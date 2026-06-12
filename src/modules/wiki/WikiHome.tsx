import { useEffect, useState, type KeyboardEvent } from "react";
import { Inbox, BookOpen, Clock, BookHeart, FileText, Sparkles, ArrowRight } from "lucide-react";
import { PageContainer, PageHeader, LoadingState } from "../../components/Layout";
import { api } from "../../core/api";
import { useToast } from "../../components/Toast";
import type { WikiType } from "./Wiki";

interface WikiStatsResponse {
  total: number;
  by_category: Record<string, number>;
  wiki_type: string;
  recent_pages?: WikiStats["recent_pages"];
}

interface WikiStats {
  page_count: number;
  entity_count?: number;
  concept_count?: number;
  paper_count?: number;
  topic_count?: number;
  recent_pages: Array<{
    slug: string;
    title: string;
    wiki_type: string;
    updated: string;
  }>;
}

interface WikiControlData {
  wiki_type: string;
  has_overview: boolean;
  primary_action_label: string;
  workflow_hint: string;
  source_summary: {
    total_sources: number;
    collections: Array<{ label: string; count: number }>;
  };
}

interface WikiHomeData {
  intelStats: WikiStats;
  litStats: WikiStats;
  intelControl: WikiControlData | null;
  litControl: WikiControlData | null;
}

const EMPTY_INTEL_STATS: WikiStats = {
  page_count: 0,
  entity_count: 0,
  concept_count: 0,
  recent_pages: [],
};

const EMPTY_LIT_STATS: WikiStats = {
  page_count: 0,
  paper_count: 0,
  topic_count: 0,
  recent_pages: [],
};

function parseStats(raw: WikiStatsResponse, _wikiType: string): WikiStats {
  const bc = raw.by_category ?? {};
  return {
    page_count: raw.total ?? 0,
    entity_count: bc.entity ?? 0,
    concept_count: bc.concept ?? 0,
    paper_count: bc.paper ?? 0,
    topic_count: bc.topic ?? 0,
    recent_pages: Array.isArray(raw.recent_pages) ? raw.recent_pages : [],
  };
}

async function loadWikiHomeData(): Promise<WikiHomeData> {
  const [intelStats, litStats, intelControl, litControl] = await Promise.allSettled([
    api.get<WikiStatsResponse>("/api/wiki/intel/stats"),
    api.get<WikiStatsResponse>("/api/wiki/lit/stats"),
    api.get<WikiControlData>("/api/wiki/intel/control"),
    api.get<WikiControlData>("/api/wiki/lit/control"),
  ]);

  return {
    intelStats: intelStats.status === "fulfilled" ? parseStats(intelStats.value, "intel") : EMPTY_INTEL_STATS,
    litStats: litStats.status === "fulfilled" ? parseStats(litStats.value, "lit") : EMPTY_LIT_STATS,
    intelControl: intelControl.status === "fulfilled" ? intelControl.value : null,
    litControl: litControl.status === "fulfilled" ? litControl.value : null,
  };
}

interface Props {
  onSelectWiki: (type: WikiType) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return dateStr.slice(0, 10);
}

function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>, onOpen: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onOpen();
  }
}

function MetricPill({
  label,
  value,
  background,
}: {
  label: string;
  value: string | number;
  background: string;
}) {
  return (
    <span
      style={{
        padding: "4px 12px",
        borderRadius: "999px",
        background,
        fontSize: "0.8125rem",
        color: "var(--text-secondary)",
        fontWeight: 600,
      }}
    >
      {value} {label}
    </span>
  );
}

function WikiActionButton({
  label,
  onClick,
  primary = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "10px 14px",
        borderRadius: "8px",
        border: primary ? "none" : "1px solid var(--border-light)",
        background: primary
          ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))"
          : "var(--bg-card)",
        color: primary ? "white" : "var(--text-secondary)",
        fontSize: "0.875rem",
        fontWeight: 700,
        cursor: disabled ? "wait" : "pointer",
        boxShadow: primary ? "0 10px 24px rgba(188, 164, 227, 0.2)" : "none",
        opacity: disabled ? 0.8 : 1,
      }}
    >
      {label}
      {!disabled && <ArrowRight style={{ width: "14px", height: "14px" }} />}
    </button>
  );
}

export default function WikiHome({ onSelectWiki }: Props) {
  const toast = useToast();
  const [intelStats, setIntelStats] = useState<WikiStats>(EMPTY_INTEL_STATS);
  const [litStats, setLitStats] = useState<WikiStats>(EMPTY_LIT_STATS);
  const [intelControl, setIntelControl] = useState<WikiControlData | null>(null);
  const [litControl, setLitControl] = useState<WikiControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<WikiType | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchHomeData() {
      setLoading(true);
      const data = await loadWikiHomeData();
      if (cancelled) return;
      setIntelStats(data.intelStats);
      setLitStats(data.litStats);
      setIntelControl(data.intelControl);
      setLitControl(data.litControl);
      setLoading(false);
    }
    void fetchHomeData();
    return () => { cancelled = true; };
  }, []);

  async function bootstrapFromHome(wikiType: WikiType) {
    setActionLoading(wikiType);
    try {
      const result = await api.post<{ pages_updated: number }>(`/api/wiki/${wikiType}/bootstrap`, {});
      const data = await loadWikiHomeData();
      setIntelStats(data.intelStats);
      setLitStats(data.litStats);
      setIntelControl(data.intelControl);
      setLitControl(data.litControl);
      toast.success(
        wikiType === "intel" ? "Internet Wiki generated" : "Literature Wiki generated",
        `Updated ${result.pages_updated} starter pages`
      );
      setActionLoading(null);
      onSelectWiki(wikiType);
      return;
    } catch (error) {
      toast.error("Generation failed", error instanceof Error ? error.message : "Please try again later");
    }
    setActionLoading(null);
  }

  const recentPages = [
    ...intelStats.recent_pages,
    ...litStats.recent_pages,
  ]
    .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
    .slice(0, 5);

  if (loading) {
    return (
      <PageContainer>
        <PageHeader title="Knowledge Base" subtitle="Generate an initial profile first, then top it up from Daily Briefing and new papers with one click" icon={BookHeart} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingState message="Loading knowledge base..." />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Knowledge Base" subtitle="Generate an initial profile first, then top it up from Daily Briefing and new papers with one click" icon={BookHeart} />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "clamp(20px, 3vw, 40px)",
        }}
      >
        <div
          style={{
            maxWidth: "900px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "28px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px",
              padding: "18px",
              borderRadius: "12px",
              background: "linear-gradient(135deg, rgba(188, 164, 227, 0.12), rgba(168, 230, 207, 0.1))",
              border: "1px solid rgba(188, 164, 227, 0.14)",
            }}
          >
            {[
              {
                key: "step-1",
                icon: Sparkles,
                title: "First time: click Generate",
                description: "The system grows an overview page from your existing collections — no need to design the structure yourself.",
              },
              {
                key: "step-2",
                icon: Inbox,
                title: "Intel flows into the Intel Library",
                description: "When you see content worth keeping, just click \"Write to Internet Wiki\".",
              },
              {
                key: "step-3",
                icon: BookOpen,
                title: "Papers and old notes map together",
                description: "Keep saving new papers to the Literature Library; follow-ups, archives, and guidance link into a research map.",
              },
            ].map(({ key, icon: Icon, title, description }) => (
              <div key={key} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: "12px", alignItems: "start" }}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "8px",
                    background: "rgba(255, 255, 255, 0.68)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-primary-dark)",
                  }}
                >
                  <Icon style={{ width: "16px", height: "16px" }} />
                </div>
                <div>
                  <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>{title}</div>
                  <div style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "var(--text-secondary)" }}>{description}</div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "24px",
            }}
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectWiki("intel")}
              onKeyDown={(event) => handleCardKeyDown(event, () => onSelectWiki("intel"))}
              onMouseEnter={() => setHoveredCard("intel")}
              onMouseLeave={() => setHoveredCard(null)}
              style={{
                padding: "28px",
                borderRadius: "14px",
                background: hoveredCard === "intel"
                  ? "linear-gradient(135deg, rgba(188, 164, 227, 0.18), rgba(168, 230, 207, 0.12))"
                  : "var(--bg-card)",
                border: "1px solid var(--border-light)",
                boxShadow: hoveredCard === "intel"
                  ? "0 10px 32px rgba(188, 164, 227, 0.22)"
                  : "var(--shadow-soft)",
                cursor: "pointer",
                transition: "all 0.25s ease",
                transform: hoveredCard === "intel" ? "translateY(-3px)" : "translateY(0)",
                display: "grid",
                gap: "16px",
                outline: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 16px rgba(188, 164, 227, 0.35)",
                  }}
                >
                  <Inbox style={{ width: "28px", height: "28px", color: "white" }} />
                </div>

                <span
                  style={{
                    padding: "6px 10px",
                    borderRadius: "999px",
                    background: intelControl?.has_overview ? "rgba(168, 230, 207, 0.18)" : "rgba(255, 183, 178, 0.18)",
                    color: intelControl?.has_overview ? "#2E7D68" : "#C76C65",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                  }}
                >
                  {intelControl?.has_overview ? "Overview generated" : "Not generated yet"}
                </span>
              </div>

              <div>
                <h2
                  style={{
                    fontFamily: "'M PLUS Rounded 1c', sans-serif",
                    fontSize: "1.375rem",
                    fontWeight: 700,
                    color: "var(--text-main)",
                    marginBottom: "6px",
                  }}
                >
                  Internet Wiki
                </h2>
                <p style={{ fontSize: "0.9375rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Bilibili · Xiaohongshu · bookmark threads
                </p>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <MetricPill label="Pages" value={intelStats.page_count} background="rgba(188, 164, 227, 0.12)" />
                <MetricPill label="Entities" value={intelStats.entity_count ?? 0} background="rgba(168, 230, 207, 0.15)" />
                <MetricPill label="Sources" value={intelControl?.source_summary.total_sources ?? 0} background="rgba(255, 183, 178, 0.12)" />
              </div>

              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.62)",
                  border: "1px solid rgba(188, 164, 227, 0.12)",
                  display: "grid",
                  gap: "8px",
                }}
              >
                <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                  {intelControl?.has_overview ? "You can open the Internet Wiki overview now" : "We recommend generating an Internet Wiki overview first"}
                </div>
                <div style={{ fontSize: "0.875rem", lineHeight: 1.65, color: "var(--text-secondary)" }}>
                  {intelControl?.workflow_hint ?? "Later, click \"Write to Internet Wiki\" in Daily Briefing and the system keeps adding to it."}
                </div>
                {intelControl?.source_summary.collections?.[0] && (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    Main collection: {intelControl.source_summary.collections[0].label}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <WikiActionButton
                  label={
                    actionLoading === "intel"
                      ? "Generating..."
                      : intelControl?.has_overview
                      ? "Open overview"
                      : (intelControl?.primary_action_label ?? "Generate Internet Wiki overview")
                  }
                  primary
                  disabled={actionLoading === "intel"}
                  onClick={() => {
                    if (intelControl?.has_overview) {
                      onSelectWiki("intel");
                      return;
                    }
                    void bootstrapFromHome("intel");
                  }}
                />
                <WikiActionButton
                  label={
                    actionLoading === "intel"
                      ? "Please wait"
                      : intelControl?.has_overview
                      ? (intelControl?.primary_action_label ?? "Refresh Internet Wiki overview")
                      : "Go to Intel Library"
                  }
                  disabled={actionLoading === "intel"}
                  onClick={() => {
                    if (intelControl?.has_overview) {
                      void bootstrapFromHome("intel");
                      return;
                    }
                    onSelectWiki("intel");
                  }}
                />
              </div>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelectWiki("lit")}
              onKeyDown={(event) => handleCardKeyDown(event, () => onSelectWiki("lit"))}
              onMouseEnter={() => setHoveredCard("lit")}
              onMouseLeave={() => setHoveredCard(null)}
              style={{
                padding: "28px",
                borderRadius: "14px",
                background: hoveredCard === "lit"
                  ? "linear-gradient(135deg, rgba(168, 230, 207, 0.2), rgba(188, 164, 227, 0.12))"
                  : "var(--bg-card)",
                border: "1px solid var(--border-light)",
                boxShadow: hoveredCard === "lit"
                  ? "0 10px 32px rgba(168, 230, 207, 0.24)"
                  : "var(--shadow-soft)",
                cursor: "pointer",
                transition: "all 0.25s ease",
                transform: hoveredCard === "lit" ? "translateY(-3px)" : "translateY(0)",
                display: "grid",
                gap: "16px",
                outline: "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, #A8E6CF, #7DD3C0)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 16px rgba(168, 230, 207, 0.35)",
                  }}
                >
                  <BookOpen style={{ width: "28px", height: "28px", color: "white" }} />
                </div>

                <span
                  style={{
                    padding: "6px 10px",
                    borderRadius: "999px",
                    background: litControl?.has_overview ? "rgba(168, 230, 207, 0.18)" : "rgba(255, 183, 178, 0.18)",
                    color: litControl?.has_overview ? "#2E7D68" : "#C76C65",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                  }}
                >
                  {litControl?.has_overview ? "Overview generated" : "Not generated yet"}
                </span>
              </div>

              <div>
                <h2
                  style={{
                    fontFamily: "'M PLUS Rounded 1c', sans-serif",
                    fontSize: "1.375rem",
                    fontWeight: 700,
                    color: "var(--text-main)",
                    marginBottom: "6px",
                  }}
                >
                  Literature Wiki
                </h2>
                <p style={{ fontSize: "0.9375rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Papers · Follow Up · Archive · Guidance
                </p>
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <MetricPill label="Pages" value={litStats.page_count} background="rgba(168, 230, 207, 0.15)" />
                <MetricPill label="Topics" value={litStats.topic_count ?? 0} background="rgba(188, 164, 227, 0.12)" />
                <MetricPill label="Sources" value={litControl?.source_summary.total_sources ?? 0} background="rgba(255, 183, 178, 0.12)" />
              </div>

              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.62)",
                  border: "1px solid rgba(168, 230, 207, 0.18)",
                  display: "grid",
                  gap: "8px",
                }}
              >
                <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                  {litControl?.has_overview ? "You can open the Literature Wiki overview now" : "We recommend generating a Literature Wiki overview first"}
                </div>
                <div style={{ fontSize: "0.875rem", lineHeight: 1.65, color: "var(--text-secondary)" }}>
                  {litControl?.workflow_hint ?? "Later, whenever a paper is saved to the Literature Library, the system links new papers, follow-ups, and old notes into the Literature Wiki."}
                </div>
                {litControl?.source_summary.collections?.[0] && (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    Main collection: {litControl.source_summary.collections[0].label}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <WikiActionButton
                  label={
                    actionLoading === "lit"
                      ? "Generating..."
                      : litControl?.has_overview
                      ? "Open overview"
                      : (litControl?.primary_action_label ?? "Generate Literature Wiki overview")
                  }
                  primary
                  disabled={actionLoading === "lit"}
                  onClick={() => {
                    if (litControl?.has_overview) {
                      onSelectWiki("lit");
                      return;
                    }
                    void bootstrapFromHome("lit");
                  }}
                />
                <WikiActionButton
                  label={
                    actionLoading === "lit"
                      ? "Please wait"
                      : litControl?.has_overview
                      ? (litControl?.primary_action_label ?? "Refresh Literature Wiki overview")
                      : "Go to Literature Library"
                  }
                  disabled={actionLoading === "lit"}
                  onClick={() => {
                    if (litControl?.has_overview) {
                      void bootstrapFromHome("lit");
                      return;
                    }
                    onSelectWiki("lit");
                  }}
                />
              </div>
            </div>
          </div>

          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "16px",
              }}
            >
              <Clock style={{ width: "16px", height: "16px", color: "var(--text-muted)" }} />
              <h3
                style={{
                  fontFamily: "'M PLUS Rounded 1c', sans-serif",
                  fontSize: "1rem",
                  fontWeight: 700,
                  color: "var(--text-secondary)",
                }}
              >
                Recently updated
              </h3>
            </div>

            {recentPages.length === 0 ? (
              <div
                style={{
                  padding: "32px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  background: "var(--bg-card)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-light)",
                }}
              >
                <FileText
                  style={{
                    width: "36px",
                    height: "36px",
                    margin: "0 auto 12px",
                    opacity: 0.4,
                  }}
                />
                <p style={{ fontSize: "0.9375rem", fontWeight: 500 }}>
                  No Wiki pages yet
                </p>
                <p style={{ fontSize: "0.8125rem", marginTop: "4px", opacity: 0.7 }}>
                  Click the generate button above first, then keep adding via the default actions
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {recentPages.map((page) => (
                  <button
                    key={`${page.wiki_type}-${page.slug}`}
                    onClick={() => onSelectWiki(page.wiki_type as WikiType)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 16px",
                      borderRadius: "var(--radius-md)",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-light)",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      textAlign: "left",
                      width: "100%",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.transform = "translateX(4px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--bg-card)";
                      e.currentTarget.style.transform = "translateX(0)";
                    }}
                  >
                    <div
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: page.wiki_type === "intel"
                          ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))"
                          : "linear-gradient(135deg, #A8E6CF, #7DD3C0)",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        color: "var(--text-main)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {page.title}
                    </span>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        flexShrink: 0,
                      }}
                    >
                      {page.wiki_type === "intel" ? "Internet Wiki" : "Literature Wiki"}
                    </span>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        flexShrink: 0,
                      }}
                    >
                      {timeAgo(page.updated)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
