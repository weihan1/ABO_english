/**
 * ChatHome - chat entry page (refactored)
 * Features: auto-detect backend CLIs, loading/empty states, unified layout
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { Sparkles, Send, Bot, Loader2, Zap, BookOpen, Lightbulb, Target, Clock, Compass, Brain, Plus, Shield, ChevronDown, History } from 'lucide-react';
import { PageContainer, PageContent, Card, LoadingState, EmptyState } from '../../components/Layout';
import { detectClis } from '../../api/chat';
import type { CliConfig } from '../../types/chat';
import { isActionEnterKey, isComposingKeyboardEvent } from '../../core/keyboard';
import { useStore } from '../../core/store';

// Quick command config
const QUICK_ACTIONS = [
  { id: 'summarize', label: 'Summarize papers', icon: BookOpen, color: 'text-blue-500' },
  { id: 'hypothesis', label: 'Generate hypotheses', icon: Lightbulb, color: 'text-amber-500' },
  { id: 'critique', label: 'Critical analysis', icon: Target, color: 'text-red-500' },
  { id: 'plan', label: 'Research planning', icon: Clock, color: 'text-green-500' },
  { id: 'energy', label: 'Energy guidance', icon: Zap, color: 'text-purple-500' },
  { id: 'insight', label: 'Spark inspiration', icon: Compass, color: 'text-pink-500' },
];

interface ChatHomeProps {
  onStartChat: (message: string, cliId?: string) => void;
  isLoading?: boolean;
}

export function ChatHome({ onStartChat, isLoading: externalLoading = false }: ChatHomeProps) {
  const aiProvider = useStore((state) => state.aiProvider);

  // Backend detection state
  const [isDetecting, setIsDetecting] = useState(true);
  const [availableClis, setAvailableClis] = useState<CliConfig[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Local state
  const [selectedCli, setSelectedCli] = useState<CliConfig | null>(null);
  const [input, setInput] = useState('');
  const [showCliSelector, setShowCliSelector] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-detect backend CLIs
  useEffect(() => {
    setIsDetecting(true);
    setError(null);

    detectClis()
      .then(clis => {
        const available = clis.filter(c => c.isAvailable);
        setAvailableClis(available);
        if (available.length > 0) {
          const preferredCli = available.find((cli) => cli.id === aiProvider) ?? available[0];
          if (!selectedCli || !available.some((cli) => cli.id === selectedCli.id) || selectedCli.id !== preferredCli.id) {
            setSelectedCli(preferredCli);
          }
        }
        setIsDetecting(false);
      })
      .catch(err => {
        console.error('Failed to detect CLIs:', err);
        setError("Could not connect to the backend service");
        setIsDetecting(false);
      });
  }, [aiProvider, selectedCli]);

  const currentCli = selectedCli || availableClis[0];
  const isLoading = isDetecting || externalLoading;

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const cliId = currentCli?.id;
    onStartChat(input.trim(), cliId);
    setInput('');
  }, [input, isLoading, currentCli, onStartChat]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isComposingKeyboardEvent(e)) return;

    if (isActionEnterKey(e) && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
  }, []);

  const handleQuickAction = useCallback((prompt: string) => {
    setInput(prev => prev ? `${prev} ${prompt}` : prompt);
    textareaRef.current?.focus();
  }, []);

  const handleSelectCli = useCallback((cli: CliConfig) => {
    setSelectedCli(cli);
    setShowCliSelector(false);
  }, []);

  // Loading state - detecting
  if (isDetecting) {
    return (
      <PageContainer>
        <LoadingState message="Detecting available AI assistants..." />
      </PageContainer>
    );
  }

  // Error state
  if (error) {
    return (
      <PageContainer>
        <PageContent centered maxWidth="600px">
          <EmptyState
            icon={Bot}
            title="Connection Failed"
            description={error}
          />
        </PageContent>
      </PageContainer>
    );
  }

  // Empty state - no usable CLI
  if (availableClis.length === 0) {
    return (
      <PageContainer>
        <PageContent centered maxWidth="600px">
          <EmptyState
            icon={Bot}
            title="No AI Assistant Available"
            description="Please install and configure Codex CLI or Claude Code"
          />
        </PageContent>
      </PageContainer>
    );
  }

  // Main view
  return (
    <PageContainer>
      <PageContent centered maxWidth="600px">
        <Card noPadding style={{ padding: 'clamp(24px, 4vw, 40px)' }}>
          {/* Top icon and greeting */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                boxShadow: '0 4px 16px rgba(188, 164, 227, 0.3)',
              }}
            >
              <Bot style={{ width: '32px', height: '32px', color: 'white' }} />
            </div>
            <h1
              style={{
                fontFamily: "'M PLUS Rounded 1c', sans-serif",
                fontSize: 'clamp(1.5rem, 3vw, 1.75rem)',
                fontWeight: 700,
                color: 'var(--text-main)',
                marginBottom: '8px',
              }}
            >
              Hi, what's the plan today?
            </h1>
            <p style={{ fontSize: '0.9375rem', color: 'var(--text-muted)' }}>
              Pick an AI assistant to start chatting
            </p>
          </div>

          {/* CLI selector */}
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center' }}>
            {showCliSelector ? (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px',
                  borderRadius: '16px',
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border-light)',
                }}
              >
                {availableClis.map(cli => (
                  <button
                    key={cli.id}
                    onClick={() => handleSelectCli(cli)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 16px',
                      borderRadius: '9999px',
                      border: '1px solid',
                      borderColor: currentCli?.id === cli.id ? 'var(--color-primary)' : 'var(--border-light)',
                      background: currentCli?.id === cli.id ? 'rgba(188, 164, 227, 0.15)' : 'var(--bg-card)',
                      color: currentCli?.id === cli.id ? 'var(--color-primary)' : 'var(--text-main)',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <Sparkles style={{ width: '14px', height: '14px' }} />
                    <span>{cli.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                onClick={() => setShowCliSelector(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 20px',
                  borderRadius: '9999px',
                  background: '#F3EDFA',
                  border: '1px solid #E6DDF2',
                  color: 'var(--color-primary)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <Sparkles style={{ width: '16px', height: '16px' }} />
                <span>{currentCli?.name || 'Choose assistant'}</span>
                <span style={{ width: '1px', height: '16px', background: 'var(--color-primary)', opacity: 0.2, margin: '0 4px' }} />
                <History style={{ width: '14px', height: '14px', opacity: 0.6 }} />
                <span style={{ width: '1px', height: '16px', background: 'var(--color-primary)', opacity: 0.2, margin: '0 4px' }} />
                <Brain style={{ width: '14px', height: '14px', color: '#F87171' }} />
                <ChevronDown style={{ width: '14px', height: '14px', opacity: 0.6, marginLeft: '4px' }} />
              </button>
            )}
          </div>

          {/* Input area */}
          <div
            style={{
              borderRadius: '16px',
              background: 'var(--bg-app)',
              border: '2px solid #E6DDF2',
              overflow: 'hidden',
              transition: 'all 0.2s ease',
            }}
          >
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              placeholder={`${currentCli?.name || 'Codex'}, send a message, upload files, open folders, or create scheduled tasks...`}
              disabled={externalLoading}
              rows={1}
              style={{
                width: '100%',
                resize: 'none',
                background: 'transparent',
                padding: '16px 20px',
                fontSize: '0.9375rem',
                lineHeight: 1.6,
                color: 'var(--text-main)',
                border: 'none',
                outline: 'none',
                minHeight: '60px',
                maxHeight: '200px',
              }}
            />

            {/* Bottom toolbar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px 12px',
              }}
            >
              {/* Left tools */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  title="Add attachment"
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <Plus style={{ width: '20px', height: '20px' }} />
                </button>

                {/* Default model pill */}
                <button
                  type="button"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    borderRadius: '9999px',
                    background: '#F5F3EE',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <Brain style={{ width: '14px', height: '14px' }} />
                  <span>Default model</span>
                </button>

                {/* Permissions pill */}
                <button
                  type="button"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    borderRadius: '9999px',
                    background: '#F5F3EE',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <Shield style={{ width: '14px', height: '14px' }} />
                  <span>Permissions · default</span>
                </button>
              </div>

              {/* Right send button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!input.trim() || externalLoading}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))',
                  border: 'none',
                  color: 'white',
                  boxShadow: '0 2px 8px rgba(188, 164, 227, 0.4)',
                  cursor: !input.trim() || externalLoading ? 'not-allowed' : 'pointer',
                  opacity: !input.trim() || externalLoading ? 0.4 : 1,
                  transition: 'all 0.2s ease',
                }}
              >
                {externalLoading ? (
                  <Loader2 style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Send style={{ width: '16px', height: '16px' }} />
                )}
              </button>
            </div>
          </div>

          {/* Quick action buttons */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '20px',
              marginBottom: '16px',
            }}
          >
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  onClick={() => handleQuickAction(action.label)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '9999px',
                    background: 'var(--bg-hover)',
                    border: '1px solid var(--border-light)',
                    color: 'var(--text-secondary)',
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-card)';
                    e.currentTarget.style.borderColor = 'var(--color-primary-light)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.borderColor = 'var(--border-light)';
                  }}
                >
                  <Icon style={{ width: '14px', height: '14px' }} className={action.color} />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>

          {/* Bottom hint */}
          <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Enter to send, Shift + Enter for new line
          </p>
        </Card>
      </PageContent>
    </PageContainer>
  );
}

export default ChatHome;
