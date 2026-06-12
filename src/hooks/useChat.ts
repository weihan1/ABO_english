import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatRunStatus, Conversation, Message, StreamEvent, CliConfig } from '../types/chat';
import {
  detectClis,
  createConversation,
  deleteConversation as deleteConversationApi,
  getConversation,
  getMessages,
  listConversations,
  stopConversation as stopConversationApi,
  warmupConversation,
} from '../api/chat';
import { buildWsUrl } from '../core/api';
import { useStore } from '../core/store';

interface CloseConversationOptions {
  activateFallback?: boolean;
  deleteRemote?: boolean;
}

interface QueuedSend {
  content: string;
  conversation: Conversation;
  contextScope?: string;
}

interface UseChatReturn {
  // CLI
  availableClis: CliConfig[];
  selectedCli: CliConfig | null;
  selectCli: (cli: CliConfig) => void;

  // Conversations (tabs)
  conversations: Conversation[];
  activeConversation: Conversation | null;
  createNewConversation: (cliType?: string, title?: string, workspace?: string, origin?: string) => Promise<Conversation | null>;
  switchConversation: (convId: string) => Promise<void>;
  closeConversation: (convId: string, options?: CloseConversationOptions) => Promise<void>;

  // Messages
  messages: Message[];
  sendMessage: (content: string, conversationOverride?: Conversation | null, contextScope?: string) => Promise<void>;
  stopGeneration: (convId?: string) => Promise<void>;
  isStreaming: boolean;
  streamStatus: ChatRunStatus | null;

  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  connectionState: string;

  // Actions
  clearError: () => void;
  refreshConversations: () => Promise<void>;
}

export function useChat(): UseChatReturn {
  const aiProvider = useStore((state) => state.aiProvider);

  // CLI state
  const [availableClis, setAvailableClis] = useState<CliConfig[]>([]);
  const [selectedCli, setSelectedCli] = useState<CliConfig | null>(null);

  // Conversations state (tabs)
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);

  // Messages state
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamStatus, setStreamStatus] = useState<ChatRunStatus | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const currentMsgIdRef = useRef<string>('');
  const currentTurnStartedAtRef = useRef<number | null>(null);
  const activeTurnConversationIdRef = useRef<string | null>(null);
  const pendingMessagesRef = useRef<Map<string, Message[]>>(new Map());
  const queuedSendsRef = useRef<Map<string, QueuedSend[]>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const connectedSessionRef = useRef<string | null>(null);
  const connectedCliRef = useRef<string | null>(null);
  const activeConversationRef = useRef<Conversation | null>(null);
  const refreshConversationsRef = useRef<() => Promise<void>>(async () => {});
  const stoppedNoticeRef = useRef<Set<string>>(new Set());

  const sortConversations = useCallback((items: Conversation[]) => (
    [...items].sort((a, b) => b.updatedAt - a.updatedAt)
  ), []);

  const mergeConversation = useCallback((conversation: Conversation) => {
    setConversations((prev) => sortConversations([conversation, ...prev.filter((item) => item.id !== conversation.id)]));
  }, [sortConversations]);

  const touchConversation = useCallback((conversationId: string, patch: Partial<Conversation> = {}) => {
    const nextUpdatedAt = patch.updatedAt ?? Date.now();
    setConversations((prev) => {
      const existing = prev.find((item) => item.id === conversationId);
      if (!existing) return prev;

      const nextConversation = {
        ...existing,
        ...patch,
        updatedAt: nextUpdatedAt,
      };

      return sortConversations([nextConversation, ...prev.filter((item) => item.id !== conversationId)]);
    });

    if (activeConversationRef.current?.id === conversationId) {
      const nextConversation = {
        ...activeConversationRef.current,
        ...patch,
        updatedAt: nextUpdatedAt,
      };
      activeConversationRef.current = nextConversation;
      setActiveConversation(nextConversation);
    }
  }, [sortConversations]);

  const mutateMessagesForConversation = useCallback((
    conversationId: string,
    updater: (items: Message[]) => Message[],
  ) => {
    if (!conversationId) return;

    if (activeConversationRef.current?.id === conversationId) {
      setMessages((prev) => {
        const next = updater(prev);
        pendingMessagesRef.current.set(conversationId, next);
        return next;
      });
      return;
    }

    const cached = pendingMessagesRef.current.get(conversationId) ?? [];
    pendingMessagesRef.current.set(conversationId, updater(cached));
  }, []);

  const getEventConversationId = useCallback((event: StreamEvent) => {
    const metadata = event.metadata ?? {};
    const fromEvent = event.conversationId;
    const fromMetadata = metadata.conversationId ?? metadata.conversation_id;
    return String(fromEvent ?? fromMetadata ?? activeConversationRef.current?.id ?? '');
  }, []);

  const getToolMessageId = useCallback((event: StreamEvent) => {
    const metadata = event.metadata ?? {};
    const toolKey =
      metadata.toolCallId
      ?? metadata.tool_call_id
      ?? metadata.callId
      ?? metadata.call_id
      ?? metadata.id
      ?? metadata.command
      ?? event.data
      ?? event.msgId;
    return `tool-${event.msgId}-${String(toolKey).slice(0, 120)}`;
  }, []);

  const getThinkingMessageId = useCallback((event: StreamEvent) => `thinking-${event.msgId}`, []);

  const isThinkingEvent = useCallback((event: StreamEvent) => {
    const metadata = event.metadata ?? {};
    const phase = String(metadata.phase ?? '').toLowerCase();
    const label = String(metadata.label ?? event.data ?? '');
    return event.type === 'thinking' || event.type === 'thought' || phase === 'thinking' || phase === 'thought' || label.includes('思考') || label.toLowerCase().includes('think');
  }, []);

  const upsertThinkingMessage = useCallback((event: StreamEvent, conversationId: string, append = false) => {
    if (!conversationId || !event.msgId) return;

    const metadata = event.metadata ?? {};
    const label = String(metadata.label ?? event.data ?? 'Thinking').trim() || 'Thinking';
    const detail = String(metadata.detail ?? metadata.phaseDetail ?? '').trim();
    const content = detail && detail !== label ? `${label}\n${detail}` : label;
    const thinkingMessageId = getThinkingMessageId(event);

    mutateMessagesForConversation(conversationId, (prev) => {
      const existing = prev.find((message) => message.id === thinkingMessageId);
      if (!existing) {
        return [
          ...prev,
          {
            id: thinkingMessageId,
            conversationId,
            msgId: thinkingMessageId,
            role: 'assistant',
            content,
            contentType: 'thinking',
            metadata,
            status: 'streaming',
            createdAt: Date.now(),
          },
        ];
      }

      return prev.map((message) =>
        message.id === thinkingMessageId
          ? {
              ...message,
              content: append && content ? `${message.content}${message.content ? '\n' : ''}${content}` : content,
              metadata: { ...message.metadata, ...metadata },
              status: 'streaming',
            }
          : message,
      );
    });
  }, [getThinkingMessageId, mutateMessagesForConversation]);

  const enqueueSend = useCallback((payload: QueuedSend) => {
    const existing = queuedSendsRef.current.get(payload.conversation.id) ?? [];
    queuedSendsRef.current.set(payload.conversation.id, [...existing, payload]);
  }, []);

  const dequeueSend = useCallback((conversationId: string): QueuedSend | null => {
    const existing = queuedSendsRef.current.get(conversationId) ?? [];
    if (existing.length === 0) {
      return null;
    }

    const [next, ...rest] = existing;
    if (rest.length > 0) {
      queuedSendsRef.current.set(conversationId, rest);
    } else {
      queuedSendsRef.current.delete(conversationId);
    }

    return next;
  }, []);

  // Detect CLIs on mount
  useEffect(() => {
    detectClis()
      .then((clis) => {
        console.log('[useChat] Detected CLIs:', clis);
        setAvailableClis(clis);
        if (clis.length > 0) {
          const preferredCli = clis.find((cli) => cli.id === aiProvider) ?? clis[0];
          if (!selectedCli || !clis.some((cli) => cli.id === selectedCli.id) || selectedCli.id !== preferredCli.id) {
            setSelectedCli(preferredCli);
          }
        }
      })
      .catch((e) => {
        console.error('[useChat] Failed to detect CLIs:', e);
        setError(e.message);
      });
  }, [aiProvider, selectedCli]);

  // Load initial conversations
  useEffect(() => {
    refreshConversations();
  }, []);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  // WebSocket connection management
  const connectWebSocket = useCallback((cliType: string, sessionId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (
        wsRef.current?.readyState === WebSocket.OPEN
        && connectedSessionRef.current === sessionId
        && connectedCliRef.current === cliType
      ) {
        console.log('[WebSocket] Already connected');
        resolve();
        return;
      }

      if (!sessionId) {
        console.error('[WebSocket] No sessionId provided');
        reject(new Error('No sessionId'));
        return;
      }

      if (wsRef.current) {
        console.log('[WebSocket] Replacing existing connection');
        wsRef.current.close();
        wsRef.current = null;
      }

      const wsUrl = buildWsUrl(`/api/chat/ws/${cliType}/${sessionId}`);
      console.log('[WebSocket] Connecting to:', wsUrl);

      try {
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('[WebSocket] Connected');
          connectedSessionRef.current = sessionId;
          connectedCliRef.current = cliType;
          setIsConnected(true);
          resolve();
        };

        ws.onmessage = (event) => {
          try {
            const data: StreamEvent = JSON.parse(event.data);
            console.log('[WebSocket] Received:', data.type);
            handleStreamEvent(data);
          } catch (e) {
            console.error('[WebSocket] Failed to parse message:', e);
          }
        };

        ws.onclose = () => {
          console.log('[WebSocket] Disconnected');
          connectedSessionRef.current = null;
          connectedCliRef.current = null;
          setIsConnected(false);
          setIsStreaming(false);
          wsRef.current = null;
        };

        ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          connectedSessionRef.current = null;
          connectedCliRef.current = null;
          setIsConnected(false);
          setError('WebSocket connection error');
          reject(error);
        };

        wsRef.current = ws;
      } catch (e) {
        console.error('[WebSocket] Failed to create connection:', e);
        reject(e);
      }
    });
  }, []);

  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) {
      console.log('[WebSocket] Disconnecting...');
      wsRef.current.close();
      wsRef.current = null;
    }
    connectedSessionRef.current = null;
    connectedCliRef.current = null;
  }, []);

  const sendViaWebSocket = useCallback((content: string, conversationId: string, contextScope?: string): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Sending message');
      wsRef.current.send(JSON.stringify({
        type: 'message',
        content,
        conversation_id: conversationId,
        context_scope: contextScope,
      }));
      return true;
    }
    console.error('[WebSocket] Not connected, cannot send');
    return false;
  }, []);

  const sendStopViaWebSocket = useCallback((conversationId: string): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'stop',
        conversation_id: conversationId,
        msg_id: currentMsgIdRef.current,
      }));
      return true;
    }
    return false;
  }, []);

  const beginLocalTurn = useCallback((conversation: Conversation, label = 'Sending to worker') => {
    const now = Date.now();
    stoppedNoticeRef.current.delete(conversation.id);
    activeTurnConversationIdRef.current = conversation.id;
    currentTurnStartedAtRef.current = now;
    setIsStreaming(true);
    setStreamStatus({
      phase: 'dispatch',
      label,
      elapsedSeconds: 0,
      conversationId: conversation.id,
      cliType: conversation.cliType,
      updatedAt: now,
    });
  }, []);

  const dispatchSend = useCallback(async (payload: QueuedSend) => {
    const { content, conversation, contextScope } = payload;
    beginLocalTurn(conversation);

    if (
      wsRef.current?.readyState !== WebSocket.OPEN
      || connectedSessionRef.current !== conversation.sessionId
      || connectedCliRef.current !== conversation.cliType
    ) {
      console.log('[useChat] Not connected to target conversation, reconnecting...');
      try {
        await connectWebSocket(conversation.cliType, conversation.sessionId);
      } catch (e) {
        activeTurnConversationIdRef.current = null;
        currentTurnStartedAtRef.current = null;
        setIsStreaming(false);
        setStreamStatus(null);
        setError('WebSocket connection failed');
        return false;
      }
    }

    const sent = sendViaWebSocket(content, conversation.id, contextScope);
    if (!sent) {
      activeTurnConversationIdRef.current = null;
      currentTurnStartedAtRef.current = null;
      setIsStreaming(false);
      setStreamStatus(null);
      setError('Send failed - WebSocket not connected');
      return false;
    }
    return true;
  }, [beginLocalTurn, connectWebSocket, sendViaWebSocket]);

  const finalizeStoppedTurn = useCallback((conversationId?: string, notice = 'Current reply stopped') => {
    const targetConversationId = conversationId || activeTurnConversationIdRef.current || activeConversationRef.current?.id || '';
    if (!targetConversationId) return;

    queuedSendsRef.current.delete(targetConversationId);
    if (activeTurnConversationIdRef.current === targetConversationId) {
      activeTurnConversationIdRef.current = null;
    }
    currentTurnStartedAtRef.current = null;
    currentMsgIdRef.current = '';

    if (activeConversationRef.current?.id === targetConversationId) {
      setIsStreaming(false);
      setStreamStatus(null);
    }

    mutateMessagesForConversation(targetConversationId, (prev) => {
      const finalized = prev.map((message) =>
        message.status === 'streaming'
          ? { ...message, status: 'completed' as const }
          : message,
      );

      if (stoppedNoticeRef.current.has(targetConversationId)) {
        return finalized;
      }
      stoppedNoticeRef.current.add(targetConversationId);
      return [
        ...finalized,
        {
          id: `stopped-${targetConversationId}-${Date.now()}`,
          conversationId: targetConversationId,
          role: 'system',
          content: notice,
          contentType: 'agent_status',
          status: 'completed',
          createdAt: Date.now(),
        },
      ];
    });
  }, [mutateMessagesForConversation]);

  const stopGeneration = useCallback(async (convId?: string) => {
    const targetConversationId = convId || activeTurnConversationIdRef.current || activeConversationRef.current?.id;
    if (!targetConversationId) return;

    queuedSendsRef.current.delete(targetConversationId);

    if (activeConversationRef.current?.id === targetConversationId) {
      const now = Date.now();
      setStreamStatus({
        phase: 'stopping',
        label: 'Stopping current reply',
        elapsedSeconds: currentTurnStartedAtRef.current
          ? Math.max(0, Math.floor((now - currentTurnStartedAtRef.current) / 1000))
          : 0,
        conversationId: targetConversationId,
        cliType: activeConversationRef.current?.cliType,
        updatedAt: now,
      });
    }

    const sentOverWebSocket = sendStopViaWebSocket(targetConversationId);
    try {
      await stopConversationApi(targetConversationId);
      if (!sentOverWebSocket) {
        finalizeStoppedTurn(targetConversationId);
      } else {
        window.setTimeout(() => {
          if (activeTurnConversationIdRef.current === targetConversationId) {
            finalizeStoppedTurn(targetConversationId);
          }
        }, 2500);
      }
      window.setTimeout(() => {
        void refreshConversationsRef.current();
      }, 150);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop the conversation');
      if (!sentOverWebSocket) {
        finalizeStoppedTurn(targetConversationId, 'Stop request sent, but the backend did not confirm');
      }
    }
  }, [finalizeStoppedTurn, sendStopViaWebSocket]);

  const updateStreamStatus = useCallback((event: StreamEvent, fallbackLabel: string, conversationId?: string) => {
    if (conversationId && activeConversationRef.current?.id !== conversationId) {
      return;
    }

    const now = Date.now();
    if (!currentTurnStartedAtRef.current) {
      currentTurnStartedAtRef.current = now;
    }

    const metadata = event.metadata ?? {};
    const elapsedFromBackend = Number(metadata.elapsedSeconds ?? metadata.elapsed_seconds);
    const elapsedSeconds = Number.isFinite(elapsedFromBackend)
      ? Math.max(0, Math.floor(elapsedFromBackend))
      : Math.max(0, Math.floor((now - currentTurnStartedAtRef.current) / 1000));

    const label = String(metadata.label ?? event.data ?? fallbackLabel).trim() || fallbackLabel;
    const detailValue = metadata.detail ?? metadata.command ?? metadata.phaseDetail;

    setStreamStatus({
      phase: String(metadata.phase ?? event.type),
      label,
      detail: detailValue === undefined || detailValue === null ? undefined : String(detailValue),
      elapsedSeconds,
      conversationId: conversationId ?? activeConversationRef.current?.id,
      cliType: String(metadata.cliType ?? metadata.cli_type ?? activeConversationRef.current?.cliType ?? ''),
      updatedAt: now,
    });
  }, []);

  // Handle stream events (convert snake_case to camelCase)
  const handleStreamEvent = useCallback((rawEvent: any) => {
    // Convert snake_case to camelCase
    const event: StreamEvent = {
      type: rawEvent.type,
      data: rawEvent.data || '',
      msgId: rawEvent.msg_id || rawEvent.msgId || '',
      metadata: rawEvent.metadata,
      conversationId: rawEvent.conversation_id || rawEvent.conversationId,
      timestamp: rawEvent.timestamp,
    };
    console.log('[WebSocket] Event:', event.type, event);
    const conversationId = getEventConversationId(event);
    const eventIsActive = !conversationId || activeConversationRef.current?.id === conversationId;

    switch (event.type) {
      case 'start':
        if (eventIsActive) {
          setIsStreaming(true);
        }
        currentTurnStartedAtRef.current = Date.now();
        if (conversationId) {
          activeTurnConversationIdRef.current = conversationId;
        }
        updateStreamStatus(event, 'Worker started', conversationId);
        currentMsgIdRef.current = event.msgId;
        if (conversationId) {
          touchConversation(conversationId);
        }
        mutateMessagesForConversation(conversationId, (prev) => {
          if (prev.some((message) => message.msgId === event.msgId && message.role === 'assistant' && message.contentType === 'text')) {
            return prev;
          }
          return [
            ...prev,
            {
              id: event.msgId,
              conversationId,
              msgId: event.msgId,
              role: 'assistant',
              content: '',
              contentType: 'text',
              status: 'streaming',
              createdAt: Date.now(),
            },
          ];
        });
        break;

      case 'status':
        if (eventIsActive) {
          setIsStreaming(true);
        }
        if (conversationId) {
          activeTurnConversationIdRef.current = conversationId;
        }
        if (event.msgId) {
          currentMsgIdRef.current = event.msgId;
        }
        updateStreamStatus(event, 'Worker processing', conversationId);
        if (isThinkingEvent(event)) {
          upsertThinkingMessage(event, conversationId);
        }
        break;

      case 'thinking':
      case 'thought':
        if (eventIsActive) {
          setIsStreaming(true);
        }
        if (conversationId) {
          activeTurnConversationIdRef.current = conversationId;
        }
        if (event.msgId) {
          currentMsgIdRef.current = event.msgId;
        }
        updateStreamStatus(event, 'Thinking', conversationId);
        upsertThinkingMessage(event, conversationId, true);
        break;

      case 'content':
        updateStreamStatus(event, 'Receiving reply', conversationId);
        mutateMessagesForConversation(conversationId, (prev) => {
          const existing = prev.find((message) => message.msgId === event.msgId && message.role === 'assistant' && message.contentType === 'text');
          if (!existing) {
            return [
              ...prev,
              {
                id: event.msgId || `assistant-${Date.now()}`,
                conversationId,
                msgId: event.msgId,
                role: 'assistant',
                content: event.data,
                contentType: 'text',
                status: 'streaming',
                createdAt: Date.now(),
              },
            ];
          }
          return prev.map((m) =>
            m.id === existing.id
              ? { ...m, content: m.content + event.data, status: 'streaming' }
              : m
          );
        });
        break;

      case 'tool_call': {
        const toolData = event.metadata || {};
        const toolMessageId = getToolMessageId(event);
        const command = String(toolData.command ?? toolData.toolName ?? event.data ?? 'Tool call');
        const phase = String(toolData.phase ?? '');
        const status = phase === 'tool_done' || phase === 'done' || phase === 'completed' ? 'completed' : 'streaming';
        const content = event.data && event.data !== command ? `${command}\n\n${event.data}` : command;
        updateStreamStatus(event, 'Running tool', conversationId);
        mutateMessagesForConversation(conversationId, (prev) => {
          const nextMessage: Message = {
            id: toolMessageId,
            conversationId,
            msgId: toolMessageId,
            role: 'assistant',
            content,
            contentType: 'tool_call',
            metadata: toolData,
            status,
            createdAt: Date.now(),
          };

          if (prev.some((message) => message.id === toolMessageId)) {
            return prev.map((message) => (message.id === toolMessageId ? { ...message, ...nextMessage, createdAt: message.createdAt } : message));
          }
          return [...prev, nextMessage];
        });
        break;
      }

      case 'finish':
        if (eventIsActive) {
          setIsStreaming(false);
          setStreamStatus(null);
        }
        currentTurnStartedAtRef.current = null;
        activeTurnConversationIdRef.current = null;
        mutateMessagesForConversation(conversationId, (prev) =>
          prev.map((m) =>
            m.msgId === event.msgId
              || m.msgId === currentMsgIdRef.current
              || m.id === getThinkingMessageId(event)
              || m.msgId?.startsWith(`tool-${event.msgId}-`)
              ? { ...m, status: 'completed' }
              : m
          ),
        );
        if (conversationId) {
          const queued = dequeueSend(conversationId);
          if (queued) {
            window.setTimeout(() => {
              void dispatchSend(queued);
            }, 0);
          }
        }
        window.setTimeout(() => {
          void refreshConversationsRef.current();
        }, 150);
        break;

      case 'stopped':
        finalizeStoppedTurn(conversationId, event.data || 'Current reply stopped');
        window.setTimeout(() => {
          void refreshConversationsRef.current();
        }, 150);
        break;

      case 'error':
        if (eventIsActive) {
          setIsStreaming(false);
          setStreamStatus(null);
        }
        currentTurnStartedAtRef.current = null;
        activeTurnConversationIdRef.current = null;
        mutateMessagesForConversation(conversationId, (prev) => [
          ...prev,
          {
            id: `error-${event.msgId || Date.now()}`,
            conversationId,
            msgId: event.msgId,
            role: 'system',
            content: `Error: ${event.data}`,
            contentType: 'error',
            status: 'error',
            createdAt: Date.now(),
          },
        ]);
        if (conversationId) {
          const queued = dequeueSend(conversationId);
          if (queued) {
            window.setTimeout(() => {
              void dispatchSend(queued);
            }, 0);
          }
        }
        break;
    }
  }, [dequeueSend, dispatchSend, finalizeStoppedTurn, getEventConversationId, getThinkingMessageId, getToolMessageId, isThinkingEvent, mutateMessagesForConversation, touchConversation, updateStreamStatus, upsertThinkingMessage]);

  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const connectionState = isConnected ? 'connected' : 'disconnected';

  // Select CLI
  const selectCli = useCallback((cli: CliConfig) => {
    setSelectedCli(cli);
    setError(null);
  }, []);

  // Refresh conversations list
  const refreshConversations = useCallback(async () => {
    try {
      const convs = await listConversations();
      setConversations(sortConversations(convs));

      if (activeConversationRef.current) {
        const refreshedActive = convs.find((item) => item.id === activeConversationRef.current?.id) ?? null;
        if (refreshedActive) {
          activeConversationRef.current = refreshedActive;
          setActiveConversation(refreshedActive);
        } else if (convs.length === 0) {
          activeConversationRef.current = null;
          setActiveConversation(null);
          setMessages([]);
        }
      }
    } catch (e) {
      console.error('[useChat] Failed to load conversations:', e);
    }
  }, [sortConversations]);

  useEffect(() => {
    refreshConversationsRef.current = refreshConversations;
  }, [refreshConversations]);

  // Create new conversation
  const createNewConversation = useCallback(async (
    cliType?: string,
    title?: string,
    workspace?: string,
    origin?: string,
  ): Promise<Conversation | null> => {
    const cliId = cliType || selectedCli?.id;
    if (!cliId) {
      setError('Please select a CLI first');
      return null;
    }

    const cli = availableClis.find((c) => c.id === cliId);
    if (!cli) {
      setError(`CLI ${cliId} is not available`);
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Close existing connection
      disconnectWebSocket();

      // Create new conversation
      console.log('[useChat] Creating conversation with CLI:', cliId);
      const conv = await createConversation(cliId, title, workspace, origin);
      console.log('[useChat] Created conversation:', conv);

      // Add to conversations list
      mergeConversation(conv);
      activeConversationRef.current = conv;
      setActiveConversation(conv);
      pendingMessagesRef.current.set(conv.id, []);
      setMessages([]);

      void warmupConversation(conv.id).catch((e) => {
        console.warn('[useChat] Runtime warmup failed:', e);
      });

      // Connect WebSocket and wait for connection
      await connectWebSocket(conv.cliType, conv.sessionId);

      return conv;
    } catch (e) {
      console.error('[useChat] Failed to create conversation:', e);
      setError(e instanceof Error ? e.message : 'Unknown error');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [selectedCli, availableClis, connectWebSocket, disconnectWebSocket, mergeConversation]);

  // Switch to existing conversation
  const switchConversation = useCallback(async (convId: string) => {
    setIsLoading(true);

    try {
      let conv = conversations.find((c) => c.id === convId) ?? null;
      if (!conv) {
        conv = await getConversation(convId);
        mergeConversation(conv);
      }
      if (!conv) return;

      // Save current messages
      if (activeConversation) {
        pendingMessagesRef.current.set(activeConversation.id, messages);
      }

      // Close existing connection
      disconnectWebSocket();

      setActiveConversation(conv);
      activeConversationRef.current = conv;

      // Show the conversation shell immediately. History/context loads after the UI is usable.
      const cached = pendingMessagesRef.current.get(convId);
      setMessages(cached ?? []);

      // Find and set CLI
      const cli = availableClis.find((c) => c.id === conv.cliType);
      if (cli) setSelectedCli(cli);

      if (!cached) {
        void getMessages(convId)
          .then((history) => {
            pendingMessagesRef.current.set(convId, history);
            if (activeConversationRef.current?.id === convId) {
              setMessages(history);
            }
          })
          .catch((e) => {
            console.error('[useChat] Failed to load conversation messages:', e);
            setError(e instanceof Error ? e.message : 'Failed to load message history');
          });
      }

      void warmupConversation(conv.id).catch((e) => {
        console.warn('[useChat] Runtime warmup failed:', e);
      });

      // Connect WebSocket
      await connectWebSocket(conv.cliType, conv.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [conversations, activeConversation, messages, availableClis, connectWebSocket, disconnectWebSocket, mergeConversation]);

  // Close conversation (remove from tabs)
  const closeConversation = useCallback(async (
    convId: string,
    options: CloseConversationOptions = {},
  ) => {
    const { activateFallback = true, deleteRemote = true } = options;
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    pendingMessagesRef.current.delete(convId);
    queuedSendsRef.current.delete(convId);

    if (activeConversation?.id === convId) {
      disconnectWebSocket();

      // Switch to another conversation or clear
      const remaining = conversations.filter((c) => c.id !== convId);
      if (activateFallback && remaining.length > 0) {
        await switchConversation(remaining[0].id);
      } else {
        activeConversationRef.current = null;
        setActiveConversation(null);
        setMessages([]);
      }
    }
    if (!deleteRemote) {
      return;
    }
    try {
      await deleteConversationApi(convId);
    } catch (e) {
      console.error('[useChat] Failed to delete conversation:', e);
      setError(e instanceof Error ? e.message : 'Failed to delete conversation');
      await refreshConversations();
    }
  }, [activeConversation, conversations, disconnectWebSocket, switchConversation, refreshConversations]);

  // Send message
  const sendMessage = useCallback(async (content: string, conversationOverride?: Conversation | null, contextScope?: string) => {
    const targetConversation = conversationOverride ?? activeConversation;
    if (!targetConversation) {
      setError('No active conversation');
      return;
    }

    // Add user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      conversationId: targetConversation.id,
      role: 'user',
      content,
      contentType: 'text',
      status: 'completed',
      createdAt: Date.now(),
    };
    mutateMessagesForConversation(targetConversation.id, (prev) => [...prev, userMsg]);
    touchConversation(targetConversation.id);

    if (conversationOverride && activeConversation?.id !== conversationOverride.id) {
      activeConversationRef.current = conversationOverride;
      setActiveConversation(conversationOverride);
      mergeConversation(conversationOverride);
    }

    const hasQueuedMessages = (queuedSendsRef.current.get(targetConversation.id)?.length ?? 0) > 0;
    const shouldQueue =
      activeTurnConversationIdRef.current === targetConversation.id
      || (isStreaming && activeConversationRef.current?.id === targetConversation.id)
      || hasQueuedMessages;

    if (shouldQueue) {
      enqueueSend({
        content,
        conversation: targetConversation,
        contextScope,
      });
      return;
    }

    await dispatchSend({
      content,
      conversation: targetConversation,
      contextScope,
    });
  }, [activeConversation, dispatchSend, enqueueSend, isStreaming, mutateMessagesForConversation, touchConversation, mergeConversation]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectWebSocket();
    };
  }, [disconnectWebSocket]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshConversations();
    }, 15000);

    return () => window.clearInterval(timer);
  }, [refreshConversations]);

  return {
    availableClis,
    selectedCli,
    selectCli,
    conversations,
    activeConversation,
    createNewConversation,
    switchConversation,
    closeConversation,
    messages,
    sendMessage,
    stopGeneration,
    isStreaming,
    streamStatus,
    isConnected,
    isLoading,
    error,
    connectionState,
    clearError,
    refreshConversations,
  };
}
