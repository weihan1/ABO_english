/**
 * MessageItem - single chat message component
 * Strictly follows the AionUi design spec
 * - User messages: right-aligned, white background, with a [You] tag
 * - Assistant messages: left-aligned, with border
 * - Markdown rendering + code highlighting + streaming cursor + tool call display
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '../../types/chat';

interface MessageItemProps {
  message: Message;
  isStreaming?: boolean;
}

/**
 * Format timestamp
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Code block rendering component
 */
function CodeBlock({
  inline,
  className,
  children,
  ...props
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const match = /language-(\w+)/.exec(className || '');
  return !inline && match ? (
    <SyntaxHighlighter
      style={oneLight as any}
      language={match[1]}
      PreTag="div"
      {...props}
    >
      {String(children).replace(/\n$/, '')}
    </SyntaxHighlighter>
  ) : (
    <code
      className="bg-[#F5F5F0] px-1.5 py-0.5 rounded text-sm"
      {...props}
    >
      {children}
    </code>
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

function ProcessDisplay({ message }: { message: Message }) {
  const isTool = message.contentType === 'tool_call';
  const { command, output } = isTool ? splitToolContent(message) : { command: '', output: message.content.trim() };
  const label = isTool
    ? processText(message.metadata?.label, message.status === 'completed' ? 'Command finished' : 'Command running')
    : message.status === 'completed' ? 'Thought process' : 'Thinking';
  const metadata = processJson(message.metadata);

  return (
    <details open={message.status !== 'completed'} className="my-2 rounded-md bg-[#F5F5F0] px-3 py-2 text-sm text-[#666666]">
      <summary className="cursor-pointer list-none font-medium text-[#4A3A5E]">
        {label}
      </summary>
      <div className="mt-2 space-y-2">
        {command && (
          <div>
            <div className="mb-1 text-xs font-semibold text-[#777777]">Command</div>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-white/70 p-2 text-xs leading-relaxed text-[#555555]">
              {command}
            </pre>
          </div>
        )}
        {output ? (
          <div>
            <div className="mb-1 text-xs font-semibold text-[#777777]">{isTool ? 'Output' : 'Thinking'}</div>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-white/70 p-2 text-xs leading-relaxed text-[#555555]">
              {output}
            </pre>
          </div>
        ) : (
          <div className="text-xs text-[#777777]">Waiting for output...</div>
        )}
        {metadata !== '{}' && (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-[#777777]">Raw events</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-white/70 p-2 text-xs leading-relaxed text-[#777777]">
              {metadata}
            </pre>
          </details>
        )}
      </div>
    </details>
  );
}

export function MessageItem({ message, isStreaming }: MessageItemProps) {
  const isUser = message.role === 'user';
  const isToolCall = message.contentType === 'tool_call';
  const isThinking = message.contentType === 'thinking';
  const isError = message.contentType === 'error';
  const timestamp = formatTimestamp(message.createdAt);

  if (!isUser && !isError && !isToolCall && !isThinking && !message.content.trim()) {
    return null;
  }

  return (
    <div
      className={`flex ${isUser ? 'flex-row-reverse' : 'flex-row'} gap-3`}
    >
      {/* Message bubble */}
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-white shadow-sm'
            : isError
            ? 'bg-red-50 border border-red-200'
            : 'bg-white border border-[#E6DDF2]'
        }`}
      >
        {(isToolCall || isThinking) && <ProcessDisplay message={message} />}

        {/* Error display */}
        {isError && (
          <div className="text-red-600 text-sm mb-2">⚠️ Error</div>
        )}

        {/* Message content */}
        <div className="prose prose-sm max-w-none">
          {!isToolCall && !isThinking && (
            <ReactMarkdown
              components={{
                code: CodeBlock,
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}

          {/* Streaming cursor */}
          {isStreaming && !isToolCall && !isThinking && (
            <span className="inline-block w-2 h-5 ml-1 bg-[#7B5EA7] animate-pulse">
              ▋
            </span>
          )}
        </div>

        {/* Timestamp */}
        <div
          className={`mt-2 text-xs text-[#666666] ${
            isUser ? 'text-right' : 'text-left'
          }`}
        >
          {isUser && <span className="mr-1">[You]</span>}
          {timestamp}
        </div>
      </div>
    </div>
  );
}

export default MessageItem;
