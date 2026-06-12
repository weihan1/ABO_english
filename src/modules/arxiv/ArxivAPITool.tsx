import { useState, useEffect, useRef } from "react";
import {
  Search,
  FileText,
  ExternalLink,
  Filter,
  Check,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Clock,
  Users,
  Download,
  Image as ImageIcon,
  Save,
} from "lucide-react";
import { PageContainer, PageHeader, PageContent, Card, EmptyState } from "../../components/Layout";
import { api } from "../../core/api";
import { isActionEnterKey } from "../../core/keyboard";
import { dirnamePath, withLocationSuffix } from "../../core/pathDisplay";
import { useToast } from "../../components/Toast";
import { useStore } from "../../core/store";
import { ArxivCategorySelector, type ArxivCategory } from "./ArxivCategorySelector";
import { fetchArxivPaperIntroduction, type ArxivIntroductionPayload } from "./arxivPaperApi";
import {
  AdvancedQueryBuilder,
  createEmptyAdvancedQuery,
  previewAdvancedQuery,
  type ArxivAdvancedQuery,
} from "./AdvancedQueryBuilder";

interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  summary: string;
  published: string;
  categories: string[];
  primary_category: string;
  pdf_url: string;
  arxiv_url: string;
  comment?: string;
  figures?: Array<{
    url?: string;
    caption: string;
    is_method: boolean;
    type: string;
    local_path?: string;
    original_url?: string;
    filename?: string;
  }>;
}

interface CategoriesResponse {
  categories: ArxivCategory[];
}

interface SearchResponse {
  papers: ArxivPaper[];
  total?: number;
  total_results?: number;
  search_time_ms: number;
}

export function ArxivAPITool() {
  const toast = useToast();
  const config = useStore((state) => state.config);
  const hasLiteraturePath = Boolean(config?.literature_path || config?.vault_path);

  const fieldShellStyle = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    height: "42px",
    padding: "0 14px",
    borderRadius: "14px",
    border: "1px solid var(--border-light)",
    background: "color-mix(in srgb, var(--bg-card) 78%, transparent)",
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.35)",
  } as const;

  // Search parameters
  const [keywords, setKeywords] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [expandedMainCategories, setExpandedMainCategories] = useState<Set<string>>(new Set());
  const [availableCategories, setAvailableCategories] = useState<ArxivCategory[]>([]);
  const [mode, setMode] = useState<"AND" | "OR">("AND");
  const [maxResults, setMaxResults] = useState(50);
  const [daysBack, setDaysBack] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState("submittedDate");
  const [activeTrackingLabel, setActiveTrackingLabel] = useState("");
  const [searchMode, setSearchMode] = useState<"simple" | "advanced">("simple");
  const [advancedQuery, setAdvancedQuery] = useState<ArxivAdvancedQuery>(() => createEmptyAdvancedQuery());

  // Results state
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [searchTimeMs, setSearchTimeMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedPapers, setExpandedPapers] = useState<Set<string>>(new Set());
  const [paperFigures, setPaperFigures] = useState<Record<string, ArxivPaper["figures"]>>({});
  const [loadingFigures, setLoadingFigures] = useState<Set<string>>(new Set());
  const [paperIntroductionData, setPaperIntroductionData] = useState<Record<string, ArxivIntroductionPayload>>({});
  const [loadingIntroductions, setLoadingIntroductions] = useState<Set<string>>(new Set());
  const [introAttemptedPapers, setIntroAttemptedPapers] = useState<Set<string>>(new Set());
  const [expandedIntroductions, setExpandedIntroductions] = useState<Set<string>>(new Set());
  const [savingPaper, setSavingPaper] = useState<string | null>(null);
  const [savedPaperIds, setSavedPaperIds] = useState<Set<string>>(new Set());
  const [autoSaveAll, setAutoSaveAll] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkSaveProgress, setBulkSaveProgress] = useState<{ current: number; total: number } | null>(null);
  const introPrefetchRunRef = useRef(0);

  // Load categories on mount
  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const result = await api.get<CategoriesResponse>("/api/tools/arxiv/categories");
      setAvailableCategories(result.categories);
    } catch (e) {
      console.error("Failed to load categories:", e);
      toast.error("Failed to load categories");
    }
  };

  const handleSearch = async () => {
    const isAdvanced = searchMode === "advanced";
    const hasAdvancedSignal =
      isAdvanced &&
      (advancedQuery.conditions.some((c) => c.value.trim()) ||
        advancedQuery.categories.length > 0 ||
        Boolean(advancedQuery.date_range));

    if (!isAdvanced && !keywords.trim()) {
      toast.error("Please enter keywords");
      return;
    }
    if (isAdvanced && !hasAdvancedSignal) {
      toast.error("Please add at least one condition / category / date range");
      return;
    }

    setLoading(true);
    try {
      const trackingLabel = isAdvanced
        ? previewAdvancedQuery(advancedQuery)
        : [keywords.trim(), categories.length > 0 ? categories.join(", ") : ""]
            .filter(Boolean)
            .join(" · ");

      const requestBody: Record<string, unknown> = isAdvanced
        ? {
            keywords: [],
            advanced: advancedQuery,
            max_results: advancedQuery.max_results,
            days_back: null,
            sort_by: advancedQuery.sort_by,
            sort_order: advancedQuery.sort_order,
          }
        : {
            keywords: keywords.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean),
            categories: categories.length > 0 ? categories : undefined,
            mode,
            max_results: maxResults,
            days_back: daysBack,
            sort_by: sortBy,
          };

      const result = await api.post<SearchResponse>("/api/tools/arxiv/search", requestBody);
      const total = result.total_results ?? result.total ?? result.papers.length;
      setPapers(result.papers);
      setTotalResults(total);
      setSearchTimeMs(result.search_time_ms);
      setActiveTrackingLabel(trackingLabel);
      setExpandedIntroductions(new Set());
      toast.success(`Found ${total} papers`);
      // Auto-load figures
      result.papers.forEach(paper => {
        if (!paperFigures[paper.id]) {
          loadPaperFigures(paper);
        }
      });
      if (autoSaveAll && result.papers.length > 0) {
        if (!hasLiteraturePath) {
          toast.info("Search finished", "No Literature Library path configured, so nothing was auto-saved.");
        } else {
          void saveAllPapers(result.papers, trackingLabel);
        }
      }
    } catch (e) {
      console.error("Search failed:", e);
      toast.error("Search failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (category: string) => {
    setCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const toggleMainCategory = (main: string) => {
    const subcategoryCodes = availableCategories
      .filter((category) => (category.main || category.code.split(".")[0]) === main)
      .map((category) => category.code);
    if (subcategoryCodes.length === 0) return;

    setCategories((prev) => {
      const selected = new Set(prev);
      const allSelected = subcategoryCodes.every((code) => selected.has(code));
      if (allSelected) {
        subcategoryCodes.forEach((code) => selected.delete(code));
      } else {
        subcategoryCodes.forEach((code) => selected.add(code));
      }
      return Array.from(selected);
    });
  };

  const toggleMainCategoryExpanded = (main: string) => {
    setExpandedMainCategories((prev) => {
      const next = new Set(prev);
      if (next.has(main)) next.delete(main);
      else next.add(main);
      return next;
    });
  };

  const togglePaperExpand = async (paperId: string) => {
    const isExpanding = !expandedPapers.has(paperId);
    setExpandedPapers(prev => {
      const next = new Set(prev);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
    // Auto-fetch figures
    if (isExpanding) {
      const paper = papers.find(p => p.id === paperId);
      if (paper && !paperFigures[paperId] && !loadingFigures.has(paperId)) {
        await loadPaperFigures(paper);
      }
    }
  };

  const loadPaperFigures = async (paper: ArxivPaper) => {
    if (paperFigures[paper.id] || loadingFigures.has(paper.id)) return;

    setLoadingFigures(prev => new Set(prev).add(paper.id));
    try {
      const result = await api.post<{ figures: ArxivPaper["figures"] }>("/api/tools/arxiv/figures", {
        arxiv_id: paper.id,
      });
      setPaperFigures(prev => ({ ...prev, [paper.id]: result.figures }));
    } catch (e) {
      console.error("Failed to load figures:", e);
    } finally {
      setLoadingFigures(prev => {
        const next = new Set(prev);
        next.delete(paper.id);
        return next;
      });
    }
  };

  const loadPaperIntroduction = async (
    paper: ArxivPaper,
    silent = false,
  ): Promise<ArxivIntroductionPayload | null> => {
    if (paperIntroductionData[paper.id]?.introduction) {
      return paperIntroductionData[paper.id];
    }
    if (loadingIntroductions.has(paper.id)) {
      return null;
    }

    setLoadingIntroductions((prev) => new Set(prev).add(paper.id));
    setIntroAttemptedPapers((prev) => new Set(prev).add(paper.id));
    try {
      const result = await fetchArxivPaperIntroduction(paper.id, paper.summary);
      setPaperIntroductionData((prev) => ({ ...prev, [paper.id]: result }));
      return result;
    } catch (e) {
      console.error("Failed to load introduction:", e);
      if (!silent) {
        toast.error("Failed to fetch Introduction", e instanceof Error ? e.message : "Unknown error");
      }
      return null;
    } finally {
      setLoadingIntroductions((prev) => {
        const next = new Set(prev);
        next.delete(paper.id);
        return next;
      });
    }
  };

  useEffect(() => {
    if (papers.length === 0) {
      introPrefetchRunRef.current += 1;
      return undefined;
    }

    const runId = ++introPrefetchRunRef.current;
    let cancelled = false;
    const pendingPapers = papers.filter((paper) => !paperIntroductionData[paper.id]?.introduction);

    const prefetchIntroductions = async () => {
      for (const paper of pendingPapers) {
        if (cancelled || introPrefetchRunRef.current !== runId) {
          return;
        }
        await loadPaperIntroduction(paper, true);
      }
    };

    void prefetchIntroductions();

    return () => {
      cancelled = true;
    };
  }, [papers]);

  const togglePaperIntroduction = async (paper: ArxivPaper) => {
    const isExpanding = !expandedIntroductions.has(paper.id);
    setExpandedIntroductions((prev) => {
      const next = new Set(prev);
      if (next.has(paper.id)) next.delete(paper.id);
      else next.add(paper.id);
      return next;
    });

    if (!isExpanding || paperIntroductionData[paper.id]?.introduction || loadingIntroductions.has(paper.id)) {
      return;
    }

    await loadPaperIntroduction(paper);
  };

  const savePaper = async (
    paper: ArxivPaper,
    options?: {
      silent?: boolean;
      trackingLabelOverride?: string;
    },
  ) => {
    setSavingPaper(paper.id);
    try {
      // Make sure figures are loaded
      let figures = paperFigures[paper.id] || [];
      if (figures.length === 0 && !loadingFigures.has(paper.id)) {
        const result = await api.post<{ figures: ArxivPaper["figures"] }>("/api/tools/arxiv/figures", {
          arxiv_id: paper.id,
        });
        figures = result.figures || [];
        setPaperFigures(prev => ({ ...prev, [paper.id]: figures }));
      }

      const introductionData = paperIntroductionData[paper.id];

      // Call the save endpoint, saving both Markdown and PDF
      const saveResult = await api.post<{
        success: boolean;
        saved_to: string;
        files: string[];
        pdf_path?: string;
        introduction?: string;
        formatted_digest?: string;
      }>("/api/tools/arxiv/save", {
        arxiv_id: paper.id,
        title: paper.title,
        authors: paper.authors,
        summary: paper.summary,
        pdf_url: paper.pdf_url,
        arxiv_url: paper.arxiv_url,
        primary_category: paper.primary_category,
        published: paper.published,
        comment: paper.comment,
        figures: figures,
        tracking_label: options?.trackingLabelOverride || activeTrackingLabel || keywords.trim(),
        introduction: introductionData?.introduction,
        formatted_digest: introductionData?.formatted_digest,
      });

      if (saveResult.success) {
        setSavedPaperIds((prev) => new Set(prev).add(paper.id));
        if (saveResult.introduction || saveResult.formatted_digest) {
          setPaperIntroductionData((prev) => ({
            ...prev,
            [paper.id]: {
              introduction: saveResult.introduction || introductionData?.introduction || "",
              formatted_digest: saveResult.formatted_digest || introductionData?.formatted_digest || "",
            },
          }));
          setIntroAttemptedPapers((prev) => new Set(prev).add(paper.id));
        }
        if (!options?.silent) {
          toast.success(
            "Saved",
            withLocationSuffix(
              "Markdown, PDF, and paper attachments saved to the knowledge base",
              saveResult.saved_to,
              "literature",
              config,
            ),
          );
        }
      }
      return saveResult.success ? saveResult.saved_to : null;
    } catch (e) {
      console.error("Failed to save paper:", e);
      if (!options?.silent) {
        toast.error("Save failed", String(e));
      }
      return null;
    } finally {
      setSavingPaper(null);
    }
  };

  const saveAllPapers = async (papersToSave = papers, trackingLabelOverride = activeTrackingLabel || keywords.trim()) => {
    if (!hasLiteraturePath) {
      toast.error("No Literature Library path configured", "Set literature_path or vault_path in Settings first");
      return;
    }

    const pendingPapers = papersToSave.filter((paper) => !savedPaperIds.has(paper.id));
    if (pendingPapers.length === 0) {
      toast.info("All current results are already saved");
      return;
    }

    setBulkSaving(true);
    setBulkSaveProgress({ current: 0, total: pendingPapers.length });
    let successCount = 0;
    let lastSavedPath = "";

    try {
      for (const [index, paper] of pendingPapers.entries()) {
        const savedPath = await savePaper(paper, {
          silent: true,
          trackingLabelOverride,
        });
        if (savedPath) {
          successCount += 1;
          lastSavedPath = savedPath;
        }
        setBulkSaveProgress({ current: index + 1, total: pendingPapers.length });
      }
    } finally {
      setBulkSaving(false);
      setBulkSaveProgress(null);
    }

    toast.success(
      "Bulk save finished",
      withLocationSuffix(
        `Saved ${successCount}/${pendingPapers.length} papers`,
        dirnamePath(lastSavedPath),
        "literature",
        config,
      ),
    );
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const renderSearchPanel = () => (
    <Card title="Search Conditions" icon={<Filter style={{ width: "18px", height: "18px" }} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Mode switch: simple keywords ↔ advanced field-level builder */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSearchMode(m)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "1px solid var(--border-light)",
                background: searchMode === m ? "var(--color-primary)" : "transparent",
                color: searchMode === m ? "white" : "var(--text-main)",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {m === "simple" ? "Simple keywords" : "Advanced (field-scoped)"}
            </button>
          ))}
          {searchMode === "advanced" && (
            <button
              type="button"
              onClick={handleSearch}
              disabled={loading}
              style={{
                marginLeft: "auto",
                padding: "6px 14px",
                borderRadius: 8,
                border: "none",
                background: loading ? "var(--bg-hover)" : "var(--color-primary)",
                color: "white",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Searching..." : "Search"}
            </button>
          )}
        </div>

        {searchMode === "advanced" ? (
          <AdvancedQueryBuilder
            value={advancedQuery}
            onChange={setAdvancedQuery}
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
            showRuntimeKnobs
            disabled={loading}
          />
        ) : (
        <>
        {/* Keywords input */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--text-main)",
              marginBottom: "8px",
            }}
          >
            Keywords
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onKeyDown={(e) => {
                if (isActionEnterKey(e)) {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder={mode === "AND" ? "vision transformer (must contain all words)" : "vision,language | robot (AND within group, OR between groups)"}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.9375rem",
                outline: "none",
              }}
            />
            <button
              onClick={handleSearch}
              disabled={loading || !keywords.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 24px",
                borderRadius: "var(--radius-md)",
                border: "none",
                background: loading ? "var(--bg-hover)" : "var(--color-primary)",
                color: "white",
                fontSize: "0.9375rem",
                fontWeight: 600,
                cursor: loading || !keywords.trim() ? "not-allowed" : "pointer",
                opacity: loading || !keywords.trim() ? 0.6 : 1,
                transition: "all 0.2s ease",
              }}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="animate-spin">⟳</span>
                  Searching...
                </span>
              ) : (
                <>
                  <Search style={{ width: "16px", height: "16px" }} />
                  Search
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mode toggle */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--text-main)",
              marginBottom: "8px",
            }}
          >
            Match mode
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setMode("OR")}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: mode === "OR" ? "var(--color-primary)" : "var(--bg-card)",
                color: mode === "OR" ? "white" : "var(--text-main)",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              OR (match any)
            </button>
            <button
              onClick={() => setMode("AND")}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: mode === "AND" ? "var(--color-primary)" : "var(--bg-card)",
                color: mode === "AND" ? "white" : "var(--text-main)",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              AND (match all)
            </button>
          </div>
        </div>

        {/* Filters row - three aligned */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          {/* Max results */}
          <div style={{ display: "flex", flexDirection: "column", width: "100px" }}>
            <label
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "8px",
                height: "20px",
                lineHeight: "20px",
              }}
            >
              Max results
            </label>
            <input
              type="number"
              value={maxResults}
              onChange={(e) => setMaxResults(Number(e.target.value))}
              placeholder="50"
              min={1}
              max={200}
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.875rem",
                width: "100px",
                height: "42px",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Time range */}
          <div style={{ display: "flex", flexDirection: "column", width: "100px" }}>
            <label
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "8px",
                height: "20px",
                lineHeight: "20px",
              }}
            >
              Time range (days)
            </label>
            <input
              type="number"
              value={daysBack ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setDaysBack(val ? Number(val) : null);
              }}
              placeholder="365"
              min={1}
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.875rem",
                width: "100px",
                height: "42px",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Sort by */}
          <div style={{ display: "flex", flexDirection: "column", width: "140px" }}>
            <label
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "8px",
                height: "20px",
                lineHeight: "20px",
              }}
            >
              Sort by
            </label>
            <div style={{ ...fieldShellStyle, width: "140px" }}>
              <select
                className="arxiv-api-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: "100%",
                  border: "none",
                  background: "transparent",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  outline: "none",
                  boxShadow: "none",
                  paddingRight: "4px",
                }}
              >
                <option value="submittedDate">Submitted date</option>
                <option value="relevance">Relevance</option>
                <option value="lastUpdatedDate">Last updated</option>
              </select>
              <ChevronDown
                aria-hidden="true"
                style={{
                  width: "14px",
                  height: "14px",
                  color: "var(--text-muted)",
                  flexShrink: 0,
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>
        </div>

        {/* Category filter */}
        <ArxivCategorySelector
          availableCategories={availableCategories}
          selectedCategories={categories}
          expandedMainCategories={expandedMainCategories}
          onToggleCategory={toggleCategory}
          onToggleMainCategory={toggleMainCategory}
          onToggleMainCategoryExpanded={toggleMainCategoryExpanded}
        />
        </>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: hasLiteraturePath ? "pointer" : "not-allowed" }}>
            <input
              type="checkbox"
              checked={autoSaveAll}
              onChange={(e) => setAutoSaveAll(e.target.checked)}
              disabled={!hasLiteraturePath}
              style={{ width: "16px", height: "16px", cursor: hasLiteraturePath ? "pointer" : "not-allowed" }}
            />
            <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
              After searching, auto-save everything to Literature Library/arxiv/<tracking label>/<paper name>
            </span>
          </label>
          {!hasLiteraturePath && (
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              Without a Literature Library path, only search runs — no bulk save.
            </span>
          )}
        </div>
      </div>
    </Card>
  );

  const renderResults = () => {
    if (papers.length === 0) {
      return (
        <EmptyState
          icon={BookOpen}
          title="Start Searching"
          description="Enter keywords to search arXiv papers"
        />
      );
    }

    return (
      <Card
        title={`Search Results (${totalResults})`}
        icon={<BookOpen style={{ width: "18px", height: "18px" }} />}
        actions={
          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            Search took {(searchTimeMs / 1000).toFixed(2)}s
          </span>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
              padding: "14px 16px",
              borderRadius: "var(--radius-lg)",
              background: "var(--bg-hover)",
              border: "1px solid var(--border-light)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                Current results can be bulk-saved
              </span>
              <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                {bulkSaveProgress
                  ? `Saving ${bulkSaveProgress.current}/${bulkSaveProgress.total} papers; PDFs, figures, and Introductions are fetched during save.`
                  : "Save papers one by one, or save all current search results in one click."}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: hasLiteraturePath ? "pointer" : "not-allowed" }}>
                <input
                  type="checkbox"
                  checked={autoSaveAll}
                  onChange={(e) => setAutoSaveAll(e.target.checked)}
                  disabled={!hasLiteraturePath || bulkSaving}
                  style={{ width: "16px", height: "16px", cursor: hasLiteraturePath ? "pointer" : "not-allowed" }}
                />
                <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                  Auto-save all
                </span>
              </label>

              <button
                onClick={() => void saveAllPapers()}
                disabled={bulkSaving || !hasLiteraturePath || papers.every((paper) => savedPaperIds.has(paper.id))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "9px 16px",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  background: bulkSaving ? "var(--bg-hover)" : "var(--color-primary)",
                  color: "white",
                  fontSize: "0.8125rem",
                  fontWeight: 700,
                  cursor: bulkSaving || !hasLiteraturePath ? "not-allowed" : "pointer",
                  opacity: bulkSaving || !hasLiteraturePath ? 0.7 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                <Save style={{ width: "14px", height: "14px" }} />
                {bulkSaving
                  ? `Saving ${bulkSaveProgress?.current ?? 0}/${bulkSaveProgress?.total ?? papers.length}`
                  : "Save all"}
              </button>
            </div>
          </div>

          {papers.map((paper) => (
            (() => {
              const introData = paperIntroductionData[paper.id];
              const introduction = introData?.introduction || "";
              const introExpanded = expandedIntroductions.has(paper.id);
              const introLoading = loadingIntroductions.has(paper.id);
              const introAttempted = introAttemptedPapers.has(paper.id);
              const isSaved = savedPaperIds.has(paper.id);

              return (
                <div
                  key={paper.id}
                  style={{
                    padding: "20px",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  {/* Title */}
                  <h3
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      color: "var(--text-main)",
                      marginBottom: "12px",
                      lineHeight: 1.4,
                    }}
                  >
                    {paper.title}
                  </h3>

                  {/* Authors */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      marginBottom: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <Users style={{ width: "14px", height: "14px", color: "var(--text-muted)" }} />
                    <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      {paper.authors.slice(0, 5).join(", ")}
                      {paper.authors.length > 5 && ` +${paper.authors.length - 5} more`}
                    </span>
                  </div>

                  {/* Meta info */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "16px",
                      marginBottom: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "0.8125rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      <Clock style={{ width: "14px", height: "14px" }} />
                      {formatDate(paper.published)}
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: "var(--radius-full)",
                        background: "var(--color-primary)20",
                        color: "var(--color-primary)",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                      }}
                    >
                      {paper.primary_category}
                    </span>
                    {paper.comment && (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {paper.comment}
                      </span>
                    )}
                  </div>

                  {/* Abstract */}
                  <div style={{ marginBottom: "12px" }}>
                    <p
                      style={{
                        fontSize: "0.875rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.7,
                      }}
                    >
                      {expandedPapers.has(paper.id)
                        ? paper.summary
                        : paper.summary.slice(0, 300) + (paper.summary.length > 300 ? "..." : "")}
                    </p>
                    {paper.summary.length > 300 && (
                      <button
                        onClick={() => togglePaperExpand(paper.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "4px 0",
                          background: "none",
                          border: "none",
                          color: "var(--color-primary)",
                          fontSize: "0.8125rem",
                          cursor: "pointer",
                          marginTop: "8px",
                        }}
                      >
                        {expandedPapers.has(paper.id) ? (
                          <>
                            <ChevronUp style={{ width: "14px", height: "14px" }} />
                            Collapse abstract
                          </>
                        ) : (
                          <>
                            <ChevronDown style={{ width: "14px", height: "14px" }} />
                            Expand abstract
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <div style={{ marginBottom: "16px" }}>
                    <button
                      onClick={() => void togglePaperIntroduction(paper)}
                      disabled={introLoading}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 14px",
                        borderRadius: "var(--radius-full)",
                        background: introExpanded ? "rgba(188, 164, 227, 0.12)" : "transparent",
                        border: "1px solid var(--border-light)",
                        color: "var(--color-primary)",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        cursor: introLoading ? "not-allowed" : "pointer",
                        opacity: introLoading ? 0.7 : 1,
                        transition: "all 0.2s ease",
                      }}
                    >
                      {introLoading ? (
                        <>
                          <span className="animate-spin">⟳</span>
                          Fetching Intro
                        </>
                      ) : introExpanded ? (
                        <>
                          <ChevronUp style={{ width: "14px", height: "14px" }} />
                          Collapse Introduction
                        </>
                      ) : (
                        <>
                          <ChevronDown style={{ width: "14px", height: "14px" }} />
                          Expand Introduction
                        </>
                      )}
                    </button>

                    {introExpanded && (
                      <div
                        style={{
                          marginTop: "12px",
                          padding: "14px 16px",
                          borderRadius: "var(--radius-lg)",
                          background: "color-mix(in srgb, var(--bg-card) 82%, transparent)",
                          border: "1px solid var(--border-light)",
                        }}
                      >
                        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: "8px", letterSpacing: "0.04em" }}>
                          INTRODUCTION
                        </div>
                        <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                          {introLoading
                            ? "Fetching the paper's Introduction..."
                            : introduction
                              ? introduction
                              : introAttempted
                                ? "No usable Introduction extracted for this paper yet."
                                : "Click the button above to fetch the Introduction."}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Categories */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px",
                      marginBottom: "16px",
                    }}
                  >
                    {paper.categories.map((cat) => (
                      <span
                        key={cat}
                        style={{
                          padding: "3px 8px",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg-card)",
                          border: "1px solid var(--border-light)",
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {cat}
                      </span>
                    ))}
                  </div>

                  {/* Figures Preview - single-row horizontal scroll, large images */}
                  {(paperFigures[paper.id]?.length ?? 0) > 0 && (
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{
                        display: "flex",
                        gap: "16px",
                        overflowX: "auto",
                        paddingBottom: "12px",
                        scrollbarWidth: "thin",
                      }}>
                        {paperFigures[paper.id]?.map((fig, idx) => (
                          <div key={idx} style={{
                            flexShrink: 0,
                            width: "480px",
                            borderRadius: "var(--radius-md)",
                            overflow: "hidden",
                            border: "1px solid var(--border-light)",
                            background: "var(--bg-card)",
                          }}>
                            <img
                              src={fig.url || fig.local_path || ""}
                              alt={fig.caption}
                              style={{
                                width: "100%",
                                height: "280px",
                                objectFit: "contain",
                                background: "var(--bg-hover)",
                                cursor: fig.url ? "pointer" : "default",
                              }}
                              onClick={() => {
                                if (fig.url) {
                                  window.open(fig.url, "_blank");
                                }
                              }}
                              loading="lazy"
                            />
                            <div style={{
                              padding: "10px 12px",
                              fontSize: "0.8125rem",
                              color: "var(--text-muted)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              background: "var(--bg-card)",
                            }}>
                              {fig.caption}
                              {fig.is_method && (
                                <span style={{
                                  marginLeft: "8px",
                                  padding: "3px 8px",
                                  borderRadius: "4px",
                                  background: "var(--color-primary)",
                                  color: "white",
                                  fontSize: "0.6875rem",
                                  fontWeight: 600,
                                }}>
                                  Architecture diagram
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <a
                      href={paper.pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 16px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--color-primary)",
                        color: "white",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        textDecoration: "none",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <Download style={{ width: "14px", height: "14px" }} />
                      PDF
                    </a>
                    <a
                      href={paper.arxiv_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 16px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-card)",
                        color: "var(--text-main)",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        textDecoration: "none",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <ExternalLink style={{ width: "14px", height: "14px" }} />
                      arXiv
                    </a>
                    <button
                      onClick={() => loadPaperFigures(paper)}
                      disabled={loadingFigures.has(paper.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 16px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: (paperFigures[paper.id]?.length ?? 0) > 0 ? "var(--bg-hover)" : "var(--bg-card)",
                        color: (paperFigures[paper.id]?.length ?? 0) > 0 ? "var(--text-muted)" : "var(--text-main)",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        cursor: loadingFigures.has(paper.id) ? "not-allowed" : "pointer",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {loadingFigures.has(paper.id) ? (
                        <>
                          <span className="animate-spin">⟳</span>
                          Loading figures...
                        </>
                      ) : (
                        <>
                          <ImageIcon style={{ width: "14px", height: "14px" }} />
                          {(paperFigures[paper.id]?.length ?? 0) > 0 ? `Loaded ${paperFigures[paper.id]?.length} figures` : "Fetch figures"}
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => void savePaper(paper)}
                      disabled={isSaved || savingPaper === paper.id || bulkSaving || !hasLiteraturePath}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 16px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: isSaved ? "rgba(16, 185, 129, 0.12)" : "var(--bg-card)",
                        color: isSaved ? "#10B981" : "var(--color-primary)",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        cursor: isSaved || savingPaper === paper.id || bulkSaving || !hasLiteraturePath ? "not-allowed" : "pointer",
                        opacity: !hasLiteraturePath ? 0.7 : 1,
                        transition: "all 0.2s ease",
                      }}
                    >
                      {isSaved ? (
                        <>
                          <Check style={{ width: "14px", height: "14px" }} />
                          Saved
                        </>
                      ) : savingPaper === paper.id ? (
                        <>
                          <span className="animate-spin">⟳</span>
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save style={{ width: "14px", height: "14px" }} />
                          Save to Literature Library
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })()
          ))}
        </div>
      </Card>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title="arXiv Paper Search"
        subtitle="Search and browse arXiv academic papers"
        icon={FileText}
      />
      <PageContent maxWidth="1200px">
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {renderSearchPanel()}
          {renderResults()}
        </div>
      </PageContent>
    </PageContainer>
  );
}
