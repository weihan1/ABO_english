import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Bell,
  BookOpen,
  GitBranch,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { Card } from "../../components/Layout";
import ToggleSwitch from "../../components/ToggleSwitch";
import { useToast } from "../../components/Toast";
import { api } from "../../core/api";
import { ArxivCategorySelector, type ArxivCategory } from "./ArxivCategorySelector";
import {
  AdvancedQueryBuilder,
  createEmptyAdvancedQuery,
  previewAdvancedQuery,
  type ArxivAdvancedQuery,
} from "./AdvancedQueryBuilder";

type KeywordMonitor = {
  id: string;
  label: string;
  query: string;
  categories: string[];
  enabled: boolean;
  advanced?: ArxivAdvancedQuery | null;
};

type FollowUpMonitor = {
  id: string;
  label: string;
  query: string;
  enabled: boolean;
};

type ArxivConfigResponse = {
  keyword_monitors?: KeywordMonitor[];
  max_results?: number;
  days_back?: number | null;
};

type FollowUpConfigResponse = {
  followup_monitors?: FollowUpMonitor[];
  max_results?: number;
  days_back?: number | null;
  sort_by?: "recency" | "citation_count";
};

type FollowUpSourceResolveResponse = {
  found: boolean;
  query: string;
  paper?: {
    title?: string;
    paper_id?: string;
    arxiv_id?: string;
    year?: number;
    publication_date?: string;
    citation_count?: number;
    url?: string;
    s2_url?: string;
  } | null;
};

type ArxivMonitorConfig = {
  keyword_monitors: KeywordMonitor[];
  max_results: number;
  days_back: number;
};

type FollowUpMonitorConfig = {
  followup_monitors: FollowUpMonitor[];
  max_results: number;
  days_back: number;
  sort_by: "recency" | "citation_count";
};

type CategoriesResponse = {
  categories: ArxivCategory[];
};

const DEFAULT_ARXIV_MAIN = "cs";
const DEFAULT_MONITOR_MAX_RESULTS = 20;
const DEFAULT_ARXIV_DAYS_BACK = 30;
const DEFAULT_FOLLOWUP_DAYS_BACK = 365;

function makeLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function getDefaultArxivSelectorCategories(availableCategories: ArxivCategory[]): string[] {
  return availableCategories
    .filter((category) => category.main === DEFAULT_ARXIV_MAIN)
    .map((category) => category.code);
}

function compactSelectedArxivCategories(
  selectedCategories: string[],
  availableCategories: ArxivCategory[],
): string[] {
  if (!availableCategories.length) return [`${DEFAULT_ARXIV_MAIN}.*`];

  const selectedSet = new Set(selectedCategories);
  if (selectedSet.size === 0) return [`${DEFAULT_ARXIV_MAIN}.*`];

  const grouped = availableCategories.reduce<Record<string, string[]>>((acc, category) => {
    if (!acc[category.main]) acc[category.main] = [];
    acc[category.main].push(category.code);
    return acc;
  }, {});

  const compacted: string[] = [];
  Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .forEach((main) => {
      const codes = grouped[main];
      const selectedCodes = codes.filter((code) => selectedSet.has(code));
      if (selectedCodes.length === 0) return;
      if (selectedCodes.length === codes.length) {
        compacted.push(`${main}.*`);
        return;
      }
      compacted.push(...selectedCodes);
    });

  return compacted.length > 0 ? compacted : [`${DEFAULT_ARXIV_MAIN}.*`];
}

function formatCategoryTag(category: string): string {
  return category.endsWith(".*") ? `${category.slice(0, -2).toUpperCase()} all areas` : category;
}

function clampInteger(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sectionHeaderStyle(): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "12px",
  };
}

function pillStyle(active: boolean): CSSProperties {
  return {
    height: "38px",
    padding: "0 14px",
    borderRadius: "8px",
    border: `1px solid ${active ? "var(--color-primary)" : "var(--border-light)"}`,
    background: active ? "rgba(188, 164, 227, 0.12)" : "var(--bg-app)",
    color: active ? "var(--color-primary)" : "var(--text-secondary)",
    fontSize: "0.875rem",
    fontWeight: 600,
    cursor: "pointer",
  };
}

export default function PaperMonitorPanel() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [runningKey, setRunningKey] = useState<"arxiv" | "followup" | null>(null);
  const [availableCategories, setAvailableCategories] = useState<ArxivCategory[]>([]);
  const [expandedMainCategories, setExpandedMainCategories] = useState<Set<string>>(new Set());

  const [arxivConfig, setArxivConfig] = useState<ArxivMonitorConfig>({
    keyword_monitors: [],
    max_results: 20,
    days_back: 30,
  });
  const [followupConfig, setFollowupConfig] = useState<FollowUpMonitorConfig>({
    followup_monitors: [],
    max_results: DEFAULT_MONITOR_MAX_RESULTS,
    days_back: DEFAULT_FOLLOWUP_DAYS_BACK,
    sort_by: "recency",
  });

  const [keywordLabelDraft, setKeywordLabelDraft] = useState("");
  const [keywordQueryDraft, setKeywordQueryDraft] = useState("");
  const [keywordSelectedCategories, setKeywordSelectedCategories] = useState<string[]>([]);
  const [advancedLabelDraft, setAdvancedLabelDraft] = useState("");
  const [keywordAdvancedDraft, setKeywordAdvancedDraft] = useState<ArxivAdvancedQuery>(() =>
    createEmptyAdvancedQuery(),
  );
  const [followupLabelDraft, setFollowupLabelDraft] = useState("");
  const [followupQueryDraft, setFollowupQueryDraft] = useState("");
  const [arxivMaxResultsInput, setArxivMaxResultsInput] = useState(String(DEFAULT_MONITOR_MAX_RESULTS));
  const [arxivDaysBackInput, setArxivDaysBackInput] = useState(String(DEFAULT_ARXIV_DAYS_BACK));
  const [followupMaxResultsInput, setFollowupMaxResultsInput] = useState(String(DEFAULT_MONITOR_MAX_RESULTS));
  const [followupDaysBackInput, setFollowupDaysBackInput] = useState(String(DEFAULT_FOLLOWUP_DAYS_BACK));

  async function loadConfigs() {
    setLoading(true);
    try {
      const [arxivRes, followupRes, categoriesRes] = await Promise.all([
        api.get<ArxivConfigResponse>("/api/modules/arxiv-tracker/config"),
        api.get<FollowUpConfigResponse>("/api/modules/semantic-scholar-tracker/config"),
        api.get<CategoriesResponse>("/api/modules/arxiv-tracker/categories"),
      ]);

      const categories = categoriesRes.categories || [];
      setAvailableCategories(categories);

      setArxivConfig({
        keyword_monitors: arxivRes.keyword_monitors || [],
        max_results: Number(arxivRes.max_results || DEFAULT_MONITOR_MAX_RESULTS),
        days_back: Number(arxivRes.days_back || DEFAULT_ARXIV_DAYS_BACK),
      });
      setFollowupConfig({
        followup_monitors: followupRes.followup_monitors || [],
        max_results: Number(followupRes.max_results || DEFAULT_MONITOR_MAX_RESULTS),
        days_back: Number(followupRes.days_back || DEFAULT_FOLLOWUP_DAYS_BACK),
        sort_by: followupRes.sort_by === "citation_count" ? "citation_count" : "recency",
      });
      setKeywordSelectedCategories((current) =>
        current.length > 0 ? current : getDefaultArxivSelectorCategories(categories),
      );
    } catch (error) {
      toast.error("Failed to load monitor config", error instanceof Error ? error.message : "Please try again later");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfigs();
  }, []);

  useEffect(() => {
    if (!availableCategories.length) return;
    setKeywordSelectedCategories((current) =>
      current.length > 0 ? current : getDefaultArxivSelectorCategories(availableCategories),
    );
  }, [availableCategories]);

  useEffect(() => {
    setArxivMaxResultsInput(String(arxivConfig.max_results));
    setArxivDaysBackInput(String(arxivConfig.days_back));
  }, [arxivConfig.max_results, arxivConfig.days_back]);

  useEffect(() => {
    setFollowupMaxResultsInput(String(followupConfig.max_results));
    setFollowupDaysBackInput(String(followupConfig.days_back));
  }, [followupConfig.max_results, followupConfig.days_back]);

  async function persistArxivConfig(nextConfig: ArxivMonitorConfig, successMessage?: string) {
    setSavingKey("arxiv");
    try {
      await api.post("/api/modules/arxiv-tracker/config", nextConfig);
      setArxivConfig(nextConfig);
      if (successMessage) {
        toast.success("Keyword monitors updated", successMessage);
      }
    } catch (error) {
      toast.error("Failed to save keyword monitors", error instanceof Error ? error.message : "Please try again later");
    } finally {
      setSavingKey(null);
    }
  }

  async function persistFollowupConfig(nextConfig: FollowUpMonitorConfig, successMessage?: string) {
    setSavingKey("followup");
    try {
      await api.post("/api/modules/semantic-scholar-tracker/config", nextConfig);
      setFollowupConfig(nextConfig);
      if (successMessage) {
        toast.success("Follow Up monitors updated", successMessage);
      }
    } catch (error) {
      toast.error("Failed to save Follow Up monitors", error instanceof Error ? error.message : "Please try again later");
    } finally {
      setSavingKey(null);
    }
  }

  async function runMonitor(moduleId: "arxiv-tracker" | "semantic-scholar-tracker") {
    const runKey = moduleId === "arxiv-tracker" ? "arxiv" : "followup";
    setRunningKey(runKey);
    try {
      await api.post(`/api/modules/${moduleId}/run`, {});
      toast.success(
        "Monitor started",
        moduleId === "arxiv-tracker" ? "Keyword monitor results will appear in Daily Briefing" : "Follow Up results will appear in Daily Briefing"
      );
    } catch (error) {
      toast.error("Failed to start monitor", error instanceof Error ? error.message : "Please try again later");
    } finally {
      setRunningKey(null);
    }
  }

  async function commitArxivNumericField(field: "max_results" | "days_back") {
    const isMaxResults = field === "max_results";
    const rawValue = isMaxResults ? arxivMaxResultsInput : arxivDaysBackInput;
    const previousValue = isMaxResults ? arxivConfig.max_results : arxivConfig.days_back;

    if (!rawValue.trim()) {
      toast.error(isMaxResults ? "Per-item max cannot be empty" : "Day range cannot be empty");
      if (isMaxResults) setArxivMaxResultsInput(String(previousValue));
      else setArxivDaysBackInput(String(previousValue));
      return;
    }

    const nextValue = isMaxResults
      ? clampInteger(rawValue, 1, 100, DEFAULT_MONITOR_MAX_RESULTS)
      : clampInteger(rawValue, 1, 3650, DEFAULT_ARXIV_DAYS_BACK);

    if (isMaxResults) setArxivMaxResultsInput(String(nextValue));
    else setArxivDaysBackInput(String(nextValue));

    if (nextValue === previousValue) return;

    await persistArxivConfig({
      ...arxivConfig,
      [field]: nextValue,
    });
  }

  async function commitFollowupNumericField(field: "max_results" | "days_back") {
    const isMaxResults = field === "max_results";
    const rawValue = isMaxResults ? followupMaxResultsInput : followupDaysBackInput;
    const previousValue = isMaxResults ? followupConfig.max_results : followupConfig.days_back;

    if (!rawValue.trim()) {
      toast.error(isMaxResults ? "Per-item max cannot be empty" : "Day range cannot be empty");
      if (isMaxResults) setFollowupMaxResultsInput(String(previousValue));
      else setFollowupDaysBackInput(String(previousValue));
      return;
    }

    const nextValue = isMaxResults
      ? clampInteger(rawValue, 1, 500, DEFAULT_MONITOR_MAX_RESULTS)
      : clampInteger(rawValue, 1, 3650, DEFAULT_FOLLOWUP_DAYS_BACK);

    if (isMaxResults) setFollowupMaxResultsInput(String(nextValue));
    else setFollowupDaysBackInput(String(nextValue));

    if (nextValue === previousValue) return;

    await persistFollowupConfig({
      ...followupConfig,
      [field]: nextValue,
    });
  }

  async function addAdvancedKeywordMonitor() {
    const hasSignal =
      keywordAdvancedDraft.conditions.some((c) => c.value.trim()) ||
      keywordAdvancedDraft.categories.length > 0 ||
      Boolean(keywordAdvancedDraft.date_range);
    if (!hasSignal) {
      toast.error("Please add at least one advanced condition / category / date range");
      return;
    }

    const preview = previewAdvancedQuery(keywordAdvancedDraft);
    const label = advancedLabelDraft.trim() || preview;

    const nextMonitor: KeywordMonitor = {
      id: makeLocalId("keyword"),
      label,
      query: "",
      categories:
        keywordAdvancedDraft.categories.length > 0
          ? keywordAdvancedDraft.categories
          : ["cs.*"],
      enabled: true,
      advanced: keywordAdvancedDraft,
    };

    const advancedKey = JSON.stringify(keywordAdvancedDraft);
    if (
      arxivConfig.keyword_monitors.some(
        (monitor) => monitor.advanced && JSON.stringify(monitor.advanced) === advancedKey,
      )
    ) {
      toast.error("An identical advanced monitor already exists", "Toggle it directly, or delete and re-add it");
      return;
    }

    const nextConfig = {
      ...arxivConfig,
      keyword_monitors: [...arxivConfig.keyword_monitors, nextMonitor],
    };
    await persistArxivConfig(nextConfig, `Added ${label}`);
    setAdvancedLabelDraft("");
    setKeywordAdvancedDraft(createEmptyAdvancedQuery());
  }

  async function addKeywordMonitor() {
    const query = keywordQueryDraft.trim();
    if (!query) {
      toast.error("Please enter a keyword expression", "Supports comma AND and | grouped OR");
      return;
    }

    const selectedCategories = keywordSelectedCategories.length > 0
      ? keywordSelectedCategories
      : getDefaultArxivSelectorCategories(availableCategories);

    const nextMonitor: KeywordMonitor = {
      id: makeLocalId("keyword"),
      label: keywordLabelDraft.trim() || query,
      query,
      categories: compactSelectedArxivCategories(selectedCategories, availableCategories),
      enabled: true,
    };

    if (
      arxivConfig.keyword_monitors.some(
        (monitor) => monitor.query.trim().toLowerCase() === nextMonitor.query.toLowerCase()
      )
    ) {
      toast.error("Keyword monitor already exists", "Toggle it directly, or delete and re-add it");
      return;
    }

    const nextConfig = {
      ...arxivConfig,
      keyword_monitors: [...arxivConfig.keyword_monitors, nextMonitor],
    };
    await persistArxivConfig(nextConfig, `Added ${nextMonitor.label}`);
    setKeywordLabelDraft("");
    setKeywordQueryDraft("");
    setKeywordSelectedCategories(getDefaultArxivSelectorCategories(availableCategories));
  }

  async function addFollowupMonitor() {
    const query = followupQueryDraft.trim();
    if (!query) {
      toast.error("Please enter the full paper title", "Semantic Scholar finds follow-ups by paper title");
      return;
    }

    setSavingKey("followup");
    let resolvedTitle = query;
    try {
      const resolved = await api.post<FollowUpSourceResolveResponse>(
        "/api/modules/semantic-scholar-tracker/resolve-source",
        { query },
      );
      resolvedTitle = resolved.paper?.title?.trim() || query;

      if (!resolved.found || !resolvedTitle) {
        toast.error("Source paper not found", "Try a more complete paper title and add again");
        return;
      }
      setFollowupLabelDraft((current) => current.trim() ? current : resolvedTitle);
    } catch (error) {
      toast.error("Failed to resolve source paper", error instanceof Error ? error.message : "Please try again later");
      return;
    } finally {
      setSavingKey(null);
    }

    const nextMonitor: FollowUpMonitor = {
      id: makeLocalId("followup"),
      label: followupLabelDraft.trim() || resolvedTitle,
      query: resolvedTitle,
      enabled: true,
    };

    const duplicateKeys = new Set([query, resolvedTitle].map((value) => value.trim().toLowerCase()).filter(Boolean));
    if (
      followupConfig.followup_monitors.some(
        (monitor) =>
          duplicateKeys.has(monitor.query.trim().toLowerCase()) ||
          duplicateKeys.has(monitor.label.trim().toLowerCase())
      )
    ) {
      toast.error("Follow Up monitor already exists", "Toggle it directly, or delete and re-add it");
      return;
    }

    const nextConfig = {
      ...followupConfig,
      followup_monitors: [...followupConfig.followup_monitors, nextMonitor],
    };
    await persistFollowupConfig(nextConfig, `Added ${nextMonitor.label}`);
    setFollowupLabelDraft("");
    setFollowupQueryDraft("");
  }

  const keywordEnabledCount = useMemo(
    () => arxivConfig.keyword_monitors.filter((monitor) => monitor.enabled).length,
    [arxivConfig.keyword_monitors]
  );
  const followupEnabledCount = useMemo(
    () => followupConfig.followup_monitors.filter((monitor) => monitor.enabled).length,
    [followupConfig.followup_monitors]
  );

  return (
    <Card
      title="Tracking Monitors"
      icon={<Bell style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />}
      style={{ marginBottom: "24px" }}
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "24px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "12px",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "8px",
              border: "1px solid var(--border-light)",
              background: "var(--bg-hover)",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px" }}>
              Keyword monitors
            </div>
            <div style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>
              {keywordEnabledCount}/{arxivConfig.keyword_monitors.length || 0}
            </div>
          </div>
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "8px",
              border: "1px solid var(--border-light)",
              background: "var(--bg-hover)",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px" }}>
              Follow Up monitors
            </div>
            <div style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>
              {followupEnabledCount}/{followupConfig.followup_monitors.length || 0}
            </div>
          </div>
        </div>

        <div
          style={{
            fontSize: "0.8125rem",
            color: "var(--text-muted)",
            lineHeight: 1.7,
            padding: "12px 14px",
            borderRadius: "8px",
            background: "var(--bg-hover)",
            border: "1px dashed var(--border-light)",
          }}
        >
          Configured monitors reuse the module's schedule, and newly caught papers go straight into Daily Briefing's paper tracking. Keyword monitors support
          <code style={{ margin: "0 4px", padding: "2px 6px", borderRadius: "4px", background: "var(--bg-card)" }}>
            vision,language | robot,manipulation
          </code>
          this AND / OR expression style.
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "20px",
            alignItems: "start",
          }}
        >
          <section
            style={{
              border: "1px solid var(--border-light)",
              borderRadius: "8px",
              padding: "18px",
              background: "var(--bg-card)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={sectionHeaderStyle()}>
              <Search style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />
              <div>
                <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
                  arXiv keyword tracking
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                  Crawls the specified areas; results land in Daily Briefing's keyword groups
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", width: "128px" }}>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                  Per-item max
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={arxivMaxResultsInput}
                  onChange={(event) => setArxivMaxResultsInput(event.target.value)}
                  onBlur={() => void commitArxivNumericField("max_results")}
                  style={{
                    height: "38px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", width: "128px" }}>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                  Day range
                </span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={arxivDaysBackInput}
                  onChange={(event) => setArxivDaysBackInput(event.target.value)}
                  onBlur={() => void commitArxivNumericField("days_back")}
                  style={{
                    height: "38px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                  }}
                />
              </label>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {loading ? (
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Loading monitors…</div>
              ) : arxivConfig.keyword_monitors.length === 0 ? (
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px dashed var(--border-light)",
                    color: "var(--text-muted)",
                    fontSize: "0.875rem",
                  }}
                >
                  No keyword monitors yet. Start with 1-3 high-value topics.
                </div>
              ) : (
                arxivConfig.keyword_monitors.map((monitor) => (
                  <div
                    key={monitor.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-hover)",
                    }}
                  >
                    <ToggleSwitch
                      enabled={monitor.enabled}
                      size="sm"
                      disabled={savingKey === "arxiv"}
                      onChange={async (enabled) => {
                        const nextConfig = {
                          ...arxivConfig,
                          keyword_monitors: arxivConfig.keyword_monitors.map((item) =>
                            item.id === monitor.id ? { ...item, enabled } : item
                          ),
                        };
                        await persistArxivConfig(nextConfig);
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
                        {monitor.label}
                      </div>
                      <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        {monitor.query}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
                        {(monitor.categories.length ? monitor.categories : ["cs.*"]).map((category) => (
                          <span
                            key={`${monitor.id}-${category}`}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "999px",
                              background: "rgba(188, 164, 227, 0.12)",
                              color: "var(--color-primary)",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                            }}
                          >
                            {formatCategoryTag(category)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const nextConfig = {
                          ...arxivConfig,
                          keyword_monitors: arxivConfig.keyword_monitors.filter((item) => item.id !== monitor.id),
                        };
                        await persistArxivConfig(nextConfig, `Deleted ${monitor.label}`);
                      }}
                      style={{
                        width: "34px",
                        height: "34px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-card)",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Trash2 style={{ width: "14px", height: "14px" }} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                Simple keyword monitor
                <span style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--text-muted)", marginLeft: 8 }}>
                  String: comma = AND, <code>|</code> = OR; matches title + abstract
                </span>
              </div>
              <input
                type="text"
                value={keywordLabelDraft}
                onChange={(event) => setKeywordLabelDraft(event.target.value)}
                placeholder="Display name, optional"
                style={{
                  height: "40px",
                  padding: "0 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-app)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                }}
              />
              <input
                type="text"
                value={keywordQueryDraft}
                onChange={(event) => setKeywordQueryDraft(event.target.value)}
                placeholder="e.g. vision,language | robot,manipulation"
                style={{
                  height: "40px",
                  padding: "0 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-app)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                }}
              />
              <div
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-app)",
                }}
              >
                <ArxivCategorySelector
                  availableCategories={availableCategories}
                  selectedCategories={keywordSelectedCategories}
                  expandedMainCategories={expandedMainCategories}
                  onToggleCategory={(category) =>
                    setKeywordSelectedCategories((current) => {
                      const next = current.includes(category)
                        ? current.filter((item) => item !== category)
                        : [...current, category];
                      return dedupeStrings(next);
                    })
                  }
                  onToggleMainCategory={(main) => {
                    const codes = availableCategories
                      .filter((category) => category.main === main)
                      .map((category) => category.code);
                    setKeywordSelectedCategories((current) => {
                      const currentSet = new Set(current);
                      const allSelected = codes.length > 0 && codes.every((code) => currentSet.has(code));
                      if (allSelected) {
                        return current.filter((code) => !codes.includes(code));
                      }
                      return dedupeStrings([...current, ...codes]);
                    });
                  }}
                  onToggleMainCategoryExpanded={(main) =>
                    setExpandedMainCategories((current) => {
                      const next = new Set(current);
                      if (next.has(main)) next.delete(main);
                      else next.add(main);
                      return next;
                    })
                  }
                  label="Areas of interest"
                  helperText="All Computer Science areas are selected by default. You can switch disciplines and fine-tune the crawl scope by tag."
                  maxHeight={240}
                  disabled={savingKey === "arxiv"}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={addKeywordMonitor}
                disabled={savingKey === "arxiv"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                  color: "white",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Plus style={{ width: "16px", height: "16px" }} />
                Add keyword monitor
              </button>
              <button
                type="button"
                onClick={() => runMonitor("arxiv-tracker")}
                disabled={runningKey === "arxiv"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Play style={{ width: "16px", height: "16px" }} />
                {runningKey === "arxiv" ? "Running..." : "Run now"}
              </button>
            </div>
          </section>

          <section
            style={{
              border: "1px solid var(--border-light)",
              borderRadius: "8px",
              padding: "18px",
              background: "var(--bg-card)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={sectionHeaderStyle()}>
              <GitBranch style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />
              <div>
                <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
                  Follow Up paper tracking
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                  Uses the Semantic Scholar backend to track follow-up research by full paper title
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", width: "128px" }}>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                  Per-item max
                </span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={followupMaxResultsInput}
                  onChange={(event) => setFollowupMaxResultsInput(event.target.value)}
                  onBlur={() => void commitFollowupNumericField("max_results")}
                  style={{
                    height: "38px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px", width: "128px" }}>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                  Day range
                </span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={followupDaysBackInput}
                  onChange={(event) => setFollowupDaysBackInput(event.target.value)}
                  onBlur={() => void commitFollowupNumericField("days_back")}
                  style={{
                    height: "38px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                  }}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() =>
                  persistFollowupConfig({
                    ...followupConfig,
                    sort_by: "recency",
                  })
                }
                style={pillStyle(followupConfig.sort_by === "recency")}
              >
                Newest first
              </button>
              <button
                type="button"
                onClick={() =>
                  persistFollowupConfig({
                    ...followupConfig,
                    sort_by: "citation_count",
                  })
                }
                style={pillStyle(followupConfig.sort_by === "citation_count")}
              >
                Most cited first
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {loading ? (
                <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Loading monitors…</div>
              ) : followupConfig.followup_monitors.length === 0 ? (
                <div
                  style={{
                    padding: "14px",
                    borderRadius: "8px",
                    border: "1px dashed var(--border-light)",
                    color: "var(--text-muted)",
                    fontSize: "0.875rem",
                  }}
                >
                  No Follow Up monitors yet. Start with the benchmark or method papers you care about most.
                </div>
              ) : (
                followupConfig.followup_monitors.map((monitor) => (
                  <div
                    key={monitor.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-hover)",
                    }}
                  >
                    <ToggleSwitch
                      enabled={monitor.enabled}
                      size="sm"
                      disabled={savingKey === "followup"}
                      onChange={async (enabled) => {
                        const nextConfig = {
                          ...followupConfig,
                          followup_monitors: followupConfig.followup_monitors.map((item) =>
                            item.id === monitor.id ? { ...item, enabled } : item
                          ),
                        };
                        await persistFollowupConfig(nextConfig);
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
                        {monitor.label}
                      </div>
                      <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        {monitor.query}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const nextConfig = {
                          ...followupConfig,
                          followup_monitors: followupConfig.followup_monitors.filter((item) => item.id !== monitor.id),
                        };
                        await persistFollowupConfig(nextConfig, `Deleted ${monitor.label}`);
                      }}
                      style={{
                        width: "34px",
                        height: "34px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-card)",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Trash2 style={{ width: "14px", height: "14px" }} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              <input
                type="text"
                value={followupLabelDraft}
                onChange={(event) => setFollowupLabelDraft(event.target.value)}
                placeholder="Display name, optional"
                style={{
                  height: "40px",
                  padding: "0 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-app)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                }}
              />
              <textarea
                value={followupQueryDraft}
                onChange={(event) => setFollowupQueryDraft(event.target.value)}
                placeholder="Enter the full paper title, e.g. World Action Models are Zero-shot Policies"
                rows={3}
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-app)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={addFollowupMonitor}
                disabled={savingKey === "followup"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "none",
                  background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                  color: "white",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Plus style={{ width: "16px", height: "16px" }} />
                {savingKey === "followup" ? "Processing..." : "Add Follow Up monitor"}
              </button>
              <button
                type="button"
                onClick={() => runMonitor("semantic-scholar-tracker")}
                disabled={runningKey === "followup"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Play style={{ width: "16px", height: "16px" }} />
                {runningKey === "followup" ? "Running..." : "Run now"}
              </button>
            </div>
          </section>
        </div>

        <section
          style={{
            border: "1px solid var(--border-light)",
            borderRadius: "8px",
            padding: "18px",
            background: "var(--bg-card)",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div style={sectionHeaderStyle()}>
            <Search style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
                Advanced condition monitor
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                Field-scoped conditions (Title / Abstract / Author / Category …), aligned with arXiv's official advanced search syntax
              </div>
            </div>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid var(--border-light)",
              }}
            >
              {arxivConfig.keyword_monitors.filter((m) => m.advanced).length}
            </span>
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            <input
              type="text"
              value={advancedLabelDraft}
              onChange={(event) => setAdvancedLabelDraft(event.target.value)}
              placeholder="Display name, optional (defaults to the compiled search_query)"
              style={{
                height: "40px",
                padding: "0 12px",
                borderRadius: "8px",
                border: "1px solid var(--border-light)",
                background: "var(--bg-app)",
                color: "var(--text-main)",
                fontSize: "0.875rem",
                outline: "none",
              }}
            />
            <AdvancedQueryBuilder
              value={keywordAdvancedDraft}
              onChange={setKeywordAdvancedDraft}
              availableCategories={availableCategories}
              expandedMainCategories={expandedMainCategories}
              onToggleMainCategoryExpanded={(main) =>
                setExpandedMainCategories((current) => {
                  const next = new Set(current);
                  if (next.has(main)) next.delete(main);
                  else next.add(main);
                  return next;
                })
              }
              showRuntimeKnobs={false}
              disabled={savingKey === "arxiv"}
            />
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={addAdvancedKeywordMonitor}
              disabled={savingKey === "arxiv"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "none",
                background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Plus style={{ width: "16px", height: "16px" }} />
              Add advanced monitor
            </button>
          </div>
        </section>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "0.8125rem",
            color: "var(--text-muted)",
          }}
        >
          <BookOpen style={{ width: "16px", height: "16px" }} />
          The save button reuses the existing "save to Literature Library" backend flow; monitor cards and manual search cards share the same persistence logic.
        </div>
      </div>
    </Card>
  );
}
