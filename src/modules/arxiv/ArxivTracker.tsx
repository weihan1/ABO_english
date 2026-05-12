import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import {
  BookOpen,
  RefreshCw,
  Search,
  FileText,
  GitBranch,
  Square,
} from "lucide-react";
import { PageContainer, PageHeader, PageContent, Card, EmptyState } from "../../components/Layout";
import { api } from "../../core/api";
import { FEED_WS_MESSAGE_EVENT, type FeedRealtimePayload } from "../../core/feedRealtime";
import { isActionEnterKey } from "../../core/keyboard";
import { withLocationSuffix } from "../../core/pathDisplay";
import { useToast } from "../../components/Toast";
import { useStore } from "../../core/store";
import PaperMonitorPanel from "./PaperMonitorPanel";
import SharedPaperTrackingCard from "./PaperTrackingCard";
import { ArxivCategorySelector, type ArxivCategory } from "./ArxivCategorySelector";
import {
  AdvancedQueryBuilder,
  createEmptyAdvancedQuery,
  type ArxivAdvancedQuery,
} from "./AdvancedQueryBuilder";

type PaperFigureAsset = {
  url?: string;
  caption: string;
  is_method?: boolean;
  local_path?: string;
  original_url?: string;
  filename?: string;
};

interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  score: number;
  tags: string[];
  source_url: string;
  metadata: TrackedPaperMetadata;
}

interface TrackedPaperMetadata extends Record<string, unknown> {
  authors?: string[];
  published?: string;
  updated?: string;
  year?: number;
  venue?: string;
  citation_count?: number;
  reference_count?: number;
  contribution?: string;
  abstract?: string;
  introduction?: string;
  "formatted-digest"?: string;
  keywords?: string[];
  figures?: PaperFigureAsset[];
  figures_dir?: string;
  local_figures?: PaperFigureAsset[];
  paper_id?: string;
  s2_url?: string;
  arxiv_id?: string;
  "arxiv-id"?: string;
  arxiv_url?: string;
  "pdf-url"?: string;
  pdf_url?: string;
  "html-url"?: string;
  html_url?: string;
  relationship?: string;
  relationship_label?: string;
  source_arxiv_id?: string;
  source_paper_title?: string;
  source_paper?: Record<string, unknown>;
  paper_tracking_type?: string;
  paper_tracking_role?: string;
  paper_tracking_label?: string;
  paper_tracking_labels?: string[];
  paper_tracking_matches?: Array<Record<string, unknown>>;
  saved_to_literature?: boolean;
  literature_path?: string;
  source_paper_path?: string;
  primary_category?: string;
  primary_category_name?: string;
  categories?: string[];
  all_categories?: string[];
  comments?: string;
  journal_ref?: string;
  doi?: string;
  fields_of_study?: string[];
}

interface TrackedPaper {
  id: string;
  title: string;
  summary: string;
  score: number;
  tags: string[];
  source_url: string;
  metadata: TrackedPaperMetadata;
}

type SemanticScholarPaper = TrackedPaper;

interface CrawlProgress {
  current: number;
  total: number;
  phase: "fetching" | "processing" | "complete";
  message?: string;
  currentPaperTitle?: string;
}

interface CategoriesResponse {
  categories: ArxivCategory[];
}

function getSemanticScholarTimestamp(paper: SemanticScholarPaper): number {
  const published = paper.metadata?.published;
  if (published) {
    const timestamp = new Date(published).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }

  const year = paper.metadata?.year;
  if (typeof year === "number" && year > 0) {
    return new Date(year, 0, 1).getTime();
  }

  return 0;
}

function extractArxivIdFromValue(value: string): string {
  const match = String(value || "").match(/([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match?.[1] || "";
}

function getTrackedPaperArxivId(paper: TrackedPaper): string {
  const meta = paper.metadata || {};
  return (
    meta.arxiv_id
    || meta["arxiv-id"]
    || extractArxivIdFromValue(paper.id)
    || extractArxivIdFromValue(paper.source_url)
  );
}

function getTrackedPaperDisplayId(paper: TrackedPaper): string {
  const meta = paper.metadata || {};
  return (
    getTrackedPaperArxivId(paper)
    || meta.paper_id
    || paper.id.replace(/^followup-monitor:/, "").replace(/^source-paper:/, "").replace(/^arxiv-monitor:/, "")
  );
}

function isTrackedPaperSaved(paper: TrackedPaper, savedPaperIds: Set<string>): boolean {
  return Boolean(
    savedPaperIds.has(paper.id)
    || paper.metadata?.saved_to_literature
    || paper.metadata?.literature_path,
  );
}

function getTrackedPaperBoundaryIndex(papers: TrackedPaper[], savedPaperIds: Set<string>): number {
  return papers.findIndex((paper) => (
    paper.metadata?.paper_tracking_role !== "source"
    && isTrackedPaperSaved(paper, savedPaperIds)
  ));
}

function parseOptionalPositiveInteger(input: string, maxValue: number): number | null {
  const text = input.trim();
  if (!text) return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;

  return Math.min(maxValue, Math.max(1, Math.floor(parsed)));
}

export default function ArxivTracker() {
  const {
    config,
    arxivAndPapers,
    arxivAndCrawling,
    arxivAndProgress,
    arxivAndKeywords,
    arxivTrackerActiveTab,
    semanticScholarPapers: storedSemanticScholarPapers,
    semanticScholarCrawling,
    semanticScholarProgress,
    semanticScholarQuery,
    semanticScholarMaxResultsInput,
    semanticScholarDaysBackInput,
    semanticScholarSortBy,
    semanticScholarFetchFigures,
    setArxivAndPapers,
    setArxivAndCrawling,
    setArxivAndProgress,
    setArxivAndKeywords,
    setArxivTrackerActiveTab,
    setSemanticScholarPapers,
    setSemanticScholarCrawling,
    setSemanticScholarProgress,
    setSemanticScholarQuery,
    setSemanticScholarMaxResultsInput,
    setSemanticScholarDaysBackInput,
    setSemanticScholarSortBy,
    setSemanticScholarFetchFigures,
  } = useStore();
  const s2Papers = storedSemanticScholarPapers as SemanticScholarPaper[];

  // 通用状态
  const [savedPapers, setSavedPapers] = useState<Set<string>>(new Set());
  const [_savedS2Papers, _setSavedS2Papers] = useState<Set<string>>(new Set());
  const [savingPaperIds, setSavingPaperIds] = useState<Set<string>>(new Set());
  const [savingS2PaperIds, setSavingS2PaperIds] = useState<Set<string>>(new Set());
  const [autoSave, setAutoSave] = useState(false);
  const [searchInputMode, setSearchInputMode] = useState<"simple" | "advanced">("simple");
  const [advancedQuery, setAdvancedQuery] = useState<ArxivAdvancedQuery>(() => createEmptyAdvancedQuery());
  const [searchMaxResultsInput, setSearchMaxResultsInput] = useState("50");
  const [searchDaysBackInput, setSearchDaysBackInput] = useState("180");
  const [searchCategories, setSearchCategories] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<ArxivCategory[]>([]);
  const [expandedMainCategories, setExpandedMainCategories] = useState<Set<string>>(() => new Set());

  const toast = useToast();
  const saveSinglePaperRef = useRef<((paper: ArxivPaper) => Promise<void>) | null>(null);
  const saveSingleS2PaperRef = useRef<((paper: SemanticScholarPaper) => Promise<void>) | null>(null);
  const savedPapersRef = useRef<Set<string>>(new Set());
  const savedS2PapersRef = useRef<Set<string>>(new Set());
  const savingPaperIdsRef = useRef<Set<string>>(new Set());
  const savingS2PaperIdsRef = useRef<Set<string>>(new Set());

  // WebSocket 连接 - 使用 ref 来避免依赖问题，确保事件处理始终可用
  const autoSaveRef = useRef(autoSave);

  useEffect(() => {
    autoSaveRef.current = autoSave;
  }, [autoSave]);

  useEffect(() => {
    let isActive = true;

    const loadCategories = async () => {
      try {
        const result = await api.get<CategoriesResponse>("/api/modules/arxiv-tracker/categories");
        if (isActive) {
          setAvailableCategories(result.categories);
        }
      } catch (err) {
        console.error("Failed to load tracker arXiv categories:", err);
        if (isActive) {
          toast.error("加载 arXiv 分类失败");
        }
      }
    };

    void loadCategories();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    savedPapersRef.current = savedPapers;
  }, [savedPapers]);

  useEffect(() => {
    savedS2PapersRef.current = _savedS2Papers;
  }, [_savedS2Papers]);

  useEffect(() => {
    savingPaperIdsRef.current = savingPaperIds;
  }, [savingPaperIds]);

  useEffect(() => {
    savingS2PaperIdsRef.current = savingS2PaperIds;
  }, [savingS2PaperIds]);

  // Track which mode is currently crawling using a crawling ID
  const crawlingIdRef = useRef<string | null>(null);

  // crawlingMode state and ref - must be declared BEFORE WebSocket effect
  const [crawlingMode, setCrawlingMode] = useState<string | null>(null);
  const crawlingModeRef = useRef<string | null>(null);

  useEffect(() => {
    crawlingModeRef.current = crawlingMode;
  }, [crawlingMode]);

  // Session ID for cancellation
  const [crawlSessionId, setCrawlSessionId] = useState<string | null>(null);
  const crawlSessionIdRef = useRef<string | null>(null);
  const s2SessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    crawlSessionIdRef.current = crawlSessionId;
  }, [crawlSessionId]);

  useEffect(() => {
    const handleRealtimeEvent = (event: Event) => {
      const customEvent = event as CustomEvent<FeedRealtimePayload>;
      const data = customEvent.detail;
      try {
        const store = useStore.getState();
        const shouldAutoSave = autoSaveRef.current;
        const hasLiteraturePath = !!(store.config?.literature_path || store.config?.vault_path);
        const isSemanticScholarEvent = data.module === "semantic-scholar-tracker";

        if (data.type === "crawl_started" && !isSemanticScholarEvent) {
          if (data.session_id) {
            setCrawlSessionId(String(data.session_id));
            crawlSessionIdRef.current = String(data.session_id);
          }
        } else if (data.type === "crawl_cancelling" && !isSemanticScholarEvent) {
          const currentProgress = store.arxivAndProgress;
          setArxivAndProgress({
            current: currentProgress?.current ?? 0,
            total: currentProgress?.total ?? 0,
            phase: currentProgress?.phase ?? "fetching",
            message: String(data.message || "正在取消爬取任务..."),
            currentPaperTitle: currentProgress?.currentPaperTitle,
          });
        } else if (data.type === "crawl_cancelled" && !isSemanticScholarEvent) {
          toast.info("已取消", String(data.message || "爬取任务已取消"));
          setArxivAndCrawling(false);
          setArxivAndProgress(null);
          crawlingIdRef.current = null;
          setCrawlingMode(null);
          setCrawlSessionId(null);
          crawlSessionIdRef.current = null;
        } else if (data.type === "crawl_progress" && !isSemanticScholarEvent) {
          const progress: CrawlProgress = {
            current: Number(data.current || 0),
            total: Number(data.total ?? 0),
            phase: (data.phase as CrawlProgress["phase"]) || "fetching",
            message: typeof data.message === "string" ? data.message : undefined,
            currentPaperTitle: typeof data.currentPaperTitle === "string" ? data.currentPaperTitle : undefined,
          };
          setArxivAndProgress(progress);
        } else if (data.type === "crawl_paper" && !isSemanticScholarEvent) {
          const paper = data.paper as ArxivPaper | undefined;
          if (!paper) return;
          const exists = store.arxivAndPapers.find((entry) => entry.id === paper.id);
          if (!exists) {
            store.appendArxivAndPaper(paper);
            if (paper.metadata?.saved_to_literature) {
              setSavedPapers((prev) => new Set(prev).add(paper.id));
            }
            if (
              shouldAutoSave &&
              hasLiteraturePath &&
              saveSinglePaperRef.current &&
              !savedPapersRef.current.has(paper.id)
            ) {
              void saveSinglePaperRef.current(paper);
            }
          }
        } else if (data.type === "crawl_complete" && !isSemanticScholarEvent) {
          toast.success("爬取完成", `共找到 ${Number(data.count || 0)} 篇论文`);
          setArxivAndCrawling(false);
          setArxivAndProgress(null);
          crawlingIdRef.current = null;
          setCrawlingMode(null);
        } else if (data.type === "crawl_error" && !isSemanticScholarEvent) {
          toast.error("爬取失败", String(data.error || "未知错误"));
          setArxivAndCrawling(false);
          setArxivAndProgress(null);
          crawlingIdRef.current = null;
          setCrawlingMode(null);
        } else if (data.type === "s2_progress") {
          setSemanticScholarProgress({
            current: Number(data.current || 0),
            total: Number(data.total || 20),
            phase: (data.phase as CrawlProgress["phase"]) || "fetching",
            message: typeof data.message === "string" ? data.message : undefined,
            currentPaperTitle: typeof data.currentPaperTitle === "string" ? data.currentPaperTitle : undefined,
          });
        } else if (data.type === "s2_paper") {
          const paper = data.paper as SemanticScholarPaper | undefined;
          if (!paper) return;
          if (!store.semanticScholarPapers.find((entry) => entry.id === paper.id)) {
            store.appendSemanticScholarPaper(paper);
            if (paper.metadata?.saved_to_literature) {
              _setSavedS2Papers((prev) => new Set(prev).add(paper.id));
            }
          }
        } else if (data.type === "s2_complete") {
          setSemanticScholarCrawling(false);
          setSemanticScholarProgress(null);
          toast.success("Semantic Scholar 爬取完成", `共获取 ${Number(data.count || 0)} 篇相关论文`);
        } else if (data.type === "s2_error") {
          setSemanticScholarCrawling(false);
          setSemanticScholarProgress(null);
          toast.error("Semantic Scholar 爬取失败", String(data.error || "未知错误"));
        }

        if (isSemanticScholarEvent) {
          if (data.type === "crawl_started") {
            setSemanticScholarCrawling(true);
            if (data.session_id) {
              s2SessionIdRef.current = String(data.session_id);
            }
          } else if (data.type === "crawl_paper") {
            const paper = data.paper as SemanticScholarPaper | undefined;
            if (!paper) return;
            if (!store.semanticScholarPapers.find((entry) => entry.id === paper.id)) {
              store.appendSemanticScholarPaper(paper);
              if (paper.metadata?.saved_to_literature) {
                _setSavedS2Papers((prev) => new Set(prev).add(paper.id));
              }
              // Defer auto-save until enrichment finishes (figures/intro/agent merged in).
              const enrichmentPending = Boolean(paper.metadata?.enrichment_pending);
              if (
                !enrichmentPending &&
                shouldAutoSave &&
                hasLiteraturePath &&
                saveSingleS2PaperRef.current &&
                !paper.metadata?.saved_to_literature &&
                !savedS2PapersRef.current.has(paper.id)
              ) {
                void saveSingleS2PaperRef.current(paper);
              }
            }
          } else if (data.type === "crawl_paper_update") {
            const paper = data.paper as SemanticScholarPaper | undefined;
            if (!paper) return;
            store.updateSemanticScholarPaper(paper);
            if (paper.metadata?.saved_to_literature) {
              _setSavedS2Papers((prev) => new Set(prev).add(paper.id));
            }
            // Enriched card is final — auto-save now if eligible.
            if (
              shouldAutoSave &&
              hasLiteraturePath &&
              saveSingleS2PaperRef.current &&
              !paper.metadata?.saved_to_literature &&
              !savedS2PapersRef.current.has(paper.id)
            ) {
              void saveSingleS2PaperRef.current(paper);
            }
          } else if (data.type === "crawl_complete") {
            setSemanticScholarCrawling(false);
            setSemanticScholarProgress(null);
            s2SessionIdRef.current = null;
            toast.success("后续论文爬取完成", `共获取 ${Number(data.count || 0)} 篇论文`);
          } else if (data.type === "crawl_error") {
            setSemanticScholarCrawling(false);
            setSemanticScholarProgress(null);
            s2SessionIdRef.current = null;
            toast.error("后续论文爬取失败", String(data.error || "未知错误"));
          } else if (data.type === "crawl_cancelled") {
            setSemanticScholarCrawling(false);
            setSemanticScholarProgress(null);
            s2SessionIdRef.current = null;
            toast.info("已取消爬取");
          } else if (data.type === "crawl_cancelling") {
            const currentProgress = store.semanticScholarProgress;
            setSemanticScholarProgress({
              current: currentProgress?.current || 0,
              total: currentProgress?.total || 0,
              phase: currentProgress?.phase || "fetching",
              message: String(data.message || "正在取消爬取任务..."),
            });
          } else if (data.type === "crawl_progress") {
            setSemanticScholarProgress({
              current: Number(data.current || 0),
              total: Number(data.total || 0),
              phase: (data.phase as CrawlProgress["phase"]) || "fetching",
              message: typeof data.message === "string" ? data.message : undefined,
            });
          }
        }
      } catch (err) {
        console.error("[arXiv] Error handling realtime event:", err);
      }
    };

    window.addEventListener(FEED_WS_MESSAGE_EVENT, handleRealtimeEvent as EventListener);
    return () => {
      window.removeEventListener(FEED_WS_MESSAGE_EVENT, handleRealtimeEvent as EventListener);
    };
  }, [])

  async function saveSinglePaper(paper: ArxivPaper) {
    if (
      savingPaperIdsRef.current.has(paper.id)
      || savedPapersRef.current.has(paper.id)
      || paper.metadata?.saved_to_literature
    ) {
      return;
    }

    const nextSavingPaperIds = new Set(savingPaperIdsRef.current);
    nextSavingPaperIds.add(paper.id);
    savingPaperIdsRef.current = nextSavingPaperIds;
    setSavingPaperIds(nextSavingPaperIds);
    try {
      const result = await api.post<{
        ok: boolean;
        path: string;
        figures?: Array<{ filename: string; caption: string; local_path: string; original_url: string }>;
        pdf?: string;
        introduction?: string;
        formatted_digest?: string;
      }>("/api/modules/arxiv-tracker/save-to-literature", {
        paper,
        folder: "arxiv",
      });
      setSavedPapers(prev => new Set(prev).add(paper.id));

      // Update paper with fetched assets/text for immediate display
      if ((result.figures && result.figures.length > 0) || result.introduction || result.formatted_digest) {
        const updatedPaper = {
          ...paper,
          metadata: {
            ...paper.metadata,
            local_figures: result.figures?.length ? result.figures : paper.metadata.local_figures,
            introduction: result.introduction || paper.metadata.introduction,
            "formatted-digest": result.formatted_digest || paper.metadata["formatted-digest"],
          },
        };
        const store = useStore.getState();
        const newPapers = store.arxivAndPapers.map(p => p.id === paper.id ? updatedPaper : p);
        setArxivAndPapers(newPapers);
      }
    } catch (e) {
      console.error(`Failed to save paper ${paper.id}:`, e);
    } finally {
      const nextSavingPaperIdsAfterSave = new Set(savingPaperIdsRef.current);
      nextSavingPaperIdsAfterSave.delete(paper.id);
      savingPaperIdsRef.current = nextSavingPaperIdsAfterSave;
      setSavingPaperIds(nextSavingPaperIdsAfterSave);
    }
  }

  // Update ref whenever saveSinglePaper changes
  useEffect(() => {
    saveSinglePaperRef.current = saveSinglePaper;
  }, []);

  async function saveSingleS2Paper(paper: SemanticScholarPaper) {
    if (
      savingS2PaperIdsRef.current.has(paper.id)
      || savedS2PapersRef.current.has(paper.id)
      || paper.metadata?.saved_to_literature
    ) {
      return;
    }

    const nextSavingS2PaperIds = new Set(savingS2PaperIdsRef.current);
    nextSavingS2PaperIds.add(paper.id);
    savingS2PaperIdsRef.current = nextSavingS2PaperIds;
    setSavingS2PaperIds(nextSavingS2PaperIds);
    try {
      const result = await api.post<{
        ok: boolean;
        path: string;
        figures: Array<{ filename: string; caption: string; local_path: string }>;
        pdf: string | null;
        folder: string;
        introduction?: string;
        formatted_digest?: string;
      }>("/api/modules/semantic-scholar/save-to-literature", {
        paper,
        save_pdf: true,
        max_figures: 5,
        fetch_figures: useStore.getState().semanticScholarFetchFigures,
      });

      _setSavedS2Papers((prev) => new Set(prev).add(paper.id));

      if ((result.figures && result.figures.length > 0) || result.introduction || result.formatted_digest) {
        const updatedPaper = {
          ...paper,
          metadata: {
            ...paper.metadata,
            local_figures: result.figures?.length ? result.figures : paper.metadata.local_figures,
            introduction: result.introduction || paper.metadata.introduction,
            "formatted-digest": result.formatted_digest || paper.metadata["formatted-digest"],
          },
        };
        const store = useStore.getState();
        setSemanticScholarPapers(store.semanticScholarPapers.map((entry) => (entry.id === paper.id ? updatedPaper : entry)));
      }
    } catch (err) {
      console.error(`Failed to auto-save follow-up paper ${paper.id}:`, err);
    } finally {
      const nextSavingS2PaperIdsAfterSave = new Set(savingS2PaperIdsRef.current);
      nextSavingS2PaperIdsAfterSave.delete(paper.id);
      savingS2PaperIdsRef.current = nextSavingS2PaperIdsAfterSave;
      setSavingS2PaperIds(nextSavingS2PaperIdsAfterSave);
    }
  }

  useEffect(() => {
    saveSingleS2PaperRef.current = saveSingleS2Paper;
  }, []);

  async function runCrawl() {
    const useAdvanced = searchInputMode === "advanced";
    const advancedReady =
      useAdvanced &&
      (advancedQuery.conditions.some((c) => c.value.trim()) ||
        advancedQuery.categories.length > 0 ||
        Boolean(advancedQuery.date_range));

    const keywords = arxivAndKeywords;
    const mode: "AND" | "AND_OR" = keywords.includes("|") ? "AND_OR" : "AND";

    const keywordList = mode === "AND_OR"
      ? [keywords.trim()]
      : keywords.split(",").map((k) => k.trim()).filter(Boolean);

    if (!useAdvanced && (keywordList.length === 0 || (mode === "AND_OR" && !keywords.trim()))) {
      toast.error("请输入关键词", "至少输入一个关键词进行搜索");
      return;
    }
    if (useAdvanced && !advancedReady) {
      toast.error("高级模式至少需要一个条件 / 分类 / 日期范围");
      return;
    }

    const selectedCategories = searchCategories;

    const crawlTag = useAdvanced ? "ADVANCED" : mode;
    crawlingIdRef.current = crawlTag;
    setCrawlingMode(crawlTag);

    setArxivAndCrawling(true);
    setArxivAndPapers([]);
    setArxivAndProgress({
      current: 0,
      total: resolvedSearchMaxResults ?? 0,
      phase: "fetching",
      message: resolvedSearchMaxResults
        ? `正在获取论文列表（最多 ${resolvedSearchMaxResults} 篇）...`
        : "正在获取论文列表（不限篇数）...",
    });

    try {
      console.log("[arXiv] Starting crawl API call with mode:", crawlTag);
      const body: Record<string, unknown> = useAdvanced
        ? {
            keywords: [],
            advanced: advancedQuery,
            max_results: resolvedSearchMaxResults,
            cs_only: false,
            days_back: resolvedSearchDaysBack,
            categories: selectedCategories,
          }
        : {
            keywords: keywordList,
            max_results: resolvedSearchMaxResults,
            mode: mode,
            cs_only: false,
            days_back: resolvedSearchDaysBack,
            categories: selectedCategories,
          };
      await api.post("/api/modules/arxiv-tracker/crawl", body);
      console.log("[arXiv] Crawl API call completed");
    } catch (err) {
      console.error("[arXiv] Crawl API error:", err);
      toast.error("爬取失败", err instanceof Error ? err.message : "请稍后重试");
      crawlingIdRef.current = null;
      setCrawlingMode(null);
      setCrawlSessionId(null);
      crawlSessionIdRef.current = null;
      setArxivAndCrawling(false);
    }
  }

  async function stopCrawl() {
    const sessionId = crawlSessionIdRef.current;
    if (!sessionId) {
      toast.error("没有正在进行的爬取任务");
      return;
    }

    try {
      console.log("[arXiv] Cancelling crawl:", sessionId);
      const result = await api.post<{ status: string; message?: string }>("/api/modules/arxiv-tracker/cancel", {
        session_id: sessionId,
      });
      if (result.status !== "ok") {
        toast.error("停止失败", result.message || "未找到正在进行的爬取任务");
        return;
      }
      toast.info("正在取消", result.message || "已发送取消信号");
    } catch (err) {
      console.error("[arXiv] Cancel error:", err);
      toast.error("取消失败", err instanceof Error ? err.message : "请稍后重试");
    }
  }

  async function saveToLiterature(paper: ArxivPaper) {
    if (
      savingPaperIdsRef.current.has(paper.id)
      || savedPapersRef.current.has(paper.id)
      || paper.metadata?.saved_to_literature
    ) {
      return;
    }

    const nextSavingPaperIds = new Set(savingPaperIdsRef.current);
    nextSavingPaperIds.add(paper.id);
    savingPaperIdsRef.current = nextSavingPaperIds;
    setSavingPaperIds(nextSavingPaperIds);
    try {
      const result = await api.post<{
        ok: boolean;
        path: string;
        figures?: Array<{ filename: string; caption: string; local_path: string; original_url: string }>;
        introduction?: string;
        formatted_digest?: string;
      }>("/api/modules/arxiv-tracker/save-to-literature", {
        paper,
        folder: "arxiv",
      });
      setSavedPapers(prev => new Set(prev).add(paper.id));

      // Update paper with fetched assets/text
      if ((result.figures && result.figures.length > 0) || result.introduction || result.formatted_digest) {
        const updatedPaper = {
          ...paper,
          metadata: {
            ...paper.metadata,
            local_figures: result.figures?.length ? result.figures : paper.metadata.local_figures,
            introduction: result.introduction || paper.metadata.introduction,
            "formatted-digest": result.formatted_digest || paper.metadata["formatted-digest"],
          },
        };
        const store = useStore.getState();
        const newPapers = store.arxivAndPapers.map(p => p.id === paper.id ? updatedPaper : p);
        setArxivAndPapers(newPapers);
      }

      toast.success(
        "保存成功",
        withLocationSuffix(
          `论文已保存${result.figures ? ` (${result.figures.length} 张图片)` : ""}`,
          result.path,
          "literature",
          config,
        ),
      );
    } catch (err) {
      toast.error("保存失败", err instanceof Error ? err.message : "请检查文献库路径");
    } finally {
      const nextSavingPaperIdsAfterSave = new Set(savingPaperIdsRef.current);
      nextSavingPaperIdsAfterSave.delete(paper.id);
      savingPaperIdsRef.current = nextSavingPaperIdsAfterSave;
      setSavingPaperIds(nextSavingPaperIdsAfterSave);
    }
  }

  const displayedS2Papers = useMemo(() => {
    const papers = [...s2Papers];
    papers.sort((a, b) => {
      const aIsSource = a.metadata?.paper_tracking_role === "source";
      const bIsSource = b.metadata?.paper_tracking_role === "source";
      if (aIsSource !== bIsSource) {
        return aIsSource ? -1 : 1;
      }

      if (semanticScholarSortBy === "citation_count") {
        const citationDiff = (b.metadata?.citation_count || 0) - (a.metadata?.citation_count || 0);
        if (citationDiff !== 0) return citationDiff;
      }

      const timeDiff = getSemanticScholarTimestamp(b) - getSemanticScholarTimestamp(a);
      if (timeDiff !== 0) return timeDiff;

      if (semanticScholarSortBy === "recency") {
        return (b.metadata?.citation_count || 0) - (a.metadata?.citation_count || 0);
      }

      return a.title.localeCompare(b.title);
    });
    return papers;
  }, [s2Papers, semanticScholarSortBy]);
  const arxivBoundaryIndex = useMemo(
    () => getTrackedPaperBoundaryIndex(arxivAndPapers, savedPapers),
    [arxivAndPapers, savedPapers],
  );
  const followupBoundaryIndex = useMemo(
    () => getTrackedPaperBoundaryIndex(displayedS2Papers, _savedS2Papers),
    [displayedS2Papers, _savedS2Papers],
  );

  const isMonitorTab = arxivTrackerActiveTab === "monitors";
  const currentPapers = arxivTrackerActiveTab === "search"
    ? arxivAndPapers
    : arxivTrackerActiveTab === "followups"
      ? displayedS2Papers
      : [];
  const isCrawling = arxivTrackerActiveTab === "search"
    ? arxivAndCrawling
    : arxivTrackerActiveTab === "followups"
      ? semanticScholarCrawling
      : false;
  const currentProgress = arxivTrackerActiveTab === "search"
    ? arxivAndProgress
    : arxivTrackerActiveTab === "followups"
      ? semanticScholarProgress
      : null;
  const resolvedSearchMaxResults = parseOptionalPositiveInteger(searchMaxResultsInput, 200);
  const resolvedSearchDaysBack = parseOptionalPositiveInteger(searchDaysBackInput, 3650);

  const toggleSearchCategory = (category: string) => {
    setSearchCategories((prev) => (
      prev.includes(category)
        ? prev.filter((entry) => entry !== category)
        : [...prev, category]
    ));
  };

  const toggleSearchMainCategory = (main: string) => {
    const subcategoryCodes = availableCategories
      .filter((category) => (category.main || category.code.split(".")[0]) === main)
      .map((category) => category.code);
    if (subcategoryCodes.length === 0) return;

    setSearchCategories((prev) => {
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

  const toggleSearchMainCategoryExpanded = (main: string) => {
    setExpandedMainCategories((prev) => {
      const next = new Set(prev);
      if (next.has(main)) next.delete(main);
      else next.add(main);
      return next;
    });
  };

  function clearCurrentResults() {
    if (isCrawling) return;
    if (isMonitorTab) return;
    if (arxivTrackerActiveTab === "search") {
      setArxivAndPapers([]);
      setArxivAndProgress(null);
      return;
    }
    setSemanticScholarPapers([]);
    setSemanticScholarProgress(null);
  }

  // Fetch follow-up papers from Semantic Scholar
  async function fetchS2FollowUps() {
    if (!semanticScholarQuery.trim()) {
      toast.error("请输入论文标题", "例如：VGGT");
      return;
    }

    const parsedMaxResults = Number(semanticScholarMaxResultsInput.trim());
    const resolvedMaxResults = Number.isFinite(parsedMaxResults) && parsedMaxResults > 0
      ? Math.min(5000, Math.max(1, Math.floor(parsedMaxResults)))
      : null;
    const parsedDaysBack = Number(semanticScholarDaysBackInput.trim());
    const resolvedDaysBack = Number.isFinite(parsedDaysBack) && parsedDaysBack > 0
      ? Math.min(3650, Math.max(1, Math.floor(parsedDaysBack)))
      : null;

    setSemanticScholarCrawling(true);
    setSemanticScholarPapers([]);
    setSemanticScholarProgress({
      current: 0,
      total: resolvedMaxResults ?? 0,
      phase: "fetching",
      message: resolvedMaxResults
        ? `正在查询 Semantic Scholar（最多 ${resolvedMaxResults} 篇）...`
        : "正在查询 Semantic Scholar（全量）...",
    });

    // Generate session ID for cancellation
    const sessionId = Math.random().toString(36).substring(2, 10);
    s2SessionIdRef.current = sessionId;

    // 后端是长阻塞请求，进度/完成/错误都走 WebSocket。
    // 如果 webview 在长时间爬取后断开了这个 fetch 连接（TypeError 等传输层错误），
    // 后端其实仍在运行，WS 会照常推送 crawl_paper/crawl_complete。
    // 所以传输层失败不要清掉爬取状态——让 WS 作为唯一真相源。
    // 只有服务端真的返回了错误响应（API 4xx/5xx）才视为致命错误。
    try {
      await api.post("/api/modules/semantic-scholar-tracker/crawl", {
        query: semanticScholarQuery.trim(),
        max_results: resolvedMaxResults,
        days_back: resolvedDaysBack,
        sort_by: semanticScholarSortBy,
        fetch_figures: semanticScholarFetchFigures,
        session_id: sessionId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const isServerError = /^API \d+/.test(message);
      if (isServerError) {
        toast.error("获取失败", message || "请稍后重试");
        setSemanticScholarCrawling(false);
        setSemanticScholarProgress(null);
        s2SessionIdRef.current = null;
      } else {
        console.warn("[s2] crawl POST 传输层中断，由 WS 继续接管完成事件:", err);
      }
    }
  }

  // Cancel S2 crawl
  async function stopS2Crawl() {
    if (s2SessionIdRef.current) {
      try {
        const result = await api.post<{ status: string; message?: string }>("/api/modules/semantic-scholar-tracker/cancel", {
          session_id: s2SessionIdRef.current,
        });
        if (result.status !== "ok") {
          toast.error("停止失败", result.message || "未找到正在进行的爬取任务");
          return;
        }
        toast.info("正在取消", result.message || "已发送取消信号");
      } catch (e) {
        console.error("Cancel failed:", e);
        toast.error("取消失败", e instanceof Error ? e.message : "请稍后重试");
      }
    }
  }

  async function saveS2ToLiterature(paper: SemanticScholarPaper) {
    if (
      savingS2PaperIdsRef.current.has(paper.id)
      || savedS2PapersRef.current.has(paper.id)
      || paper.metadata?.saved_to_literature
    ) {
      return;
    }

    const nextSavingS2PaperIds = new Set(savingS2PaperIdsRef.current);
    nextSavingS2PaperIds.add(paper.id);
    savingS2PaperIdsRef.current = nextSavingS2PaperIds;
    setSavingS2PaperIds(nextSavingS2PaperIds);
    try {
      const result = await api.post<{
        ok: boolean;
        path: string;
        figures: Array<{ filename: string; caption: string; local_path: string }>;
        pdf: string | null;
        folder: string;
        introduction?: string;
        formatted_digest?: string;
      }>("/api/modules/semantic-scholar/save-to-literature", {
        paper,
        save_pdf: true,
        max_figures: 5,
        fetch_figures: useStore.getState().semanticScholarFetchFigures,
      });

      _setSavedS2Papers(prev => new Set(prev).add(paper.id));

      // Update paper with fetched assets/text for immediate display
      if ((result.figures && result.figures.length > 0) || result.introduction || result.formatted_digest) {
        const updatedPaper = {
          ...paper,
          metadata: {
            ...paper.metadata,
            local_figures: result.figures?.length ? result.figures : paper.metadata.local_figures,
            introduction: result.introduction || paper.metadata.introduction,
            "formatted-digest": result.formatted_digest || paper.metadata["formatted-digest"],
          },
        };
        const store = useStore.getState();
        setSemanticScholarPapers(store.semanticScholarPapers.map((entry) => (entry.id === paper.id ? updatedPaper : entry)));
      }

      const figureMsg = result.figures?.length ? ` (${result.figures.length}张图)` : "";
      const pdfMsg = result.pdf ? " +PDF" : "";
      toast.success(
        "保存成功",
        withLocationSuffix(
          `论文已保存${figureMsg}${pdfMsg}`,
          result.folder,
          "literature",
          config,
        ),
      );
    } catch (err) {
      toast.error("保存失败", err instanceof Error ? err.message : "请检查文献库路径");
    } finally {
      const nextSavingS2PaperIdsAfterSave = new Set(savingS2PaperIdsRef.current);
      nextSavingS2PaperIdsAfterSave.delete(paper.id);
      savingS2PaperIdsRef.current = nextSavingS2PaperIdsAfterSave;
      setSavingS2PaperIds(nextSavingS2PaperIdsAfterSave);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="论文追踪"
        subtitle="AND/OR 双模式 · CS领域 · 实时进度 · 自动去重"
        icon={BookOpen}
        actions={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              onClick={clearCurrentResults}
              disabled={isCrawling || currentPapers.length === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-hover)",
                border: "1px solid var(--border-light)",
                color: "var(--text-secondary)",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: isCrawling || currentPapers.length === 0 ? "not-allowed" : "pointer",
                opacity: isCrawling || currentPapers.length === 0 ? 0.6 : 1,
                transition: "all 0.3s ease",
              }}
            >
              <RefreshCw style={{ width: "14px", height: "14px" }} />
              清空本次结果
            </button>
          </div>
        }
      />

      <PageContent maxWidth="1200px">
        {/* Search Tabs */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "stretch",
            marginBottom: "20px",
          }}
        >
          <button
            onClick={() => setArxivTrackerActiveTab("followups")}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "16px 24px",
              borderRadius: "var(--radius-lg)",
              background: arxivTrackerActiveTab === "followups" ? "var(--color-primary)" : "var(--bg-card)",
              border: `1px solid ${arxivTrackerActiveTab === "followups" ? "transparent" : "var(--border-light)"}`,
              color: arxivTrackerActiveTab === "followups" ? "white" : "var(--text-secondary)",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.3s ease",
            }}
          >
            <GitBranch style={{ width: "18px", height: "18px" }} />
            后续论文
            <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>(Semantic Scholar)</span>
          </button>
          <button
            onClick={() => setArxivTrackerActiveTab("search")}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "16px 24px",
              borderRadius: "var(--radius-lg)",
              background: arxivTrackerActiveTab === "search" ? "var(--color-primary)" : "var(--bg-card)",
              border: `1px solid ${arxivTrackerActiveTab === "search" ? "transparent" : "var(--border-light)"}`,
              color: arxivTrackerActiveTab === "search" ? "white" : "var(--text-secondary)",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.3s ease",
            }}
          >
            <Search style={{ width: "18px", height: "18px" }} />
            AI领域论文
            <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>(AND / AND-OR)</span>
          </button>
          <button
            onClick={() => setArxivTrackerActiveTab("monitors")}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "16px 24px",
              borderRadius: "var(--radius-lg)",
              background: arxivTrackerActiveTab === "monitors" ? "var(--color-primary)" : "var(--bg-card)",
              border: `1px solid ${arxivTrackerActiveTab === "monitors" ? "transparent" : "var(--border-light)"}`,
              color: arxivTrackerActiveTab === "monitors" ? "white" : "var(--text-secondary)",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.3s ease",
            }}
          >
            <GitBranch style={{ width: "18px", height: "18px" }} />
            关注监控
          </button>
        </div>

        {isMonitorTab ? (
          <PaperMonitorPanel />
        ) : (
          <>
            {/* Search Card */}
            <Card style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {arxivTrackerActiveTab === "followups" ? (
              // Follow-ups Tab UI
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <GitBranch style={{ width: "20px", height: "20px", color: "var(--color-primary)" }} />
                  <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)" }}>
                    Semantic Scholar 后续论文
                  </span>
                  <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginLeft: "8px" }}>
                    查找引用该论文的后续研究
                  </span>
                </div>

                <div style={{ display: "flex", gap: "12px", alignItems: "stretch" }}>
                  <input
                    type="text"
                    value={semanticScholarQuery}
                    onChange={(e) => setSemanticScholarQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (isActionEnterKey(e) && !semanticScholarCrawling) {
                        e.preventDefault();
                        fetchS2FollowUps();
                      }
                    }}
                    placeholder="输入论文标题，如：VGGT"
                    disabled={semanticScholarCrawling}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-app)",
                      color: "var(--text-main)",
                      fontSize: "0.9375rem",
                      outline: "none",
                      transition: "all 0.2s ease",
                    }}
                  />
                  {semanticScholarCrawling ? (
                    <button
                      onClick={stopS2Crawl}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "12px 24px",
                        borderRadius: "var(--radius-full)",
                        background: "linear-gradient(135deg, #EF4444, #DC2626)",
                        border: "none",
                        color: "white",
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.3s ease",
                        boxShadow: "0 4px 16px rgba(239, 68, 68, 0.4)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Square style={{ width: "16px", height: "16px" }} />
                      停止爬取
                    </button>
                  ) : (
                    <button
                      onClick={fetchS2FollowUps}
                      disabled={semanticScholarCrawling}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "12px 24px",
                        borderRadius: "var(--radius-full)",
                        background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                        border: "none",
                        color: "white",
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.3s ease",
                        boxShadow: "0 4px 16px rgba(188, 164, 227, 0.4)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <GitBranch style={{ width: "16px", height: "16px" }} />
                      查找后续论文
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px", width: "140px" }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                      最大结果数
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      value={semanticScholarMaxResultsInput}
                      onChange={(e) => setSemanticScholarMaxResultsInput(e.target.value)}
                      placeholder="默认 50，留空=全量"
                      disabled={semanticScholarCrawling}
                      style={{
                        height: "38px",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-app)",
                        color: "var(--text-main)",
                        fontSize: "0.875rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "6px", width: "140px" }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                      最近 N 天
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={semanticScholarDaysBackInput}
                      onChange={(e) => setSemanticScholarDaysBackInput(e.target.value)}
                      placeholder="留空=不限"
                      disabled={semanticScholarCrawling}
                      style={{
                        height: "38px",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-app)",
                        color: "var(--text-main)",
                        fontSize: "0.875rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                      排序
                    </span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setSemanticScholarSortBy("recency")}
                        disabled={semanticScholarCrawling}
                        style={{
                          height: "38px",
                          padding: "0 14px",
                          borderRadius: "var(--radius-md)",
                          border: `1px solid ${semanticScholarSortBy === "recency" ? "var(--color-primary)" : "var(--border-light)"}`,
                          background: semanticScholarSortBy === "recency" ? "rgba(188, 164, 227, 0.12)" : "var(--bg-app)",
                          color: semanticScholarSortBy === "recency" ? "var(--color-primary)" : "var(--text-secondary)",
                          fontSize: "0.875rem",
                          fontWeight: 600,
                          cursor: semanticScholarCrawling ? "not-allowed" : "pointer",
                        }}
                      >
                        最近优先
                      </button>
                      <button
                        type="button"
                        onClick={() => setSemanticScholarSortBy("citation_count")}
                        disabled={semanticScholarCrawling}
                        style={{
                          height: "38px",
                          padding: "0 14px",
                          borderRadius: "var(--radius-md)",
                          border: `1px solid ${semanticScholarSortBy === "citation_count" ? "var(--color-primary)" : "var(--border-light)"}`,
                          background: semanticScholarSortBy === "citation_count" ? "rgba(188, 164, 227, 0.12)" : "var(--bg-app)",
                          color: semanticScholarSortBy === "citation_count" ? "var(--color-primary)" : "var(--text-secondary)",
                          fontSize: "0.875rem",
                          fontWeight: 600,
                          cursor: semanticScholarCrawling ? "not-allowed" : "pointer",
                        }}
                      >
                        被引优先
                      </button>
                    </div>
                  </div>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      gap: "8px",
                      cursor: semanticScholarCrawling ? "not-allowed" : "pointer",
                      userSelect: "none",
                      height: "38px",
                      paddingBottom: "10px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={semanticScholarFetchFigures}
                      disabled={semanticScholarCrawling}
                      onChange={(e) => setSemanticScholarFetchFigures(e.target.checked)}
                      style={{ width: "16px", height: "16px", accentColor: "var(--color-primary)" }}
                    />
                    <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                      爬取图片
                    </span>
                  </label>
                </div>

                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                  提示：默认会把引用该论文的后续研究全量翻页抓完；如果填写最近 N 天，会在抓取结果里按时间过滤并按你选的排序展示。
                  Semantic Scholar 只提供 abstract（外加 TLDR 一句话），Introduction 仍需从 arXiv 拉取；卡片初次出现使用 S2 元数据 + TLDR，
                  随后并发补上 Introduction + AI 分析。「爬取图片」仅决定是否额外抓取并展示论文配图。
                </div>
              </>
            ) : (
              // Keyword search UI
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <Search style={{ width: "20px", height: "20px", color: "var(--color-primary)" }} />
                  <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)" }}>
                    AI领域论文
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(["simple", "advanced"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setSearchInputMode(m)}
                          disabled={isCrawling}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            border: "1px solid var(--border-light)",
                            background: searchInputMode === m ? "var(--color-primary)" : "transparent",
                            color: searchInputMode === m ? "white" : "var(--text-secondary)",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            cursor: isCrawling ? "not-allowed" : "pointer",
                          }}
                        >
                          {m === "simple" ? "简单" : "高级"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {searchInputMode === "advanced" && (
                  <AdvancedQueryBuilder
                    value={advancedQuery}
                    onChange={setAdvancedQuery}
                    availableCategories={availableCategories}
                    expandedMainCategories={expandedMainCategories}
                    onToggleMainCategoryExpanded={toggleSearchMainCategoryExpanded}
                    showRuntimeKnobs={false}
                    compact
                    disabled={isCrawling}
                  />
                )}

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px", width: "120px" }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                      最大结果数
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={searchMaxResultsInput}
                      onChange={(e) => setSearchMaxResultsInput(e.target.value)}
                      placeholder="50"
                      disabled={isCrawling}
                      style={{
                        height: "38px",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-app)",
                        color: "var(--text-main)",
                        fontSize: "0.875rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "6px", width: "140px" }}>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                      截止时间范围(天)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={searchDaysBackInput}
                      onChange={(e) => setSearchDaysBackInput(e.target.value)}
                      placeholder="180"
                      disabled={isCrawling}
                      style={{
                        height: "38px",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-app)",
                        color: "var(--text-main)",
                        fontSize: "0.875rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </label>
                </div>

                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <ArxivCategorySelector
                    availableCategories={availableCategories}
                    selectedCategories={searchCategories}
                    expandedMainCategories={expandedMainCategories}
                    onToggleCategory={toggleSearchCategory}
                    onToggleMainCategory={toggleSearchMainCategory}
                    onToggleMainCategoryExpanded={toggleSearchMainCategoryExpanded}
                    disabled={isCrawling}
                    label="领域筛选"
                    helperText={searchCategories.length > 0
                      ? "当前会只搜索你勾选的子类。点击大类按钮可一键全选或取消该大类。"
                      : "未勾选任何子类时，将和 arXiv API 一样按全领域搜索；点击大类标题展开后再勾选具体子类。"}
                    maxHeight="240px"
                  />
                </div>

                <div style={{ display: "flex", gap: "12px", alignItems: "stretch" }}>
                  {searchInputMode === "simple" && (
                  <input
                    type="text"
                    value={arxivAndKeywords}
                    onChange={(e) => setArxivAndKeywords(e.target.value)}
                    onKeyDown={(e) => {
                      if (isActionEnterKey(e) && !isCrawling) {
                        e.preventDefault();
                        runCrawl();
                      }
                    }}
                    placeholder="AND：robotics, manipulation；AND-OR：vision,language | robot,manipulation"
                    disabled={isCrawling}
                    style={{
                      flex: 1,
                      padding: "12px 16px",
                      borderRadius: "var(--radius-lg)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-app)",
                      color: "var(--text-main)",
                      fontSize: "0.9375rem",
                      outline: "none",
                      transition: "all 0.2s ease",
                    }}
                  />
                  )}
                  {isCrawling ? (
                    <button
                      onClick={stopCrawl}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "12px 24px",
                        borderRadius: "var(--radius-full)",
                        background: "linear-gradient(135deg, #EF4444, #DC2626)",
                        border: "none",
                        color: "white",
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.3s ease",
                        boxShadow: "0 4px 16px rgba(239, 68, 68, 0.4)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Square style={{ width: "16px", height: "16px" }} />
                      停止爬取
                    </button>
                  ) : (
                    <button
                      onClick={runCrawl}
                      disabled={isCrawling}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "12px 24px",
                        borderRadius: "var(--radius-full)",
                        background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                        border: "none",
                        color: "white",
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                        cursor: isCrawling ? "not-allowed" : "pointer",
                        opacity: isCrawling ? 0.6 : 1,
                        transition: "all 0.3s ease",
                        boxShadow: "0 4px 16px rgba(188, 164, 227, 0.4)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <RefreshCw style={{ width: "16px", height: "16px", animation: isCrawling ? "spin 1s linear infinite" : "none" }} />
                      {isCrawling
                        ? "爬取中..."
                        : resolvedSearchMaxResults
                          ? `立即爬取 (${resolvedSearchMaxResults}篇)`
                          : "立即爬取（不限篇数）"}
                    </button>
                  )}
                </div>

                {/* AND-OR Mode Help Text */}
                {!isCrawling && searchInputMode === "simple" && (
                  <div style={{
                    marginTop: "12px",
                    padding: "12px 16px",
                    background: "var(--bg-hover)",
                    borderRadius: "var(--radius-lg)",
                    border: "1px dashed var(--border-light)",
                    fontSize: "0.875rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                  }}>
                    <strong style={{ color: "var(--text-main)" }}>搜索规则：</strong>
                    <br />
                    逗号分隔的关键词按 AND 搜索；用 <code style={{ background: "var(--bg-card)", padding: "2px 6px", borderRadius: "4px" }}>|</code> 分隔多组 AND 条件
                    <br />
                    例如：
                    <code style={{ background: "var(--bg-card)", padding: "2px 6px", borderRadius: "4px" }}>
                      vision,language | robot,manipulation
                    </code>
                    <br />
                    <span style={{ fontSize: "0.8125rem", opacity: 0.8 }}>
                      表示：(vision AND language) OR (robot AND manipulation)
                    </span>
                  </div>
                )}
              </>
            )}

                {/* Real-time Progress Bar */}
                {isCrawling && currentProgress && (
              <div style={{ marginTop: "12px", padding: "16px", background: "var(--bg-hover)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-light)" }}>
                {/* Progress Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                  <div style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    animation: currentProgress.phase === "fetching" ? "spin 1s linear infinite" : "none"
                  }}>
                    <RefreshCw style={{ width: "16px", height: "16px", color: "white" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)" }}>
                      {currentProgress.phase === "fetching"
                        ? arxivTrackerActiveTab === "search"
                          ? "正在获取论文列表..."
                          : "正在查询 Semantic Scholar..."
                        : arxivTrackerActiveTab === "search"
                          ? `正在推送第 ${currentProgress.current}/${currentProgress.total} 篇`
                          : `正在处理第 ${currentProgress.current}/${currentProgress.total} 篇`}
                    </div>
                    <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                      {currentProgress.message || "正在爬取..."}
                    </div>
                  </div>
                  <span style={{
                    fontSize: "1.125rem",
                    fontWeight: 700,
                    color: "var(--color-primary)",
                  }}>
                    {currentProgress.phase === "fetching"
                      ? "准备中"
                      : `${Math.round((currentProgress.current / currentProgress.total) * 100)}%`}
                  </span>
                </div>

                {/* Progress Bar */}
                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    background: "var(--bg-app)",
                    borderRadius: "var(--radius-full)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: currentProgress.phase === "fetching"
                        ? "30%"
                        : `${(currentProgress.current / currentProgress.total) * 100}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, var(--color-primary), var(--color-secondary))",
                      borderRadius: "var(--radius-full)",
                      transition: "width 0.3s ease",
                      animation: currentProgress.phase === "fetching" ? "progress-pulse 1.5s ease-in-out infinite" : "none",
                    }}
                  />
                </div>

                {/* Current Paper Title */}
                {currentProgress.currentPaperTitle && currentProgress.phase === "processing" && (
                  <div style={{
                    marginTop: "12px",
                    padding: "10px 14px",
                    background: "var(--bg-card)",
                    borderRadius: "var(--radius-md)",
                    borderLeft: "3px solid var(--color-primary)"
                  }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                      当前处理
                    </div>
                    <div style={{
                      fontSize: "0.875rem",
                      color: "var(--text-main)",
                      fontWeight: 500,
                      lineHeight: 1.4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}>
                      {currentProgress.currentPaperTitle}
                    </div>
                  </div>
                )}

                {/* Recently Added Papers */}
                {currentPapers.length > 0 && (
                  <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>最新获取:</span>
                    {currentPapers.slice(-3).reverse().map((p) => (
                      <span key={p.id} style={{
                        fontSize: "0.75rem",
                        color: "var(--color-primary)",
                        background: "rgba(188, 164, 227, 0.15)",
                        padding: "3px 10px",
                        borderRadius: "var(--radius-full)",
                        fontWeight: 500
                      }}>
                        {getTrackedPaperDisplayId(p as TrackedPaper)}
                      </span>
                    ))}
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginLeft: "auto" }}>
                      已获取 {currentPapers.length} 篇
                    </span>
                  </div>
                )}
              </div>
            )}

                {/* Auto Save Toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={autoSave}
                      onChange={(e) => setAutoSave(e.target.checked)}
                      disabled={isCrawling}
                      style={{ width: "18px", height: "18px", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                      自动保存到文献库/{arxivTrackerActiveTab === "followups" ? "FollowUps/源论文/日期 论文名" : "arxiv/追踪标签/日期 论文名"}
                    </span>
                  </label>
                </div>
              </div>
            </Card>

            {/* Papers List */}
            {currentPapers.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="暂无论文"
                description={
                  arxivTrackerActiveTab === "followups"
                    ? "输入论文标题点击「查找后续论文」开始搜索"
                    : "输入关键词点击「立即爬取」开始搜索"
                }
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {arxivTrackerActiveTab === "followups"
                  ? displayedS2Papers.map((paper, index) => (
                      <Fragment key={paper.id}>
                        {index === followupBoundaryIndex && (
                          <PaperFreshnessBoundary hasNewPapers={followupBoundaryIndex > 0} />
                        )}
                        <S2PaperCard
                          paper={paper}
                          isSaved={isTrackedPaperSaved(paper, _savedS2Papers)}
                          isSaving={savingS2PaperIds.has(paper.id)}
                          onSave={() => saveS2ToLiterature(paper)}
                          hasLiteraturePath={!!(config?.literature_path || config?.vault_path)}
                        />
                      </Fragment>
                    ))
                  : currentPapers.map((paper, index) => (
                      <Fragment key={paper.id}>
                        {index === arxivBoundaryIndex && (
                          <PaperFreshnessBoundary hasNewPapers={arxivBoundaryIndex > 0} />
                        )}
                        <PaperCard
                          paper={paper}
                          isSaved={isTrackedPaperSaved(paper, savedPapers)}
                          isSaving={savingPaperIds.has(paper.id)}
                          onSave={() => saveToLiterature(paper)}
                          hasLiteraturePath={!!(config?.literature_path || config?.vault_path)}
                        />
                      </Fragment>
                    ))}
              </div>
            )}
          </>
        )}
      </PageContent>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes progress-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </PageContainer>
  );
}

function TrackedPaperCard({
  paper,
  isSaved,
  isSaving = false,
  onSave,
  hasLiteraturePath,
  onUpdatePaper,
}: {
  paper: TrackedPaper;
  isSaved: boolean;
  isSaving?: boolean;
  onSave: () => void;
  hasLiteraturePath: boolean;
  onUpdatePaper: (updatedPaper: TrackedPaper) => void;
}) {
  return (
    <SharedPaperTrackingCard
      paper={paper}
      isSaved={isSaved}
      isSaving={isSaving}
      onSave={onSave}
      hasLiteraturePath={hasLiteraturePath}
      onUpdatePaper={onUpdatePaper}
    />
  );
}

function PaperFreshnessBoundary({ hasNewPapers }: { hasNewPapers: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        margin: "4px 0",
      }}
    >
      <div style={{ flex: 1, height: "1px", background: "rgba(16, 185, 129, 0.2)" }} />
      <div
        style={{
          padding: "8px 14px",
          borderRadius: "var(--radius-full)",
          background: "rgba(16, 185, 129, 0.08)",
          border: "1px solid rgba(16, 185, 129, 0.18)",
          color: "#0F766E",
          fontSize: "0.8125rem",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        {hasNewPapers ? "新论文分界线：以下开始出现已入库论文" : "本次结果从这里开始就是已入库论文"}
      </div>
      <div style={{ flex: 1, height: "1px", background: "rgba(16, 185, 129, 0.2)" }} />
    </div>
  );
}

function PaperCard({
  paper,
  isSaved,
  isSaving,
  onSave,
  hasLiteraturePath,
}: {
  paper: ArxivPaper;
  isSaved: boolean;
  isSaving: boolean;
  onSave: () => void;
  hasLiteraturePath: boolean;
}) {
  const setArxivAndPapers = useStore((state) => state.setArxivAndPapers);

  return (
    <TrackedPaperCard
      paper={paper}
      isSaved={isSaved}
      isSaving={isSaving}
      onSave={onSave}
      hasLiteraturePath={hasLiteraturePath}
      onUpdatePaper={(updatedPaper) => {
        const store = useStore.getState();
        setArxivAndPapers(store.arxivAndPapers.map((entry) => (entry.id === paper.id ? updatedPaper as ArxivPaper : entry)));
      }}
    />
  );
}

function S2PaperCard({
  paper,
  isSaved,
  isSaving,
  onSave,
  hasLiteraturePath,
}: {
  paper: SemanticScholarPaper;
  isSaved: boolean;
  isSaving: boolean;
  onSave: () => void;
  hasLiteraturePath: boolean;
}) {
  const setSemanticScholarPapers = useStore((state) => state.setSemanticScholarPapers);

  return (
    <TrackedPaperCard
      paper={paper}
      isSaved={isSaved}
      isSaving={isSaving}
      onSave={onSave}
      hasLiteraturePath={hasLiteraturePath}
      onUpdatePaper={(updatedPaper) => {
        const store = useStore.getState();
        setSemanticScholarPapers(store.semanticScholarPapers.map((entry) => (entry.id === paper.id ? updatedPaper as ArxivPaper : entry)));
      }}
    />
  );
}
