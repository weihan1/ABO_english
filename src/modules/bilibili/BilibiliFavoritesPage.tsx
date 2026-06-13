import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Check, Cookie, FolderHeart, ImageOff, RefreshCw, RotateCcw, Save, Tv, Users } from "lucide-react";
import { PageContainer, PageHeader, PageContent, Card, EmptyState, LoadingState } from "../../components/Layout";
import { useToast } from "../../components/Toast";
import { buildImageProxyUrl } from "../../core/api";
import { withLocationSuffix } from "../../core/pathDisplay";
import { useStore } from "../../core/store";
import {
  readJsonStorage,
  readStringStorage,
  removeStorageKey,
  writeJsonStorage,
  writeStringStorage,
} from "../../core/storage";
import {
  BilibiliFavoriteFolder,
  FavoriteCrawlResponse,
  bilibiliCancelTaskSilently,
  bilibiliListFavoriteFolders,
  bilibiliGetConfig,
  bilibiliGetCookieFromBrowser,
  bilibiliStartListFavoriteFolders,
  bilibiliGetListFavoriteFoldersTask,
  FavoriteFoldersTask,
  bilibiliCrawlFavoriteFolders,
  bilibiliStartCrawlFavoriteFolders,
  bilibiliGetCrawlFavoriteFoldersTask,
  FavoriteCrawlTask,
} from "../../api/bilibili";
import { BilibiliCookieModal } from "./BilibiliCookieModal";

interface BilibiliFavoritesPageProps {
  embedded?: boolean;
}

type FavoriteCrawlMode = "full" | "incremental";

function proxiedImage(url: string): string {
  if (!url) return "";
  return buildImageProxyUrl(url);
}

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /not found|404/i.test(message);
}

const FAVORITES_LIST_TASK_KEY = "bilibili_favorites_list_task_id";
const FAVORITES_CRAWL_TASK_KEY = "bilibili_favorites_crawl_task_id";
const FAVORITES_FOLDERS_CACHE_KEY = "bilibili_favorites_folders_cache";
const FAVORITES_RESULT_CACHE_KEY = "bilibili_favorites_result_cache";
const TASK_POLL_INTERVAL_MS = 900;
const TASK_POLL_RETRY_DELAY_MS = 1500;
const TASK_POLL_MAX_CONSECUTIVE_ERRORS = 12;
const TASK_POLL_NOT_FOUND_RETRY_LIMIT = 5;

function readJsonCache<T>(key: string, fallback: T): T {
  return readJsonStorage(key, fallback);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err || "Unknown error");
}

function createTerminalTaskError(message: string): Error & { taskTerminal: true } {
  return Object.assign(new Error(message), { taskTerminal: true as const });
}

function isTerminalTaskError(err: unknown): err is Error & { taskTerminal: true } {
  return Boolean(err && typeof err === "object" && "taskTerminal" in err);
}

function formatTaskPollingMessage(err: unknown, taskStorageKey?: string): string {
  const message = getErrorMessage(err);
  if (isTerminalTaskError(err)) {
    return message;
  }
  if (taskStorageKey && readStringStorage(taskStorageKey, "")) {
    return `${message}; the background task may still be running and can resume automatically later`;
  }
  return message;
}

function cancelStoredTask(taskStorageKey: string): void {
  const taskId = readStringStorage(taskStorageKey, "");
  if (!taskId) {
    return;
  }
  removeStorageKey(taskStorageKey);
  bilibiliCancelTaskSilently(taskId);
}

export function BilibiliFavoritesPage({ embedded = false }: BilibiliFavoritesPageProps) {
  const toast = useToast();
  const config = useStore((state) => state.config);
  const setActiveTab = useStore((state) => state.setActiveTab);
  const didAutoLoad = useRef(false);
  const [cookie, setCookie] = useState("");
  const [cookieConfigured, setCookieConfigured] = useState(false);
  const [cookiePreview, setCookiePreview] = useState<string | null>(null);
  const [gettingFromBrowser, setGettingFromBrowser] = useState(false);
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [showFullCookie, setShowFullCookie] = useState(false);
  const [folders, setFolders] = useState<BilibiliFavoriteFolder[]>(() => readJsonCache(FAVORITES_FOLDERS_CACHE_KEY, []));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(readJsonCache<string[]>("bilibili_favorites_selected_ids", [])));
  const [loading, setLoading] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [result, setResult] = useState<FavoriteCrawlResponse | null>(() => readJsonCache(FAVORITES_RESULT_CACHE_KEY, null));
  const [listTask, setListTask] = useState<FavoriteFoldersTask | null>(null);
  const [crawlTask, setCrawlTask] = useState<FavoriteCrawlTask | null>(null);
  const [legacyStatus, setLegacyStatus] = useState<{
    kind: "list" | "crawl";
    title: string;
    stage: string;
    detail: string;
    ratio: number;
  } | null>(null);

  const selectedCount = selectedIds.size;
  const selectedVideos = useMemo(
    () => folders.filter((folder) => selectedIds.has(folder.id)).reduce((sum, folder) => sum + folder.media_count, 0),
    [folders, selectedIds]
  );
  const crawlProgressRatio = useMemo(() => {
    if (!crawlTask) return 0;
    if (crawlTask.status === "completed") return 1;
    if (crawlTask.current_step === "writing") return 0.92;
    if (crawlTask.current_step === "watch_later") return 0.85;
    const estimatedTotal = Math.max(1, selectedVideos || selectedCount * 1000 || crawlTask.fetched_count || 1);
    if (crawlTask.fetched_count > 0) {
      return Math.min(0.9, crawlTask.fetched_count / estimatedTotal);
    }
    return crawlTask.current_step === "favorites" ? 0.12 : 0.08;
  }, [crawlTask, selectedCount, selectedVideos]);

  useEffect(() => {
    writeJsonStorage(FAVORITES_FOLDERS_CACHE_KEY, folders);
  }, [folders]);

  useEffect(() => {
    writeJsonStorage("bilibili_favorites_selected_ids", [...selectedIds]);
  }, [selectedIds]);

  useEffect(() => {
    writeJsonStorage(FAVORITES_RESULT_CACHE_KEY, result);
  }, [result]);

  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    void loadConfig();
    const listTaskId = readStringStorage(FAVORITES_LIST_TASK_KEY, "");
    const crawlTaskId = readStringStorage(FAVORITES_CRAWL_TASK_KEY, "");
    if (crawlTaskId) {
      void resumeCrawlTask(crawlTaskId, false).catch((err) => {
        toast.error("Failed to resume crawl task", formatTaskPollingMessage(err, FAVORITES_CRAWL_TASK_KEY));
      });
      return;
    }
    if (listTaskId) {
      void resumeListTask(listTaskId, false).catch((err) => {
        toast.error("Failed to resume favorites task", formatTaskPollingMessage(err, FAVORITES_LIST_TASK_KEY));
      });
      return;
    }
  }, []);

  useEffect(() => {
    const handlePageHide = () => {
      cancelStoredTask(FAVORITES_LIST_TASK_KEY);
      cancelStoredTask(FAVORITES_CRAWL_TASK_KEY);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  function finalizeListTask(taskId?: string | null) {
    if (!taskId) return;
    if (readStringStorage(FAVORITES_LIST_TASK_KEY, "") === taskId) {
      removeStorageKey(FAVORITES_LIST_TASK_KEY);
    }
  }

  function finalizeCrawlTask(taskId?: string | null) {
    if (!taskId) return;
    if (readStringStorage(FAVORITES_CRAWL_TASK_KEY, "") === taskId) {
      removeStorageKey(FAVORITES_CRAWL_TASK_KEY);
    }
  }

  async function resumeListTask(taskId: string, showToast = true) {
    setLoading(true);
    let consecutiveErrors = 0;
    try {
      while (true) {
        try {
          const task = await bilibiliGetListFavoriteFoldersTask(taskId);
          consecutiveErrors = 0;
          setListTask(task);

          if (task.status === "completed") {
            const res = task.result;
            if (!res) {
              throw createTerminalTaskError("Favorites preview returned empty");
            }
            setFolders(res.folders);
            setCookieConfigured(true);
            setSelectedIds((prev) => {
              const valid = new Set(res.folders.map((folder) => folder.id));
              return new Set([...prev].filter((id) => valid.has(id)));
            });
            finalizeListTask(taskId);
            if (showToast) {
              toast.success("Favorites loaded", `${res.folder_count} entries`);
            }
            break;
          }

          if (task.status === "failed") {
            finalizeListTask(taskId);
            throw createTerminalTaskError(task.error || "Failed to read favorites");
          }

          if (task.status === "cancelled") {
            finalizeListTask(taskId);
            throw createTerminalTaskError(task.error || "Background task stopped");
          }

          await sleep(TASK_POLL_INTERVAL_MS);
        } catch (err) {
          if (isTerminalTaskError(err)) {
            throw err;
          }
          consecutiveErrors += 1;
          const maxRetry = isNotFoundError(err)
            ? TASK_POLL_NOT_FOUND_RETRY_LIMIT
            : TASK_POLL_MAX_CONSECUTIVE_ERRORS;
          if (consecutiveErrors >= maxRetry) {
            if (isNotFoundError(err)) {
              finalizeListTask(taskId);
            }
            throw err;
          }
          await sleep(TASK_POLL_RETRY_DELAY_MS);
        }
      }
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function resumeCrawlTask(taskId: string, showToast = true) {
    setCrawling(true);
    let consecutiveErrors = 0;
    try {
      while (true) {
        try {
          const task = await bilibiliGetCrawlFavoriteFoldersTask(taskId);
          consecutiveErrors = 0;
          setCrawlTask(task);

          if (task.status === "completed") {
            const crawlResult = task.result;
            if (!crawlResult) {
              throw createTerminalTaskError("Favorites save returned empty");
            }
            setResult(crawlResult);
            setCookieConfigured(true);
            finalizeCrawlTask(taskId);
            if (showToast) {
              toast.success(
                crawlResult.crawl_mode === "full" ? "Favorites fully saved" : "Favorites incrementally saved",
                withLocationSuffix(
                  `Added ${crawlResult.favorite_count}, watch-later ${crawlResult.watch_later_count}, skipped ${crawlResult.skipped_count}`,
                  crawlResult.output_dir,
                  "vault",
                  config,
                ),
              );
            }
            break;
          }

          if (task.status === "failed") {
            finalizeCrawlTask(taskId);
            throw createTerminalTaskError(task.error || "Failed to save favorites");
          }

          if (task.status === "cancelled") {
            finalizeCrawlTask(taskId);
            throw createTerminalTaskError(task.error || "Background task stopped");
          }

          await sleep(TASK_POLL_INTERVAL_MS);
        } catch (err) {
          if (isTerminalTaskError(err)) {
            throw err;
          }
          consecutiveErrors += 1;
          const maxRetry = isNotFoundError(err)
            ? TASK_POLL_NOT_FOUND_RETRY_LIMIT
            : TASK_POLL_MAX_CONSECUTIVE_ERRORS;
          if (consecutiveErrors >= maxRetry) {
            if (isNotFoundError(err)) {
              finalizeCrawlTask(taskId);
            }
            throw err;
          }
          await sleep(TASK_POLL_RETRY_DELAY_MS);
        }
      }
    } catch (err) {
      throw err;
    } finally {
      setCrawling(false);
    }
  }

  async function loadConfig() {
    try {
      const config = await bilibiliGetConfig();
      setCookieConfigured(config.cookie_configured);
      setCookiePreview(config.cookie_preview);
      if (!config.cookie_configured && !cookie.trim()) {
        setShowCookieModal(true);
      }
    } catch {
      if (!cookie.trim()) {
        setShowCookieModal(true);
      }
    }
  }

  async function handleGetFromBrowser() {
    setGettingFromBrowser(true);
    try {
      const res = await bilibiliGetCookieFromBrowser();
      if (!res.success || !res.cookie) {
        throw new Error(res.error || "Could not get the Bilibili cookie from the browser");
      }
      setCookieConfigured(true);
      setCookiePreview(res.cookie_preview || null);
      setCookie(res.cookie);
      setShowCookieModal(false);
      toast.success("Browser cookie connected", res.message || `Got ${res.cookie_count || 0} cookies`);
    } catch (err) {
      toast.error("Fetch failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGettingFromBrowser(false);
    }
  }

  async function handleLoadFolders(showToast = true) {
    setLoading(true);
    setListTask(null);
    setLegacyStatus({
      kind: "list",
      title: "Favorites preview",
      stage: "Reading favorites",
      detail: "Connecting to Bilibili and reading favorites and watch-later previews.",
      ratio: 0.2,
    });
    try {
      const request = {
        cookie: cookie.trim() || undefined,
        use_cdp: true,
        cdp_port: 9222,
      };

      try {
        const started = await bilibiliStartListFavoriteFolders(request);
        writeStringStorage(FAVORITES_LIST_TASK_KEY, started.task_id);
        await resumeListTask(started.task_id, showToast);
      } catch (err) {
        if (!isNotFoundError(err)) {
          throw err;
        }
        finalizeListTask(readStringStorage(FAVORITES_LIST_TASK_KEY, ""));

        const res = await bilibiliListFavoriteFolders(request);
        setLegacyStatus({
          kind: "list",
          title: "Favorites preview",
          stage: "Legacy endpoint responding",
          detail: "The backend provides no paging progress; waiting for the favorites preview result.",
          ratio: 0.65,
        });
        setFolders(res.folders);
        setCookieConfigured(true);
        setSelectedIds((prev) => {
          const valid = new Set(res.folders.map((folder) => folder.id));
          return new Set([...prev].filter((id) => valid.has(id)));
        });
        if (showToast) {
          toast.success("Favorites loaded", `${res.folder_count} entries`);
        }
      }
    } catch (err) {
      const message = formatTaskPollingMessage(err, FAVORITES_LIST_TASK_KEY);
      if (
        message.includes("SESSDATA")
        || message.includes("Cookie")
        || message.includes("登录")
        || message.includes("未获取到")
        || message.toLowerCase().includes("login")
        || message.toLowerCase().includes("not logged in")
      ) {
        setShowCookieModal(true);
      }
      toast.error("Load failed", message);
    } finally {
      setLegacyStatus((current) => {
        if (!current || current.kind !== "list") return current;
        return {
          ...current,
          stage: folders.length > 0 ? "Favorites preview finished" : current.stage,
          detail: folders.length > 0 ? `Read ${folders.length} entries.` : current.detail,
          ratio: folders.length > 0 ? 1 : current.ratio,
        };
      });
      setLoading(false);
    }
  }

  function toggleFolder(folderId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(folders.map((folder) => folder.id)));
  }

  async function handleCrawlSelected(crawlMode: FavoriteCrawlMode) {
    if (selectedIds.size === 0) {
      toast.error("Please select a favorites folder");
      return;
    }

    setCrawling(true);
    setCrawlTask(null);
    setLegacyStatus({
      kind: "crawl",
      title: "Saving favorites",
      stage: "Preparing save task",
      detail: crawlMode === "full"
        ? `${selectedIds.size} entries selected; preparing a full save.`
        : `${selectedIds.size} entries selected; checking the incremental baseline and login state.`,
      ratio: 0.1,
    });
    try {
      const request = {
        cookie: cookie.trim() || undefined,
        folder_ids: [...selectedIds],
        crawl_mode: crawlMode,
        item_limit: crawlMode === "full" ? 100000 : 1000,
        use_cdp: true,
        cdp_port: 9222,
      };
      try {
        const started = await bilibiliStartCrawlFavoriteFolders(request);
        writeStringStorage(FAVORITES_CRAWL_TASK_KEY, started.task_id);
        await resumeCrawlTask(started.task_id, true);
        return;
      } catch (err) {
        if (isNotFoundError(err)) {
          finalizeCrawlTask(readStringStorage(FAVORITES_CRAWL_TASK_KEY, ""));
          setLegacyStatus({
            kind: "crawl",
            title: "Saving favorites",
            stage: "Legacy endpoint processing",
            detail: "The backend provides no live page progress; waiting for the save to finish.",
            ratio: 0.7,
          });
          const crawlResult = await bilibiliCrawlFavoriteFolders(request);
          setResult(crawlResult);
          setCookieConfigured(true);
          toast.success(
            crawlResult.crawl_mode === "full" ? "Favorites fully saved" : "Favorites incrementally saved",
            withLocationSuffix(
              `Added ${crawlResult.favorite_count}, watch-later ${crawlResult.watch_later_count}, skipped ${crawlResult.skipped_count}`,
              crawlResult.output_dir,
              "vault",
              config,
            ),
          );
          setLegacyStatus({
            kind: "crawl",
            title: "Saving favorites",
            stage: "Save finished",
            detail: `Added ${crawlResult.favorite_count}, watch-later ${crawlResult.watch_later_count}, skipped ${crawlResult.skipped_count}.`,
            ratio: 1,
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      const message = formatTaskPollingMessage(err, FAVORITES_CRAWL_TASK_KEY);
      if (
        message.includes("SESSDATA")
        || message.includes("Cookie")
        || message.includes("登录")
        || message.includes("未获取到")
        || message.toLowerCase().includes("login")
        || message.toLowerCase().includes("not logged in")
      ) {
        setShowCookieModal(true);
      }
      toast.error("Crawl failed", message);
    } finally {
      setCrawling(false);
    }
  }

  function openBilibiliPanel(panel: "dynamics" | "following") {
    writeStringStorage("bilibili_tool_panel", panel);
    setActiveTab("bilibili");
  }

  const content = (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", height: "100%" }}>
      {!embedded && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "12px",
          }}
        >
            <button
              type="button"
              onClick={() => openBilibiliPanel("dynamics")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.9375rem",
                fontWeight: 700,
                cursor: "pointer",
                justifyContent: "flex-start",
              }}
            >
              <span style={{ width: "36px", height: "36px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-hover)", color: "#00AEEC", flexShrink: 0 }}>
                <Tv size={18} />
              </span>
              Post tracking
            </button>
            <button
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid #FB7299",
                background: "rgba(251, 114, 153, 0.12)",
                color: "#D64078",
                fontSize: "0.9375rem",
                fontWeight: 700,
                cursor: "default",
                justifyContent: "flex-start",
              }}
            >
              <span style={{ width: "36px", height: "36px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(251, 114, 153, 0.14)", color: "#D64078", flexShrink: 0 }}>
                <FolderHeart size={18} />
              </span>
              Favorites organizing
            </button>
            <button
              type="button"
              onClick={() => openBilibiliPanel("following")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.9375rem",
                fontWeight: 700,
                cursor: "pointer",
                justifyContent: "flex-start",
              }}
            >
              <span style={{ width: "36px", height: "36px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-hover)", color: "#10B981", flexShrink: 0 }}>
                <Users size={18} />
              </span>
              Follow monitors
            </button>
        </div>
      )}

      <Card title="Select Scope" icon={<Tv size={18} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "10px",
                }}
              >
                <Metric label="Folders" value={folders.length.toString()} />
                <Metric label="Selected" value={selectedCount.toString()} />
                <Metric label="Total videos" value={selectedVideos.toString()} />
                <Metric label="Incremental basis" value="Latest save date" />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => handleLoadFolders()}
                  disabled={loading || crawling}
                  style={{
                    ...favoriteLoadButton,
                    opacity: loading || crawling ? 0.62 : 1,
                    cursor: loading || crawling ? "not-allowed" : "pointer",
                  }}
                >
                  <RefreshCw size={15} />
                  {folders.length > 0 ? "Refresh favorites" : "Read favorites"}
                </button>
                <button type="button" onClick={selectAll} disabled={folders.length === 0 || crawling} style={secondaryButton}>
                  <Check size={15} />
                  Select all
                </button>
                <button type="button" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0 || crawling} style={secondaryButton}>
                  <RotateCcw size={15} />
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => handleCrawlSelected("full")}
                  disabled={selectedIds.size === 0 || crawling || loading}
                  style={{
                    ...fullCrawlButton,
                    opacity: selectedIds.size === 0 || crawling || loading ? 0.6 : 1,
                    cursor: selectedIds.size === 0 || crawling || loading ? "not-allowed" : "pointer",
                  }}
                >
                  <Save size={15} />
                  Full crawl
                </button>
                <button
                  type="button"
                  onClick={() => handleCrawlSelected("incremental")}
                  disabled={selectedIds.size === 0 || crawling || loading}
                  style={{
                    ...primaryButton,
                    opacity: selectedIds.size === 0 || crawling || loading ? 0.6 : 1,
                    cursor: selectedIds.size === 0 || crawling || loading ? "not-allowed" : "pointer",
                  }}
                >
                  <Save size={15} />
                  {crawling ? "Saving..." : "Incremental crawl"}
                </button>
              </div>

              {result && (
                <div
                  style={{
                    padding: "12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(82, 196, 26, 0.28)",
                    background: "rgba(82, 196, 26, 0.1)",
                    color: "var(--color-success)",
                    fontSize: "0.8125rem",
                    lineHeight: 1.65,
                  }}
                >
                  {result.crawl_mode === "full"
                    ? `Full crawl finished: ${result.favorite_count} new favorites, ${result.watch_later_count} watch-later, ${result.skipped_count} skipped. Renamed ${result.renamed_favorite_count ?? 0} favorite files by save date. State saved at ${result.state_path}`
                    : `Incremental crawl finished: ${result.favorite_count} new favorites, ${result.watch_later_count} watch-later, ${result.skipped_count} already-recorded skipped. Renamed ${result.renamed_favorite_count ?? 0} favorite files by save date. Incremental state saved at ${result.state_path}`}
                </div>
              )}

              {listTask && listTask.status === "running" && (
                <ProgressNotice
                  title="Favorites preview"
                  stage={listTask.stage}
                  detail={`Processed ${listTask.processed_folders}/${Math.max(listTask.total_folders || 0, 1)} items${listTask.current_folder ? ` · ${listTask.current_folder}` : ""}`}
                  ratio={listTask.total_folders ? listTask.processed_folders / listTask.total_folders : 0}
                />
              )}

              {crawlTask && crawlTask.status === "running" && (
                <ProgressNotice
                  title="Saving favorites"
                  stage={crawlTask.stage}
                  detail={`Checked ${crawlTask.fetched_count}, ${crawlTask.saved_count} new to save, ${crawlTask.skipped_count} already saved skipped${crawlTask.current_folder ? ` · ${crawlTask.current_folder}` : ""}`}
                  ratio={crawlProgressRatio}
                />
              )}

              {!listTask && !crawlTask && legacyStatus && (loading || crawling || legacyStatus.ratio >= 1) && (
                <ProgressNotice
                  title={legacyStatus.title}
                  stage={legacyStatus.stage}
                  detail={legacyStatus.detail}
                  ratio={legacyStatus.ratio}
                />
              )}

            </div>
          </Card>

      {loading ? (
        <LoadingState message="Reading favorites and covers..." />
      ) : folders.length === 0 ? (
        <EmptyState
          icon={FolderHeart}
          title="No Favorites Loaded"
          description="Nothing loads automatically — click \"Read favorites\" above to start"
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "14px",
            paddingBottom: "24px",
          }}
        >
          {folders.map((folder) => (
            <FavoriteFolderTile
              key={folder.id}
              folder={folder}
              selected={selectedIds.has(folder.id)}
              onToggle={() => toggleFolder(folder.id)}
            />
          ))}
        </div>
      )}
    </div>
  );

  const modal = (
    <BilibiliCookieModal
      open={showCookieModal}
      canClose={cookieConfigured || Boolean(cookie.trim())}
      onClose={() => setShowCookieModal(false)}
      gettingFromBrowser={gettingFromBrowser}
      onFetchFromBrowser={handleGetFromBrowser}
      cookiePreview={cookiePreview}
      cookieInput={cookie}
      showFullCookie={showFullCookie}
      onToggleFullCookie={() => setShowFullCookie((visible) => !visible)}
    />
  );

  if (embedded) {
    return (
      <>
        {modal}
        {content}
      </>
    );
  }

  return (
    <PageContainer>
      {modal}
      <PageHeader
        title="Bilibili Tools"
        subtitle="One-click cookie connect; save by posts and watch-later categories"
        icon={Tv}
        actions={
          <button
            type="button"
            onClick={() => setShowCookieModal(true)}
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-light)",
              background: cookieConfigured ? "transparent" : "rgba(239, 68, 68, 0.08)",
              color: cookieConfigured ? "var(--text-secondary)" : "var(--color-danger)",
              fontSize: "0.875rem",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Cookie size={16} />
            {cookieConfigured ? "Cookie settings" : "Configure cookie"}
          </button>
        }
      />
      <PageContent>
        {content}
      </PageContent>
    </PageContainer>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "1.125rem", fontWeight: 800, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function FavoriteFolderTile({
  folder,
  selected,
  onToggle,
}: {
  folder: BilibiliFavoriteFolder;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        padding: 0,
        borderRadius: "var(--radius-md)",
        border: selected ? "2px solid #00AEEC" : "1px solid var(--border-subtle)",
        background: "var(--bg-card)",
        overflow: "hidden",
        textAlign: "left",
        cursor: "pointer",
        minHeight: "286px",
        display: "flex",
        flexDirection: "column",
        boxShadow: selected ? "0 10px 24px rgba(0, 174, 236, 0.16)" : "none",
      }}
    >
      <div style={{ position: "relative", aspectRatio: "16 / 9", background: "var(--bg-muted)", overflow: "hidden" }}>
        {folder.cover ? (
          <img
            src={proxiedImage(folder.cover)}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
            }}
          >
            <ImageOff size={28} />
          </div>
        )}
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            width: "26px",
            height: "26px",
            borderRadius: "6px",
            background: selected ? "#00AEEC" : "rgba(0, 0, 0, 0.52)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selected && <Check size={16} />}
        </div>
      </div>

      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
        <div
          style={{
            fontSize: "0.9375rem",
            fontWeight: 800,
            color: "var(--text-primary)",
            lineHeight: 1.35,
          }}
        >
          {folder.title}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.45, minHeight: "34px" }}>
          {folder.first_video_title || "No video preview"}
        </div>
        <div style={{ marginTop: "auto", display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <Pill>{folder.media_count} videos</Pill>
          <Pill>Saved {folder.crawled_count}</Pill>
          {folder.last_crawled_at && <Pill>{folder.last_crawled_at}</Pill>}
        </div>
      </div>
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: "5px 7px",
        borderRadius: "6px",
        background: "var(--bg-hover)",
        color: "var(--text-secondary)",
        fontSize: "0.6875rem",
        fontWeight: 700,
      }}
    >
      {children}
    </span>
  );
}

function ProgressNotice({
  title,
  stage,
  detail,
  ratio,
}: {
  title: string;
  stage: string;
  detail: string;
  ratio: number;
}) {
  const progress = Math.max(0, Math.min(1, ratio || 0));
  return (
    <div
      style={{
        padding: "12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid rgba(0, 174, 236, 0.28)",
        background: "rgba(0, 174, 236, 0.08)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-primary)" }}>{title}</div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{Math.round(progress * 100)}%</div>
      </div>
      <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>{stage}</div>
      <div
        style={{
          width: "100%",
          height: "8px",
          borderRadius: "999px",
          background: "rgba(0, 0, 0, 0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(progress * 100)}%`,
            height: "100%",
            background: "linear-gradient(90deg, #00AEEC, #52C41A)",
          }}
        />
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{detail}</div>
    </div>
  );
}

const secondaryButton: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  fontSize: "0.875rem",
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "7px",
};

const favoriteLoadButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid rgba(0, 174, 236, 0.34)",
  background: "linear-gradient(135deg, rgba(0, 174, 236, 0.22), rgba(251, 114, 153, 0.18))",
  color: "#047EAA",
  fontSize: "0.875rem",
  fontWeight: 800,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "7px",
  boxShadow: "0 7px 16px rgba(0, 174, 236, 0.16)",
};

const primaryButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "var(--radius-sm)",
  border: "none",
  background: "#00AEEC",
  color: "white",
  fontSize: "0.875rem",
  fontWeight: 800,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "7px",
};

const fullCrawlButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid rgba(245, 158, 11, 0.42)",
  background: "rgba(245, 158, 11, 0.12)",
  color: "#B45309",
  fontSize: "0.875rem",
  fontWeight: 800,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "7px",
};
