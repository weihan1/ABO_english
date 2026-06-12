import { useEffect, useState, useRef } from "react";
import { LayoutGrid, Play, Terminal, ArrowRight, Clock, Rss } from "lucide-react";
import { api } from "../../core/api";
import { filterModulesForManagement } from "../../core/moduleVisibility";
import { useStore, FeedModule } from "../../core/store";
import { PageContainer, PageHeader, PageContent, Grid } from "../../components/Layout";
import ModuleDetail from "./ModuleDetail";
import SubscriptionSummary from "./SubscriptionSummary";

const MODULE_DESCRIPTIONS: Record<string, string> = {
  "arxiv-tracker": "Automatically track the latest academic papers on arXiv",
  "semantic-scholar-tracker": "Track the latest papers on Semantic Scholar",
  "xiaohongshu-tracker": "Track research and PhD-related notes on Xiaohongshu",
  "bilibili-tracker": "Track knowledge and tech videos on Bilibili",
  "xiaoyuzhou-tracker": "Track research and academic podcasts on Xiaoyuzhou",
  "zhihu-tracker": "Track research and academic topics on Zhihu",
  "folder-monitor": "Monitor a folder and auto-import new files",
};

export default function ModulePanel() {
  const { feedModules, setFeedModules, unreadCounts, moduleToConfigure } = useStore();
  const [selectedModule, setSelectedModule] = useState<FeedModule | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const managementModules = filterModulesForManagement(feedModules);

  useEffect(() => {
    api.get<{ modules: FeedModule[] }>("/api/modules")
      .then((r) => setFeedModules(r.modules))
      .catch(() => {});
  }, [setFeedModules]);

  // Track previous moduleToConfigure to detect actual changes
  const prevModuleToConfigureRef = useRef<string | null>(null);

  useEffect(() => {
    // Only process when moduleToConfigure actually changes to a new value
    if (moduleToConfigure !== prevModuleToConfigureRef.current) {
      prevModuleToConfigureRef.current = moduleToConfigure;

      if (moduleToConfigure === null && selectedModule) {
        // User clicked the header button - reset to list
        setSelectedModule(null);
      } else if (moduleToConfigure && managementModules.length > 0) {
        const mod = managementModules.find(m => m.id === moduleToConfigure);
        if (mod) {
          setSelectedModule(mod);
        }
        // Don't reset moduleToConfigure here - let NavSidebar handle it
      }
    }
  }, [moduleToConfigure, managementModules, selectedModule]);

  async function runNow(moduleId: string, e: React.MouseEvent) {
    e.stopPropagation();
    await api.post(`/api/modules/${moduleId}/run`, {}).catch(() => {});
  }

  if (showSummary) {
    return <SubscriptionSummary onBack={() => setShowSummary(false)} />;
  }

  if (selectedModule) {
    return <ModuleDetail module={selectedModule} onBack={() => setSelectedModule(null)} />;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Module Management"
        subtitle="Configure automation module parameters and scheduling"
        icon={LayoutGrid}
        actions={
          <>
            <button
              onClick={() => setShowSummary(true)}
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
                border: "1px solid var(--border-light)",
                cursor: "pointer",
              }}
            >
              <Rss style={{ width: "16px", height: "16px" }} />
              Subscription Overview
            </button>
            <button
              onClick={() => alert(
                "Run your agent CLI in a terminal and tell it:\n\n" +
                "\"Write an ABO module for me and put it in the modules/ directory of the current ABO data directory\"\n\n" +
                "ABO will automatically detect and load the new module."
              )}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 16px",
                borderRadius: "var(--radius-full)",
                background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(188, 164, 227, 0.35)",
              }}
            >
              <Terminal style={{ width: "16px", height: "16px" }} />
              New Module
            </button>
          </>
        }
      />
      <PageContent maxWidth="1200px">
        <Grid columns={2} gap="md">
          {managementModules.map((mod) => {
            const unread = unreadCounts[mod.id] ?? 0;
            return (
              <div
                key={mod.id}
                onClick={() => setSelectedModule(mod)}
                style={{
                  background: "var(--bg-card)",
                  backdropFilter: "blur(16px)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-light)",
                  boxShadow: "var(--shadow-soft)",
                  padding: "clamp(16px, 2vw, 20px)",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "var(--shadow-medium)";
                  e.currentTarget.style.borderColor = "var(--color-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "var(--shadow-soft)";
                  e.currentTarget.style.borderColor = "var(--border-light)";
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: mod.enabled ? "#10B981" : "var(--text-muted)",
                        boxShadow: mod.enabled ? "0 0 8px rgba(16, 185, 129, 0.4)" : "none",
                      }}
                    />
                    <h3
                      style={{
                        fontFamily: "'M PLUS Rounded 1c', sans-serif",
                        fontSize: "clamp(1rem, 1.5vw, 1.125rem)",
                        fontWeight: 700,
                        color: "var(--text-main)",
                      }}
                    >
                      {mod.name}
                    </h3>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {unread > 0 && (
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "var(--color-primary)",
                          padding: "4px 10px",
                          borderRadius: "var(--radius-full)",
                          background: "rgba(188, 164, 227, 0.15)",
                        }}
                      >
                        {unread} unread
                      </span>
                    )}
                    <ArrowRight style={{ width: "18px", height: "18px", color: "var(--text-muted)" }} />
                  </div>
                </div>

                <p
                  style={{
                    fontSize: "0.9375rem",
                    color: "var(--text-secondary)",
                    marginBottom: "16px",
                    lineHeight: 1.5,
                  }}
                >
                  {MODULE_DESCRIPTIONS[mod.id] || "Click to configure module parameters"}
                </p>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-muted)", fontSize: "0.8125rem" }}>
                    <Clock style={{ width: "14px", height: "14px" }} />
                    <span>{mod.schedule}</span>
                    {mod.next_run && (
                      <span style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                        · {new Date(mod.next_run).toLocaleString("zh-CN", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => runNow(mod.id, e)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "32px",
                      height: "32px",
                      borderRadius: "var(--radius-full)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--color-primary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    <Play style={{ width: "16px", height: "16px" }} />
                  </button>
                </div>
              </div>
            );
          })}
        </Grid>

        {feedModules.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
            <p style={{ fontSize: "1rem" }}>Loading modules...</p>
          </div>
        )}
      </PageContent>
    </PageContainer>
  );
}
