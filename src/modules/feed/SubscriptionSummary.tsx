import { useEffect, useState } from "react";
import { ArrowLeft, Rss, Clock, User, Trash2, RefreshCw } from "lucide-react";
import { api } from "../../core/api";
import { PageContainer, PageHeader, PageContent, Card } from "../../components/Layout";
import { useToast } from "../../components/Toast";

interface ModuleInfo {
  name: string;
  icon: string;
  total: number;
  by_type: Record<string, Array<{
    value: string;
    added_at: string;
    added_by: string;
    last_fetched: string | null;
    fetch_count: number;
  }>>;
}

interface SummaryData {
  total_modules: number;
  total_subscriptions: number;
  modules: Record<string, ModuleInfo>;
  modules_info: Record<string, { name: string; icon: string }>;
}

const TYPE_LABELS: Record<string, string> = {
  up_uid: "Creator",
  user_id: "User ID",
  user: "User",
  topic: "Topic",
  podcast_id: "Podcast",
  keyword: "Keyword",
};

const TYPE_COLORS: Record<string, string> = {
  up_uid: "#FF6B6B",
  user_id: "#FF6B9D",
  user: "#C44569",
  topic: "#786FA6",
  podcast_id: "#63CDDA",
  keyword: "#F8B500",
};

interface Props {
  onBack: () => void;
}

export default function SubscriptionSummary({ onBack }: Props) {
  const toast = useToast();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  async function fetchSummary() {
    setLoading(true);
    try {
      const data = await api.get<SummaryData>("/api/subscriptions/summary");
      setSummary(data);
    } catch {
      toast.error("Failed to load subscription overview");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSummary();
  }, []);

  function toggleModule(moduleId: string) {
    const newSet = new Set(expandedModules);
    if (newSet.has(moduleId)) {
      newSet.delete(moduleId);
    } else {
      newSet.add(moduleId);
    }
    setExpandedModules(newSet);
  }

  function formatDateTime(isoString: string | null): string {
    if (!isoString) return "Never";
    try {
      const date = new Date(isoString);
      return date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  }

  async function removeSubscription(moduleId: string, type: string, value: string) {
    try {
      await api.delete(`/api/modules/${moduleId}/subscriptions`, { type, value } as any);
      toast.success("Subscription removed");
      fetchSummary();
    } catch {
      toast.error("Failed to remove");
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <PageHeader title="Subscription Overview" subtitle="Loading..." icon={Rss} />
        <PageContent maxWidth="700px">
          <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
            Loading...
          </div>
        </PageContent>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Subscription Overview"
        subtitle={`${summary?.total_subscriptions || 0} subscriptions · ${summary?.total_modules || 0} modules`}
        icon={Rss}
        actions={
          <>
            <button
              onClick={fetchSummary}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              <RefreshCw style={{ width: "14px", height: "14px" }} />
              Refresh
            </button>
            <button
              onClick={onBack}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 16px",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                fontSize: "0.875rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              <ArrowLeft style={{ width: "16px", height: "16px" }} />
              Back
            </button>
          </>
        }
      />

      <PageContent maxWidth="700px">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Stats cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "12px",
            }}
          >
            <div
              style={{
                padding: "16px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-card)",
                border: "1px solid var(--border-light)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "1.75rem",
                  fontWeight: 700,
                  color: "var(--color-primary)",
                }}
              >
                {summary?.total_subscriptions || 0}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                Total subscriptions
              </div>
            </div>
            <div
              style={{
                padding: "16px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-card)",
                border: "1px solid var(--border-light)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "1.75rem",
                  fontWeight: 700,
                  color: "var(--color-secondary)",
                }}
              >
                {summary?.total_modules || 0}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                Active modules
              </div>
            </div>
            <div
              style={{
                padding: "16px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-card)",
                border: "1px solid var(--border-light)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "1.75rem",
                  fontWeight: 700,
                  color: "#F8B500",
                }}
              >
                {Object.values(summary?.modules || {}).reduce(
                  (acc, m) => acc + Object.keys(m.by_type).length,
                  0
                )}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                Subscription types
              </div>
            </div>
          </div>

          {/* Module list */}
          {summary?.modules && Object.entries(summary.modules).length > 0 ? (
            Object.entries(summary.modules).map(([moduleId, moduleData]) => {
              const moduleInfo = summary.modules_info[moduleId] || {
                name: moduleId,
                icon: "rss",
              };
              const isExpanded = expandedModules.has(moduleId);
              const allSubs = Object.values(moduleData.by_type).flat();

              return (
                <Card
                  key={moduleId}
                  title={`${moduleInfo.name} (${allSubs.length} subscriptions)`}
                  icon={<Rss style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />}
                >
                  {/* Subscriptions grouped by type */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {Object.entries(moduleData.by_type).map(([type, subs]) => (
                      <div key={type}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "8px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.65rem",
                              padding: "2px 8px",
                              borderRadius: "4px",
                              background: TYPE_COLORS[type] || "var(--color-primary)",
                              color: "white",
                              fontWeight: 600,
                            }}
                          >
                            {TYPE_LABELS[type] || type}
                          </span>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            {subs.length}
                          </span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          {(isExpanded ? subs : subs.slice(0, 3)).map((sub, idx) => (
                            <div
                              key={idx}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                padding: "8px 10px",
                                borderRadius: "var(--radius-md)",
                                background: "var(--bg-hover)",
                                border: "1px solid var(--border-light)",
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: "0.8125rem",
                                  color: "var(--text-main)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {sub.value}
                              </span>
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  color: "var(--text-muted)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "3px",
                                }}
                              >
                                <User style={{ width: "10px", height: "10px" }} />
                                {sub.added_by}
                              </span>
                              <span
                                style={{
                                  fontSize: "0.7rem",
                                  color: "var(--text-muted)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "3px",
                                }}
                              >
                                <Clock style={{ width: "10px", height: "10px" }} />
                                {formatDateTime(sub.added_at)}
                              </span>
                              <button
                                onClick={() => removeSubscription(moduleId, type, sub.value)}
                                style={{
                                  padding: "4px",
                                  borderRadius: "4px",
                                  background: "transparent",
                                  color: "var(--text-muted)",
                                  border: "none",
                                  cursor: "pointer",
                                  opacity: 0.6,
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                              >
                                <Trash2 style={{ width: "12px", height: "12px" }} />
                              </button>
                            </div>
                          ))}

                          {!isExpanded && subs.length > 3 && (
                            <button
                              onClick={() => toggleModule(moduleId)}
                              style={{
                                padding: "6px",
                                borderRadius: "var(--radius-md)",
                                background: "transparent",
                                color: "var(--text-muted)",
                                border: "1px dashed var(--border-light)",
                                cursor: "pointer",
                                fontSize: "0.75rem",
                              }}
                            >
                              + {subs.length - 3} more
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    {isExpanded && (
                      <button
                        onClick={() => toggleModule(moduleId)}
                        style={{
                          padding: "6px",
                          borderRadius: "var(--radius-md)",
                          background: "transparent",
                          color: "var(--text-muted)",
                          border: "1px dashed var(--border-light)",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                        }}
                      >
                        Collapse
                      </button>
                    )}
                  </div>
                </Card>
              );
            })
          ) : (
            <Card>
              <div
                style={{
                  textAlign: "center",
                  padding: "40px",
                  color: "var(--text-muted)",
                }}
              >
                <Rss style={{ width: "48px", height: "48px", opacity: 0.3, marginBottom: "16px" }} />
                <div style={{ fontSize: "0.875rem" }}>No subscriptions yet</div>
                <div style={{ fontSize: "0.75rem", marginTop: "8px" }}>
                  Go to each module page to add subscriptions
                </div>
              </div>
            </Card>
          )}
        </div>
      </PageContent>
    </PageContainer>
  );
}
