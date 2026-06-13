import { useEffect, useState, type CSSProperties, type FC } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  BookOpen,
  CheckCircle,
  Clock,
  ExternalLink,
  FileText,
  FolderOpen,
  Headphones,
  HelpCircle,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rss,
  Search,
  ShoppingBag,
  Video,
  X,
  XCircle,
} from "lucide-react";

import { api } from "../../core/api";
import { useStore, FeedCard } from "../../core/store";
import type {
  DiagnosisResult,
  ModuleConfig,
  ModuleStatus,
  QuickFixResponse,
} from "../../types/module";
import {
  type ModuleUsageMetrics,
  formatDateTime,
  formatRelativeDate,
  getModuleFocusTokens,
} from "./moduleManagementShared";

type TabType = "overview" | "history";

interface ModuleDetailModalProps {
  module: ModuleConfig;
  usage: ModuleUsageMetrics;
  initialTab?: TabType;
  onClose: () => void;
  onUpdate: (updatedModule: ModuleConfig) => void;
  onOpenTool: () => void;
  onRun: () => void;
  onToggle: () => void;
}

type HistoryResponse = {
  cards: FeedCard[];
};

const STATUS_MAP: Record<ModuleStatus, { label: string; color: string; bg: string }> = {
  active: { label: "Running", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  paused: { label: "Paused", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  error: { label: "Needs attention", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
  unconfigured: { label: "Needs setup", color: "var(--text-muted)", bg: "var(--bg-hover)" },
};

const MODULE_ICONS: Record<string, FC<{ style?: CSSProperties }>> = {
  "arxiv-tracker": BookOpen,
  "semantic-scholar-tracker": FileText,
  "bilibili-tracker": Video,
  "xiaohongshu-tracker": ShoppingBag,
  "xiaoyuzhou-tracker": Headphones,
  "zhihu-tracker": HelpCircle,
  "folder-monitor": FolderOpen,
};

const MODULE_GRADIENTS: Record<string, string> = {
  "arxiv-tracker": "linear-gradient(135deg, #BCA4E3, #9D7BDB)",
  "semantic-scholar-tracker": "linear-gradient(135deg, #7BC8F0, #5BA8D0)",
  "bilibili-tracker": "linear-gradient(135deg, #FFB7B2, #E89B96)",
  "xiaohongshu-tracker": "linear-gradient(135deg, #FF6B6B, #E85555)",
  "xiaoyuzhou-tracker": "linear-gradient(135deg, #A8E6CF, #7DD3C0)",
  "zhihu-tracker": "linear-gradient(135deg, #4A9DFF, #3478CC)",
  "folder-monitor": "linear-gradient(135deg, #F5C88C, #D4A574)",
};

export function ModuleDetailModal({
  module,
  usage,
  initialTab = "overview",
  onClose,
  onUpdate,
  onOpenTool,
  onRun,
  onToggle,
}: ModuleDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixResult, setFixResult] = useState<QuickFixResponse | null>(null);
  const [visible, setVisible] = useState(false);
  const [historyCards, setHistoryCards] = useState<FeedCard[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const { addToast } = useStore();

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    if (historyCards.length === 0) {
      void loadHistory(0);
    }
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 180);
  };

  async function loadHistory(offset: number) {
    setHistoryLoading(true);
    try {
      const response = await api.get<HistoryResponse>(
        `/api/cards?module_id=${module.id}&limit=30&offset=${offset}`
      );
      const cards = response.cards || [];
      if (offset === 0) {
        setHistoryCards(cards);
      } else {
        setHistoryCards((previous) => [...previous, ...cards]);
      }
      setHasMore(cards.length === 30);
      setHistoryOffset(offset + cards.length);
    } catch {
      addToast({ kind: "error", title: "Load failed", message: "Could not load history" });
    } finally {
      setHistoryLoading(false);
    }
  }

  async function runDiagnosis() {
    setIsDiagnosing(true);
    setDiagnosisResult(null);
    try {
      const result = await api.post<DiagnosisResult>(`/api/modules/${module.id}/diagnose`, { deep: true });
      setDiagnosisResult(result);
    } catch (error) {
      setDiagnosisResult({
        moduleId: module.id,
        diagnosedAt: new Date().toISOString(),
        overallStatus: "fail",
        checks: [
          {
            name: "diagnosis",
            status: "fail",
            message: error instanceof Error ? error.message : "Diagnostics failed",
          },
        ],
        recommendations: [],
      });
    } finally {
      setIsDiagnosing(false);
    }
  }

  async function runQuickFix() {
    setIsFixing(true);
    setFixResult(null);
    try {
      const result = await api.post<QuickFixResponse>(`/api/modules/${module.id}/quick-fix`, { fixes: ["all"] });
      setFixResult(result);
      if (result.moduleStatus !== module.status) {
        onUpdate({ ...module, status: result.moduleStatus });
      }
    } catch (error) {
      setFixResult({
        moduleId: module.id,
        fixedAt: new Date().toISOString(),
        results: [
          {
            fix: "all",
            status: "failed",
            message: error instanceof Error ? error.message : "Fix failed",
          },
        ],
        moduleStatus: module.status,
        nextSteps: ["Open the tool page to check the monitor configuration"],
      });
    } finally {
      setIsFixing(false);
    }
  }

  const Icon = MODULE_ICONS[module.id] || Rss;
  const gradient = MODULE_GRADIENTS[module.id] || "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))";
  const status = STATUS_MAP[module.status];
  const focusTokens = getModuleFocusTokens(module);
  const filteredHistory = filterHistoryCards(historyCards, historySearch);
  const historyPreview = historyCards.slice(0, 3);
  const primaryActionLabel = module.status === "unconfigured"
    ? "Open tool"
    : module.status === "active"
      ? "Pause module"
      : "Start module";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={handleClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(15,23,42,0.44)",
          backdropFilter: "blur(6px)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.18s ease",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "min(860px, 92vw)",
          maxHeight: "88vh",
          background: "var(--bg-card)",
          borderRadius: "18px",
          boxShadow: "0 28px 90px rgba(15,23,42,0.24)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transform: visible ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
          opacity: visible ? 1 : 0,
          transition: "transform 0.2s ease, opacity 0.2s ease",
        }}
      >
        <div
          style={{
            padding: "24px 28px 0",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "14px",
                background: gradient,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 12px 24px ${status.color}22`,
                flexShrink: 0,
              }}
            >
              <Icon style={{ width: "24px", height: "24px", color: "white" }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "4px" }}>
                <h2
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: 800,
                    color: "var(--text-main)",
                    margin: 0,
                  }}
                >
                  {module.name}
                </h2>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    background: status.bg,
                    color: status.color,
                    fontSize: "0.75rem",
                    fontWeight: 700,
                  }}
                >
                  {module.status === "active" && (
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: status.color,
                        animation: "modulePulse 2s infinite",
                      }}
                    />
                  )}
                  {status.label}
                </span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{module.id}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button onClick={onOpenTool} style={ghostHeaderButtonStyle}>
              <ExternalLink style={{ width: "15px", height: "15px" }} />
              Open tool
            </button>
            <button onClick={handleClose} style={iconHeaderButtonStyle} aria-label="Close">
              <X style={{ width: "16px", height: "16px" }} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px", padding: "16px 28px 0", borderBottom: "1px solid var(--border-light)" }}>
          {[
            { id: "overview" as const, label: "Run overview" },
            { id: "history" as const, label: "History" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                height: "40px",
                padding: "0 14px",
                border: "none",
                borderBottom: `2px solid ${activeTab === tab.id ? "var(--color-primary)" : "transparent"}`,
                background: "transparent",
                color: activeTab === tab.id ? "var(--color-primary)" : "var(--text-muted)",
                fontSize: "0.8125rem",
                fontWeight: 700,
                cursor: "pointer",
                marginBottom: "-1px",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px 28px" }}>
          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 16px",
                  borderRadius: "14px",
                  background: "var(--bg-hover)",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
                    Only toggles and records here
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    Keywords, sources, cookies, and monitor details are handled on the tool pages; Module Management only shows results and run status.
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      if (module.status === "unconfigured") {
                        onOpenTool();
                        return;
                      }
                      onToggle();
                    }}
                    style={{
                      ...solidActionButtonStyle,
                      background: module.status === "active" ? "#f59e0b" : "var(--color-primary)",
                    }}
                  >
                    {module.status === "active" ? <Pause style={{ width: "15px", height: "15px" }} /> : <Play style={{ width: "15px", height: "15px" }} />}
                    {primaryActionLabel}
                  </button>
                  <button onClick={onRun} style={ghostActionButtonStyle}>
                    <RefreshCw style={{ width: "15px", height: "15px" }} />
                    Run now
                  </button>
                </div>
              </div>

              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7, margin: 0 }}>
                {module.description}
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
                {[
                  { label: "Pending", value: usage.unreadCount, tone: "#f59e0b" },
                  { label: "Total read", value: usage.readCount, tone: "var(--text-main)" },
                  { label: "Views (7d)", value: usage.viewCount7d, tone: "#2563eb" },
                  { label: "Saves (7d)", value: usage.saveCount7d, tone: "#7c3aed" },
                ].map((item) => (
                  <MetricBlock key={item.label} label={item.label} value={item.value} tone={item.tone} />
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
                {[
                  { label: "New this week", value: module.stats.thisWeek },
                  { label: "Latest", value: formatRelativeDate(usage.lastCardAt) },
                  { label: "Last run", value: formatRelativeDate(module.lastRun) },
                  { label: "Next run", value: formatDateTime(module.nextRun) },
                ].map((item) => (
                  <MetricBlock key={item.label} label={item.label} value={item.value} tone="var(--text-main)" />
                ))}
              </div>

              <section style={sectionStyle}>
                <SectionTitle title="Monitor content" helper="View the scope here; make changes on the tool page" />
                {focusTokens.length > 0 ? (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {focusTokens.map((token) => (
                      <span
                        key={token}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "999px",
                          background: "rgba(188,164,227,0.12)",
                          color: "var(--color-primary)",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                        }}
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    No monitor targets set yet. Open the tool page to add keywords, sources, or monitor lists.
                  </div>
                )}
              </section>

              <section style={sectionStyle}>
                <SectionTitle
                  title="Recent records"
                  helper={historyCards.length > 0 ? `Captured ${historyCards.length}; click to open the original link` : "Recently captured content appears here first"}
                />
                {historyLoading && historyCards.length === 0 ? (
                  <CenteredLoader />
                ) : historyPreview.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {historyPreview.map((card) => (
                      <HistoryCard key={card.id} card={card} moduleId={module.id} compact />
                    ))}
                    <button onClick={() => setActiveTab("history")} style={ghostActionButtonStyle}>
                      View all records
                    </button>
                  </div>
                ) : (
                  <EmptyHistory />
                )}
              </section>

              <section style={sectionStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <SectionTitle title="Run health" helper="Check here first when something's wrong, then decide whether to go to the tool page" />
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button onClick={runQuickFix} disabled={isFixing} style={{ ...solidActionButtonStyle, background: "#16a34a" }}>
                      {isFixing ? <Loader2 style={spinningIconStyle} /> : <CheckCircle style={{ width: "15px", height: "15px" }} />}
                      Quick fix
                    </button>
                    <button onClick={runDiagnosis} disabled={isDiagnosing} style={ghostActionButtonStyle}>
                      {isDiagnosing ? <Loader2 style={spinningIconStyle} /> : <AlertCircle style={{ width: "15px", height: "15px" }} />}
                      Run diagnostics
                    </button>
                  </div>
                </div>

                {diagnosisResult ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: "12px",
                        background: diagnosisResult.overallStatus === "pass" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      {diagnosisResult.overallStatus === "pass"
                        ? <CheckCircle style={{ width: "18px", height: "18px", color: "#16a34a" }} />
                        : <XCircle style={{ width: "18px", height: "18px", color: "#dc2626" }} />}
                      <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                        {diagnosisResult.overallStatus === "pass" ? "Running normally" : "Found issues that need attention"}
                      </span>
                    </div>
                    {diagnosisResult.checks.map((check) => (
                      <div
                        key={check.name}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "12px",
                          background: "var(--bg-hover)",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "10px",
                        }}
                      >
                        {check.status === "pass"
                          ? <CheckCircle style={{ width: "16px", height: "16px", color: "#16a34a", flexShrink: 0, marginTop: "2px" }} />
                          : <XCircle style={{ width: "16px", height: "16px", color: "#dc2626", flexShrink: 0, marginTop: "2px" }} />}
                        <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>{check.message}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    No diagnostics run yet. Check here first when a module errors, produces nothing for a while, or its cookie expires.
                  </div>
                )}

                {fixResult && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {fixResult.results.map((result, index) => (
                      <div
                        key={`${result.fix}-${index}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "9px 12px",
                          borderRadius: "12px",
                          background: result.status === "success" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                          color: result.status === "success" ? "#15803d" : "#dc2626",
                          fontSize: "0.8125rem",
                          fontWeight: 600,
                        }}
                      >
                        {result.status === "success"
                          ? <CheckCircle style={{ width: "14px", height: "14px" }} />
                          : <XCircle style={{ width: "14px", height: "14px" }} />}
                        {result.message}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === "history" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
                {[
                  { label: "Pending", value: usage.unreadCount },
                  { label: "Total read", value: usage.readCount },
                  { label: "Views (7d)", value: usage.viewCount7d },
                  { label: "New this week", value: module.stats.thisWeek },
                ].map((item) => (
                  <MetricBlock key={item.label} label={item.label} value={item.value} tone="var(--text-main)" />
                ))}
              </div>

              <div style={{ position: "relative" }}>
                <Search
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "15px",
                    height: "15px",
                    color: "var(--text-muted)",
                  }}
                />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Search title, summary, tags"
                  style={{
                    width: "100%",
                    height: "40px",
                    padding: "0 12px 0 38px",
                    borderRadius: "999px",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-hover)",
                    color: "var(--text-main)",
                    fontSize: "0.8125rem",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {historyLoading && historyCards.length === 0 ? (
                <CenteredLoader />
              ) : historyCards.length === 0 ? (
                <EmptyHistory />
              ) : filteredHistory.length === 0 ? (
                <div style={{ textAlign: "center", padding: "42px 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  No matching records
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {historySearch && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Found {filteredHistory.length} matching records
                    </div>
                  )}
                  {filteredHistory.map((card) => (
                    <HistoryCard key={card.id} card={card} moduleId={module.id} />
                  ))}
                  {hasMore && !historySearch && (
                    <button onClick={() => void loadHistory(historyOffset)} disabled={historyLoading} style={ghostActionButtonStyle}>
                      {historyLoading ? (
                        <>
                          <Loader2 style={spinningIconStyle} />
                          Loading
                        </>
                      ) : (
                        "Load more"
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <style>{`
          @keyframes modulePulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.45; }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}

function filterHistoryCards(cards: FeedCard[], query: string): FeedCard[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return cards;

  return cards.filter((card) =>
    card.title.toLowerCase().includes(normalized)
    || (card.summary || "").toLowerCase().includes(normalized)
    || (card.tags || []).some((tag) => tag.toLowerCase().includes(normalized))
  );
}

function metadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function resolveHistoryCardUrl(card: FeedCard): string {
  const candidates = [
    card.source_url,
    metadataString(card.metadata, "source_url"),
    metadataString(card.metadata, "url"),
    metadataString(card.metadata, "arxiv_url"),
    metadataString(card.metadata, "arxiv-url"),
    metadataString(card.metadata, "s2_url"),
    metadataString(card.metadata, "pdf_url"),
    metadataString(card.metadata, "pdf-url"),
    metadataString(card.metadata, "html_url"),
    metadataString(card.metadata, "html-url"),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.startsWith("//")) return `https:${candidate}`;
    return candidate;
  }

  return "";
}

async function openHistoryCardUrl(card: FeedCard) {
  const targetUrl = resolveHistoryCardUrl(card);
  if (!targetUrl) return;

  try {
    await openUrl(targetUrl);
  } catch {
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  }
}

function SectionTitle({ title, helper }: { title: string; helper: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>{title}</div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>{helper}</div>
    </div>
  );
}

function MetricBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: string;
}) {
  return (
    <div
      style={{
        padding: "12px",
        borderRadius: "14px",
        background: "var(--bg-hover)",
      }}
    >
      <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "5px" }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 800, color: tone }}>{value}</div>
    </div>
  );
}

function HistoryCard({
  card,
  moduleId,
  compact = false,
}: {
  card: FeedCard;
  moduleId: string;
  compact?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const emoji = SOURCE_ICONS[moduleId] || "📋";
  const targetUrl = resolveHistoryCardUrl(card);
  const canOpen = Boolean(targetUrl);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (!canOpen) return;
        void openHistoryCardUrl(card);
      }}
      style={{
        padding: compact ? "12px 14px" : "14px 16px",
        borderRadius: "14px",
        background: hovered ? "var(--bg-hover)" : "transparent",
        border: "1px solid var(--border-light)",
        transition: "background 0.15s ease, border-color 0.15s ease",
        cursor: canOpen ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <span style={{ fontSize: compact ? "1.1rem" : "1.2rem", lineHeight: 1, marginTop: "2px" }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <h4
              style={{
                fontSize: compact ? "0.8125rem" : "0.875rem",
                fontWeight: 700,
                color: "var(--text-main)",
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {card.title}
            </h4>
            {canOpen && hovered && (
              <ExternalLink style={{ width: "14px", height: "14px", color: "var(--text-muted)", flexShrink: 0 }} />
            )}
          </div>

          {card.summary && !compact && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                margin: "4px 0 0",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {card.summary}
            </p>
          )}

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "8px" }}>
            <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>{formatDateTime(card.created_at)}</span>
            {(card.tags || []).slice(0, compact ? 2 : 3).map((tag) => (
              <span
                key={tag}
                style={{
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: "rgba(188,164,227,0.12)",
                  color: "var(--color-primary)",
                  fontSize: "0.625rem",
                  fontWeight: 600,
                }}
              >
                {tag}
              </span>
            ))}
            <span
              style={{
                padding: "2px 8px",
                borderRadius: "999px",
                background: card.read ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.12)",
                color: card.read ? "#15803d" : "#b45309",
                fontSize: "0.625rem",
                fontWeight: 700,
              }}
            >
              {card.read ? "Read" : "Pending"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CenteredLoader() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "28px 0" }}>
      <Loader2 style={spinningIconStyle} />
    </div>
  );
}

function EmptyHistory() {
  return (
    <div style={{ textAlign: "center", padding: "42px 0", color: "var(--text-muted)" }}>
      <Clock style={{ width: "34px", height: "34px", margin: "0 auto 10px", opacity: 0.4 }} />
      <div style={{ fontSize: "0.875rem", marginBottom: "4px" }}>No history yet</div>
      <div style={{ fontSize: "0.75rem" }}>This accumulates automatically once the module starts producing content.</div>
    </div>
  );
}

const SOURCE_ICONS: Record<string, string> = {
  "arxiv-tracker": "📄",
  "semantic-scholar-tracker": "🔬",
  "bilibili-tracker": "📺",
  "xiaohongshu-tracker": "📕",
  "xiaoyuzhou-tracker": "🎧",
  "zhihu-tracker": "❓",
  "folder-monitor": "📁",
};

const sectionStyle: CSSProperties = {
  padding: "16px",
  borderRadius: "16px",
  border: "1px solid var(--border-light)",
  background: "rgba(255,255,255,0.02)",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

const solidActionButtonStyle: CSSProperties = {
  height: "38px",
  padding: "0 14px",
  borderRadius: "8px",
  border: "none",
  color: "white",
  fontSize: "0.8125rem",
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
};

const ghostActionButtonStyle: CSSProperties = {
  height: "38px",
  padding: "0 14px",
  borderRadius: "8px",
  border: "1px solid var(--border-light)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: "0.8125rem",
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
};

const ghostHeaderButtonStyle: CSSProperties = {
  height: "34px",
  padding: "0 12px",
  borderRadius: "8px",
  border: "1px solid var(--border-light)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: "0.75rem",
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
};

const iconHeaderButtonStyle: CSSProperties = {
  width: "34px",
  height: "34px",
  borderRadius: "8px",
  border: "1px solid var(--border-light)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const spinningIconStyle: CSSProperties = {
  width: "18px",
  height: "18px",
  animation: "spin 1s linear infinite",
};
