/**
 * ChatSession - full conversation view
 * Shows message history + input box, with streaming typewriter effect
 */
import { useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, ArrowLeft, Trash2, MessageSquare, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, CliConfig, Conversation } from '../../types/chat';
import { PageContainer, PageHeader, PageContent, Card } from '../../components/Layout';
import { isActionEnterKey, isComposingKeyboardEvent } from '../../core/keyboard';

interface ChatSessionProps {
  cli: CliConfig;
  conversation: Conversation;
  messages: Message[];
  isConnected: boolean;
  isStreaming: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onBack: () => void;
  onClear: () => void;
}

export function ChatSession({
  cli,
  conversation,
  messages,
  isConnected,
  isStreaming,
  input,
  onInputChange,
  onSend,
  onStop,
  onBack,
  onClear,
}: ChatSessionProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when streaming
  useEffect(() => {
    if (isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isComposingKeyboardEvent(e)) return;

    if (isActionEnterKey(e) && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  }, []);

  const headerActions = (
    <>
      <button
        onClick={onBack}
        className="p-2 rounded-xl text-[var(--text-muted)] hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)] transition-all"
        title="Back"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <button
        onClick={onClear}
        className="p-2 rounded-xl text-[var(--text-muted)] hover:bg-red-50 hover:text-red-500 transition-all"
        title="Clear conversation"
      >
        <Trash2 className="w-5 h-5" />
      </button>
    </>
  );

  return (
    <PageContainer>
      <PageHeader
        title={cli.name}
        subtitle={isConnected ? "Connected" : "Disconnected"}
        icon={MessageSquare}
        actions={headerActions}
      />

      <PageContent maxWidth="900px">
        <Card noPadding style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-6">
              {/* Conversation title */}
              <div className="text-center py-4">
                <h2 className="text-lg font-semibold text-[var(--text-main)]">{conversation.title}</h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {new Date(conversation.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>

              {/* Message list */}
              {messages.map((msg, index) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLast={index === messages.length - 1}
                  isStreaming={isStreaming && index === messages.length - 1 && msg.role === 'assistant'}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input area */}
          <div className="p-4 bg-white/60 backdrop-blur-xl border-t border-[var(--border-color)]">
            <div className="flex items-end gap-2 p-2 rounded-2xl bg-white/80 border border-[var(--border-color)] shadow-soft focus-within:border-[var(--color-primary)] focus-within:shadow-medium transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onInput={handleInput}
                placeholder="Continue the conversation..."
                disabled={!isConnected || isStreaming}
                rows={1}
                className="flex-1 resize-none bg-transparent px-3 py-2.5 text-[var(--text-main)] placeholder:text-[var(--text-muted)]/60 outline-none text-sm"
                style={{ minHeight: '40px', maxHeight: '120px' }}
              />
              <button
                onClick={isStreaming ? onStop : onSend}
                disabled={isStreaming ? false : (!input.trim() || !isConnected)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl
                  bg-[var(--color-primary)] text-white
                  transition-all hover:bg-[var(--color-primary-dark)] hover:scale-105
                  disabled:opacity-40 disabled:cursor-not-allowed"
                title={isStreaming ? "Stop current reply" : "Send"}
              >
                {isStreaming ? (
                  <Square className="h-4 w-4 fill-current" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-center text-xs text-[var(--text-muted)] mt-2">
              Enter to send, Shift + Enter for new line
            </p>
          </div>
        </Card>
      </PageContent>
    </PageContainer>
  );
}

// Typing cursor component - Claude Code style
function TypingCursor() {
  return (
    <span className="inline-flex items-center ml-1">
      <span className="w-2 h-4 bg-[var(--color-primary)] animate-pulse rounded-sm" />
    </span>
  );
}

function processText(value: unknown, fallback = ''): string {
  return String(value ?? fallback).trim();
}

function processJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function splitToolContent(message: Message) {
  const command = processText(message.metadata?.command ?? message.metadata?.toolName);
  const raw = message.content.trim();
  return {
    command,
    output: command && raw.startsWith(command) ? raw.slice(command.length).trim() : raw,
  };
}

function ProcessMessage({ message }: { message: Message }) {
  const isTool = message.contentType === 'tool_call';
  const { command, output } = isTool ? splitToolContent(message) : { command: '', output: message.content.trim() };
  const label = isTool
    ? processText(message.metadata?.label, message.status === 'completed' ? 'Command finished' : 'Command running')
    : message.status === 'completed' ? 'Thought process' : 'Thinking';
  const metadata = processJson(message.metadata);

  return (
    <details open={message.status !== 'completed'} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[var(--color-primary)]">
        <span>{label}</span>
      </summary>

      <div className="mt-3 space-y-3">
        {command && (
          <div>
            <div className="mb-1 text-xs font-semibold text-[var(--text-muted)]">Command</div>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-[var(--border-color)] bg-blue-50/50 p-2 text-xs leading-relaxed text-slate-700">
              {command}
            </pre>
          </div>
        )}

        {output ? (
          <div>
            <div className="mb-1 text-xs font-semibold text-[var(--text-muted)]">{isTool ? 'Output' : 'Thinking'}</div>
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-[var(--border-color)] bg-slate-50 p-2 text-xs leading-relaxed text-slate-700">
              {output}
            </pre>
          </div>
        ) : (
          <div className="text-xs text-[var(--text-muted)]">Waiting for output...</div>
        )}

        {metadata !== '{}' && (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-[var(--text-muted)]">Raw events</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-[var(--border-color)] bg-slate-50 p-2 text-xs leading-relaxed text-[var(--text-muted)]">
              {metadata}
            </pre>
          </details>
        )}
      </div>
    </details>
  );
}

// Message bubble component with streaming support
function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isLast?: boolean;
  isStreaming?: boolean;
}) {
  const isUser = message.role === 'user';
  const isError = message.contentType === 'error';
  const isProcess = message.contentType === 'tool_call' || message.contentType === 'thinking';

  if (!isUser && !isError && !isProcess && !message.content.trim()) {
    return null;
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl
          ${isUser ? 'bg-[var(--color-primary)]' : 'bg-white border border-[var(--border-color)]'}
          ${isError ? 'bg-red-500' : ''}`}
      >
        {isUser ? (
          <User className="h-4 w-4 text-white" />
        ) : (
          <Bot className="h-4 w-4 text-[var(--color-primary)]" />
        )}
      </div>

      {/* Content */}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-soft
          ${
            isUser
              ? 'bg-[var(--color-primary)] text-white rounded-tr-sm'
              : isError
              ? 'bg-red-50 text-red-600 border border-red-200'
              : 'bg-white border border-[var(--border-color)] rounded-tl-sm'
          }`}
      >
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        ) : isProcess ? (
          <ProcessMessage message={message} />
        ) : (
          <div className="prose prose-sm max-w-none text-[var(--text-main)]">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>,
                code: ({ children }) => <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{children}</code>,
              }}
            >
              {message.content}
            </ReactMarkdown>
            {isStreaming && <TypingCursor />}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatSession;
