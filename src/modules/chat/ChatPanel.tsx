/**
 * ChatPanel - main chat panel (with multi-conversation tabs)
 * Flow: ChatHome -> start conversation -> ChatSession (smooth transition)
 * Supports multiple conversation tabs, switchable like a browser
 */
import { useState, useCallback, useEffect } from 'react';
import { ChatHome } from './ChatHome';
import { ChatSession } from './ChatSession';
import { useChat } from '../../hooks/useChat';
import { X, Plus, MessageSquare, Wifi, WifiOff } from 'lucide-react';
import type { Message } from '../../types/chat';

export function ChatPanel() {
  const {
    availableClis,
    selectedCli,
    conversations,
    activeConversation,
    createNewConversation,
    switchConversation,
    closeConversation,
    messages,
    sendMessage,
    stopGeneration,
    isConnected,
    isStreaming,
    error,
    clearError,
  } = useChat();

  // Local state
  const [hasStarted, setHasStarted] = useState(false);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Sync messages into local state
  useEffect(() => {
    setLocalMessages(messages);
  }, [messages]);

  // Sync active conversation state
  useEffect(() => {
    if (activeConversation) {
      setHasStarted(true);
    }
  }, [activeConversation]);

  // Start a new conversation
  const handleStartChat = useCallback(async (initialMessage: string, cliId?: string) => {
    // Use the given cliId or the currently selected CLI
    const targetCliId = cliId || selectedCli?.id;
    if (!targetCliId && availableClis.length === 0) {
      return;
    }

    setIsCreating(true);

    try {
      // Create the conversation first (this connects the WebSocket)
      const conv = await createNewConversation(
        targetCliId,
        initialMessage.slice(0, 30)
      );

      if (conv) {
        // Send the message (WebSocket should be connected by now)
        await sendMessage(initialMessage, conv);
      }
    } catch (e) {
      console.error('Failed to start chat:', e);
    } finally {
      setIsCreating(false);
    }
  }, [selectedCli, availableClis, createNewConversation, sendMessage]);

  // Continue conversation
  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeConversation) return;

    const content = input;
    setInput('');

    // Send to backend
    await sendMessage(content);
  }, [input, activeConversation, sendMessage]);

  // Switch conversation
  const handleSwitchConversation = useCallback(async (convId: string) => {
    await switchConversation(convId);
  }, [switchConversation]);

  // Close conversation
  const handleCloseConversation = useCallback((e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    void closeConversation(convId);

    // If the last conversation was closed, go back home
    if (conversations.length <= 1) {
      setHasStarted(false);
      setLocalMessages([]);
    }
  }, [closeConversation, conversations.length]);

  // New conversation
  const handleNewConversation = useCallback(async () => {
    if (!selectedCli && availableClis.length === 0) return;

    setIsCreating(true);
    try {
      await createNewConversation(selectedCli?.id, 'New conversation');
    } finally {
      setIsCreating(false);
    }
  }, [selectedCli, availableClis, createNewConversation]);

  // Back to home
  const handleBack = useCallback(() => {
    setHasStarted(false);
    setLocalMessages([]);
  }, []);

  // Clear current conversation
  const handleClear = useCallback(() => {
    setLocalMessages([]);
  }, []);

  // Show error message if there is one
  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-app)]">
        <div className="text-center p-8">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={clearError}
            className="px-4 py-2 rounded-xl bg-[var(--color-primary)] text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const currentCli = selectedCli || availableClis[0];

  return (
    <div className="h-full flex flex-col bg-[var(--bg-app)]">
      {/* Conversation tab bar - browser style */}
      {conversations.length > 0 && (
        <div className="flex items-center gap-1 px-2 py-2 bg-white/60 backdrop-blur-xl border-b border-[var(--border-color)] overflow-x-auto">
          {conversations.map((conv) => {
            const isActive = activeConversation?.id === conv.id;
            return (
              <div
                key={conv.id}
                onClick={() => handleSwitchConversation(conv.id)}
                className={`
                  group flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer
                  transition-all duration-200 min-w-[120px] max-w-[200px]
                  ${isActive
                    ? 'bg-white shadow-soft border border-[var(--border-color)]'
                    : 'bg-transparent hover:bg-white/40 border border-transparent'
                  }
                `}
              >
                <MessageSquare className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                <span className="flex-1 text-sm truncate text-[var(--text-main)]">
                  {conv.title}
                </span>
                <button
                  onClick={(e) => handleCloseConversation(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--bg-hover)] transition-all"
                >
                  <X className="w-3 h-3 text-[var(--text-muted)]" />
                </button>
              </div>
            );
          })}

          {/* New conversation button */}
          <button
            onClick={handleNewConversation}
            disabled={isCreating}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/60 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4 text-[var(--text-muted)]" />
          </button>

          {/* Connection status indicator */}
          <div className="ml-auto flex items-center gap-2 px-3">
            {isConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-green-500" />
                <span className="text-xs text-green-600">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs text-red-500">Disconnected</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 relative overflow-hidden">
        {/* ChatHome - input view */}
        <div
          className={`absolute inset-0 transition-all duration-500 ease-out ${
            hasStarted ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
          }`}
        >
          <ChatHome
            onStartChat={handleStartChat}
            isLoading={isCreating}
          />
        </div>

        {/* ChatSession - conversation view */}
        {hasStarted && activeConversation && (
          <div
            className={`absolute inset-0 transition-all duration-500 ease-out ${
              hasStarted ? 'opacity-100 scale-100' : 'opacity-0 scale-105 pointer-events-none'
            }`}
          >
            <ChatSession
              cli={currentCli}
              conversation={activeConversation}
              messages={localMessages}
              isConnected={isConnected}
              isStreaming={isStreaming}
              input={input}
              onInputChange={setInput}
              onSend={handleSend}
              onStop={() => {
                void stopGeneration(activeConversation.id);
              }}
              onBack={handleBack}
              onClear={handleClear}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatPanel;
