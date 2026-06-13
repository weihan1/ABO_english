import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle,
  Filter,
  LayoutGrid,
  List,
  PauseCircle,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";

import { api } from "../../core/api";
import {
  filterModulesForManagement,
  isModuleHiddenFromManagement,
} from "../../core/moduleVisibility";
import { useStore, FeedCard } from "../../core/store";
import LazyKeywordPreferencesSection from "../../components/LazyKeywordPreferencesSection";
import { ModuleCard } from "./ModuleCard";
import { ModuleDetailModal } from "./ModuleDetailModal";
import type { ModuleConfig, ModuleDashboard, ModuleStatus } from "../../types/module";
import {
  EMPTY_MODULE_USAGE_METRICS,
  type ModuleUsageMetrics,
} from "./moduleManagementShared";

type ViewMode = "grid" | "list";
type FilterType = "all" | "active" | "paused" | "error" | "unconfigured";
type ModalTab = "overview" | "history";
type TimelineActivity = {
  type: string;
  module_id?: string | null;
};

const FILTER_OPTIONS: { key: FilterType; label: string; icon: ReactNode }[] = [
  { key: "all", label: "All", icon: <Filter style={{ width: "14px", height: "14px" }} /> },
  { key: "active", label: "Running", icon: <CheckCircle style={{ width: "14px", height: "14px" }} /> },
  { key: "paused", label: "Paused", icon: <PauseCircle style={{ width: "14px", height: "14px" }} /> },
  { key: "error", label: "Error", icon: <AlertCircle style={{ width: "14px", height: "14px" }} /> },
  { key: "unconfigured", label: "Needs setup", icon: <Settings style={{ width: "14px", height: "14px" }} /> },
];

type RecentTimelineResponse = {
  timelines?: Array<{
    date: string;
    activities: TimelineActivity[];
  }>;
};

type UnreadCountsResponse = Record<string, number>;
type CardsResponse = { cards: FeedCard[] };

export function ModuleManagementPanel() {
  const [dashboard, setDashboard] = useState<ModuleDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModule, setSelectedModule] = useState<ModuleConfig | null>(null);
  const [initialTab, setInitialTab] = useState<ModalTab>("overview");
  const [runningModules, setRunningModules] = useState<Set<string>>(new Set());
  const [usageByModule, setUsageByModule] = useState<Record<string, ModuleUsageMetrics>>({});
  const {
    addToast,
    moduleHistoryId,
    setModuleHistoryId,
    moduleToConfigure,
    setModuleToConfigure,
    setActiveTab,
    setArxivTrackerActiveTab,
  } = useStore();

  useEffect(() => {
    void loadDashboard();
    const interval = setInterval(() => {
      void loadDashboard();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (dashboard) {
      void loadUsageMetrics(filterModulesForManagement(dashboard.modules));
    }
  }, [dashboard]);

  useEffect(() => {
    if (moduleHistoryId && dashboard) {
      const module = dashboard.modules.find((item) => item.id === moduleHistoryId);
      if (module) {
        setInitialTab("history");
        setSelectedModule(module);
      }
      setModuleHistoryId(null);
    }
  }, [dashboard, moduleHistoryId, setModuleHistoryId]);

  useEffect(() => {
    if (moduleToConfigure) {
      openModuleTool(moduleToConfigure);
      setModuleToConfigure(null);
    }
  }, [moduleToConfigure, setModuleToConfigure]);

  useEffect(() => {
    if (!dashboard || !selectedModule) return;
    const latest = dashboard.modules.find((module) => module.id === selectedModule.id);
    if (latest) {
      setSelectedModule(latest);
    }
  }, [dashboard, selectedModule?.id]);

  async function loadDashboard() {
    try {
      const data = await api.get<ModuleDashboard>("/api/modules/dashboard");
      setDashboard(data);
    } catch (error) {
      addToast({
        kind: "error",
        title: "Load failed",
        message: error instanceof Error ? error.message : "Could not load module data",
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadUsageMetrics(modules: ModuleConfig[]) {
    const moduleIds = modules.map((module) => module.id);
    if (moduleIds.length === 0) {
      setUsageByModule({});
      return;
    }

    try {
      const totalCardsByModule = Object.fromEntries(
        modules.map((module) => [module.id, module.stats.totalCards || 0])
      );

      const latestRequests = moduleIds.map((moduleId) =>
        api.get<CardsResponse>(`/api/cards?module_id=${moduleId}&limit=1&offset=0`)
          .catch(() => ({ cards: [] }))
      );

      const [unreadCounts, recentTimelines, latestResponses] = await Promise.all([
        api.get<UnreadCountsResponse>("/api/cards/unread-counts").catch(() => ({} as UnreadCountsResponse)),
        api.get<RecentTimelineResponse>("/api/timeline/recent/7").catch(() => ({ timelines: [] })),
        Promise.all(latestRequests),
      ]);

      const nextMetrics: Record<string, ModuleUsageMetrics> = Object.fromEntries(
        moduleIds.map((moduleId) => {
          const unreadCount = unreadCounts[moduleId] || 0;
          const totalCards = totalCardsByModule[moduleId] || 0;
          return [
            moduleId,
            {
              ...EMPTY_MODULE_USAGE_METRICS,
              unreadCount,
              readCount: Math.max(0, totalCards - unreadCount),
            },
          ];
        })
      );

      for (const timeline of recentTimelines.timelines || []) {
        for (const activity of timeline.activities || []) {
          const moduleId = activity.module_id || "";
          if (!nextMetrics[moduleId]) continue;
          if (activity.type === "card_view") nextMetrics[moduleId].viewCount7d += 1;
          if (activity.type === "card_save") nextMetrics[moduleId].saveCount7d += 1;
          if (activity.type === "card_like") nextMetrics[moduleId].likeCount7d += 1;
        }
      }

      latestResponses.forEach((response, index) => {
        const latestCard = response.cards?.[0];
        if (latestCard) {
          nextMetrics[moduleIds[index]].lastCardAt = latestCard.created_at;
        }
      });

      setUsageByModule(nextMetrics);
    } catch {
      setUsageByModule((previous) => previous);
    }
  }

  function openModuleTool(moduleId: string) {
    if (selectedModule?.id === moduleId) {
      setSelectedModule(null);
    }

    if (moduleId === "arxiv-tracker" || moduleId === "semantic-scholar-tracker") {
      setArxivTrackerActiveTab("monitors");
      setActiveTab("arxiv");
      return;
    }

    if (moduleId === "xiaohongshu-tracker") {
      localStorage.setItem("xiaohongshu_tool_tab", "following");
      setActiveTab("xiaohongshu");
      return;
    }

    if (moduleId === "bilibili-tracker") {
      localStorage.setItem("bilibili_tool_panel", "following");
      setActiveTab("bilibili");
      return;
    }

    setActiveTab("settings");
  }

  async function handleToggleModule(moduleId: string) {
    const module = dashboard?.modules.find((item) => item.id === moduleId);
    if (!module) return;

    try {
      const newStatus = module.status === "active" ? "paused" : "active";
      await api.post(`/api/modules/${moduleId}/toggle`, { status: newStatus });

      setDashboard((previous) => (
        previous
          ? {
              ...previous,
              modules: previous.modules.map((item) =>
                item.id === moduleId ? { ...item, status: newStatus as ModuleStatus } : item
              ),
            }
          : null
      ));

      setSelectedModule((previous) => (
        previous?.id === moduleId
          ? { ...previous, status: newStatus as ModuleStatus }
          : previous
      ));

      addToast({
        kind: "success",
        title: "Status updated",
        message: `Module ${newStatus === "active" ? "started" : "paused"}`,
      });
    } catch (error) {
      addToast({
        kind: "error",
        title: "Operation failed",
        message: error instanceof Error ? error.message : "Could not toggle module status",
      });
    }
  }

  async function handleRunModule(moduleId: string) {
    try {
      setRunningModules((previous) => new Set(previous).add(moduleId));
      await api.post(`/api/modules/${moduleId}/run`, {});
      addToast({ kind: "success", title: "Run started", message: "The module was added to the execution queue" });
      setTimeout(() => {
        void loadDashboard();
      }, 2000);
    } catch (error) {
      addToast({
        kind: "error",
        title: "Run failed",
        message: error instanceof Error ? error.message : "Could not run the module",
      });
    } finally {
      setRunningModules((previous) => {
        const next = new Set(previous);
        next.delete(moduleId);
        return next;
      });
    }
  }

  function handleUpdateModule(updatedModule: ModuleConfig) {
    setDashboard((previous) => (
      previous
        ? {
            ...previous,
            modules: previous.modules.map((module) =>
              module.id === updatedModule.id ? updatedModule : module
            ),
          }
        : null
    ));
    setSelectedModule(updatedModule);
    void loadDashboard();
  }

  function openModuleModal(module: ModuleConfig, tab: ModalTab) {
    setInitialTab(tab);
    setSelectedModule(module);
  }

  const visibleModules = dashboard ? filterModulesForManagement(dashboard.modules) : [];
  const visibleSummary = visibleModules.reduce(
    (summary, module) => {
      summary.total += 1;
      summary[module.status] += 1;
      summary.totalCardsThisWeek += module.stats.thisWeek;
      return summary;
    },
    {
      total: 0,
      active: 0,
      paused: 0,
      error: 0,
      unconfigured: 0,
      totalCardsThisWeek: 0,
    }
  );

  const visibleUsageSummary = visibleModules.reduce(
    (summary, module) => {
      const usage = usageByModule[module.id] || EMPTY_MODULE_USAGE_METRICS;
      summary.unreadCount += usage.unreadCount;
      summary.viewCount7d += usage.viewCount7d;
      summary.saveCount7d += usage.saveCount7d;
      return summary;
    },
    {
      unreadCount: 0,
      viewCount7d: 0,
      saveCount7d: 0,
    }
  );

  const visibleAlerts = dashboard?.alerts.filter(
    (alert) => !alert.acknowledged && !isModuleHiddenFromManagement(alert.moduleId)
  ) || [];

  const filteredModules = visibleModules.filter((module) => {
    if (filter !== "all" && module.status !== filter) return false;
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase();
    return module.name.toLowerCase().includes(q)
      || module.description.toLowerCase().includes(q)
      || module.id.toLowerCase().includes(q)
      || (module.config.keywords || []).some((keyword) => keyword.toLowerCase().includes(q))
      || (module.subscriptions || []).some((subscription) =>
        subscription.label.toLowerCase().includes(q) || subscription.value.toLowerCase().includes(q)
      );
  });

  if (loading) {
    return (
      <CenteredState
        icon={<RefreshCw style={{ width: "32px", height: "32px", color: "var(--color-primary)", animation: "spin 1s linear infinite" }} />}
        title="Loading module data..."
      />
    );
  }

  if (!dashboard) {
    return (
      <CenteredState
        icon={<AlertCircle style={{ width: "46px", height: "46px", color: "#ef4444" }} />}
        title="Failed to load module data"
        action={
          <button onClick={() => void loadDashboard()} style={primaryButtonStyle}>
            Retry
          </button>
        }
      />
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "24px 28px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "18px", marginBottom: "18px" }}>
          <div>
            <h1
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--text-main)",
                fontFamily: "'M PLUS Rounded 1c', sans-serif",
                margin: 0,
              }}
            >
              Module Runs
            </h1>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginTop: "6px", lineHeight: 1.6 }}>
              This view is only for start, pause, and historical results. Adjust keywords, sources, and cookies on the corresponding tool pages.
            </p>
          </div>

          <button onClick={() => void loadDashboard()} style={ghostButtonStyle}>
            <RefreshCw style={{ width: "14px", height: "14px" }} />
            Refresh
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px", marginBottom: "18px" }}>
          {[
            { label: "Running modules", value: visibleSummary.active, accent: "#16a34a", bg: "rgba(34,197,94,0.12)" },
            { label: "Pending content", value: visibleUsageSummary.unreadCount, accent: "#b45309", bg: "rgba(245,158,11,0.12)" },
            { label: "Views (7d)", value: visibleUsageSummary.viewCount7d, accent: "#2563eb", bg: "rgba(37,99,235,0.10)" },
            { label: "New this week", value: visibleSummary.totalCardsThisWeek, accent: "#7c3aed", bg: "rgba(124,58,237,0.10)" },
          ].map((item) => (
            <div key={item.label} style={{ padding: "14px 16px", borderRadius: "16px", background: item.bg }}>
              <div style={{ fontSize: "1.35rem", fontWeight: 800, color: item.accent, marginBottom: "4px" }}>{item.value}</div>
              <div style={{ fontSize: "0.75rem", color: item.accent, opacity: 0.82 }}>{item.label}</div>
            </div>
          ))}
        </div>

        {visibleAlerts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "18px" }}>
            {visibleAlerts.slice(0, 3).map((alert) => (
              <div
                key={alert.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  background: alert.severity === "error" ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
                  border: `1px solid ${alert.severity === "error" ? "rgba(239,68,68,0.18)" : "rgba(245,158,11,0.18)"}`,
                }}
              >
                <AlertCircle style={{ width: "16px", height: "16px", color: alert.severity === "error" ? "#dc2626" : "#b45309", flexShrink: 0 }} />
                <span style={{ fontSize: "0.8125rem", color: alert.severity === "error" ? "#dc2626" : "#b45309" }}>{alert.message}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
          <div style={{ flex: 1, position: "relative" }}>
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
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search modules, keywords, or sources"
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

          <div style={{ display: "flex", gap: "6px" }}>
            {FILTER_OPTIONS.map((item) => (
              <button
                key={item.key}
                onClick={() => setFilter(item.key)}
                style={{
                  height: "36px",
                  padding: "0 12px",
                  borderRadius: "999px",
                  border: "none",
                  background: filter === item.key ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))" : "var(--bg-hover)",
                  color: filter === item.key ? "white" : "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", background: "var(--bg-hover)", borderRadius: "10px", padding: "3px" }}>
            {([
              ["grid", LayoutGrid],
              ["list", List],
            ] as const).map(([mode, Icon]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  width: "34px",
                  height: "30px",
                  borderRadius: "8px",
                  border: "none",
                  background: viewMode === mode ? "var(--bg-card)" : "transparent",
                  color: viewMode === mode ? "var(--text-main)" : "var(--text-muted)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon style={{ width: "16px", height: "16px" }} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 28px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {filteredModules.length === 0 ? (
            <CenteredState
              icon={<Settings style={{ width: "42px", height: "42px", color: "var(--text-muted)", opacity: 0.35 }} />}
              title={searchQuery ? "No matching modules" : "No modules under this filter"}
              description={searchQuery ? "Try a different keyword." : "Adjust the filter, or set up monitors on the tool pages."}
            />
          ) : (
            <div
              style={
                viewMode === "grid"
                  ? { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }
                  : { display: "flex", flexDirection: "column", gap: "12px" }
              }
            >
              {filteredModules.map((module) => (
                <ModuleCard
                  key={module.id}
                  module={module}
                  usage={usageByModule[module.id] || EMPTY_MODULE_USAGE_METRICS}
                  onOpenHistory={() => openModuleModal(module, "history")}
                  onOpenOverview={() => openModuleModal(module, "overview")}
                  onOpenTool={() => openModuleTool(module.id)}
                  onRun={() => {
                    if (!runningModules.has(module.id)) {
                      void handleRunModule(module.id);
                    }
                  }}
                  onToggle={() => void handleToggleModule(module.id)}
                />
              ))}
            </div>
          )}

          <LazyKeywordPreferencesSection
            title="Preference learning"
            description="Shows positive preference keywords. Data loads only on click, keeping the Module Management first paint fast."
          />
        </div>
      </div>

      {selectedModule && (
        <ModuleDetailModal
          module={selectedModule}
          usage={usageByModule[selectedModule.id] || EMPTY_MODULE_USAGE_METRICS}
          initialTab={initialTab}
          onClose={() => setSelectedModule(null)}
          onUpdate={handleUpdateModule}
          onOpenTool={() => openModuleTool(selectedModule.id)}
          onRun={() => {
            if (!runningModules.has(selectedModule.id)) {
              void handleRunModule(selectedModule.id);
            }
          }}
          onToggle={() => void handleToggleModule(selectedModule.id)}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function CenteredState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: "12px",
        color: "var(--text-muted)",
      }}
    >
      {icon}
      <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)" }}>{title}</div>
      {description && <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{description}</div>}
      {action}
    </div>
  );
}

const primaryButtonStyle: CSSProperties = {
  height: "38px",
  padding: "0 16px",
  borderRadius: "8px",
  border: "none",
  background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
  color: "white",
  fontSize: "0.8125rem",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  height: "36px",
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
