import { useState, useEffect, useRef } from "react";
import type React from "react";
import {
  Search,
  MessageCircle,
  TrendingUp,
  Heart,
  ExternalLink,
  Filter,
  Users,
  Zap,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Cookie,
  AlertCircle,
  CheckCircle,
  Plus,
  RefreshCw,
  X,
  Save,
  FolderDown,
  Trash2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageContainer, PageHeader, PageContent, Card, EmptyState } from "../../components/Layout";
import { api, buildImageProxyUrl } from "../../core/api";
import { isActionEnterKey } from "../../core/keyboard";
import { dirnamePath, formatLibraryLocation, withLocationSuffix } from "../../core/pathDisplay";
import {
  readJsonStorage,
  readStringStorage,
  removeStorageKey,
  writeJsonStorage,
  writeStringStorage,
} from "../../core/storage";
import { useStore } from "../../core/store";
import { useToast } from "../../components/Toast";
import { CookieGuide } from "../../components/ConfigHelp";
import { PaginationControls } from "../../components/PaginationControls";
import {
  type CrawlNoteResponse,
  type CrawlBatchResponse,
  type XHSTaskStatus,
  type XHSAuthorCandidate,
  type XHSCreatorRecentResponse,
  type XHSSmartGroupOption,
  type XHSSmartGroupResult,
  xiaohongshuCancelTask,
  xiaohongshuGetConfig,
  xiaohongshuGetTaskStatus,
  xiaohongshuGetCookieFromBrowser,
  xiaohongshuListTasks,
  xiaohongshuSaveConfig,
  xiaohongshuSavePreviews,
  xiaohongshuSyncAuthorsToTracker,
  xiaohongshuStartCommentsTask,
  xiaohongshuStartCrawlBatchTask,
  xiaohongshuStartCrawlNoteTask,
  xiaohongshuStartCreatorRecentTask,
  xiaohongshuStartFollowingFeedTask,
  xiaohongshuStartSearchTask,
  xiaohongshuStartSmartGroupTask,
  xiaohongshuVerifyCookie,
} from "../../api/xiaohongshu";
import { SmartGroupActionButton } from "../../components/SmartGroupActionButton";
import { SharedSignalMappingPanel, type SharedSignalEntry } from "../../components/SharedSignalMappingPanel";
import {
  createCreatorMonitor,
  createFollowingScan,
  createFollowingScanMonitor,
  createKeywordMonitor,
  DEFAULT_XHS_RECENT_DAYS,
  formatKeywordInput,
  normalizeXhsTrackerConfig,
  parseKeywordInput,
  type XHSTrackerCreatorMonitor,
  type XHSTrackerFollowingScanMonitor,
  type XHSTrackerFollowingScan,
  type XHSTrackerKeywordMonitor,
} from "./trackerConfig";
import XiaohongshuNoteCard from "./XiaohongshuNoteCard";

interface XHSNote {
  id: string;
  title: string;
  content: string;
  author: string;
  author_id?: string;
  likes: number;
  collects: number;
  comments_count: number;
  url: string;
  published_at: string | null;
  cover_image?: string | null;
  note_type?: string;
  images?: string[];
  video_url?: string | null;
  xsec_token?: string;
  xsec_source?: string;
  comments_preview?: XHSComment[];
}

interface XHSComment {
  id: string;
  author: string;
  content: string;
  likes: number;
  is_top: boolean;
}

interface SearchResponse {
  keyword: string;
  total_found: number;
  notes: XHSNote[];
}

interface CommentsResponse {
  note_id: string;
  total_comments: number;
  sort_by: string;
  strategy?: string;
  comments: XHSComment[];
}

type TabType = "collections" | "search" | "following";
type AlbumCrawlMode = "incremental" | "full";
type BrowserChoice = "default" | "edge" | "chrome" | "brave" | "safari" | "firefox";
type NoteResultLayout = "horizontal" | "vertical";
const XIAOHONGSHU_TOOL_TAB_KEY = "xiaohongshu_tool_tab";
const CREATOR_BATCH_DELAY_SECONDS_RANGE = [20, 30] as const;
const FREQUENT_AUTHOR_PAGE_SIZE = 12;
const XHS_CREATOR_RISK_MARKERS = [
  "访问频繁",
  "安全验证",
  "安全限制",
  "安全访问",
  "扫码",
  "请先登录",
  "登录后查看更多内容",
  "请稍后再试",
  "risk_limited",
  "manual_required",
  "auth_invalid",
];

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const randomCreatorBatchDelaySeconds = () => {
  const [minSeconds, maxSeconds] = CREATOR_BATCH_DELAY_SECONDS_RANGE;
  return minSeconds + Math.floor(Math.random() * (maxSeconds - minSeconds + 1));
};
const isXhsCreatorRiskError = (value: unknown) => {
  const text = value instanceof Error ? value.message : String(value || "");
  return XHS_CREATOR_RISK_MARKERS.some((marker) => text.includes(marker));
};

interface FollowingFeedResponse {
  total_found: number;
  notes: Array<XHSNote & { matched_keywords?: string[] }>;
}

interface XHSAlbumPreview {
  board_id: string;
  name: string;
  count: number | null;
  url: string;
  preview_image?: string;
  latest_title?: string;
  seen_count?: number;
  new_estimate?: number | null;
}

interface XHSAlbumListResponse {
  success: boolean;
  albums: XHSAlbumPreview[];
  total: number;
  progress_path: string;
  message: string;
}

interface XHSAlbumCrawlResponse {
  success: boolean;
  saved: number;
  skipped: number;
  failed: number;
  progress_path: string;
  results: Array<{
    success: boolean;
    album?: string;
    board_id?: string;
    mode?: string;
    found?: number;
    saved?: number;
    skipped?: number;
    diagnostics?: {
      loaded_notes?: number;
      raw_seen_count?: number;
      valid_seen_count?: number;
      pruned_seen_count?: number;
      candidate_notes?: number;
      processable_notes?: number;
      recent_days?: number | null;
      before_date?: string | null;
      skip_breakdown?: {
        already_seen?: number;
        older_than_recent_days?: number;
        newer_than_before_date?: number;
        invalid_note?: number;
      };
    };
    error?: string;
  }>;
}

const IMAGE_PROXY_PREFIX = buildImageProxyUrl("");

function proxiedImage(url: string): string {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) return "";
  if (cleanUrl.startsWith("data:image/")) return cleanUrl;
  if (cleanUrl.startsWith(IMAGE_PROXY_PREFIX)) return cleanUrl;
  return buildImageProxyUrl(cleanUrl);
}

function normalizeAlbumPreviewImage(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw || raw === "?" || raw === "#" || raw === "about:blank") return "";
  if (raw.startsWith("data:image/")) return raw;
  try {
    const parsed = new URL(raw, window.location.href);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    if ((parsed.hostname || "").toLowerCase().endsWith(".xhscdn.com") && parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }
    const href = parsed.toString();
    if ((parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && !href.startsWith(IMAGE_PROXY_PREFIX)) {
      return "";
    }
    if (
      /(?:xiaohongshu\.com|xhscdn\.com)$/i.test(parsed.hostname)
      && /\/(?:explore|board|user\/profile)(?:\/|$)/.test(parsed.pathname)
    ) {
      return "";
    }
    return href;
  } catch {
    return "";
  }
}

function normalizeAlbumPreview(album: XHSAlbumPreview): XHSAlbumPreview {
  return {
    ...album,
    preview_image: normalizeAlbumPreviewImage(album.preview_image),
  };
}

function normalizeAlbumPreviews(albums: XHSAlbumPreview[]): XHSAlbumPreview[] {
  return Array.isArray(albums) ? albums.map(normalizeAlbumPreview) : [];
}

type AlbumPreviewFallbackMode = "proxy" | "none";

function shouldProxyAlbumPreview(url: string): boolean {
  if (!url || url.startsWith("data:image/")) return false;
  try {
    const parsed = new URL(url, window.location.href);
    const hostname = (parsed.hostname || "").toLowerCase();
    return (
      hostname === "xiaohongshu.com"
      || hostname.endsWith(".xiaohongshu.com")
      || hostname === "xhscdn.com"
      || hostname.endsWith(".xhscdn.com")
    );
  } catch {
    return false;
  }
}

interface XHSCreatorProfile {
  author?: string;
  author_id?: string;
  profile_url?: string;
  pending_author_id?: boolean;
  recent_days?: number;
  sort_by?: "likes" | "time";
  smart_groups?: string[];
  smart_group_labels?: string[];
  latest_title?: string;
  sample_titles?: string[];
  sample_albums?: string[];
  sample_tags?: string[];
  sample_note_urls?: string[];
  source_summary?: string;
}

interface SharedCreatorGroupingSnapshot {
  updated_at?: string;
  signal_group_labels?: Record<string, string | string[]>;
  vault_signal_database?: {
    indexed_files?: number;
    signal_count?: number;
    database_path?: string;
    tag_index_path?: string;
    saved_at?: string;
  };
  shared_data_paths?: {
    tag_index_path?: string;
    shared_groups_path?: string;
    creator_profiles_path?: string;
  };
}

interface CreatorBatchTarget {
  profileId: string;
  author: string;
  authorId: string;
  query: string;
  groupValue?: string;
  groupLabel?: string;
}

interface CreatorBatchResultItem {
  target: CreatorBatchTarget;
  result?: XHSCreatorRecentResponse;
  error?: string;
}

export function XiaohongshuTool() {
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = readStringStorage(XIAOHONGSHU_TOOL_TAB_KEY, "");
    if (saved === "following" || saved === "search") return saved;
    return "collections";
  });
  const toast = useToast();
  const config = useStore((state) => state.config);

  // Cookie config state
  const [webSession, setWebSession] = useState(() => readStringStorage("xiaohongshu_websession", ""));
  const [idToken, setIdToken] = useState(() => readStringStorage("xiaohongshu_idtoken", ""));
  const [fullCookie, setFullCookie] = useState(() => readStringStorage("xiaohongshu_full_cookie", ""));
  const [cookieVerified, setCookieVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [gettingCookie, setGettingCookie] = useState(false);
  const [showManualCookie, setShowManualCookie] = useState(false);
  const [showFullCookie, setShowFullCookie] = useState(false);
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [backendCookieConfigured, setBackendCookieConfigured] = useState(false);

  // Search state
  const [searchKeyword, setSearchKeyword] = useState("");
  const [minLikes, setMinLikes] = useState(100);
  const [searchLimit, setSearchLimit] = useState(20);
  const [searchRecentDays, setSearchRecentDays] = useState(DEFAULT_XHS_RECENT_DAYS);
  const [searchAutoSaveAfterFetch, setSearchAutoSaveAfterFetch] = useState(false);
  const [searchSaveComments, setSearchSaveComments] = useState(false);
  const [searchSaveCommentsLimit, setSearchSaveCommentsLimit] = useState(20);
  const [searchSaveCommentsSortBy, setSearchSaveCommentsSortBy] = useState<"likes" | "time">("likes");
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(true);
  const [searchResultLayout, setSearchResultLayout] = useState<NoteResultLayout>("horizontal");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  // Comments state
  const [noteId, setNoteId] = useState("");
  const [commentsResult, setCommentsResult] = useState<CommentsResponse | null>(null);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());

  // Following feed state
  const [followingKeywords, setFollowingKeywords] = useState("");
  const [followingLimit, setFollowingLimit] = useState(20);
  const [followingRecentDays, setFollowingRecentDays] = useState(DEFAULT_XHS_RECENT_DAYS);
  const [followingAutoSaveAfterFetch, setFollowingAutoSaveAfterFetch] = useState(false);
  const [followingResult, setFollowingResult] = useState<FollowingFeedResponse | null>(null);
  const [showFollowingResults, setShowFollowingResults] = useState(true);
  const [followingResultLayout, setFollowingResultLayout] = useState<NoteResultLayout>("horizontal");
  const [expandedFollowingNotes, setExpandedFollowingNotes] = useState<Set<string>>(new Set());
  const [followingFeedTaskId, setFollowingFeedTaskId] = useState<string | null>(null);
  const [creatorSearchQuery, setCreatorSearchQuery] = useState("");
  const [creatorRecentDays, setCreatorRecentDays] = useState(DEFAULT_XHS_RECENT_DAYS);
  const [creatorRecentLimit, setCreatorRecentLimit] = useState(10);
  const [creatorRecentAutoSaveAfterFetch, setCreatorRecentAutoSaveAfterFetch] = useState(false);
  const [creatorRecentResult, setCreatorRecentResult] = useState<XHSCreatorRecentResponse | null>(null);
  const [creatorRecentResultLayout, setCreatorRecentResultLayout] = useState<NoteResultLayout>("horizontal");
  const [expandedCreatorRecentNotes, setExpandedCreatorRecentNotes] = useState<Set<string>>(new Set());
  const [creatorBatchResultLayout, setCreatorBatchResultLayout] = useState<NoteResultLayout>("horizontal");
  const [expandedCreatorBatchNotes, setExpandedCreatorBatchNotes] = useState<Set<string>>(new Set());
  const [creatorRecentTaskId, setCreatorRecentTaskId] = useState<string | null>(null);
  const [selectedCreatorBatchIds, setSelectedCreatorBatchIds] = useState<Set<string>>(new Set());
  const [creatorBatchResults, setCreatorBatchResults] = useState<CreatorBatchResultItem[]>([]);
  const [creatorBatchProgress, setCreatorBatchProgress] = useState<{
    completed: number;
    total: number;
    currentLabel: string;
  } | null>(null);

  // Crawl state
  const [crawlUrl, setCrawlUrl] = useState("");
  const [includeImages, setIncludeImages] = useState(false);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [includeLivePhoto, setIncludeLivePhoto] = useState(false);
  const [includeComments, setIncludeComments] = useState(false);
  const [commentsLimit, setCommentsLimit] = useState(20);
  const [crawlResult, setCrawlResult] = useState<CrawlNoteResponse | null>(null);
  const [batchUrls, setBatchUrls] = useState("");
  const [batchResult, setBatchResult] = useState<CrawlBatchResponse | null>(null);

  // Album collection state
  const [albums, setAlbums] = useState<XHSAlbumPreview[]>(() => {
    try {
      const saved = readJsonStorage("xiaohongshu_album_cache", [] as XHSAlbumPreview[]);
      return normalizeAlbumPreviews(saved);
    } catch {
      return [];
    }
  });
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<string>>(() => {
    try {
      const saved = readJsonStorage("xiaohongshu_album_cache", [] as XHSAlbumPreview[]);
      const parsed = normalizeAlbumPreviews(saved);
      return new Set(Array.isArray(parsed) ? parsed.map((album: XHSAlbumPreview) => album.board_id).filter(Boolean) : []);
    } catch {
      return new Set();
    }
  });
  const [albumPreviewFallbacks, setAlbumPreviewFallbacks] = useState<Record<string, AlbumPreviewFallbackMode>>({});
  const [albumCrawlMode, setAlbumCrawlMode] = useState<AlbumCrawlMode>("full");
  const [albumResult, setAlbumResult] = useState<XHSAlbumCrawlResponse | null>(null);
  const [albumRecentDaysInput, setAlbumRecentDaysInput] = useState("");
  const [albumCookieBrowser, setAlbumCookieBrowser] = useState<BrowserChoice>("default");
  const [albumDedicatedWindowMode, setAlbumDedicatedWindowMode] = useState(true);
  const [albumExtensionPort, setAlbumExtensionPort] = useState(9334);
  const [showAlbumRecoveryOptions, setShowAlbumRecoveryOptions] = useState(false);
  const [albumRecoveryMode, setAlbumRecoveryMode] = useState(true);
  const [albumBatchSize, setAlbumBatchSize] = useState(5);
  const [albumBatchPauseSeconds, setAlbumBatchPauseSeconds] = useState(30);
  const [albumProgress, setAlbumProgress] = useState<any | null>(null);
  const [albumListProgress, setAlbumListProgress] = useState<any | null>(null);
  const [albumListTaskId, setAlbumListTaskId] = useState<string | null>(null);
  const [albumCrawlTaskId, setAlbumCrawlTaskId] = useState<string | null>(null);
  const albumListTimerRef = useRef<number | null>(null);
  const albumCrawlTimerRef = useRef<number | null>(null);
  const followingResultTopRef = useRef<HTMLDivElement | null>(null);
  const followingResultBottomRef = useRef<HTMLDivElement | null>(null);
  const searchResultCarouselRef = useRef<HTMLDivElement | null>(null);
  const followingResultCarouselRef = useRef<HTMLDivElement | null>(null);
  const creatorRecentResultCarouselRef = useRef<HTMLDivElement | null>(null);
  const creatorBatchResultCarouselRef = useRef<HTMLDivElement | null>(null);
  const [, setTrackerKeywords] = useState<string[]>([]);
  const [trackerMaxResults, setTrackerMaxResults] = useState(20);
  const [trackerKeywordMinLikes, setTrackerKeywordMinLikes] = useState(500);
  const [trackerKeywordLimit, setTrackerKeywordLimit] = useState(10);
  const [trackerEnableKeywordSearch, setTrackerEnableKeywordSearch] = useState(true);
  const [trackerKeywordMonitors, setTrackerKeywordMonitors] = useState<XHSTrackerKeywordMonitor[]>([]);
  const [trackerFollowingScan, setTrackerFollowingScan] = useState<XHSTrackerFollowingScan>(createFollowingScan());
  const [trackerFollowingScanMonitors, setTrackerFollowingScanMonitors] = useState<XHSTrackerFollowingScanMonitor[]>([]);
  const [trackerKeywordDraft, setTrackerKeywordDraft] = useState("");
  const [trackerKeywordMonitorDrafts, setTrackerKeywordMonitorDrafts] = useState<Record<string, string>>({});
  const [trackerFollowingScanMonitorDrafts, setTrackerFollowingScanMonitorDrafts] = useState<Record<string, string>>({});
  const [trackerFollowingScanKeywordDraft, setTrackerFollowingScanKeywordDraft] = useState("");
  const [trackerCreatorMonitors, setTrackerCreatorMonitors] = useState<XHSTrackerCreatorMonitor[]>([]);
  const [trackerUserIds, setTrackerUserIds] = useState<string[]>([]);
  const [disabledCreatorIds, setDisabledCreatorIds] = useState<Set<string>>(new Set());
  const [trackerCreatorProfiles, setTrackerCreatorProfiles] = useState<Record<string, XHSCreatorProfile>>({});
  const [trackerCreatorNameMap, setTrackerCreatorNameMap] = useState<Record<string, {
    author?: string;
    author_id?: string;
    profile_url?: string;
    source?: string;
    updated_at?: string;
  }>>({});
  const [trackerCreatorGroups, setTrackerCreatorGroups] = useState<string[]>([]);
  const [trackerCreatorGroupOptions, setTrackerCreatorGroupOptions] = useState<XHSSmartGroupOption[]>([]);
  const [trackerCreatorPushEnabled, setTrackerCreatorPushEnabled] = useState(false);
  const [sharedSignalEntries, setSharedSignalEntries] = useState<SharedSignalEntry[]>([]);
  const [sharedCreatorGrouping, setSharedCreatorGrouping] = useState<SharedCreatorGroupingSnapshot>({});
  const [savingSignalMappings, setSavingSignalMappings] = useState(false);
  const [smartGroupResult, setSmartGroupResult] = useState<XHSSmartGroupResult | null>(null);
  const [showSharedGroupingDetail, setShowSharedGroupingDetail] = useState(false);
  const [showSharedSignalRules, setShowSharedSignalRules] = useState(false);
  const [showSharedCreatorGroupManager, setShowSharedCreatorGroupManager] = useState(false);
  const [expandedCreatorSelectorGroups, setExpandedCreatorSelectorGroups] = useState<Set<string>>(new Set());
  const [expandedSharedManagerGroups, setExpandedSharedManagerGroups] = useState<Set<string>>(new Set());
  const [expandedSharedManagerMembers, setExpandedSharedManagerMembers] = useState<Set<string>>(new Set());
  const [authorCandidates, setAuthorCandidates] = useState<XHSAuthorCandidate[]>([]);
  const [authorCandidateMeta, setAuthorCandidateMeta] = useState<{ totalNotes: number; message: string } | null>(null);
  const [frequentAuthorGroupFilter, setFrequentAuthorGroupFilter] = useState<string>("all");
  const [frequentAuthorPage, setFrequentAuthorPage] = useState(1);
  const [creatorMonitorGroupFilter, setCreatorMonitorGroupFilter] = useState<string>("all");
  const [creatorMonitorPage, setCreatorMonitorPage] = useState(0);
  const [showCreatorImportPanel, setShowCreatorImportPanel] = useState(false);
  const [showCreatorFilterPanel, setShowCreatorFilterPanel] = useState(false);
  const [showCreatorRecentWorkbench, setShowCreatorRecentWorkbench] = useState(false);
  const [showManualCrawlWorkbench, setShowManualCrawlWorkbench] = useState(false);
  const [sharedCreatorManagerQuery, setSharedCreatorManagerQuery] = useState("");
  const [sharedCreatorManagerPageSize, setSharedCreatorManagerPageSize] = useState<20 | 50>(20);
  const [sharedCreatorManagerPages, setSharedCreatorManagerPages] = useState<Record<string, number>>({});
  const [activeTaskKinds, setActiveTaskKinds] = useState<Set<string>>(new Set());
  const [backgroundTask, setBackgroundTask] = useState<{ kind: string; stage: string; taskId: string } | null>(null);
  const [taskHistory, setTaskHistory] = useState<XHSTaskStatus[]>([]);
  const [showTaskHistory, setShowTaskHistory] = useState(false);
  const [taskHistoryQuery, setTaskHistoryQuery] = useState("");
  const [taskHistoryPage, setTaskHistoryPage] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [expandedPushes, setExpandedPushes] = useState<Set<string>>(new Set(["creator"]));
  const [updatingSharedCreatorIds, setUpdatingSharedCreatorIds] = useState<Set<string>>(new Set());

  const compactControlStyle = {
    padding: "10px 12px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-light)",
    background: "var(--bg-card)",
    color: "var(--text-main)",
    fontSize: "0.875rem",
    lineHeight: 1.2,
    outline: "none",
    boxShadow: "none",
  };

  const segmentedButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 12px",
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${active ? "var(--color-primary)" : "var(--border-light)"}`,
    background: active ? "var(--color-primary)" : "transparent",
    color: active ? "white" : "var(--text-main)",
    fontSize: "0.875rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s ease",
  });

  const browserLabelMap: Record<BrowserChoice, string> = {
    default: "Default browser",
    edge: "Edge",
    chrome: "Chrome",
    brave: "Brave",
    safari: "Safari",
    firefox: "Firefox",
  };

  const hasCookie = Boolean(fullCookie.trim() || webSession.trim() || backendCookieConfigured);
  const xhsBridgeOptions = {
    use_extension: true,
    extension_port: albumExtensionPort,
    dedicated_window_mode: albumDedicatedWindowMode,
  };
  const xhsCrawlFallbackOptions = {
    ...xhsBridgeOptions,
    use_cdp: true,
    cdp_port: 9222,
  };

  const formatStrategyLabel = (strategy?: string | null) => {
    switch (strategy) {
      case "extension_note_detail_map":
        return "Extension detail state";
      case "extension_state_tree_detail":
      case "extension_state_tree_note":
        return "Extension page state re-fetch";
      case "extension_dom_fallback":
        return "Extension DOM re-fetch";
      case "extension_state_machine":
        return "Extension comment state machine";
      case "plugin_state_urls":
        return "Extension state media links";
      case "plugin_dom_urls":
        return "Extension DOM media links";
      case "cdp_initial_state":
        return "CDP detail fallback";
      case "cdp_state_urls":
        return "CDP media links";
      case "html_initial_state":
        return "Backend HTML/Initial State";
      case "html_state_urls":
        return "Backend HTML media links";
      default:
        return strategy || "Unlabeled";
    }
  };

  const formatExecutionRoute = (payload?: {
    used_extension?: boolean;
    used_cdp?: boolean;
  } | null) => {
    if (payload?.used_extension) return "Extension main path";
    if (payload?.used_cdp) return "CDP fallback";
    return "Backend HTML fallback";
  };

  const normalizeAuthorKey = (value?: string | null) => String(value || "").trim().toLowerCase();

  const normalizeXhsProfileUserId = (value?: string | null) => {
    const cleanValue = String(value || "").trim();
    const profileMatch = cleanValue.match(/\/user\/profile\/([^/?#]+)/);
    return decodeURIComponent(profileMatch?.[1] || cleanValue).trim();
  };

  const buildXhsProfileUrl = (userId?: string | null) => {
    const cleanUserId = normalizeXhsProfileUserId(userId);
    return cleanUserId ? `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(cleanUserId)}` : "";
  };

  const openExternalUrl = async (url?: string | null, label = "page") => {
    const cleanUrl = String(url || "").trim();
    if (!cleanUrl) {
      toast.error(`No link for ${label}`);
      return;
    }
    try {
      await openUrl(cleanUrl);
    } catch (e) {
      try {
        window.open(cleanUrl, "_blank", "noopener,noreferrer");
        return;
      } catch {
        // fall through
      }
      toast.error(`Failed to open ${label}`, e instanceof Error ? e.message : "Unknown error");
    }
  };

  useEffect(() => {
    return () => {
      if (albumListTimerRef.current) window.clearInterval(albumListTimerRef.current);
      if (albumCrawlTimerRef.current) window.clearInterval(albumCrawlTimerRef.current);
    };
  }, []);

  const switchStyle = (active: boolean): React.CSSProperties => ({
    width: "42px",
    height: "24px",
    borderRadius: "999px",
    border: "none",
    background: active ? "var(--color-primary)" : "var(--text-muted)",
    position: "relative",
    cursor: "pointer",
    transition: "background 0.18s ease",
    flexShrink: 0,
  });

  const switchKnobStyle = (active: boolean): React.CSSProperties => ({
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    background: "white",
    position: "absolute",
    top: "3px",
    left: active ? "21px" : "3px",
    transition: "left 0.18s ease",
    boxShadow: "0 1px 4px rgba(15, 23, 42, 0.18)",
  });

  const refreshTrackerConfig = async () => {
    const config = await api.get<any>("/api/modules/xiaohongshu-tracker/config");
    const normalized = normalizeXhsTrackerConfig(config);
    const keywordKeywords = Array.from(
      new Set(normalized.keywordMonitors.flatMap((monitor) => monitor.keywords))
    );
    const firstKeywordMonitor = normalized.keywordMonitors[0];
    const creatorProfiles = { ...(config.creator_profiles || {}) };
    normalized.creatorMonitors.forEach((monitor) => {
      if (!monitor.user_id) return;
      creatorProfiles[monitor.user_id] = {
        ...(creatorProfiles[monitor.user_id] || {}),
        author: monitor.author || monitor.label || monitor.user_id,
        author_id: monitor.user_id,
        smart_groups: monitor.smart_groups || [],
        smart_group_labels: monitor.smart_group_labels || [],
      };
    });

    setTrackerKeywords(keywordKeywords);
    setTrackerMaxResults(config.max_results ?? 20);
    setTrackerKeywordMinLikes(firstKeywordMonitor?.min_likes ?? config.keyword_min_likes ?? 500);
    setTrackerKeywordLimit(firstKeywordMonitor?.per_keyword_limit ?? config.keyword_search_limit ?? 10);
    setTrackerEnableKeywordSearch(normalized.keywordMonitors.some((monitor) => monitor.enabled));
    setTrackerKeywordMonitors(normalized.keywordMonitors);
    setTrackerFollowingScan(normalized.followingScan);
    setTrackerFollowingScanMonitors(normalized.followingScanMonitors);
    setTrackerKeywordDraft(keywordKeywords.join(", "));
    setTrackerKeywordMonitorDrafts(Object.fromEntries(
      normalized.keywordMonitors.map((monitor) => [monitor.id, monitor.keywords[0] || ""])
    ));
    setTrackerFollowingScanMonitorDrafts(Object.fromEntries(
      normalized.followingScanMonitors.map((monitor) => [monitor.id, monitor.keywords[0] || ""])
    ));
    setTrackerFollowingScanKeywordDraft(formatKeywordInput(
      normalized.followingScanMonitors.flatMap((monitor) => monitor.keywords),
    ));
    setTrackerCreatorMonitors(normalized.creatorMonitors);
    setTrackerUserIds(normalized.creatorMonitors.map((monitor) => monitor.user_id).filter(Boolean));
    setDisabledCreatorIds(new Set(normalized.creatorMonitors.filter((monitor) => !monitor.enabled).map((monitor) => monitor.user_id)));
    setTrackerCreatorProfiles(creatorProfiles);
    setTrackerCreatorNameMap(config.creator_name_map || {});
    setTrackerCreatorGroups(config.creator_groups || []);
    setTrackerCreatorGroupOptions(config.creator_group_options || []);
    setTrackerCreatorPushEnabled(config.creator_push_enabled ?? false);
    setSharedSignalEntries(config.shared_signal_entries || []);
    setSharedCreatorGrouping(config.shared_creator_grouping || {});
  };

  const buildTrackerConfigPayload = (overrides: {
    keyword_monitors?: XHSTrackerKeywordMonitor[];
    following_scan?: XHSTrackerFollowingScan;
    following_scan_monitors?: XHSTrackerFollowingScanMonitor[];
    creator_monitors?: XHSTrackerCreatorMonitor[];
    creator_groups?: string[];
    creator_push_enabled?: boolean;
  } = {}) => ({
    keyword_monitors: overrides.keyword_monitors ?? trackerKeywordMonitors,
    following_scan: overrides.following_scan ?? trackerFollowingScan,
    following_scan_monitors: overrides.following_scan_monitors ?? trackerFollowingScanMonitors,
    creator_monitors: overrides.creator_monitors ?? trackerCreatorMonitors,
    creator_groups: overrides.creator_groups ?? trackerCreatorGroups,
    creator_push_enabled: overrides.creator_push_enabled ?? trackerCreatorPushEnabled,
    max_results: trackerMaxResults,
  });

  const buildKeywordMonitorsFromKeywords = (
    keywords: string[],
    currentMonitors: XHSTrackerKeywordMonitor[] = trackerKeywordMonitors,
  ): XHSTrackerKeywordMonitor[] => {
    const normalizedKeywords = parseKeywordInput(keywords.join(", "));
    const existingByKeyword = new Map<string, XHSTrackerKeywordMonitor>();
    currentMonitors.forEach((monitor) => {
      const firstKeyword = (monitor.keywords[0] || "").trim().toLowerCase();
      if (firstKeyword) {
        existingByKeyword.set(firstKeyword, monitor);
      }
    });

    return normalizedKeywords.map((keyword) => {
      const existing = existingByKeyword.get(keyword.toLowerCase());
      return createKeywordMonitor({
        id: existing?.id,
        label: keyword,
        keywords: [keyword],
        enabled: existing?.enabled ?? true,
        min_likes: existing?.min_likes ?? trackerKeywordMinLikes,
        per_keyword_limit: existing?.per_keyword_limit ?? trackerKeywordLimit,
        include_comments: existing?.include_comments ?? false,
        comments_limit: existing?.comments_limit ?? 20,
        comments_sort_by: existing?.comments_sort_by ?? "likes",
      });
    });
  };

  const applyKeywordDraftToMonitors = (draftText: string) => {
    const keywords = parseKeywordInput(draftText);
    const nextMonitors = buildKeywordMonitorsFromKeywords(keywords);
    const normalizedDraft = formatKeywordInput(keywords);
    setTrackerKeywordDraft(normalizedDraft);
    setTrackerKeywords(keywords);
    setTrackerKeywordMonitors(nextMonitors);
    setTrackerKeywordMonitorDrafts(Object.fromEntries(
      nextMonitors.map((monitor) => [monitor.id, monitor.keywords[0] || ""])
    ));
    setTrackerEnableKeywordSearch(nextMonitors.some((monitor) => monitor.enabled));
    return nextMonitors;
  };

  const mergeKeywordsIntoKeywordMonitors = (keywords: string[]) => {
    const mergedKeywords = Array.from(new Set([
      ...trackerKeywordMonitors.flatMap((monitor) => monitor.keywords),
      ...parseKeywordInput(keywords.join(", ")),
    ]));
    return applyKeywordDraftToMonitors(formatKeywordInput(mergedKeywords));
  };

  const normalizeSingleKeywordDraft = (value: string) => {
    const [firstKeyword] = parseKeywordInput(value);
    return firstKeyword || "";
  };

  const commitKeywordMonitorDraft = (monitorId: string, draftText?: string) => {
    const rawText = draftText ?? trackerKeywordMonitorDrafts[monitorId] ?? "";
    const normalizedKeyword = normalizeSingleKeywordDraft(rawText);
    const normalizedDraft = normalizedKeyword;
    const nextMonitors = trackerKeywordMonitors.map((monitor) => (
      monitor.id === monitorId
        ? {
            ...monitor,
            keywords: normalizedKeyword ? [normalizedKeyword] : [],
            label: normalizedKeyword || monitor.label,
          }
        : monitor
    )).filter((monitor) => monitor.keywords.length > 0);
    const mergedKeywords = Array.from(
      new Set(nextMonitors.flatMap((monitor) => monitor.keywords).filter(Boolean))
    );
    setTrackerKeywordMonitorDrafts((prev) => ({
      ...prev,
      [monitorId]: normalizedDraft,
    }));
    setTrackerKeywordMonitors(nextMonitors);
    setTrackerKeywords(mergedKeywords);
    setTrackerKeywordDraft(formatKeywordInput(mergedKeywords));
    setTrackerEnableKeywordSearch(nextMonitors.some((monitor) => monitor.enabled));
  };

  const buildFollowingScanMonitorsFromKeywords = (
    keywords: string[],
    currentMonitors: XHSTrackerFollowingScanMonitor[] = trackerFollowingScanMonitors,
  ): XHSTrackerFollowingScanMonitor[] => {
    const normalizedKeywords = parseKeywordInput(keywords.join(", "));
    const existingByKeyword = new Map<string, XHSTrackerFollowingScanMonitor>();
    currentMonitors.forEach((monitor) => {
      const firstKeyword = (monitor.keywords[0] || "").trim().toLowerCase();
      if (firstKeyword) {
        existingByKeyword.set(firstKeyword, monitor);
      }
    });
    return normalizedKeywords.map((keyword) => {
      const existing = existingByKeyword.get(keyword.toLowerCase());
      return createFollowingScanMonitor({
        id: existing?.id,
        label: keyword,
        keywords: [keyword],
        enabled: existing?.enabled ?? trackerFollowingScan.enabled ?? true,
        fetch_limit: existing?.fetch_limit ?? trackerFollowingScan.fetch_limit,
        recent_days: existing?.recent_days ?? trackerFollowingScan.recent_days,
        sort_by: existing?.sort_by ?? trackerFollowingScan.sort_by,
        keyword_filter: true,
        include_comments: existing?.include_comments ?? trackerFollowingScan.include_comments,
        comments_limit: existing?.comments_limit ?? trackerFollowingScan.comments_limit,
        comments_sort_by: existing?.comments_sort_by ?? trackerFollowingScan.comments_sort_by,
      });
    });
  };

  const syncFollowingScanFromMonitors = (
    monitors: XHSTrackerFollowingScanMonitor[],
    baseScan: XHSTrackerFollowingScan = trackerFollowingScan,
  ) => {
    const primaryMonitor = monitors.find((monitor) => monitor.enabled) || monitors[0];
    const activeKeywords = Array.from(new Set(
      monitors
        .filter((monitor) => monitor.enabled)
        .flatMap((monitor) => monitor.keywords)
        .filter(Boolean),
    ));
    setTrackerFollowingScan({
      ...baseScan,
      enabled: monitors.some((monitor) => monitor.enabled),
      keywords: activeKeywords,
      fetch_limit: primaryMonitor?.fetch_limit ?? baseScan.fetch_limit,
      recent_days: primaryMonitor?.recent_days ?? baseScan.recent_days,
      sort_by: primaryMonitor?.sort_by ?? baseScan.sort_by,
      keyword_filter: true,
      include_comments: primaryMonitor?.include_comments ?? baseScan.include_comments,
      comments_limit: primaryMonitor?.comments_limit ?? baseScan.comments_limit,
      comments_sort_by: primaryMonitor?.comments_sort_by ?? baseScan.comments_sort_by,
    });
  };

  const applyFollowingScanDraftToMonitors = (draftText: string) => {
    const keywords = parseKeywordInput(draftText);
    const nextMonitors = buildFollowingScanMonitorsFromKeywords(keywords);
    const normalizedDraft = formatKeywordInput(keywords);
    setTrackerFollowingScanKeywordDraft(normalizedDraft);
    setTrackerFollowingScanMonitors(nextMonitors);
    setTrackerFollowingScanMonitorDrafts(Object.fromEntries(
      nextMonitors.map((monitor) => [monitor.id, monitor.keywords[0] || ""])
    ));
    syncFollowingScanFromMonitors(nextMonitors);
    return nextMonitors;
  };

  const mergeKeywordsIntoFollowingScanMonitors = (keywords: string[]) => {
    const mergedKeywords = Array.from(new Set([
      ...trackerFollowingScanMonitors.flatMap((monitor) => monitor.keywords),
      ...parseKeywordInput(keywords.join(", ")),
    ]));
    return applyFollowingScanDraftToMonitors(formatKeywordInput(mergedKeywords));
  };

  const commitFollowingScanMonitorDraft = (monitorId: string, draftText?: string) => {
    const rawText = draftText ?? trackerFollowingScanMonitorDrafts[monitorId] ?? "";
    const normalizedKeyword = normalizeSingleKeywordDraft(rawText);
    const normalizedDraft = normalizedKeyword;
    const nextMonitors = trackerFollowingScanMonitors.map((monitor) => (
      monitor.id === monitorId
        ? createFollowingScanMonitor({
            ...monitor,
            label: normalizedKeyword || monitor.label,
            keywords: normalizedKeyword ? [normalizedKeyword] : [],
          })
        : monitor
    )).filter((monitor) => monitor.keywords.length > 0);
    const mergedKeywords = Array.from(new Set(nextMonitors.flatMap((monitor) => monitor.keywords).filter(Boolean)));
    setTrackerFollowingScanMonitorDrafts((prev) => ({
      ...prev,
      [monitorId]: normalizedDraft,
    }));
    setTrackerFollowingScanMonitors(nextMonitors);
    setTrackerFollowingScanKeywordDraft(formatKeywordInput(mergedKeywords));
    syncFollowingScanFromMonitors(nextMonitors);
  };

  const commitFollowingScanMonitorsForSave = () => {
    const committedMonitors = trackerFollowingScanMonitors
      .map((monitor) => {
        const normalizedKeyword = normalizeSingleKeywordDraft(
          trackerFollowingScanMonitorDrafts[monitor.id] ?? (monitor.keywords[0] || ""),
        );
        return createFollowingScanMonitor({
          ...monitor,
          label: normalizedKeyword || monitor.label,
          keywords: normalizedKeyword ? [normalizedKeyword] : [],
          keyword_filter: true,
        });
      })
      .filter((monitor) => monitor.keywords.length > 0);
    const mergedKeywords = Array.from(new Set(committedMonitors.flatMap((monitor) => monitor.keywords).filter(Boolean)));
    setTrackerFollowingScanMonitors(committedMonitors);
    setTrackerFollowingScanMonitorDrafts(Object.fromEntries(
      committedMonitors.map((monitor) => [monitor.id, monitor.keywords[0] || ""])
    ));
    setTrackerFollowingScanKeywordDraft(formatKeywordInput(mergedKeywords));
    syncFollowingScanFromMonitors(committedMonitors);
    return committedMonitors;
  };

  const handleRemoveFollowingScanMonitor = (monitorId: string) => {
    const nextMonitors = trackerFollowingScanMonitors.filter((monitor) => monitor.id !== monitorId);
    const mergedKeywords = Array.from(new Set(nextMonitors.flatMap((monitor) => monitor.keywords).filter(Boolean)));
    setTrackerFollowingScanMonitors(nextMonitors);
    setTrackerFollowingScanMonitorDrafts((prev) => {
      const next = { ...prev };
      delete next[monitorId];
      return next;
    });
    setTrackerFollowingScanKeywordDraft(formatKeywordInput(mergedKeywords));
    syncFollowingScanFromMonitors(nextMonitors);
  };

  const buildFollowingScanPayload = (
    monitors: XHSTrackerFollowingScanMonitor[] = trackerFollowingScanMonitors,
    scan: XHSTrackerFollowingScan = trackerFollowingScan,
  ) => {
    const normalizedMonitors = monitors.map((monitor) => createFollowingScanMonitor({
      ...monitor,
      keyword_filter: true,
    })).filter((monitor) => monitor.keywords.length > 0);
    const primaryMonitor = normalizedMonitors.find((monitor) => monitor.enabled) || normalizedMonitors[0];
    const activeKeywords = Array.from(new Set(
      normalizedMonitors
        .filter((monitor) => monitor.enabled)
        .flatMap((monitor) => monitor.keywords)
        .filter(Boolean),
    ));
    return {
      followingScanMonitors: normalizedMonitors,
      followingScan: createFollowingScan({
        ...scan,
        enabled: normalizedMonitors.some((monitor) => monitor.enabled),
        keywords: activeKeywords,
        fetch_limit: primaryMonitor?.fetch_limit ?? scan.fetch_limit,
        recent_days: primaryMonitor?.recent_days ?? scan.recent_days,
        sort_by: primaryMonitor?.sort_by ?? scan.sort_by,
        keyword_filter: true,
        include_comments: primaryMonitor?.include_comments ?? scan.include_comments,
        comments_limit: primaryMonitor?.comments_limit ?? scan.comments_limit,
        comments_sort_by: primaryMonitor?.comments_sort_by ?? scan.comments_sort_by,
      }),
    };
  };

  const commitKeywordMonitorsForSave = () => {
    const committedMonitors = trackerKeywordMonitors
      .map((monitor) => {
        const normalizedKeyword = normalizeSingleKeywordDraft(
          trackerKeywordMonitorDrafts[monitor.id] ?? (monitor.keywords[0] || ""),
        );
        return createKeywordMonitor({
          ...monitor,
          label: normalizedKeyword || monitor.label,
          keywords: normalizedKeyword ? [normalizedKeyword] : [],
        });
      })
      .filter((monitor) => monitor.keywords.length > 0);
    const mergedKeywords = Array.from(
      new Set(committedMonitors.flatMap((monitor) => monitor.keywords).filter(Boolean))
    );
    setTrackerKeywordMonitors(committedMonitors);
    setTrackerKeywordMonitorDrafts(Object.fromEntries(
      committedMonitors.map((monitor) => [monitor.id, monitor.keywords[0] || ""])
    ));
    setTrackerKeywords(mergedKeywords);
    setTrackerKeywordDraft(formatKeywordInput(mergedKeywords));
    setTrackerEnableKeywordSearch(committedMonitors.some((monitor) => monitor.enabled));
    return committedMonitors;
  };

  const handleRemoveKeywordMonitor = (monitorId: string) => {
    const nextMonitors = trackerKeywordMonitors.filter((monitor) => monitor.id !== monitorId);
    const mergedKeywords = Array.from(
      new Set(nextMonitors.flatMap((monitor) => monitor.keywords).filter(Boolean))
    );
    setTrackerKeywordMonitors(nextMonitors);
    setTrackerKeywordMonitorDrafts((prev) => {
      const next = { ...prev };
      delete next[monitorId];
      return next;
    });
    setTrackerKeywords(mergedKeywords);
    setTrackerKeywordDraft(formatKeywordInput(mergedKeywords));
    setTrackerEnableKeywordSearch(nextMonitors.some((monitor) => monitor.enabled));
  };

  const handleSaveSharedSignalMappings = async (mapping: Record<string, string[]>) => {
    setSavingSignalMappings(true);
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", {
        shared_creator_grouping: {
          signal_group_labels: Object.fromEntries(
            Object.entries(mapping)
              .map(([signal, labels]) => [
                signal.trim(),
                [...new Set((labels || []).map((label) => String(label || "").trim()).filter(Boolean))],
              ])
              .filter(([signal, labels]) => signal && Array.isArray(labels) && labels.length > 0)
          ),
        },
      });
      await refreshTrackerConfig();
      toast.success("Shared mapping saved", "The next \"shared smart grouping\" run will use this mapping first.");
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSavingSignalMappings(false);
    }
  };

  // Persist cookies
  useEffect(() => {
    writeStringStorage(XIAOHONGSHU_TOOL_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (webSession) {
      writeStringStorage("xiaohongshu_websession", webSession);
    } else {
      removeStorageKey("xiaohongshu_websession");
    }
  }, [webSession]);

  useEffect(() => {
    if (idToken) {
      writeStringStorage("xiaohongshu_idtoken", idToken);
    } else {
      removeStorageKey("xiaohongshu_idtoken");
    }
  }, [idToken]);

  useEffect(() => {
    if (fullCookie) {
      writeStringStorage("xiaohongshu_full_cookie", fullCookie);
    } else {
      removeStorageKey("xiaohongshu_full_cookie");
    }
  }, [fullCookie]);

  useEffect(() => {
    if (albums.length > 0) {
      writeJsonStorage("xiaohongshu_album_cache", albums);
    } else {
      removeStorageKey("xiaohongshu_album_cache");
    }
  }, [albums]);

  useEffect(() => {
    setAlbumPreviewFallbacks({});
  }, [albums]);

  useEffect(() => {
    void (async () => {
      try {
        const config = await xiaohongshuGetConfig();
        const configured = Boolean(config.cookie_configured);
        setBackendCookieConfigured(configured);
        if (configured || fullCookie.trim() || webSession.trim()) {
          setCookieVerified(true);
        } else {
          setShowCookieModal(true);
        }
      } catch {
        if (!fullCookie.trim() && !webSession.trim()) {
          setShowCookieModal(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const result = await xiaohongshuListTasks(20);
        setTaskHistory(result.tasks || []);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refreshTrackerConfig();
      } catch {
        // ignore
      }
    })();
  }, []);

  const buildCookie = () => {
    if (fullCookie.trim()) return fullCookie.trim();
    const parts = [];
    if (webSession.trim()) parts.push(`web_session=${webSession.trim()}`);
    if (idToken.trim()) parts.push(`id_token=${idToken.trim()}`);
    return parts.join("; ");
  };

  const requireCookie = (message = "Please configure the cookie first") => {
    if (hasCookie) return true;
    setShowCookieModal(true);
    toast.error(message);
    return false;
  };

  const isTaskRunning = (kind: string) => activeTaskKinds.has(kind);

  const setTaskRunning = (kind: string, running: boolean) => {
    setActiveTaskKinds((prev) => {
      const next = new Set(prev);
      if (running) next.add(kind);
      else next.delete(kind);
      return next;
    });
  };

  const searchRunning = isTaskRunning("search");
  const commentsRunning = isTaskRunning("comments");
  const followingRunning = isTaskRunning("following-feed");
  const creatorRecentRunning = isTaskRunning("creator-recent");
  const creatorRecentBatchRunning = isTaskRunning("creator-recent-batch");
  const crawlNoteRunning = isTaskRunning("crawl-note");
  const crawlBatchRunning = isTaskRunning("crawl-batch");
  const previewSaveRunning = isTaskRunning("save-previews");
  const smartGroupRunning = isTaskRunning("smart-groups");

  useEffect(() => {
    if (!followingRunning) {
      setFollowingFeedTaskId(null);
    }
  }, [followingRunning]);

  useEffect(() => {
    if (!creatorRecentRunning) {
      setCreatorRecentTaskId(null);
    }
  }, [creatorRecentRunning]);

  const runBackgroundTask = async <T,>(
    kind: string,
    start: () => Promise<{ success: boolean; task_id: string }>,
    onComplete: (result: T) => void,
    successMessage: (result: T) => { title: string; description?: string },
    onStarted?: (taskId: string) => void,
  ) => {
    if (isTaskRunning(kind)) {
      toast.info("Task already running", "Start a new one after the current task of this type finishes.");
      return;
    }
    setTaskRunning(kind, true);
    try {
      const started = await start();
      onStarted?.(started.task_id);
      setBackgroundTask({ kind, stage: "Task created", taskId: started.task_id });
      setTaskHistory((prev) => [
        {
          task_id: started.task_id,
          kind,
          status: "running" as const,
          stage: "Task created",
          result: null,
          error: null,
        },
        ...prev.filter((item) => item.task_id !== started.task_id),
      ].slice(0, 20));

      const poll = async () => {
        try {
          const progress = await xiaohongshuGetTaskStatus<T>(started.task_id);
          setBackgroundTask({ kind, stage: progress.stage, taskId: started.task_id });
          if (progress.status === "completed" && progress.result) {
            onComplete(progress.result);
            const msg = successMessage(progress.result);
            toast.success(msg.title, msg.description);
            setTaskHistory((prev) => [progress, ...prev.filter((item) => item.task_id !== progress.task_id)].slice(0, 20));
            setBackgroundTask(null);
            setTaskRunning(kind, false);
            return;
          }
          if (progress.status === "failed") {
            toast.error("Background task failed", progress.error || "Unknown error");
            setTaskHistory((prev) => [progress, ...prev.filter((item) => item.task_id !== progress.task_id)].slice(0, 20));
            setBackgroundTask(null);
            setTaskRunning(kind, false);
            return;
          }
          if (progress.status === "cancelled" || progress.status === "interrupted") {
            toast.info("Task stopped", progress.stage || "Interrupted");
            setTaskHistory((prev) => [progress, ...prev.filter((item) => item.task_id !== progress.task_id)].slice(0, 20));
            setBackgroundTask(null);
            setTaskRunning(kind, false);
            return;
          }
          window.setTimeout(poll, 1000);
        } catch (err) {
          toast.error("Failed to read background progress", err instanceof Error ? err.message : "Unknown error");
          setBackgroundTask(null);
          setTaskRunning(kind, false);
        }
      };

      window.setTimeout(poll, 300);
    } catch (err) {
      setTaskRunning(kind, false);
      setBackgroundTask(null);
      throw err;
    }
  };

  const normalizeFollowingLimit = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 20;
    return Math.max(1, Math.min(300, Math.round(parsed)));
  };

  const scrollToAnchor = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollNoteCarousel = (ref: React.RefObject<HTMLDivElement | null>, direction: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(320, el.clientWidth - 80), behavior: "smooth" });
  };

  useEffect(() => {
    const handleNoteCarouselKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const direction = key === "arrowleft" || key === "q" ? -1 : key === "arrowright" || key === "e" ? 1 : 0;
      if (!direction) return;

      const activeCarouselRef = activeTab === "following"
        ? followingResultCarouselRef
        : activeTab === "search"
          ? searchResultCarouselRef
          : (creatorRecentResultCarouselRef.current ? creatorRecentResultCarouselRef : creatorBatchResultCarouselRef.current ? creatorBatchResultCarouselRef : null);
      if (!activeCarouselRef?.current) return;

      event.preventDefault();
      scrollNoteCarousel(activeCarouselRef, direction as -1 | 1);
    };

    document.addEventListener("keydown", handleNoteCarouselKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleNoteCarouselKeyDown, { capture: true });
  }, [activeTab]);

  const handleGetCookieFromBrowser = async (browser: BrowserChoice = albumCookieBrowser) => {
    setGettingCookie(true);
    try {
      const res = await xiaohongshuGetCookieFromBrowser({ browser });
      if (!res.success) {
        toast.error("One-click fetch failed", res.error || "Log in to Xiaohongshu in your local browser first");
        return;
      }

      if (res.cookie) setFullCookie(res.cookie);
      if (res.web_session) setWebSession(res.web_session);
      if (res.id_token) setIdToken(res.id_token);
      setBackendCookieConfigured(true);
      setCookieVerified(Boolean(res.web_session || res.cookie));
      setShowCookieModal(false);
      toast.success("Cookie saved", res.message || `Got ${res.cookie_count || 0} cookies`);
    } catch (err) {
      toast.error("One-click fetch failed", err instanceof Error ? err.message : "Check that the browser is logged in");
    } finally {
      setGettingCookie(false);
    }
  };

  const handleClearXhsLocalCache = () => {
    removeStorageKey("xiaohongshu_album_cache");
    removeStorageKey("xiaohongshu_websession");
    removeStorageKey("xiaohongshu_idtoken");
    removeStorageKey("xiaohongshu_full_cookie");
    setAlbums([]);
    setSelectedAlbumIds(new Set());
    setAlbumResult(null);
    setAlbumListProgress(null);
    setAlbumProgress(null);
    setWebSession("");
    setIdToken("");
    setFullCookie("");
    setCookieVerified(false);
    setBackendCookieConfigured(false);
    toast.success("Local cache cleared", "ABO's saved Xiaohongshu album and cookie caches were cleared. Log in again and update the cookie");
  };

  const handleVerifyCookie = async () => {
    if (!webSession.trim()) {
      toast.error("Please enter web_session");
      return;
    }
    setVerifying(true);
    try {
      const res = await xiaohongshuVerifyCookie({
        web_session: webSession.trim(),
        id_token: idToken.trim() || undefined,
      });
      if (res.valid) {
        const cookieToSave = buildCookie();
        if (cookieToSave) {
          await xiaohongshuSaveConfig({ cookie: cookieToSave });
        }
        setCookieVerified(true);
        setBackendCookieConfigured(true);
        setShowCookieModal(false);
        toast.success("Cookie verified", res.message);
      } else {
        setCookieVerified(false);
        toast.error("Cookie verification failed", res.message);
      }
    } catch (err) {
      setCookieVerified(false);
      toast.error("Verification failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setVerifying(false);
    }
  };

  const handleSearch = async () => {
    if (!searchKeyword.trim()) {
      toast.error("Please enter keywords");
      return;
    }
    if (!requireCookie()) {
      return;
    }
    try {
      const shouldAutoSave = searchAutoSaveAfterFetch;
      await runBackgroundTask<SearchResponse>(
        "search",
        () => xiaohongshuStartSearchTask({
          keyword: searchKeyword.trim(),
          max_results: Math.max(1, Math.min(300, searchLimit || 20)),
          min_likes: minLikes,
          sort_by: "comprehensive",
          recent_days: Math.max(1, Math.min(365, searchRecentDays || DEFAULT_XHS_RECENT_DAYS)),
          cookie: buildCookie() || undefined,
          ...xhsBridgeOptions,
        }),
        (result) => {
          setSearchResult(result);
          setShowSearchResults(true);
          if (shouldAutoSave && result.notes.length > 0) {
            void handleSaveSearchResults(result.notes, result.keyword);
          }
        },
        (result) => ({ title: `Found ${result.total_found} results` }),
      );
    } catch (e) {
      console.error("Search failed:", e);
      toast.error("Search failed", e instanceof Error ? e.message : "Configure a valid cookie first");
    }
  };

  const handleComments = async () => {
    if (!noteId.trim()) {
      toast.error("Please enter a note ID");
      return;
    }
    if (!requireCookie()) {
      return;
    }
    try {
      const raw = noteId.trim();
      const noteUrl = raw.startsWith("http://") || raw.startsWith("https://") ? raw : undefined;
      const normalizedId = noteUrl ? raw.split("/explore/").pop()?.split("?")[0] || raw : raw;
      await runBackgroundTask<CommentsResponse>(
        "comments",
        () => xiaohongshuStartCommentsTask({
          note_id: normalizedId,
          note_url: noteUrl,
          max_comments: 50,
          sort_by: "likes",
          cookie: buildCookie() || undefined,
          ...xhsBridgeOptions,
          load_all_comments: true,
          click_more_replies: true,
          max_replies_threshold: 10,
        }),
        (result) => setCommentsResult(result),
        (result) => ({ title: `Fetched ${result.total_comments} comments` }),
      );
    } catch (e) {
      console.error("Fetch comments failed:", e);
      toast.error("Failed to fetch comments");
    }
  };

  const handleFollowingFeed = async () => {
    if (!followingKeywords.trim()) {
      toast.error("Please enter keywords");
      return;
    }
    if (!requireCookie()) {
      return;
    }
    try {
      const keywords = parseKeywordInput(followingKeywords);
      const keywordLabel = keywords.join("，") || followingKeywords.trim();
      const shouldAutoSave = followingAutoSaveAfterFetch;
      await runBackgroundTask<FollowingFeedResponse>(
        "following-feed",
        () => xiaohongshuStartFollowingFeedTask({
          cookie: buildCookie() || undefined,
          keywords,
          max_notes: normalizeFollowingLimit(followingLimit),
          recent_days: Math.max(1, Math.min(365, followingRecentDays || DEFAULT_XHS_RECENT_DAYS)),
          sort_by: "time",
          ...xhsBridgeOptions,
        }),
        (result) => {
          setFollowingResult(result);
          setShowFollowingResults(true);
          setExpandedFollowingNotes(new Set());
          if (shouldAutoSave && result.notes.length > 0) {
            void handleSaveFollowingResults(result.notes, keywordLabel);
          }
        },
        (result) => ({ title: `Found ${result.total_found} matches in the followed filter` }),
        (taskId) => setFollowingFeedTaskId(taskId),
      );
    } catch (e) {
      console.error("Failed to fetch follow-feed keyword results:", e);
      setFollowingFeedTaskId(null);
      toast.error("Failed to fetch follow-feed keyword results", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const runCreatorRecentFetch = async (
    nextCreatorQuery = creatorSearchQuery,
    overrides: { recentDays?: number; maxNotes?: number } = {},
  ) => {
    const trimmedQuery = String(nextCreatorQuery || "").trim();
    if (!trimmedQuery) {
      toast.error("Enter a blogger name, profile link, or user_id");
      return;
    }
    if (!requireCookie()) {
      return;
    }
    const recentDays = Math.max(1, Math.min(365, overrides.recentDays ?? creatorRecentDays ?? DEFAULT_XHS_RECENT_DAYS));
    const maxNotes = Math.max(1, Math.min(50, overrides.maxNotes ?? creatorRecentLimit ?? 10));
    const shouldAutoSave = creatorRecentAutoSaveAfterFetch;
    setCreatorSearchQuery(trimmedQuery);
    setCreatorRecentDays(recentDays);
    setCreatorRecentLimit(maxNotes);
    setShowCreatorRecentWorkbench(true);
    setCreatorRecentResult(null);
    setCreatorBatchResults([]);
    try {
      await runBackgroundTask<XHSCreatorRecentResponse>(
        "creator-recent",
        () => xiaohongshuStartCreatorRecentTask({
          creator_query: trimmedQuery,
          cookie: buildCookie() || undefined,
          recent_days: recentDays,
          max_notes: maxNotes,
          use_extension: true,
          extension_port: albumExtensionPort,
          dedicated_window_mode: albumDedicatedWindowMode,
          manual_current_tab: false,
          require_extension_success: true,
        }),
        (result) => {
          setCreatorRecentResult(result);
          setCreatorRecentTaskId(null);
          focusCreatorRecentResults();
          if (shouldAutoSave && result.notes.length > 0) {
            void handleSaveCreatorRecentNotes(
              result.notes,
              result.resolved_author || result.creator_query,
              "Blogger's recent posts saved",
              result.resolved_user_id,
            );
          }
        },
        (result) => ({
          title: `${resolveCreatorDisplayLabel(
            result.resolved_author || result.creator_query,
            result.notes,
            result.resolved_user_id,
          )} last ${result.recent_days} days, ${result.total_found} items`,
        }),
        (taskId) => setCreatorRecentTaskId(taskId),
      );
    } catch (e) {
      console.error("Failed to crawl the specified blogger:", e);
      setCreatorRecentTaskId(null);
      toast.error("Failed to crawl the specified blogger", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleFetchCreatorRecent = async () => {
    await runCreatorRecentFetch();
  };

  const waitForTaskResult = async <T,>(taskId: string): Promise<T> => {
    while (true) {
      const progress = await xiaohongshuGetTaskStatus<T>(taskId);
      if (progress.status === "completed" && progress.result) {
        return progress.result;
      }
      if (progress.status === "failed") {
        throw new Error(progress.error || progress.stage || "Task execution failed");
      }
      if (progress.status === "cancelled" || progress.status === "interrupted") {
        throw new Error(progress.stage || "Task stopped");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 800));
    }
  };

  const fetchCreatorRecentDirect = async (
    creatorQuery: string,
    recentDays: number,
    maxNotes: number,
  ): Promise<XHSCreatorRecentResponse> => {
    const started = await xiaohongshuStartCreatorRecentTask({
      creator_query: creatorQuery,
      cookie: buildCookie() || undefined,
      recent_days: recentDays,
      max_notes: maxNotes,
      use_extension: true,
      extension_port: albumExtensionPort,
      dedicated_window_mode: albumDedicatedWindowMode,
      manual_current_tab: false,
      require_extension_success: true,
    });
    return waitForTaskResult<XHSCreatorRecentResponse>(started.task_id);
  };

  const handleCancelFollowingFeed = async () => {
    if (!followingFeedTaskId) return;
    try {
      await xiaohongshuCancelTask(followingFeedTaskId);
      toast.info("Stop signal sent", "Follow-feed keyword search is being interrupted.");
    } catch (e) {
      toast.error("Stop failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleCancelCreatorRecent = async () => {
    if (!creatorRecentTaskId) return;
    try {
      await xiaohongshuCancelTask(creatorRecentTaskId);
      toast.info("Stop signal sent", "Targeted creator crawl is being interrupted.");
    } catch (e) {
      toast.error("Stop failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleCrawlNote = async () => {
    if (!crawlUrl.trim()) {
      toast.error("Please enter a Xiaohongshu note link");
      return;
    }
    if (!requireCookie()) {
      return;
    }
    try {
      await runBackgroundTask<CrawlNoteResponse>(
        "crawl-note",
        () => xiaohongshuStartCrawlNoteTask({
          url: crawlUrl.trim(),
          cookie: buildCookie() || undefined,
          include_images: includeImages,
          include_video: includeVideo,
          include_live_photo: includeLivePhoto,
          include_comments: includeComments,
          comments_limit: commentsLimit,
          ...xhsCrawlFallbackOptions,
        }),
        (result) => setCrawlResult(result),
        (result) => ({
          title: "Saved to xhs/主动保存",
          description: formatLibraryLocation(result.markdown_path, "vault", config),
        }),
      );
    } catch (e) {
      console.error("Crawl note failed:", e);
      toast.error("Save failed", e instanceof Error ? e.message : "Check the link, cookie, or local browser debug port");
    }
  };

  const handleCrawlBatch = async (urls?: string[]) => {
    const targetUrls = urls || batchUrls.split(/\n+/).map((item) => item.trim()).filter(Boolean);
    if (targetUrls.length === 0) {
      toast.error("Enter at least one Xiaohongshu link");
      return;
    }
    if (!requireCookie()) {
      return;
    }
    try {
      await runBackgroundTask<CrawlBatchResponse>(
        "crawl-batch",
        () => xiaohongshuStartCrawlBatchTask({
          urls: targetUrls,
          cookie: buildCookie() || undefined,
          include_images: includeImages,
          include_video: includeVideo,
          include_live_photo: includeLivePhoto,
          include_comments: includeComments,
          comments_limit: commentsLimit,
          ...xhsCrawlFallbackOptions,
        }),
        (result) => setBatchResult(result),
        (result) => {
          const firstSavedResult = result.results.find((item): item is CrawlNoteResponse => item.success === true);
          return {
            title: "Bulk save finished",
            description: withLocationSuffix(
              `${result.saved} succeeded, ${result.failed} failed`,
              firstSavedResult?.xhs_dir || firstSavedResult?.markdown_path,
              "vault",
              config,
            ),
          };
        },
      );
    } catch (e) {
      console.error("Crawl batch failed:", e);
      toast.error("Bulk save failed", e instanceof Error ? e.message : "Check the links or cookie");
    }
  };

  const buildSaveSubfolderName = (raw: string, fallback: string) => {
    const compact = raw.trim().replace(/\s+/g, " ");
    return compact || fallback;
  };

  const buildKeywordSaveSubfolder = (keyword: string) => buildSaveSubfolderName(
    `关键词扫描/${keyword}`,
    "关键词扫描/未命名关键词",
  );

  const buildFollowingSaveSubfolder = (keywordLabel: string) => buildSaveSubfolderName(
    `关注流扫描/${keywordLabel}`,
    "关注流扫描/未命名关键词",
  );

  const buildCreatorSaveSubfolder = (
    rawLabel: string,
    notes: XHSNote[] = [],
    explicitAuthorId?: string | null,
  ) => buildSaveSubfolderName(
    `指定用户扫描/${resolveCreatorDisplayLabel(rawLabel, notes, explicitAuthorId)}`,
    "指定用户扫描/未命名用户",
  );

  const keywordLabelFromFollowingResult = (result: FollowingFeedResponse, fallback: string) => {
    const keywords = Array.from(new Set(
      result.notes.flatMap((note) => note.matched_keywords || []).map((keyword) => keyword.trim()).filter(Boolean),
    ));
    return keywords.join("，") || parseKeywordInput(fallback).join("，") || fallback;
  };

  const focusCreatorRecentResults = () => {
    setExpandedCreatorSelectorGroups(new Set());
    setShowCreatorRecentWorkbench(false);
  };

  const handleSavePreviewNotesWithOptions = async (
    notes: XHSNote[],
    options: {
      subfolder?: string;
      successTitle?: string;
      includeComments?: boolean;
      commentsLimit?: number;
      commentsSortBy?: "likes" | "time";
      emptyMessage?: string;
    },
  ) => {
    const targetNotes = notes.filter((note) => note.url);
    if (targetNotes.length === 0) {
      toast.error(options.emptyMessage || "No search results to save");
      return;
    }
    if (previewSaveRunning) {
      toast.info("Preview save already running");
      return;
    }
    setTaskRunning("save-previews", true);
    try {
      const result = await xiaohongshuSavePreviews({
        notes: targetNotes,
        subfolder: options.subfolder,
        ...xhsCrawlFallbackOptions,
        download_images_mode: "always",
        save_strategy: "card",
        short_content_threshold: 120,
        include_comments: Boolean(options.includeComments),
        comments_limit: options.includeComments ? Math.max(1, options.commentsLimit || 20) : 0,
        comments_sort_by: options.includeComments ? (options.commentsSortBy || "likes") : "likes",
      });
      const status: XHSTaskStatus["status"] = result.failed > 0 ? "failed" : "completed";
      toast.success(
        options.successTitle || "Saved to xhs/主动保存",
        withLocationSuffix(`${result.saved} succeeded, ${result.failed} failed`, result.xhs_dir, "vault", config),
      );
      setTaskHistory((prev) => [
        {
          task_id: `preview-${Date.now()}`,
          kind: "save-previews",
          status,
          stage: `Unified save finished: ${result.saved} succeeded, ${result.failed} failed`,
          result,
          error: result.failed > 0 ? "Some search results failed to save" : null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, 20));
    } catch (e) {
      toast.error("Preview save failed", e instanceof Error ? e.message : "Check the Intel Library path");
    } finally {
      setTaskRunning("save-previews", false);
    }
  };

  const handleSaveCreatorRecentNotes = async (
    notes: XHSNote[],
    rawSubfolder: string,
    successTitle: string,
    explicitAuthorId?: string | null,
  ) => {
    await handleSavePreviewNotesWithOptions(notes, {
      subfolder: buildCreatorSaveSubfolder(rawSubfolder, notes, explicitAuthorId),
      successTitle,
      emptyMessage: "No blogger posts to save",
    });
  };

  const handleSaveSearchResults = async (notes: XHSNote[], keyword: string) => {
    await handleSavePreviewNotesWithOptions(notes, {
      subfolder: buildKeywordSaveSubfolder(keyword),
      successTitle: "Keyword results saved",
      includeComments: searchSaveComments,
      commentsLimit: searchSaveCommentsLimit,
      commentsSortBy: searchSaveCommentsSortBy,
      emptyMessage: "No keyword results to save",
    });
  };

  const handleSaveFollowingResults = async (notes: XHSNote[], keywordLabel: string) => {
    await handleSavePreviewNotesWithOptions(notes, {
      subfolder: buildFollowingSaveSubfolder(keywordLabel),
      successTitle: "Follow-feed search results saved",
      includeComments: searchSaveComments,
      commentsLimit: searchSaveCommentsLimit,
      commentsSortBy: searchSaveCommentsSortBy,
      emptyMessage: "No follow-feed results to save",
    });
  };

  const handleFetchAlbums = async () => {
    if (albumListTaskId) {
      try {
        await api.post(`/api/tools/xiaohongshu/albums/tasks/${albumListTaskId}/cancel`, {});
        if (albumListTimerRef.current) window.clearInterval(albumListTimerRef.current);
        albumListTimerRef.current = null;
        setAlbumListProgress((prev: any) => ({ ...(prev || {}), status: "cancelled", stage: "Interrupted" }));
        setAlbumListTaskId(null);
        toast.info("Album reading interrupted");
      } catch (e) {
        toast.error("Interrupt failed", e instanceof Error ? e.message : "Unknown error");
      }
      return;
    }
    if (!requireCookie()) {
      return;
    }
    try {
      const started = await api.post<{ success: boolean; task_id: string }>("/api/tools/xiaohongshu/albums/start", {
        cookie: buildCookie() || undefined,
        cdp_port: 9222,
        background: !albumDedicatedWindowMode,
        allow_cdp_fallback: false,
        ...xhsBridgeOptions,
      });
      setAlbumListTaskId(started.task_id);
      setAlbumListProgress({ status: "running", stage: "Task created", albums_total: 0 });
      const timer = window.setInterval(async () => {
        try {
          const progress = await api.get<any>(`/api/tools/xiaohongshu/albums/${started.task_id}`);
          setAlbumListProgress(progress);
          if (progress.status === "completed") {
            window.clearInterval(timer);
            albumListTimerRef.current = null;
            const result = progress.result as XHSAlbumListResponse;
            const normalizedAlbums = normalizeAlbumPreviews(result.albums);
            setAlbums(normalizedAlbums);
            setSelectedAlbumIds(new Set(normalizedAlbums.map((album) => album.board_id)));
            setAlbumListTaskId(null);
            if (normalizedAlbums.length > 0) toast.success(`Found ${normalizedAlbums.length} albums`);
            else toast.info("No albums found", result.message);
          } else if (progress.status === "cancelled") {
            window.clearInterval(timer);
            albumListTimerRef.current = null;
            setAlbumListTaskId(null);
          } else if (progress.status === "failed") {
            window.clearInterval(timer);
            albumListTimerRef.current = null;
            setAlbumListTaskId(null);
            toast.error("Failed to fetch albums", progress.error || "Unknown error");
          }
        } catch (err) {
          window.clearInterval(timer);
          albumListTimerRef.current = null;
          setAlbumListTaskId(null);
          toast.error("Failed to read progress", err instanceof Error ? err.message : "Unknown error");
        }
      }, 800);
      albumListTimerRef.current = timer;
    } catch (e) {
      setAlbumListTaskId(null);
      console.error("Fetch albums failed:", e);
      toast.error("Failed to fetch albums", e instanceof Error ? e.message : "Open your profile's bookmark album page in the browser first");
    }
  };

  const toggleAlbumSelection = (boardId: string) => {
    setSelectedAlbumIds((prev) => {
      const next = new Set(prev);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
  };

  const handleCrawlSelectedAlbums = async (mode: AlbumCrawlMode = albumCrawlMode) => {
    if (albumCrawlTaskId) {
      try {
        await api.post(`/api/tools/xiaohongshu/albums/tasks/${albumCrawlTaskId}/cancel`, {});
        if (albumCrawlTimerRef.current) window.clearInterval(albumCrawlTimerRef.current);
        albumCrawlTimerRef.current = null;
        setAlbumProgress((prev: any) => ({ ...(prev || {}), status: "cancelled", stage: "Interrupted" }));
        setAlbumCrawlTaskId(null);
        toast.info("Album crawl interrupted");
      } catch (e) {
        toast.error("Interrupt failed", e instanceof Error ? e.message : "Unknown error");
      }
      return;
    }
    const selected = albums.filter((album) => selectedAlbumIds.has(album.board_id));
    if (selected.length === 0) {
      toast.error("Select at least one album");
      return;
    }
    if (!requireCookie()) {
      return;
    }
    try {
      const started = await api.post<{ success: boolean; task_id: string }>("/api/tools/xiaohongshu/albums/crawl", {
        albums: selected,
        cookie: buildCookie() || undefined,
        include_images: includeImages,
        include_video: includeVideo,
        include_live_photo: includeLivePhoto,
        include_comments: includeComments,
        comments_limit: commentsLimit,
        recent_days: mode === "full"
          ? undefined
          : (() => {
              const raw = albumRecentDaysInput.trim();
              if (!raw) return undefined;
              const next = Number(raw);
              if (!Number.isFinite(next)) return undefined;
              return Math.max(1, Math.min(3650, next));
            })(),
        crawl_mode: mode,
        batch_size: albumRecoveryMode ? Math.max(1, Math.min(20, albumBatchSize || 5)) : undefined,
        batch_pause_seconds: albumRecoveryMode ? Math.max(10, Math.min(180, albumBatchPauseSeconds || 30)) : undefined,
        cdp_port: 9222,
        ...xhsBridgeOptions,
      });
      setAlbumCrawlTaskId(started.task_id);
      setAlbumProgress({ status: "running", stage: "Task created", total_albums: selected.length, saved: 0, skipped: 0, failed: 0 });
      const timer = window.setInterval(async () => {
        try {
          const progress = await api.get<any>(`/api/tools/xiaohongshu/albums/crawl/${started.task_id}`);
          setAlbumProgress(progress);
          if (progress.status === "completed") {
            window.clearInterval(timer);
            albumCrawlTimerRef.current = null;
            setAlbumResult(progress.result);
            setAlbumCrawlTaskId(null);
            const failedCount = Number(progress.result?.failed || 0);
            const savedCount = Number(progress.result?.saved || 0);
            const skippedCount = Number(progress.result?.skipped || 0);
            const firstFailedItem = Array.isArray(progress.result?.results)
              ? progress.result.results.find((item: any) => !item?.success)
              : null;
            const failureDetail = firstFailedItem?.error ? `; reason: ${firstFailedItem.error}` : "";
            if (failedCount > 0) {
              toast.error(
                `Album ${mode === "full" ? "full" : "incremental"} crawl ended`,
                withLocationSuffix(
                  `Added ${savedCount}, skipped ${skippedCount}, failed ${failedCount}; current album list kept${failureDetail}`,
                  dirnamePath(progress.result?.progress_path),
                  "vault",
                  config,
                ),
              );
            } else {
              toast.success(
                `Album ${mode === "full" ? "full" : "incremental"} crawl finished`,
                withLocationSuffix(
                  `Added ${savedCount}, skipped ${skippedCount}; current album list kept`,
                  dirnamePath(progress.result?.progress_path),
                  "vault",
                  config,
                ),
              );
            }
          } else if (progress.status === "cancelled") {
            window.clearInterval(timer);
            albumCrawlTimerRef.current = null;
            setAlbumCrawlTaskId(null);
          } else if (progress.status === "failed") {
            window.clearInterval(timer);
            albumCrawlTimerRef.current = null;
            setAlbumCrawlTaskId(null);
            toast.error("Album crawl failed", progress.error || "Unknown error");
          }
        } catch (err) {
          window.clearInterval(timer);
          albumCrawlTimerRef.current = null;
          setAlbumCrawlTaskId(null);
          toast.error("Failed to read progress", err instanceof Error ? err.message : "Unknown error");
        }
      }, 1200);
      albumCrawlTimerRef.current = timer;
    } catch (e) {
      setAlbumCrawlTaskId(null);
      console.error("Crawl albums failed:", e);
      toast.error("Album crawl failed", e instanceof Error ? e.message : "Confirm the album page is accessible");
    }
  };

  const handleSaveTrackerKeywords = async () => {
    try {
      const draftKeywords = parseKeywordInput(trackerKeywordDraft);
      const nextKeywordMonitors = draftKeywords.length > 0
        ? applyKeywordDraftToMonitors(trackerKeywordDraft)
        : commitKeywordMonitorsForSave();
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        keyword_monitors: nextKeywordMonitors,
      }));
      toast.success("Intel push saved", "Module management will crawl these definitions on schedule");
      await refreshTrackerConfig();
      setExpandedPushes((prev) => new Set(prev).add("keyword"));
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleToggleKeywordPush = async () => {
    const draftKeywords = parseKeywordInput(trackerKeywordDraft);
    const existingMonitors = draftKeywords.length > 0
      ? applyKeywordDraftToMonitors(trackerKeywordDraft)
      : commitKeywordMonitorsForSave();
    if (existingMonitors.length === 0) {
      toast.error("Add at least one keyword definition first");
      return;
    }
    const next = !trackerEnableKeywordSearch;
    const nextKeywordMonitors = existingMonitors.map((monitor) => ({
      ...monitor,
      enabled: next,
    }));
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        keyword_monitors: nextKeywordMonitors,
      }));
      await refreshTrackerConfig();
      toast.success(next ? "Intel push enabled" : "Intel push disabled");
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleDeleteKeywordPush = async () => {
    try {
      setTrackerKeywordDraft("");
      setTrackerKeywordMonitorDrafts({});
      setTrackerKeywordMonitors([]);
      setTrackerKeywords([]);
      setTrackerEnableKeywordSearch(false);
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        keyword_monitors: [],
      }));
      await refreshTrackerConfig();
      setExpandedPushes((prev) => {
        const next = new Set(prev);
        next.delete("keyword");
        return next;
      });
      toast.success("Intel push deleted");
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleToggleCreatorPush = async () => {
    const baseCreatorMonitors = trackerCreatorMonitors.length > 0 ? trackerCreatorMonitors : creatorEntries;
    const next = !baseCreatorMonitors.some((monitor) => monitor.enabled);
    const nextCreatorMonitors = baseCreatorMonitors.map((monitor) => ({ ...monitor, enabled: next }));
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        creator_monitors: nextCreatorMonitors,
        creator_push_enabled: next,
      }));
      await refreshTrackerConfig();
      toast.success(next ? "All bloggers enabled" : "All bloggers disabled");
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleDeleteCreatorPush = async () => {
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        creator_monitors: [],
        creator_groups: [],
        creator_push_enabled: false,
      }));
      await refreshTrackerConfig();
      setExpandedPushes((prev) => {
        const next = new Set(prev);
        next.delete("creator");
        return next;
      });
      toast.success("Targeted follow deleted");
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleToggleCreatorUser = async (userId: string) => {
    const normalizedUserId = normalizeXhsProfileUserId(userId);
    const baseCreatorMonitors = trackerCreatorMonitors.length > 0 ? trackerCreatorMonitors : creatorEntries;
    const nextCreatorMonitors = baseCreatorMonitors.map((monitor) => (
      normalizeXhsProfileUserId(monitor.user_id) === normalizedUserId
        ? { ...monitor, enabled: !monitor.enabled }
        : monitor
    ));
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        creator_monitors: nextCreatorMonitors,
      }));
      await refreshTrackerConfig();
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleRemoveCreatorUser = async (userId: string) => {
    const normalizedUserId = normalizeXhsProfileUserId(userId);
    const baseCreatorMonitors = trackerCreatorMonitors.length > 0 ? trackerCreatorMonitors : creatorEntries;
    const nextCreatorMonitors = baseCreatorMonitors.filter((monitor) => normalizeXhsProfileUserId(monitor.user_id) !== normalizedUserId);
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        creator_monitors: nextCreatorMonitors,
      }));
      await refreshTrackerConfig();
      toast.success("Blogger removed");
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleRemoveCreatorMonitor = async (creatorMonitor: XHSTrackerCreatorMonitor) => {
    if (creatorMonitor.user_id) {
      await handleRemoveCreatorUser(creatorMonitor.user_id);
      return;
    }
    const nextCreatorMonitors = trackerCreatorMonitors.filter((monitor) => monitor.id !== creatorMonitor.id);
    setTrackerCreatorMonitors(nextCreatorMonitors);
  };

  const handleClearCreatorMonitors = async (scope: "all" | "filtered" | "page") => {
    const baseCreatorMonitors = trackerCreatorMonitors.length > 0 ? trackerCreatorMonitors : creatorEntries;
    const removeIds = new Set(
      (scope === "all" ? baseCreatorMonitors : scope === "filtered" ? filteredCreatorEntries : visibleCreatorEntries)
        .map((monitor) => monitor.id),
    );
    if (removeIds.size === 0) {
      toast.info("No follows to delete");
      return;
    }
    const nextCreatorMonitors = scope === "all"
      ? []
      : baseCreatorMonitors.filter((monitor) => !removeIds.has(monitor.id));
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        creator_monitors: nextCreatorMonitors,
        creator_push_enabled: nextCreatorMonitors.length > 0 ? trackerCreatorPushEnabled : false,
      }));
      await refreshTrackerConfig();
      setCreatorMonitorPage(0);
      toast.success("Follows bulk-deleted", `Removed ${removeIds.size} bloggers`);
    } catch (e) {
      toast.error("Bulk delete failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleImportCreatorGroup = async (groupValue: string) => {
    const group = visibleSharedCreatorGroups.find((item) => item.value === groupValue);
    if (!group) return;
    const currentMonitors = trackerCreatorMonitors.length > 0 ? trackerCreatorMonitors : creatorEntries;
    const existingIds = new Set(currentMonitors.map((monitor) => normalizeXhsProfileUserId(monitor.user_id)).filter(Boolean));
    const importedMonitors = group.members
      .filter((member) => member.authorId && !existingIds.has(normalizeXhsProfileUserId(member.authorId)))
      .map((member) => createCreatorMonitor({
        user_id: member.authorId,
        label: member.author,
        author: member.author,
        enabled: true,
        smart_groups: member.profile.smart_groups || [],
        smart_group_labels: member.profile.smart_group_labels || [],
      }));
    if (importedMonitors.length === 0) {
      toast.info("All bloggers in this smart group are already added");
      return;
    }
    const nextCreatorMonitors = [...currentMonitors, ...importedMonitors];
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        creator_monitors: nextCreatorMonitors,
      }));
      await refreshTrackerConfig();
      setCreatorMonitorGroupFilter(groupValue);
      setCreatorMonitorPage(0);
      setExpandedPushes((prev) => new Set(prev).add("creator"));
      toast.success("Imported from smart group", `Added ${importedMonitors.length} bloggers`);
    } catch (e) {
      toast.error("Import failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleRunSharedSmartGroups = async (mode: "full" | "creator-only" = "full") => {
    try {
      await runBackgroundTask<XHSSmartGroupResult>(
        "smart-groups",
        () => xiaohongshuStartSmartGroupTask({
          cookie: buildCookie() || undefined,
          resolve_author_ids: Boolean(buildCookie()),
          resolve_limit: 0,
          mode,
        }),
        (result) => {
          setSmartGroupResult(result);
          setAuthorCandidates(result.xhs_candidates || []);
          setAuthorCandidateMeta({
            totalNotes: result.total_notes || 0,
            message: result.xhs_candidate_message || result.message,
          });
          setFrequentAuthorGroupFilter("all");
          setFrequentAuthorPage(1);
          void refreshTrackerConfig();
          setExpandedPushes((prev) => new Set(prev).add("creator"));
        },
        (result) => ({
          title: result.workflow_mode === "creator-only"
            ? "Creators re-organized"
            : (result.already_grouped ? "Smart groups incrementally updated" : "Smart groups generated"),
          description: result.message,
        }),
      );
    } catch (e) {
      toast.error("Smart grouping failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleBuildSmartGroups = async () => {
    await handleRunSharedSmartGroups("full");
  };

  const handleRefreshSharedCreatorAssignments = async () => {
    await handleRunSharedSmartGroups("creator-only");
  };

  const handleAddFrequentAuthorToCreatorMonitor = async (candidate: XHSAuthorCandidate) => {
    const candidateAuthorId = normalizeXhsProfileUserId(candidate.author_id || resolveKnownAuthorId(candidate.author));
    if (!candidateAuthorId) {
      toast.error("No user_id resolved for this blogger yet", "Re-run \"shared smart grouping\" first.");
      return;
    }
    if (creatorMonitorByUserId.has(candidateAuthorId)) {
      setExpandedPushes((prev) => new Set(prev).add("creator"));
      toast.info("This blogger is already in targeted follows");
      return;
    }
    try {
      const result = await xiaohongshuSyncAuthorsToTracker([
        {
          author: candidate.author,
          author_id: candidateAuthorId,
          latest_title: candidate.latest_title,
          sample_titles: candidate.sample_titles,
          sample_albums: candidate.sample_albums || [],
          sample_tags: candidate.sample_tags || [],
          source_summary: candidate.source_summary || "",
        },
      ]);
      await refreshTrackerConfig();
      setExpandedPushes((prev) => new Set(prev).add("creator"));
      toast.success("Added to targeted follow crawl", `Added ${result.added_count} bloggers, ${result.total_user_ids} total`);
    } catch (e) {
      toast.error("Failed to add", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const toggleNoteExpand = (noteId: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const renderHorizontalNoteResults = ({
    notes,
    carouselRef,
    layout,
    onLayoutChange,
    expandedIds,
    onToggleExpand,
    saveSubfolder,
    saveSuccessTitle,
    saveAllSubfolder,
    saveAllSuccessTitle,
    creatorSourceLabel,
    showMatchedKeywords = false,
  }: {
    notes: Array<XHSNote & { matched_keywords?: string[] }>;
    carouselRef: React.RefObject<HTMLDivElement | null>;
    layout: NoteResultLayout;
    onLayoutChange: (layout: NoteResultLayout) => void;
    expandedIds: Set<string>;
    onToggleExpand: (noteId: string) => void;
    saveSubfolder: (note: XHSNote & { matched_keywords?: string[] }) => string;
    saveSuccessTitle: string;
    saveAllSubfolder: string;
    saveAllSuccessTitle: string;
    creatorSourceLabel: (note: XHSNote & { matched_keywords?: string[] }) => { tags: string[]; summary: string };
    showMatchedKeywords?: boolean;
  }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
          {layout === "horizontal"
            ? "Results arranged in a horizontal track. Swipe left/right, or use Q / E and ← / → to flip pages."
            : "Results switched back to vertical cards. Good for item-by-item review, continuous saving, and detail comparison."}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => onLayoutChange(layout === "horizontal" ? "vertical" : "horizontal")}
            style={segmentedButtonStyle(layout === "vertical")}
          >
            {layout === "horizontal" ? "Switch to vertical" : "Switch to horizontal"}
          </button>
          <button
            type="button"
            onClick={() => void handleSavePreviewNotesWithOptions(notes, {
              subfolder: saveAllSubfolder,
              successTitle: saveAllSuccessTitle,
              includeComments: searchSaveComments,
              commentsLimit: searchSaveCommentsLimit,
              commentsSortBy: searchSaveCommentsSortBy,
              emptyMessage: "No search results to save",
            })}
            disabled={previewSaveRunning || notes.length === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: previewSaveRunning || notes.length === 0 ? "var(--bg-hover)" : "var(--color-primary)",
              color: "white",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: previewSaveRunning || notes.length === 0 ? "not-allowed" : "pointer",
              opacity: previewSaveRunning || notes.length === 0 ? 0.62 : 1,
              whiteSpace: "nowrap",
            }}
          >
            <FolderDown style={{ width: "14px", height: "14px" }} />
            {previewSaveRunning ? "Saving..." : "Save all"}
          </button>
          {layout === "horizontal" ? (
            <>
              <button type="button" onClick={() => scrollNoteCarousel(carouselRef, -1)} style={segmentedButtonStyle(false)}>
                ← Q Previous
              </button>
              <button type="button" onClick={() => scrollNoteCarousel(carouselRef, 1)} style={segmentedButtonStyle(false)}>
                E Next →
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div
        ref={carouselRef}
        style={{
          display: layout === "horizontal" ? "flex" : "grid",
          gridTemplateColumns: layout === "vertical" ? "1fr" : undefined,
          gap: "14px",
          overflowX: layout === "horizontal" ? "auto" : "visible",
          alignItems: "stretch",
          paddingBottom: "6px",
          scrollSnapType: layout === "horizontal" ? "x proximity" : undefined,
          scrollBehavior: "smooth",
        }}
      >
        {notes.map((note) => {
          const expanded = expandedIds.has(note.id);
          const content = note.content || "";
          const authorId = String(note.author_id || resolveKnownAuthorId(note.author) || "").trim();
          const creatorSource = creatorSourceLabel(note);

          return (
            <div
              key={note.id}
              style={{
                flex: layout === "horizontal" ? "0 0 min(420px, calc(100vw - 88px))" : undefined,
                minWidth: layout === "horizontal" ? "320px" : 0,
                maxWidth: layout === "horizontal" ? "420px" : "100%",
                scrollSnapAlign: layout === "horizontal" ? "start" : undefined,
              }}
            >
              <XiaohongshuNoteCard
                note={note}
                showMatchedKeywords={showMatchedKeywords}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                addToMonitorAction={{
                  onClick: () => handleAddFrequentAuthorToCreatorMonitor({
                    author: note.author,
                    author_id: authorId,
                    note_count: 1,
                    total_likes: note.likes || 0,
                    total_collects: note.collects || 0,
                    total_comments: note.comments_count || 0,
                    latest_date: note.published_at || "",
                    latest_title: note.title || content.slice(0, 28) || note.author,
                    sample_note_urls: note.url ? [note.url] : [],
                    sample_titles: note.title ? [note.title] : [],
                    sample_albums: [],
                    sample_tags: creatorSource.tags,
                    source_summary: creatorSource.summary,
                    score: (note.likes || 0) + (note.collects || 0),
                  }),
                  disabled: !authorId,
                }}
                primaryAction={{
                  label: "Save",
                  onClick: () => handleSavePreviewNotesWithOptions([note], {
                    subfolder: saveSubfolder(note),
                    successTitle: saveSuccessTitle,
                    includeComments: searchSaveComments,
                    commentsLimit: searchSaveCommentsLimit,
                    commentsSortBy: searchSaveCommentsSortBy,
                  }),
                  disabled: previewSaveRunning,
                  icon: <Save style={{ width: "12px", height: "12px" }} />,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderCreatorNoteResults = ({
    notes,
    carouselRef,
    layout,
    onLayoutChange,
    expandedIds,
    onToggleExpand,
    sourceLabel,
    saveAllTitle,
  }: {
    notes: XHSNote[];
    carouselRef: React.RefObject<HTMLDivElement | null>;
    layout: NoteResultLayout;
    onLayoutChange: (layout: NoteResultLayout) => void;
    expandedIds: Set<string>;
    onToggleExpand: (noteId: string) => void;
    sourceLabel: string;
    saveAllTitle: string;
  }) => renderHorizontalNoteResults({
    notes,
    carouselRef,
    layout,
    onLayoutChange,
    expandedIds,
    onToggleExpand,
    saveSubfolder: () => buildCreatorSaveSubfolder(sourceLabel),
    saveSuccessTitle: "Blogger posts saved",
    saveAllSubfolder: buildCreatorSaveSubfolder(sourceLabel),
    saveAllSuccessTitle: saveAllTitle,
    creatorSourceLabel: (note) => ({
      tags: [sourceLabel].filter(Boolean),
      summary: `From targeted blogger crawl: ${sourceLabel || note.author}`,
    }),
  });

  const renderTabs = () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "12px",
      }}
    >
      {[
        {
          id: "collections" as const,
          label: "Bookmark album crawl",
          icon: Save,
          accent: "#FF6B81",
          bg: "rgba(255, 107, 129, 0.14)",
        },
        {
          id: "search" as const,
          label: "Manual crawl",
          icon: Filter,
          accent: "#EF4444",
          bg: "rgba(239, 68, 68, 0.12)",
        },
        {
          id: "following" as const,
          label: "Follow monitor",
          icon: Users,
          accent: "#FF8A00",
          bg: "rgba(255, 138, 0, 0.14)",
        },
      ].map(({ id, label, icon: Icon, accent, bg }) => (
        <button
          key={id}
          onClick={() => setActiveTab(id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "14px 16px",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${activeTab === id ? accent : "var(--border-light)"}`,
            background: activeTab === id ? bg : "var(--bg-card)",
            color: activeTab === id ? accent : "var(--text-main)",
            fontSize: "0.9375rem",
            fontWeight: 700,
            cursor: "pointer",
            transition: "all 0.18s ease",
            justifyContent: "flex-start",
            textAlign: "left",
          }}
        >
          <span
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: activeTab === id ? bg : "var(--bg-hover)",
              color: activeTab === id ? accent : "var(--text-secondary)",
              flexShrink: 0,
            }}
          >
            <Icon style={{ width: "18px", height: "18px" }} />
          </span>
          {label}
        </button>
      ))}
    </div>
  );

  const formatTaskTime = (value?: string) => {
    if (!value) return "Unknown time";
    try {
      return new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return value;
    }
  };

  const formatTaskKindLabel = (kind: string) => {
    switch (kind) {
      case "search":
        return "Keyword scan";
      case "following-feed":
        return "Follow-feed scan";
      case "creator-recent":
        return "Targeted blogger crawl";
      case "crawl-note":
        return "Single save";
      case "crawl-batch":
        return "Bulk save";
      case "comments":
        return "Comment crawl";
      case "author-candidates":
        return "Blogger candidate analysis";
      case "smart-groups":
        return "Smart grouping";
      case "save-previews":
        return "Search result save";
      default:
        return kind;
    }
  };

  const renderTaskInputDetails = (task: XHSTaskStatus) => {
    const input = task.input || {};
    const lines: string[] = [];

    if (task.input_summary) lines.push(task.input_summary);
    if (typeof input.keyword === "string" && input.keyword && !lines.some((line) => line.includes(String(input.keyword)))) {
      lines.push(`Keyword: ${input.keyword}`);
    }
    if (Array.isArray(input.keywords) && input.keywords.length > 0) {
      lines.push(`Keywords: ${input.keywords.join(", ")}`);
    }
    if (typeof input.url === "string" && input.url) {
      lines.push(`Link: ${input.url}`);
    }
    if (Array.isArray(input.urls) && input.urls.length > 0) {
      lines.push(`Links: ${input.urls.length}`);
    }
    if (Array.isArray(input.albums) && input.albums.length > 0) {
      lines.push(`Albums: ${input.albums.length}`);
    }
    if (typeof input.min_likes === "number") {
      lines.push(`Min likes: ${input.min_likes}`);
    }
    if (typeof input.max_results === "number") {
      lines.push(`Result limit: ${input.max_results}`);
    }
    if (typeof input.max_comments === "number") {
      lines.push(`Comments: ${input.max_comments}`);
    }
    if (typeof input.max_notes === "number") {
      lines.push(`Fetch limit: ${input.max_notes}`);
    }
    if (typeof input.max_creators === "number") {
      lines.push(`Blogger limit: ${input.max_creators}`);
    }
    if (typeof input.creator_query === "string" && input.creator_query) {
      lines.push(`Blogger: ${input.creator_query}`);
    }
    if (typeof input.recent_days === "number") {
      lines.push(`Day range: ${input.recent_days}`);
    }

    if (lines.length === 0) return null;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
        {lines.map((line, index) => (
          <div key={`${task.task_id}-${index}`} style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {line}
          </div>
        ))}
      </div>
    );
  };

  const renderManualCrawlTools = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <Card title="Save Notes to xhs/主动保存" icon={<FolderDown style={{ width: "18px", height: "18px" }} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: 0 }}>
            Paste a Xiaohongshu detail link. ABO fetches the body, remote image links, and local assets, and saves them to the Intel Library's xhs/主动保存/ folder.
          </p>

          <div style={{ display: "flex", gap: "12px", alignItems: "stretch" }}>
            <textarea
              value={crawlUrl}
              onChange={(e) => setCrawlUrl(e.target.value)}
              placeholder="https://www.xiaohongshu.com/explore/..."
              style={{
                flex: 1,
                minHeight: "84px",
                padding: "12px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.9375rem",
                outline: "none",
                resize: "vertical",
              }}
            />
	            <button
	              onClick={handleCrawlNote}
	              disabled={crawlNoteRunning || !crawlUrl.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                minWidth: "150px",
                padding: "12px 20px",
                borderRadius: "var(--radius-md)",
                border: "none",
	                background: crawlNoteRunning ? "var(--bg-hover)" : "var(--color-primary)",
                color: "white",
                fontSize: "0.9375rem",
                fontWeight: 600,
	                cursor: crawlNoteRunning || !crawlUrl.trim() ? "not-allowed" : "pointer",
	                opacity: crawlNoteRunning || !crawlUrl.trim() ? 0.6 : 1,
              }}
            >
	              {crawlNoteRunning ? "Saving..." : (
                <>
                  <Save style={{ width: "16px", height: "16px" }} />
                  Save
                </>
              )}
            </button>
          </div>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <input
                type="checkbox"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
              />
              Download images locally
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <input
                type="checkbox"
                checked={includeLivePhoto}
                onChange={(e) => setIncludeLivePhoto(e.target.checked)}
              />
              Download Live photo clips
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <input
                type="checkbox"
                checked={includeVideo}
                onChange={(e) => setIncludeVideo(e.target.checked)}
              />
              Download video MP4
            </label>
            <div style={{ flexBasis: "100%" }} />
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <input
                type="checkbox"
                checked={includeComments}
                onChange={(e) => setIncludeComments(e.target.checked)}
              />
              Record comments (beta, requires an open browser page)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              Comment count
              <input
                type="number"
                min={1}
                max={200}
                value={commentsLimit}
                onChange={(e) => setCommentsLimit(Number(e.target.value))}
                style={{
                  width: "80px",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-main)",
                }}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card title="Bulk Link Save" icon={<BookOpen style={{ width: "18px", height: "18px" }} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: 0 }}>
            One Xiaohongshu link per line, saved with the same media download and Markdown format.
          </p>
          <textarea
            value={batchUrls}
            onChange={(e) => setBatchUrls(e.target.value)}
            placeholder={"https://www.xiaohongshu.com/explore/...\nhttps://www.xiaohongshu.com/explore/..."}
            style={{
              width: "100%",
              minHeight: "140px",
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              background: "var(--bg-card)",
              color: "var(--text-main)",
              fontSize: "0.9375rem",
              outline: "none",
              resize: "vertical",
            }}
          />
	          <button
	            onClick={() => handleCrawlBatch()}
	            disabled={crawlBatchRunning || !batchUrls.trim()}
            style={{
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              borderRadius: "var(--radius-md)",
              border: "none",
	              background: crawlBatchRunning || !batchUrls.trim() ? "var(--bg-hover)" : "var(--color-primary)",
              color: "white",
              fontSize: "0.875rem",
              fontWeight: 600,
	              cursor: crawlBatchRunning || !batchUrls.trim() ? "not-allowed" : "pointer",
	              opacity: crawlBatchRunning || !batchUrls.trim() ? 0.6 : 1,
            }}
          >
            <FolderDown style={{ width: "16px", height: "16px" }} />
            Bulk save
          </button>
        </div>
      </Card>

      {crawlResult && (
        <Card title="Save Results" icon={<CheckCircle style={{ width: "18px", height: "18px" }} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ color: "var(--text-main)", fontWeight: 600 }}>{crawlResult.title}</div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
              {crawlResult.author} · {crawlResult.note_id}
            </div>
            <div
              style={{
                padding: "12px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-hover)",
                color: "var(--text-main)",
                fontSize: "0.875rem",
                wordBreak: "break-all",
              }}
            >
              Markdown：{crawlResult.markdown_path}
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", color: "var(--text-muted)", fontSize: "0.8125rem" }}>
              <span>Execution route: {formatExecutionRoute(crawlResult)}</span>
              <span>Images {crawlResult.remote_resources.images.length}</span>
              <span>Live {crawlResult.remote_resources.live.length}</span>
              <span>Videos {crawlResult.remote_resources.video ? 1 : 0}</span>
              <span>Local assets {crawlResult.local_resources.length}</span>
              <span>Detail path: {formatStrategyLabel(crawlResult.detail_strategy)}</span>
              <span>Media path: {formatStrategyLabel(crawlResult.media_strategy)}</span>
              {crawlResult.comment_strategy ? (
                <span>Comment path: {formatStrategyLabel(crawlResult.comment_strategy)}</span>
              ) : null}
            </div>
            {crawlResult.warnings.length > 0 && (
              <div style={{ color: "var(--color-warning)", fontSize: "0.8125rem", lineHeight: 1.6 }}>
                {crawlResult.warnings.join("；")}
              </div>
            )}
          </div>
        </Card>
      )}

      {batchResult && (
        <Card title="Bulk Save Results" icon={<CheckCircle style={{ width: "18px", height: "18px" }} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", color: "var(--text-main)", fontSize: "0.875rem" }}>
              <span>Total {batchResult.total}</span>
              <span>Succeeded {batchResult.saved}</span>
              <span>Failed {batchResult.failed}</span>
            </div>
            {batchResult.results.slice(0, 8).map((item, index) => (
              <div
                key={index}
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-hover)",
                  color: item.success ? "var(--text-main)" : "var(--color-danger)",
                  fontSize: "0.8125rem",
                  wordBreak: "break-all",
                }}
              >
                {"markdown_path" in item
                  ? `Saved: ${item.markdown_path} · ${formatExecutionRoute(item)} · ${formatStrategyLabel(item.detail_strategy)}`
                  : `Failed: ${item.url} · ${item.error}`}
              </div>
            ))}
          </div>
        </Card>
      )}

      {renderCommentsTab()}
    </div>
  );

  const renderCollectionsTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <Card title="Bookmark Album Crawl (strict anti-crawling, ~10s per item) (if rate-limited: wait, update cookie, switch IP, re-login)" icon={<Save style={{ width: "18px", height: "18px" }} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(255, 138, 0, 0.18)",
              background: "rgba(255, 138, 0, 0.08)",
              fontSize: "0.8125rem",
              color: "#C2410C",
              lineHeight: 1.7,
              fontWeight: 600,
            }}
          >
            <div>Due to Xiaohongshu limits, only one task can run at a time. Wait for the current task to finish before starting another crawl or save.</div>
            <div>The desktop must not be fullscreen, and a few pixels of the background browser must remain visible for scrolling and crawling to work.</div>
          </div>

          <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
            <div>Defaults to extension-first with fallback on failure; incremental mode skips notes whose Markdown files still exist locally, and an empty day range means unlimited.</div>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={handleFetchAlbums}
              disabled={Boolean(albumCrawlTaskId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 18px",
                borderRadius: "var(--radius-md)",
                border: "none",
                background: albumListTaskId ? "#FF6B81" : albumCrawlTaskId ? "var(--bg-hover)" : "var(--color-primary)",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: albumCrawlTaskId ? "not-allowed" : "pointer",
              }}
            >
              <Search style={{ width: "16px", height: "16px" }} />
              {albumListTaskId ? "Fetching albums, click to interrupt" : "Fetch bookmark albums"}
            </button>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem" }}>
              Last
              <input
                type="number"
                min={1}
                max={3650}
                value={albumRecentDaysInput}
                onChange={(e) => {
                  setAlbumRecentDaysInput(e.target.value);
                }}
                onBlur={() => {
                  const raw = albumRecentDaysInput.trim();
                  if (!raw) return;
                  const next = Number(raw);
                  if (!Number.isFinite(next)) {
                    setAlbumRecentDaysInput("");
                    return;
                  }
                  setAlbumRecentDaysInput(String(Math.max(1, Math.min(3650, next))));
                }}
                inputMode="numeric"
                placeholder="Unlimited"
                style={{ ...compactControlStyle, width: "82px", background: "transparent" }}
              />
              days
            </label>
            <button
              type="button"
              onClick={() => setShowAlbumRecoveryOptions((v) => !v)}
              style={{
                ...segmentedButtonStyle(showAlbumRecoveryOptions),
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Zap style={{ width: "15px", height: "15px" }} />
              Recovery crawl settings
              {showAlbumRecoveryOptions ? <ChevronUp style={{ width: "14px", height: "14px" }} /> : <ChevronDown style={{ width: "14px", height: "14px" }} />}
            </button>
          </div>

          {showAlbumRecoveryOptions && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "14px 16px",
                borderRadius: "var(--radius-md)",
                background: "rgba(255, 107, 129, 0.06)",
                border: "1px solid rgba(255, 107, 129, 0.16)",
              }}
            >
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>Recovery browser</span>
                <select
                  value={albumCookieBrowser}
                  onChange={(e) => setAlbumCookieBrowser(e.target.value as BrowserChoice)}
                  style={{ ...compactControlStyle, minWidth: "132px" }}
                >
                  {Object.entries(browserLabelMap).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleGetCookieFromBrowser(albumCookieBrowser)}
                  disabled={gettingCookie}
                  style={segmentedButtonStyle(false)}
                >
                  {gettingCookie ? "Updating cookie..." : `Update cookie with ${browserLabelMap[albumCookieBrowser]}`}
                </button>
                <button
                  type="button"
                  onClick={handleClearXhsLocalCache}
                  style={{ ...segmentedButtonStyle(false), borderColor: "rgba(239, 68, 68, 0.2)", color: "var(--color-danger)" }}
                >
                  Clear local cache
                </button>
              </div>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" onClick={() => setAlbumRecoveryMode((prev) => !prev)} style={segmentedButtonStyle(albumRecoveryMode)}>
                  Low-frequency batched crawl
                </button>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem" }}>
                  Per batch
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={albumBatchSize}
                    onChange={(e) => setAlbumBatchSize(Number(e.target.value || 5))}
                    style={{ ...compactControlStyle, width: "74px" }}
                  />
                  items
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem" }}>
                  Wait between batches
                  <input
                    type="number"
                    min={10}
                    max={180}
                    value={albumBatchPauseSeconds}
                    onChange={(e) => setAlbumBatchPauseSeconds(Number(e.target.value || 30))}
                    style={{ ...compactControlStyle, width: "82px" }}
                  />
                  seconds
                </label>
              </div>

              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                Try switching browsers and re-fetching the cookie first. If still rate-limited, clear the browser site cache, log in again, and continue in low-frequency batch mode.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>Crawl mode</span>
            <button type="button" onClick={() => setAlbumCrawlMode("incremental")} style={segmentedButtonStyle(albumCrawlMode === "incremental")}>
              Incremental
            </button>
            <button
              type="button"
              onClick={() => setAlbumCrawlMode("full")}
              style={{
                ...segmentedButtonStyle(albumCrawlMode === "full"),
                borderColor: albumCrawlMode === "full" ? "#FF6B81" : "var(--border-light)",
                background: albumCrawlMode === "full" ? "#FF6B81" : "transparent",
              }}
            >
              Full
            </button>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>By default only Markdown and remote links are saved; local assets download on demand</span>
            <button type="button" onClick={() => setIncludeImages((v) => !v)} style={segmentedButtonStyle(includeImages)}>
              Download images
            </button>
            <button type="button" onClick={() => setIncludeLivePhoto((v) => !v)} style={segmentedButtonStyle(includeLivePhoto)}>
              Download Live photos
            </button>
            <button type="button" onClick={() => setIncludeVideo((v) => !v)} style={segmentedButtonStyle(includeVideo)}>
              Download videos
            </button>
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => setIncludeComments((v) => !v)} style={segmentedButtonStyle(includeComments)}>
              Record comments (extension state machine)
            </button>
            <button
              type="button"
              onClick={() => setAlbumDedicatedWindowMode((v) => !v)}
              style={segmentedButtonStyle(albumDedicatedWindowMode)}
            >
              Dedicated Edge window
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem" }}>
              Extension port
              <input
                type="number"
                min={1024}
                max={65535}
                value={albumExtensionPort}
                onChange={(e) => setAlbumExtensionPort(Number(e.target.value || 9334))}
                style={{ ...compactControlStyle, width: "88px" }}
              />
            </label>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
            Crawl path: extension first (port {albumExtensionPort}, {albumDedicatedWindowMode ? "dedicated window" : "current window"}){` -> `}CDP / backend fallback
          </div>

          {albumListProgress && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "14px 16px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-hover)",
                border: "1px solid var(--border-light)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem", fontWeight: 600 }}>
                <TrendingUp style={{ width: "16px", height: "16px" }} />
                Album read progress
              </div>
              <div style={{ color: "var(--text-main)", fontSize: "0.9375rem", fontWeight: 600 }}>
                {albumListProgress.stage || "Running"}
              </div>
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  borderRadius: "999px",
                  background: "var(--bg-card)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width:
                      albumListProgress.status === "completed"
                        ? "100%"
                        : albumListProgress.total_steps
                          ? `${Math.max(((albumListProgress.current_step || 0) / albumListProgress.total_steps) * 100, 8)}%`
                        : albumListProgress.stage === "Task created"
                          ? "8%"
                          : albumListProgress.stage === "Launching headless browser"
                            ? "18%"
                            : albumListProgress.stage === "Entering Xiaohongshu home"
                              ? "34%"
                              : albumListProgress.stage === "Opening profile page"
                                ? "52%"
                                : albumListProgress.stage === "Opening bookmarks page"
                                  ? "70%"
                                  : albumListProgress.stage === "Opening album page"
                                    ? "86%"
                                    : "94%",
                    height: "100%",
                    background: "var(--color-primary)",
                    transition: "width 0.25s ease",
                  }}
                />
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
                {albumListProgress.status === "completed"
                  ? `Read ${albumListProgress.albums_total || 0} albums`
                  : albumListProgress.status === "cancelled"
                    ? "Interrupted; albums already on the page are kept."
                  : albumDedicatedWindowMode
                    ? `Reading in the dedicated Edge window. Step ${albumListProgress.current_step || 0}/${albumListProgress.total_steps || 7}`
                    : `Loading headlessly in the background; your current window is unaffected. Step ${albumListProgress.current_step || 0}/${albumListProgress.total_steps || 7}`}
              </div>
            </div>
          )}

          {albumProgress && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                padding: "14px 16px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-hover)",
                border: "1px solid var(--border-light)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem", fontWeight: 600 }}>
                <TrendingUp style={{ width: "16px", height: "16px" }} />
                Crawl progress
              </div>
              <div style={{ color: "var(--text-main)", fontSize: "0.9375rem", fontWeight: 600 }}>
                {albumProgress.stage || "Running"}
              </div>
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  borderRadius: "999px",
                  background: "var(--bg-card)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: (() => {
                      const totalAlbums = albumProgress.total_albums || 0;
                      if (albumProgress.status === "completed") return "100%";
                      if (!totalAlbums) return "12%";
                      const albumIndex = Math.max((albumProgress.current_album_index || 1) - 1, 0);
                      const noteTotal = albumProgress.total_notes || 0;
                      const noteIndex = albumProgress.current_note_index || 0;
                      const noteFraction = noteTotal ? Math.min(noteIndex / noteTotal, 1) : 0;
                      return `${Math.max(((albumIndex + noteFraction) / totalAlbums) * 100, 6)}%`;
                    })(),
                    height: "100%",
                    background: "var(--color-primary)",
                    transition: "width 0.25s ease",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", color: "var(--text-muted)", fontSize: "0.8125rem" }}>
                <span>Current album: {albumProgress.current_album || "Preparing"}</span>
                <span>Album progress: {albumProgress.current_album_index || 0}/{albumProgress.total_albums || 0}</span>
                <span>Loaded: {albumProgress.total_notes || 0}/{albumProgress.expected_total || "?"}</span>
                <span>Pages flipped: {albumProgress.pages_loaded || 0}</span>
                <span>Added: {albumProgress.saved || 0}</span>
                <span>Skipped: {albumProgress.skipped || 0}</span>
                <span>Failed: {albumProgress.failed || 0}</span>
                {albumProgress.pruned_seen_count ? (
                  <span>Pruned invalid seen {albumProgress.pruned_seen_count}</span>
                ) : null}
              </div>
              {albumProgress.total_notes ? (
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8125rem" }}>
                  Current album note progress: {albumProgress.current_note_index || 0}/{albumProgress.total_notes}
                  {albumProgress.stage === "Paging album list" || albumProgress.stage === "Reading album note list"
                    ? " · loading headlessly in background"
                    : ""}
                  {albumProgress.delay_seconds ? ` · waiting ${albumProgress.delay_seconds}s before continuing` : ""}
                </div>
              ) : null}
              {albumProgress.skip_breakdown ? (
                <div style={{ color: "var(--text-secondary)", fontSize: "0.8125rem" }}>
                  Filter breakdown: seen {albumProgress.skip_breakdown.already_seen || 0} · older {albumProgress.skip_breakdown.older_than_recent_days || 0} · newer {albumProgress.skip_breakdown.newer_than_before_date || 0} · invalid {albumProgress.skip_breakdown.invalid_note || 0}
                </div>
              ) : null}
            </div>
          )}

          {albums.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  Read {albums.length} albums, {selectedAlbumIds.size} selected (totals may not match due to deleted posts)
                </span>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      if (selectedAlbumIds.size === albums.length) setSelectedAlbumIds(new Set());
                      else setSelectedAlbumIds(new Set(albums.map((album) => album.board_id)));
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--color-primary)",
                      cursor: "pointer",
                      fontSize: "0.8125rem",
                    }}
                  >
                    {selectedAlbumIds.size === albums.length ? "Deselect all" : "Select all"}
                  </button>
                  <button
                    onClick={() => handleCrawlSelectedAlbums(albumCrawlMode)}
                    disabled={Boolean(albumListTaskId) || (!albumCrawlTaskId && selectedAlbumIds.size === 0)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 18px",
                      borderRadius: "var(--radius-md)",
                      border: "none",
                      background: albumCrawlTaskId
                        ? "#FF6B81"
                        : Boolean(albumListTaskId) || selectedAlbumIds.size === 0
                          ? "var(--bg-hover)"
                          : "var(--color-primary)",
                      color: "white",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      cursor: Boolean(albumListTaskId) || (!albumCrawlTaskId && selectedAlbumIds.size === 0) ? "not-allowed" : "pointer",
                      opacity: Boolean(albumListTaskId) || (!albumCrawlTaskId && selectedAlbumIds.size === 0) ? 0.6 : 1,
                    }}
                  >
                    <FolderDown style={{ width: "16px", height: "16px" }} />
                    {albumCrawlTaskId ? "Crawling, click to interrupt" : albumCrawlMode === "full" ? "Full crawl selected albums" : "Incremental crawl selected albums"}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
                {albums.map((album) => {
                  const previewImage = normalizeAlbumPreviewImage(album.preview_image);
                  const fallbackMode = albumPreviewFallbacks[album.board_id];
                  const preferProxy = shouldProxyAlbumPreview(previewImage);
                  const displayImage = !previewImage || fallbackMode === "none"
                    ? ""
                    : fallbackMode === "proxy"
                      ? proxiedImage(previewImage)
                      : preferProxy
                        ? proxiedImage(previewImage)
                        : previewImage;
                  return (
                    <button
                      key={album.board_id}
                      onClick={() => toggleAlbumSelection(album.board_id)}
                      style={{
                        textAlign: "left",
                        padding: "0",
                        borderRadius: "var(--radius-md)",
                        border: selectedAlbumIds.has(album.board_id) ? "2px solid var(--color-primary)" : "1px solid var(--border-light)",
                        background: "var(--bg-card)",
                        color: "var(--text-main)",
                        overflow: "hidden",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ aspectRatio: "4 / 3", background: "var(--bg-hover)" }}>
                        {displayImage ? (
                          <img
                            src={displayImage}
                            alt={album.name}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() => {
                              setAlbumPreviewFallbacks((prev) => ({
                                ...prev,
                                [album.board_id]: displayImage.startsWith(IMAGE_PROXY_PREFIX) || previewImage.startsWith("data:image/")
                                  ? "none"
                                  : "proxy",
                              }));
                            }}
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        ) : (
                          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                            No preview image
                          </div>
                        )}
                      </div>
                      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ fontWeight: 600, fontSize: "0.9375rem", lineHeight: 1.4 }}>{album.name}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
                          {album.count ?? "?"} items · {album.seen_count || 0} crawled
                        </div>
                        {album.latest_title && (
                          <div style={{ color: "var(--text-secondary)", fontSize: "0.8125rem", lineHeight: 1.5 }}>
                            Latest: {album.latest_title}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        </div>
        </Card>

      {albumResult && (
        <Card title="Album Crawl Results" icon={<CheckCircle style={{ width: "18px", height: "18px" }} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <span>Added {albumResult.saved}</span>
              <span>Skipped {albumResult.skipped}</span>
              <span>Failed {albumResult.failed}</span>
            </div>
            {albumResult.results.map((item, index) => (
              <div
                key={index}
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-hover)",
                  color: item.success ? "var(--text-main)" : "var(--color-danger)",
                  fontSize: "0.8125rem",
                }}
              >
                {item.success
                  ? `${item.album}: found ${item.found || 0}, added ${item.saved || 0}, skipped ${item.skipped || 0}${item.mode ? ` · ${item.mode === "full" ? "full" : "incremental"}` : ""}`
                  : `${item.album || "Album"}: ${item.error || "failed"}`}
                {item.success && item.diagnostics ? (
                  <div style={{ marginTop: "6px", color: "var(--text-muted)" }}>
                    Seen check: raw {item.diagnostics.raw_seen_count || 0} · valid {item.diagnostics.valid_seen_count || 0} · pruned {item.diagnostics.pruned_seen_count || 0} · processable {item.diagnostics.processable_notes || 0}
                    {item.diagnostics.skip_breakdown ? ` · filtered: seen ${item.diagnostics.skip_breakdown.already_seen || 0} / older ${item.diagnostics.skip_breakdown.older_than_recent_days || 0} / newer ${item.diagnostics.skip_breakdown.newer_than_before_date || 0}` : ""}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  const togglePushExpanded = (id: string) => {
    setExpandedPushes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderPushRow = (
    id: "creator" | "keyword" | "following-scan",
    title: string,
    subtitle: string,
    active: boolean,
    onToggle: () => void,
    onDelete: (() => void) | undefined,
    children: React.ReactNode,
  ) => {
    const expanded = expandedPushes.has(id);
    return (
      <div
        style={{
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-light)",
          background: "var(--bg-card)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px" }}>
          <button
            type="button"
            onClick={() => togglePushExpanded(id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flex: 1,
              minWidth: 0,
              padding: 0,
              border: "none",
              background: "transparent",
              color: "var(--text-main)",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            {expanded ? (
              <ChevronUp style={{ width: "16px", height: "16px", color: "var(--text-muted)", flexShrink: 0 }} />
            ) : (
              <ChevronDown style={{ width: "16px", height: "16px", color: "var(--text-muted)", flexShrink: 0 }} />
            )}
            <span style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>{title}</span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {subtitle}
              </span>
            </span>
          </button>
          <button type="button" onClick={onToggle} aria-label={active ? "Disable push" : "Enable push"} style={switchStyle(active)}>
            <span style={switchKnobStyle(active)} />
          </button>
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-light)",
                background: "transparent",
                color: "var(--color-danger)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-label="Delete push"
            >
              <Trash2 style={{ width: "15px", height: "15px" }} />
            </button>
          ) : null}
        </div>
        {expanded && (
          <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {children}
          </div>
        )}
      </div>
    );
  };

  const creatorEntries = trackerCreatorMonitors.length > 0
    ? trackerCreatorMonitors
    : trackerUserIds.map((userId) => createCreatorMonitor({
        user_id: userId,
        label: trackerCreatorProfiles[userId]?.author || userId,
        author: trackerCreatorProfiles[userId]?.author || userId,
        enabled: trackerCreatorPushEnabled && !disabledCreatorIds.has(userId),
        smart_groups: trackerCreatorProfiles[userId]?.smart_groups || [],
        smart_group_labels: trackerCreatorProfiles[userId]?.smart_group_labels || [],
      }));
  const creatorMonitorByUserId = new Map<string, XHSTrackerCreatorMonitor>();
  creatorEntries.forEach((creatorMonitor) => {
    const userId = normalizeXhsProfileUserId(creatorMonitor.user_id);
    if (!userId || creatorMonitorByUserId.has(userId)) return;
    creatorMonitorByUserId.set(userId, creatorMonitor);
  });
  const creatorGroupLabelMap = new Map(
    trackerCreatorGroupOptions.map((option) => [option.value, option.label]),
  );
  const creatorGroupCounts = trackerCreatorGroupOptions.reduce<Record<string, number>>((acc, option) => {
    acc[option.value] = Object.values(trackerCreatorProfiles).filter((profile) =>
      (profile.smart_groups || []).includes(option.value),
    ).length;
    return acc;
  }, {});
  const vaultIndexedFileCount = Number(sharedCreatorGrouping.vault_signal_database?.indexed_files || 0);
  const vaultSignalCount = Number(sharedCreatorGrouping.vault_signal_database?.signal_count || 0);
  const sharedTagIndexPath = sharedCreatorGrouping.shared_data_paths?.tag_index_path
    || sharedCreatorGrouping.vault_signal_database?.tag_index_path
    || sharedCreatorGrouping.vault_signal_database?.database_path
    || "";
  const creatorGroupDisplayOptions = trackerCreatorGroupOptions.filter((option) =>
    (creatorGroupCounts[option.value] || 0) > 0 || trackerCreatorGroups.includes(option.value),
  );
  const getCreatorGroupLabels = (profile?: XHSCreatorProfile | null): string[] => (
    (profile?.smart_groups || []).map((group, index) =>
      profile?.smart_group_labels?.[index]
      || creatorGroupLabelMap.get(group)
      || group,
    )
  );
  const getCreatorMonitorGroupLabels = (monitor: XHSTrackerCreatorMonitor): string[] => {
    const userId = String(monitor.user_id || "").trim();
    const profile = trackerCreatorProfiles[userId];
    const values = profile?.smart_groups?.length ? profile.smart_groups : monitor.smart_groups;
    const labels = profile?.smart_group_labels?.length ? profile.smart_group_labels : monitor.smart_group_labels;
    return (values || []).map((group, index) => labels?.[index] || creatorGroupLabelMap.get(group) || group);
  };
  const resolveCreatorProfileUrl = (profile?: XHSCreatorProfile | null, fallbackAuthorId?: string | null) => {
    const directUrl = String(profile?.profile_url || "").trim();
    if (directUrl) return directUrl;
    const directAuthorId = String(profile?.author_id || fallbackAuthorId || "").trim();
    if (directAuthorId) return buildXhsProfileUrl(directAuthorId);
    const mappedEntry = trackerCreatorNameMap[normalizeAuthorKey(profile?.author)] || null;
    const mappedAuthorId = String(mappedEntry?.author_id || "").trim();
    if (mappedAuthorId) return buildXhsProfileUrl(mappedAuthorId);
    return String(mappedEntry?.profile_url || "").trim();
  };
  const trackedCreatorUserIds = new Set(
    creatorEntries.map((monitor) => normalizeXhsProfileUserId(monitor.user_id)).filter(Boolean),
  );
  const getMonitorGroupValues = (monitor: XHSTrackerCreatorMonitor): string[] => {
    const userId = String(monitor.user_id || "").trim();
    const profile = trackerCreatorProfiles[userId];
    return (profile?.smart_groups?.length ? profile.smart_groups : monitor.smart_groups) || [];
  };
  const filteredCreatorEntries = creatorEntries.filter((monitor) => {
    if (creatorMonitorGroupFilter === "all") return true;
    if (creatorMonitorGroupFilter === "__ungrouped__") return getMonitorGroupValues(monitor).length === 0;
    return getMonitorGroupValues(monitor).includes(creatorMonitorGroupFilter);
  });
  const creatorMonitorPageSize = 8;
  const creatorMonitorPageCount = Math.max(1, Math.ceil(filteredCreatorEntries.length / creatorMonitorPageSize));
  const safeCreatorMonitorPage = Math.min(creatorMonitorPage, creatorMonitorPageCount - 1);
  const visibleCreatorEntries = filteredCreatorEntries.slice(
    safeCreatorMonitorPage * creatorMonitorPageSize,
    safeCreatorMonitorPage * creatorMonitorPageSize + creatorMonitorPageSize,
  );
  const buildSharedCreatorMembers = (
    predicate: (profile: XHSCreatorProfile, profileId: string) => boolean,
  ) => Object.entries(trackerCreatorProfiles)
    .filter(([profileId, profile]) => predicate(profile, profileId))
    .map(([profileId, profile]) => {
      const authorId = String(profile.author_id || profileId || "").trim();
      const author = String(profile.author || authorId || "Unnamed blogger").trim() || "Unnamed blogger";
      return {
        profileId,
        profile,
        author,
        authorId,
        latestTitle: String(profile.latest_title || profile.sample_titles?.[0] || "").trim(),
        sourceSummary: String(profile.source_summary || "").trim(),
        sampleUrl: String(profile.sample_note_urls?.[0] || "").trim(),
        profileUrl: resolveCreatorProfileUrl(profile, profileId),
        sampleLabels: [...new Set([...(profile.sample_tags || []), ...(profile.sample_albums || [])])].slice(0, 5),
        inTracker: trackedCreatorUserIds.has(authorId),
      };
    })
    .sort((left, right) =>
      Number(right.inTracker) - Number(left.inTracker)
      || left.author.localeCompare(right.author, "zh-CN")
    );
  const sharedCreatorGroups = creatorGroupDisplayOptions.map((option) => {
    const members = buildSharedCreatorMembers((profile) => (profile.smart_groups || []).includes(option.value));
    return {
      ...option,
      members,
      count: members.length,
    };
  }).filter((group) => group.count > 0);
  const ungroupedCreatorMembers = buildSharedCreatorMembers((profile) => (profile.smart_groups || []).length === 0);
  const visibleSharedCreatorGroups = [
    ...sharedCreatorGroups,
    ...(ungroupedCreatorMembers.length > 0 ? [{
      value: "__ungrouped__",
      label: "Ungrouped",
      count: ungroupedCreatorMembers.length,
      members: ungroupedCreatorMembers,
      isUngrouped: true,
    }] : []),
  ];
  const allSharedCreatorMembers = buildSharedCreatorMembers(() => true);
  const normalizedSharedCreatorManagerQuery = sharedCreatorManagerQuery.trim().toLowerCase();
  const filteredSharedCreatorMembers = allSharedCreatorMembers.filter((member) => {
    if (!normalizedSharedCreatorManagerQuery) return true;
    const candidateText = [
      member.author,
      member.authorId,
      member.latestTitle,
      member.sourceSummary,
      ...getCreatorGroupLabels(member.profile),
    ].join(" ").toLowerCase();
    return candidateText.includes(normalizedSharedCreatorManagerQuery);
  });
  const filteredSharedCreatorManagerGroups = visibleSharedCreatorGroups.map((group) => {
    const groupQueryMatched = !normalizedSharedCreatorManagerQuery
      || group.label.toLowerCase().includes(normalizedSharedCreatorManagerQuery);
    const members = group.members.filter((member) => {
      if (groupQueryMatched) return true;
      const candidateText = [
        member.author,
        member.authorId,
        member.latestTitle,
        member.sourceSummary,
        ...getCreatorGroupLabels(member.profile),
      ].join(" ").toLowerCase();
      return candidateText.includes(normalizedSharedCreatorManagerQuery);
    });
    return {
      ...group,
      members,
      filteredCount: members.length,
    };
  }).filter((group) => group.filteredCount > 0);
  const creatorBatchTargetByProfileId = new Map<string, CreatorBatchTarget>();
  visibleSharedCreatorGroups.forEach((group) => {
    group.members.forEach((member) => {
      creatorBatchTargetByProfileId.set(member.profileId, {
        profileId: member.profileId,
        author: member.author,
        authorId: member.authorId,
        query: member.authorId || member.author,
        groupValue: group.value,
        groupLabel: group.label,
      });
    });
  });
  const selectedCreatorBatchTargets = [...selectedCreatorBatchIds]
    .map((profileId) => creatorBatchTargetByProfileId.get(profileId))
    .filter((target): target is CreatorBatchTarget => Boolean(target?.query));
  const knownAuthorIdByName = new Map<string, string>();
  const knownAuthorNameById = new Map<string, string>();
  const rememberKnownAuthor = (authorId?: string | null, author?: string | null) => {
    const normalizedAuthorId = normalizeXhsProfileUserId(authorId);
    const cleanAuthor = String(author || "").trim();
    if (normalizedAuthorId && cleanAuthor) {
      knownAuthorNameById.set(normalizedAuthorId, cleanAuthor);
    }
  };
  authorCandidates.forEach((candidate) => {
    const authorKey = normalizeAuthorKey(candidate.author);
    if (authorKey && candidate.author_id) knownAuthorIdByName.set(authorKey, candidate.author_id);
    rememberKnownAuthor(candidate.author_id, candidate.author);
  });
  Object.values(trackerCreatorNameMap).forEach((entry) => {
    const authorKey = normalizeAuthorKey(entry.author);
    const authorId = String(entry.author_id || "").trim();
    if (authorKey && authorId) knownAuthorIdByName.set(authorKey, authorId);
    rememberKnownAuthor(authorId, entry.author);
  });
  Object.entries(trackerCreatorProfiles).forEach(([profileId, profile]) => {
    const authorKey = normalizeAuthorKey(profile.author);
    const profileAuthorId = String(profile.author_id || profileId || "").trim();
    if (authorKey && profileAuthorId) knownAuthorIdByName.set(authorKey, profileAuthorId);
    rememberKnownAuthor(profileAuthorId, profile.author);
  });
  creatorEntries.forEach((monitor) => {
    rememberKnownAuthor(monitor.user_id, monitor.author || monitor.label);
  });
  const resolveKnownAuthorId = (author?: string | null) => knownAuthorIdByName.get(normalizeAuthorKey(author)) || "";
  const resolveCreatorDisplayLabel = (
    rawLabel: string,
    notes: XHSNote[] = [],
    explicitAuthorId?: string | null,
  ) => {
    const cleanRawLabel = String(rawLabel || "").trim();
    const normalizedExplicitAuthorId = normalizeXhsProfileUserId(explicitAuthorId);
    const normalizedRawAuthorId = cleanRawLabel ? normalizeXhsProfileUserId(cleanRawLabel) : "";
    const noteAuthors = Array.from(new Set(
      notes
        .map((note) => String(note.author || "").trim())
        .filter(Boolean),
    ));
    const noteAuthorIds = Array.from(new Set(
      notes
        .map((note) => normalizeXhsProfileUserId(note.author_id || resolveKnownAuthorId(note.author)))
        .filter(Boolean),
    ));
    const singleNoteAuthor = noteAuthors.length === 1 ? noteAuthors[0] : "";
    const singleNoteAuthorId = noteAuthorIds.length === 1 ? noteAuthorIds[0] : "";
    const targetAuthorId = normalizedExplicitAuthorId || singleNoteAuthorId || normalizedRawAuthorId;
    const mappedAuthor = targetAuthorId ? String(knownAuthorNameById.get(targetAuthorId) || "").trim() : "";
    const rawLabelLooksLikeAuthorId = Boolean(normalizedRawAuthorId && cleanRawLabel === normalizedRawAuthorId);
    const shouldPreferMappedAuthor = Boolean(
      normalizedExplicitAuthorId
      || singleNoteAuthorId
      || rawLabelLooksLikeAuthorId,
    );
    if (singleNoteAuthor && shouldPreferMappedAuthor) return singleNoteAuthor;
    if (mappedAuthor && shouldPreferMappedAuthor) return mappedAuthor;
    return cleanRawLabel || mappedAuthor || singleNoteAuthor || "Unnamed user";
  };
  const frequentAuthorCandidates = [...authorCandidates].sort((a, b) => {
    if (b.note_count !== a.note_count) return b.note_count - a.note_count;
    if (b.total_collects !== a.total_collects) return b.total_collects - a.total_collects;
    if (b.total_likes !== a.total_likes) return b.total_likes - a.total_likes;
    return b.score - a.score;
  });
  const getCandidateGroupLabels = (candidate: XHSAuthorCandidate): string[] => {
    const candidateAuthorId = normalizeXhsProfileUserId(candidate.author_id || resolveKnownAuthorId(candidate.author));
    const profile = candidateAuthorId ? trackerCreatorProfiles[candidateAuthorId] : undefined;
    return getCreatorGroupLabels(profile);
  };
  const frequentAuthorGroupCounts = creatorGroupDisplayOptions.reduce<Record<string, number>>((acc, option) => {
    acc[option.value] = frequentAuthorCandidates.filter((candidate) => {
      const candidateAuthorId = normalizeXhsProfileUserId(candidate.author_id || resolveKnownAuthorId(candidate.author));
      const profile = candidateAuthorId ? trackerCreatorProfiles[candidateAuthorId] : undefined;
      return (profile?.smart_groups || []).includes(option.value);
    }).length;
    return acc;
  }, {});
  const frequentAuthorGroupOptions = creatorGroupDisplayOptions.filter((option) =>
    (frequentAuthorGroupCounts[option.value] || 0) > 0
  );
  const filteredFrequentAuthorCandidates = frequentAuthorCandidates.filter((candidate) => {
    if (frequentAuthorGroupFilter === "all") return true;
    const candidateAuthorId = normalizeXhsProfileUserId(candidate.author_id || resolveKnownAuthorId(candidate.author));
    const profile = candidateAuthorId ? trackerCreatorProfiles[candidateAuthorId] : undefined;
    return (profile?.smart_groups || []).includes(frequentAuthorGroupFilter);
  });
  const frequentAuthorTotalPages = Math.max(1, Math.ceil(filteredFrequentAuthorCandidates.length / FREQUENT_AUTHOR_PAGE_SIZE));
  const safeFrequentAuthorPage = Math.min(frequentAuthorPage, frequentAuthorTotalPages);
  const visibleFrequentAuthorCandidates = filteredFrequentAuthorCandidates.slice(
    (safeFrequentAuthorPage - 1) * FREQUENT_AUTHOR_PAGE_SIZE,
    safeFrequentAuthorPage * FREQUENT_AUTHOR_PAGE_SIZE,
  );

  useEffect(() => {
    setFrequentAuthorPage(1);
  }, [frequentAuthorGroupFilter]);

  useEffect(() => {
    if (frequentAuthorPage > frequentAuthorTotalPages) {
      setFrequentAuthorPage(frequentAuthorTotalPages);
    }
  }, [frequentAuthorPage, frequentAuthorTotalPages]);

  const persistTrackerDefinitions = async (successTitle: string, successDescription?: string) => {
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload());
      await refreshTrackerConfig();
      toast.success(successTitle, successDescription);
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleToggleFollowingScanPush = async () => {
    const draftKeywords = parseKeywordInput(trackerFollowingScanKeywordDraft);
    const existingMonitors = draftKeywords.length > 0
      ? applyFollowingScanDraftToMonitors(trackerFollowingScanKeywordDraft)
      : commitFollowingScanMonitorsForSave();
    if (existingMonitors.length === 0) {
      toast.error("Add at least one follow-feed keyword definition first");
      return;
    }
    const next = !trackerFollowingScan.enabled;
    const nextMonitors = existingMonitors.map((monitor) => ({
      ...monitor,
      enabled: next,
    }));
    const payload = buildFollowingScanPayload(nextMonitors, {
      ...trackerFollowingScan,
      enabled: next,
    });
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        following_scan: payload.followingScan,
        following_scan_monitors: payload.followingScanMonitors,
      }));
      await refreshTrackerConfig();
      toast.success(next ? "Follow-feed intel push enabled" : "Follow-feed intel push disabled");
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleSaveFollowingScan = async () => {
    try {
      const draftKeywords = parseKeywordInput(trackerFollowingScanKeywordDraft);
      const nextMonitors = draftKeywords.length > 0
        ? applyFollowingScanDraftToMonitors(trackerFollowingScanKeywordDraft)
        : commitFollowingScanMonitorsForSave();
      const payload = buildFollowingScanPayload(nextMonitors);
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        following_scan: payload.followingScan,
        following_scan_monitors: payload.followingScanMonitors,
      }));
      toast.success("Follow-feed intel push saved", "Module management will crawl these definitions on schedule");
      await refreshTrackerConfig();
      setExpandedPushes((prev) => new Set(prev).add("following-scan"));
    } catch (e) {
      toast.error("Save failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const handleDeleteFollowingScanPush = async () => {
    try {
      await api.post("/api/modules/xiaohongshu-tracker/config", buildTrackerConfigPayload({
        following_scan: createFollowingScan({
          ...trackerFollowingScan,
          enabled: false,
          keywords: [],
        }),
        following_scan_monitors: [],
      }));
      await refreshTrackerConfig();
      setExpandedPushes((prev) => {
        const next = new Set(prev);
        next.delete("following-scan");
        return next;
      });
      toast.success("Follow-feed intel push cleared");
    } catch (e) {
      toast.error("Delete failed", e instanceof Error ? e.message : "Unknown error");
    }
  };

  const toggleCreatorBatchSelection = (profileId: string) => {
    setSelectedCreatorBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  };

  const buildCreatorBatchTargetsFromMembers = (
    members: Array<{
      profileId: string;
      author: string;
      authorId: string;
    }>,
    groupLabel?: string,
    groupValue?: string,
  ): CreatorBatchTarget[] => Array.from(new Map(
    members
      .map((member) => ({
        profileId: member.profileId,
        author: member.author,
        authorId: member.authorId,
        query: member.authorId || member.author,
        groupLabel,
        groupValue,
      }))
      .filter((target) => String(target.query || "").trim())
      .map((target) => [target.profileId, target]),
  ).values());

  const runCreatorRecentBatch = async (targets: CreatorBatchTarget[], sourceLabel: string) => {
    if (creatorRecentRunning || creatorRecentBatchRunning) {
      toast.info("Task already running", "A blogger crawl is in progress; start a new one after it finishes.");
      return;
    }
    if (!requireCookie()) {
      return;
    }
    const normalizedTargets = Array.from(new Map(
      targets
        .map((target) => ({
          ...target,
          query: String(target.query || "").trim(),
        }))
        .filter((target) => target.query)
        .map((target) => [target.profileId, target]),
    ).values());
    if (normalizedTargets.length === 0) {
      toast.error("No bloggers to crawl");
      return;
    }

    const recentDays = Math.max(1, Math.min(365, creatorRecentDays || DEFAULT_XHS_RECENT_DAYS));
    const maxNotes = Math.max(1, Math.min(50, creatorRecentLimit || 10));
    const shouldAutoSave = creatorRecentAutoSaveAfterFetch;
    setShowCreatorRecentWorkbench(true);
    setCreatorRecentResult(null);
    setCreatorBatchResults([]);
    setCreatorBatchProgress({
      completed: 0,
      total: normalizedTargets.length,
      currentLabel: sourceLabel,
    });
    setTaskRunning("creator-recent-batch", true);

    const nextResults: CreatorBatchResultItem[] = [];
    let fuseStopped = false;
    try {
      for (let index = 0; index < normalizedTargets.length; index += 1) {
        const target = normalizedTargets[index];
        if (index > 0) {
          const delaySeconds = randomCreatorBatchDelaySeconds();
          setCreatorBatchProgress({
            completed: index,
            total: normalizedTargets.length,
            currentLabel: `Waiting ${delaySeconds}s before crawling ${target.author}`,
          });
          await wait(delaySeconds * 1000);
        }
        setCreatorBatchProgress({
          completed: index,
          total: normalizedTargets.length,
          currentLabel: target.author,
        });
        try {
          const result = await fetchCreatorRecentDirect(target.query, recentDays, maxNotes);
          nextResults.push({ target, result });
        } catch (err) {
          nextResults.push({
            target,
            error: err instanceof Error ? err.message : "Unknown error",
          });
          if (isXhsCreatorRiskError(err)) {
            fuseStopped = true;
            toast.error("Blogger batch crawl tripped", "Rate limiting / verification / login restriction detected — remaining blogger crawls stopped. Wait for recovery before retrying.");
            setCreatorBatchResults([...nextResults]);
            break;
          }
        }
        setCreatorBatchResults([...nextResults]);
      }

      const successCount = nextResults.filter((item) => item.result).length;
      const failedCount = nextResults.length - successCount;
      const successfulNotes = nextResults.flatMap((item) => item.result?.notes || []);
      setCreatorBatchProgress({
        completed: normalizedTargets.length,
        total: normalizedTargets.length,
        currentLabel: "Done",
      });
      if (successCount > 0) {
        focusCreatorRecentResults();
        if (shouldAutoSave && successfulNotes.length > 0) {
          await handleSaveCreatorRecentNotes(
            successfulNotes,
            sourceLabel,
            "Batch crawl results saved",
          );
        }
      }
      if (successCount > 0 && failedCount === 0) {
        toast.success("Batch crawl finished", `${sourceLabel}: crawled ${successCount} bloggers`);
      } else if (successCount > 0) {
        toast.success("Batch crawl finished", `${successCount} succeeded, ${failedCount} failed`);
      } else if (fuseStopped) {
        toast.error("Batch crawl stopped", "Risk circuit breaker tripped; remaining bloggers were not crawled.");
      } else {
        toast.error("Batch crawl failed", "None of these bloggers returned results");
      }
    } finally {
      setTaskRunning("creator-recent-batch", false);
      window.setTimeout(() => setCreatorBatchProgress(null), 1200);
    }
  };

  const handleRunSelectedCreatorBatch = async () => {
    await runCreatorRecentBatch(selectedCreatorBatchTargets, "Selected bloggers");
  };

  const handleRefreshCreatorRecentResult = async () => {
    if (!creatorRecentResult) return;
    setCreatorRecentResult(null);
    await runCreatorRecentFetch(
      creatorRecentResult.resolved_user_id || creatorRecentResult.creator_query,
      {
        recentDays: creatorRecentResult.recent_days,
        maxNotes: creatorRecentLimit,
      },
    );
  };

  const handleRefreshCreatorBatchResults = async () => {
    if (creatorBatchResults.length === 0) return;
    const targets = creatorBatchResults.map((item) => item.target);
    setCreatorBatchResults([]);
    await runCreatorRecentBatch(targets, "Current batch results");
  };

  const handleRunGroupCreatorBatch = async (
    groupLabel: string,
    groupValue: string,
    members: Array<{
      profileId: string;
      author: string;
      authorId: string;
    }>,
  ) => {
    const targets = buildCreatorBatchTargetsFromMembers(members, groupLabel, groupValue);
    if (targets.length === 0) {
      toast.error("No crawlable bloggers in this group");
      return;
    }
    setSelectedCreatorBatchIds(new Set(targets.map((target) => target.profileId)));
    await runCreatorRecentBatch(targets, groupLabel);
  };

  const saveSharedCreatorGroupMembership = async (profileId: string, nextGroupValues: string[]) => {
    const normalizedProfileId = String(profileId || "").trim();
    if (!normalizedProfileId) return;

    const currentProfile = trackerCreatorProfiles[normalizedProfileId];
    if (!currentProfile) {
      toast.error("No shared group info found for this blogger");
      return;
    }

    const nextGroups = Array.from(new Set(
      nextGroupValues
        .map((groupValue) => String(groupValue || "").trim())
        .filter((groupValue) => groupValue && groupValue !== "__ungrouped__"),
    ));
    const nextGroupLabels = nextGroups.map((groupValue) =>
      trackerCreatorGroupOptions.find((option) => option.value === groupValue)?.label || groupValue
    );
    const currentGroups = Array.from(new Set(
      (currentProfile.smart_groups || [])
        .map((group) => String(group || "").trim())
        .filter(Boolean),
    ));
    const currentGroupKey = [...currentGroups].sort().join("|");
    const nextGroupKey = [...nextGroups].sort().join("|");
    if (currentGroupKey === nextGroupKey) {
      return;
    }

    const normalizedAuthorId = String(currentProfile.author_id || normalizedProfileId).trim();
    const authorLabel = currentProfile.author || normalizedAuthorId || "this blogger";

    setUpdatingSharedCreatorIds((prev) => new Set(prev).add(normalizedProfileId));
    try {
      const nextCreatorProfiles = { ...trackerCreatorProfiles };
      nextCreatorProfiles[normalizedProfileId] = {
        ...(nextCreatorProfiles[normalizedProfileId] || currentProfile),
        smart_groups: nextGroups,
        smart_group_labels: nextGroupLabels,
      };
      if (normalizedAuthorId && normalizedAuthorId !== normalizedProfileId) {
        nextCreatorProfiles[normalizedAuthorId] = {
          ...(nextCreatorProfiles[normalizedAuthorId] || {}),
          ...nextCreatorProfiles[normalizedAuthorId],
          author: nextCreatorProfiles[normalizedAuthorId]?.author || currentProfile.author || normalizedAuthorId,
          author_id: normalizedAuthorId,
          smart_groups: nextGroups,
          smart_group_labels: nextGroupLabels,
        };
      }

      const baseCreatorMonitors = trackerCreatorMonitors.length > 0 ? trackerCreatorMonitors : creatorEntries;
      const nextCreatorMonitors = baseCreatorMonitors.map((monitor) => {
        const monitorUserId = String(monitor.user_id || "").trim();
        if (monitorUserId !== normalizedProfileId && monitorUserId !== normalizedAuthorId) {
          return monitor;
        }
        return {
          ...monitor,
          smart_groups: nextGroups,
          smart_group_labels: nextGroupLabels,
        };
      });

      await api.post("/api/modules/xiaohongshu-tracker/config", {
        ...buildTrackerConfigPayload({
          creator_monitors: nextCreatorMonitors,
        }),
        creator_profiles: nextCreatorProfiles,
      });
      setTrackerCreatorProfiles(nextCreatorProfiles);
      setTrackerCreatorMonitors(nextCreatorMonitors);
      toast.success(
        nextGroups.length > 0 ? "Shared groups updated" : "Moved to ungrouped",
        nextGroups.length > 0
          ? `${authorLabel} joined ${nextGroupLabels.join(", ")}`
          : `${authorLabel} moved to ungrouped`,
      );
    } catch (e) {
      toast.error("Failed to adjust shared groups", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setUpdatingSharedCreatorIds((prev) => {
        const next = new Set(prev);
        next.delete(normalizedProfileId);
        return next;
      });
    }
  };

  const toggleSharedCreatorGroupMembership = async (profileId: string, groupValue: string) => {
    const normalizedProfileId = String(profileId || "").trim();
    const normalizedGroupValue = String(groupValue || "").trim();
    if (!normalizedProfileId || !normalizedGroupValue) return;
    const currentProfile = trackerCreatorProfiles[normalizedProfileId];
    if (!currentProfile) {
      toast.error("No shared group info found for this blogger");
      return;
    }
    const currentGroups = Array.from(new Set(
      (currentProfile.smart_groups || [])
        .map((group) => String(group || "").trim())
        .filter(Boolean),
    ));
    const nextGroups = currentGroups.includes(normalizedGroupValue)
      ? currentGroups.filter((group) => group !== normalizedGroupValue)
      : [...currentGroups, normalizedGroupValue];
    await saveSharedCreatorGroupMembership(normalizedProfileId, nextGroups);
  };

  const renderDetailDivider = () => (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <div style={{ flex: 1, height: "1px", background: "var(--border-light)" }} />
      <span style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)" }}>
        Detailed settings
      </span>
      <div style={{ flex: 1, height: "1px", background: "var(--border-light)" }} />
    </div>
  );

  const toggleCreatorSelectorGroupExpanded = (groupValue: string) => {
    setExpandedCreatorSelectorGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupValue)) next.delete(groupValue);
      else next.add(groupValue);
      return next;
    });
  };

  const toggleSharedManagerGroupExpanded = (groupValue: string) => {
    setExpandedSharedManagerGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupValue)) next.delete(groupValue);
      else next.add(groupValue);
      return next;
    });
    setSharedCreatorManagerPages((prev) => ({
      ...prev,
      [groupValue]: prev[groupValue] || 0,
    }));
  };

  const toggleSharedManagerMemberExpanded = (memberKey: string) => {
    setExpandedSharedManagerMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberKey)) next.delete(memberKey);
      else next.add(memberKey);
      return next;
    });
  };

  const renderSharedCreatorBatchSelector = () => {
    if (visibleSharedCreatorGroups.length === 0) {
      return (
        <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
          Run "shared smart grouping" once first; the final Xiaohongshu grouping results appear here. Then you can crawl whole groups or pick several bloggers for a batch crawl.
        </div>
      );
    }

    return (
      <div
        style={{
          padding: "14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid rgba(255, 138, 0, 0.16)",
          background: "linear-gradient(180deg, rgba(255, 138, 0, 0.06), rgba(255, 255, 255, 0.72))",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div>
          <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
            Shared-group batch crawl
          </div>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "4px" }}>
            This reuses the final Xiaohongshu results of shared smart grouping. Crawl whole groups, or check several bloggers and batch-crawl them together.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(255, 138, 0, 0.16)",
            background: "rgba(255, 255, 255, 0.72)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <span>{selectedCreatorBatchTargets.length} bloggers selected</span>
            <span>{visibleSharedCreatorGroups.length} shared groups</span>
            <span>Scope: last {creatorRecentDays} days / {creatorRecentLimit} per blogger</span>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void handleRunSelectedCreatorBatch()}
              disabled={selectedCreatorBatchTargets.length === 0 || creatorRecentBatchRunning}
              style={{
                ...segmentedButtonStyle(true),
                opacity: selectedCreatorBatchTargets.length === 0 || creatorRecentBatchRunning ? 0.55 : 1,
                cursor: selectedCreatorBatchTargets.length === 0 || creatorRecentBatchRunning ? "not-allowed" : "pointer",
              }}
            >
              {creatorRecentBatchRunning ? "Batch crawling..." : "Crawl selected bloggers"}
            </button>
            <button
              type="button"
              onClick={() => setSelectedCreatorBatchIds(new Set())}
              disabled={selectedCreatorBatchTargets.length === 0 || creatorRecentBatchRunning}
              style={{
                ...segmentedButtonStyle(false),
                opacity: selectedCreatorBatchTargets.length === 0 || creatorRecentBatchRunning ? 0.55 : 1,
                cursor: selectedCreatorBatchTargets.length === 0 || creatorRecentBatchRunning ? "not-allowed" : "pointer",
              }}
            >
              Clear selection
            </button>
          </div>
        </div>

        {creatorBatchProgress ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(255, 138, 0, 0.16)",
              background: "rgba(255, 138, 0, 0.08)",
              fontSize: "0.8125rem",
              color: "#C2410C",
              fontWeight: 700,
            }}
          >
            Batch crawl progress {creatorBatchProgress.completed}/{creatorBatchProgress.total} · current: {creatorBatchProgress.currentLabel}
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {visibleSharedCreatorGroups.map((group) => {
            const expanded = expandedCreatorSelectorGroups.has(group.value);
            const selectableMembers = group.members.filter((member) => String(member.authorId || member.author || "").trim());
            const selectedMemberCount = selectableMembers.filter((member) =>
              selectedCreatorBatchIds.has(member.profileId),
            ).length;
            const isUngrouped = "isUngrouped" in group && Boolean(group.isUngrouped);
            return (
              <div
                key={`selector-${group.value}`}
                style={{
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgba(255, 138, 0, 0.18)",
                  background: selectedMemberCount > 0 ? "rgba(255, 138, 0, 0.10)" : "rgba(255, 255, 255, 0.74)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    alignItems: "stretch",
                    flexWrap: "wrap",
                    padding: "10px 12px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleCreatorSelectorGroupExpanded(group.value)}
                    style={{
                      flex: 1,
                      minWidth: "220px",
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      textAlign: "left",
                      cursor: "pointer",
                      color: "inherit",
                    }}
                  >
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                      <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                        {group.label}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        {group.count} bloggers · {selectedMemberCount} selected
                        {isUngrouped ? " · manual sorting area" : ""}
                      </span>
                    </span>
                  </button>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => {
                        const groupIds = selectableMembers.map((member) => member.profileId);
                        const allSelected = groupIds.length > 0 && groupIds.every((profileId) => selectedCreatorBatchIds.has(profileId));
                        setSelectedCreatorBatchIds((prev) => {
                          const next = new Set(prev);
                          groupIds.forEach((profileId) => {
                            if (allSelected) next.delete(profileId);
                            else next.add(profileId);
                          });
                          return next;
                        });
                      }}
                      disabled={selectableMembers.length === 0 || creatorRecentBatchRunning}
                      style={{
                        alignSelf: "center",
                        padding: "7px 10px",
                        borderRadius: "999px",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-card)",
                        color: "var(--text-secondary)",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        cursor: selectableMembers.length === 0 || creatorRecentBatchRunning ? "not-allowed" : "pointer",
                        opacity: selectableMembers.length === 0 || creatorRecentBatchRunning ? 0.55 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selectableMembers.length > 0 && selectableMembers.every((member) => selectedCreatorBatchIds.has(member.profileId))
                        ? "Deselect this group"
                        : "Select this group"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRunGroupCreatorBatch(group.label, group.value, group.members)}
                      disabled={selectableMembers.length === 0 || creatorRecentBatchRunning}
                      style={{
                        ...segmentedButtonStyle(true),
                        opacity: selectableMembers.length === 0 || creatorRecentBatchRunning ? 0.55 : 1,
                        cursor: selectableMembers.length === 0 || creatorRecentBatchRunning ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Crawl this group
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div
                    style={{
                      padding: "0 12px 12px",
                      borderTop: "1px solid rgba(255, 138, 0, 0.12)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "10px" }}>
                      {isUngrouped
                        ? "Bloggers not yet placed in any shared group. Check them for a batch crawl, or crawl one individually."
                        : "Check several bloggers for a unified batch crawl, or immediately crawl one blogger's recent content individually."}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {group.members.map((member) => {
                        const memberSelected = selectedCreatorBatchIds.has(member.profileId);
                        const canSelectIndividually = Boolean(String(member.authorId || member.author || "").trim());
                        return (
                          <div
                            key={`selector-member-${group.value}-${member.authorId || member.profileId}`}
                            style={{
                              padding: "10px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: memberSelected ? "rgba(255, 36, 66, 0.06)" : "var(--bg-card)",
                              display: "flex",
                              justifyContent: "space-between",
                              gap: "12px",
                              alignItems: "flex-start",
                              flexWrap: "wrap",
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                                  {member.author}
                                </span>
                                <span style={{ fontSize: "0.6875rem", color: memberSelected ? "var(--color-primary)" : "var(--text-muted)" }}>
                                  {memberSelected ? "In batch list" : canSelectIndividually ? "Not selected" : "Needs user_id"}
                                </span>
                                {member.inTracker ? (
                                  <span style={{ fontSize: "0.6875rem", color: "#C2410C" }}>
                                    In follow push
                                  </span>
                                ) : null}
                              </div>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                                Latest: {member.latestTitle || "no sample title"}
                              </div>
                              {member.sampleLabels.length > 0 ? (
                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                  {member.sampleLabels.slice(0, 3).map((label) => (
                                    <span
                                      key={`selector-label-${member.authorId || member.profileId}-${label}`}
                                      style={{
                                        padding: "3px 6px",
                                        borderRadius: "var(--radius-sm)",
                                        background: "rgba(255, 138, 0, 0.08)",
                                        color: "#C2410C",
                                        fontSize: "0.6875rem",
                                      }}
                                    >
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                onClick={() => toggleCreatorBatchSelection(member.profileId)}
                                disabled={!canSelectIndividually}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: "999px",
                                  border: `1px solid ${memberSelected ? "rgba(255, 36, 66, 0.24)" : "var(--border-light)"}`,
                                  background: memberSelected ? "rgba(255, 36, 66, 0.10)" : "var(--bg-card)",
                                  color: memberSelected ? "var(--color-primary)" : canSelectIndividually ? "var(--text-secondary)" : "var(--text-muted)",
                                  fontSize: "0.75rem",
                                  fontWeight: 700,
                                  cursor: canSelectIndividually ? "pointer" : "not-allowed",
                                  opacity: canSelectIndividually ? 1 : 0.55,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {!canSelectIndividually ? "Needs user_id" : memberSelected ? "Deselect" : "Select blogger"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void runCreatorRecentFetch(member.authorId || member.author, {
                                  recentDays: creatorRecentDays,
                                  maxNotes: creatorRecentLimit,
                                })}
                                disabled={!canSelectIndividually || creatorRecentBatchRunning}
                                style={{
                                  ...segmentedButtonStyle(true),
                                  padding: "6px 10px",
                                  fontSize: "0.75rem",
                                  opacity: !canSelectIndividually || creatorRecentBatchRunning ? 0.55 : 1,
                                  cursor: !canSelectIndividually || creatorRecentBatchRunning ? "not-allowed" : "pointer",
                                }}
                              >
                                Crawl individually
                              </button>
                              <button
                                type="button"
                                onClick={() => void openExternalUrl(member.profileUrl, `${member.author}'s profile`)}
                                disabled={!member.profileUrl}
                                style={{
                                  ...segmentedButtonStyle(false),
                                  padding: "6px 10px",
                                  fontSize: "0.75rem",
                                  opacity: member.profileUrl ? 1 : 0.55,
                                  cursor: member.profileUrl ? "pointer" : "not-allowed",
                                }}
                              >
                                Profile
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSharedCreatorGroupManager = () => {
    if (allSharedCreatorMembers.length === 0) {
      return (
        <div
          style={{
            padding: "14px",
            borderRadius: "var(--radius-md)",
            border: "1px dashed rgba(255, 36, 66, 0.18)",
            background: "rgba(255, 36, 66, 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <button
            type="button"
            aria-expanded={showSharedCreatorGroupManager}
            onClick={() => setShowSharedCreatorGroupManager((value) => !value)}
            style={{
              width: "100%",
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                  Manage shared groups
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "4px" }}>
                  No manageable creator members yet.
                </div>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: "1px solid rgba(255, 36, 66, 0.16)",
                  background: "rgba(255, 255, 255, 0.72)",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                }}
              >
                {showSharedCreatorGroupManager ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showSharedCreatorGroupManager ? "Collapse" : "Expand"}
              </span>
            </div>
          </button>
          {showSharedCreatorGroupManager ? (
            <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              Run "shared smart grouping" once first; manually sortable Xiaohongshu blogger members appear here afterwards.
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div
        style={{
          padding: "14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid rgba(255, 36, 66, 0.14)",
          background: "linear-gradient(180deg, rgba(255, 36, 66, 0.04), rgba(255, 255, 255, 0.76))",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <button
          type="button"
          aria-expanded={showSharedCreatorGroupManager}
          onClick={() => setShowSharedCreatorGroupManager((value) => !value)}
          style={{
            width: "100%",
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                Manage shared groups
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "4px" }}>
                {allSharedCreatorMembers.length} bloggers total · {filteredSharedCreatorMembers.length} filtered · {ungroupedCreatorMembers.length} ungrouped · {trackerCreatorGroupOptions.length} shared groups
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "999px",
                border: "1px solid rgba(255, 36, 66, 0.16)",
                background: "rgba(255, 255, 255, 0.72)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 700,
              }}
            >
              {showSharedCreatorGroupManager ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showSharedCreatorGroupManager ? "Collapse" : "Expand"}
            </span>
          </div>
        </button>

        {showSharedCreatorGroupManager ? (
          <>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Click a group name to expand, then click a creator name for details. Each blogger can join multiple shared groups; removing all groups returns them to "ungrouped".
            </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(255, 36, 66, 0.14)",
            background: "rgba(255, 255, 255, 0.78)",
          }}
        >
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <span>{allSharedCreatorMembers.length} bloggers total</span>
            <span>{filteredSharedCreatorMembers.length} filtered</span>
            <span>{ungroupedCreatorMembers.length} ungrouped</span>
            <span>{trackerCreatorGroupOptions.length} shared groups</span>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", flex: "1 1 420px", justifyContent: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
              Per page
              <select
                value={sharedCreatorManagerPageSize}
                onChange={(e) => setSharedCreatorManagerPageSize(Number(e.target.value) === 50 ? 50 : 20)}
                style={{ ...compactControlStyle, padding: "8px 10px", width: "84px" }}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
            <input
              type="text"
              value={sharedCreatorManagerQuery}
              onChange={(e) => {
                setSharedCreatorManagerQuery(e.target.value);
                setSharedCreatorManagerPages({});
              }}
              placeholder="Search bloggers, titles, or groups"
              style={{ ...compactControlStyle, minWidth: "240px", flex: "1 1 240px", maxWidth: "360px" }}
            />
          </div>
        </div>

        {filteredSharedCreatorManagerGroups.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {filteredSharedCreatorManagerGroups.map((group) => {
              const isUngrouped = "isUngrouped" in group && Boolean(group.isUngrouped);
              const expanded = expandedSharedManagerGroups.has(group.value);
              const currentPage = Math.max(0, sharedCreatorManagerPages[group.value] || 0);
              const pageCount = Math.max(1, Math.ceil(group.members.length / sharedCreatorManagerPageSize));
              const normalizedPage = Math.min(currentPage, pageCount - 1);
              const pagedMembers = group.members.slice(
                normalizedPage * sharedCreatorManagerPageSize,
                normalizedPage * sharedCreatorManagerPageSize + sharedCreatorManagerPageSize,
              );
              return (
                <div
                  key={`manager-group-${group.value}`}
                  style={{
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(255, 36, 66, 0.10)",
                    background: "var(--bg-card)",
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleSharedManagerGroupExpanded(group.value)}
                    aria-expanded={expanded}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      border: "none",
                      background: expanded ? "rgba(255, 36, 66, 0.05)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                          {group.label}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.5 }}>
                          {group.members.length} creators
                          {isUngrouped ? " · ungrouped members" : ""}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {expanded ? "Collapse" : "Expand"}
                    </span>
                  </button>

                  {expanded ? (
                    <div
                      style={{
                        padding: "0 14px 14px",
                        borderTop: "1px solid rgba(255, 36, 66, 0.10)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap", marginTop: "12px" }}>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          {isUngrouped
                            ? "Creators manually removed from all shared groups."
                            : "Click a creator name to expand details, then adjust groups or crawl individually."}
                        </div>
                        {pageCount > 1 ? (
                          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => setSharedCreatorManagerPages((prev) => ({
                                ...prev,
                                [group.value]: Math.max(0, normalizedPage - 1),
                              }))}
                              disabled={normalizedPage === 0}
                              style={{
                                ...segmentedButtonStyle(false),
                                padding: "6px 10px",
                                fontSize: "0.75rem",
                                opacity: normalizedPage === 0 ? 0.55 : 1,
                                cursor: normalizedPage === 0 ? "not-allowed" : "pointer",
                              }}
                            >
                              Previous
                            </button>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              Page {normalizedPage + 1} / {pageCount}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSharedCreatorManagerPages((prev) => ({
                                ...prev,
                                [group.value]: Math.min(pageCount - 1, normalizedPage + 1),
                              }))}
                              disabled={normalizedPage >= pageCount - 1}
                              style={{
                                ...segmentedButtonStyle(false),
                                padding: "6px 10px",
                                fontSize: "0.75rem",
                                opacity: normalizedPage >= pageCount - 1 ? 0.55 : 1,
                                cursor: normalizedPage >= pageCount - 1 ? "not-allowed" : "pointer",
                              }}
                            >
                              Next
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {pagedMembers.map((member) => {
                          const memberKey = `${group.value}-${member.profileId}`;
                          const memberExpanded = expandedSharedManagerMembers.has(memberKey);
                          const memberSelected = selectedCreatorBatchIds.has(member.profileId);
                          const canSelectIndividually = Boolean(String(member.authorId || member.author || "").trim());
                          const savingSharedGroup = updatingSharedCreatorIds.has(member.profileId);
                          const currentGroups = Array.from(new Set(
                            (member.profile.smart_groups || [])
                              .map((item) => String(item || "").trim())
                              .filter(Boolean),
                          ));
                          const currentGroupLabels = getCreatorGroupLabels(member.profile);
                          return (
                            <div
                              key={`manager-member-${memberKey}`}
                              style={{
                                borderRadius: "var(--radius-sm)",
                                border: "1px solid rgba(255, 36, 66, 0.10)",
                                background: memberSelected ? "rgba(255, 36, 66, 0.05)" : "var(--bg-card)",
                                overflow: "hidden",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => toggleSharedManagerMemberExpanded(memberKey)}
                                aria-expanded={memberExpanded}
                                style={{
                                  width: "100%",
                                  padding: "10px 12px",
                                  border: "none",
                                  background: "transparent",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: "12px",
                                  textAlign: "left",
                                  cursor: "pointer",
                                }}
                              >
                                <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                    {memberExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                                      {member.author}
                                    </span>
                                    <span style={{ fontSize: "0.6875rem", color: memberSelected ? "var(--color-primary)" : "var(--text-muted)" }}>
                                      {memberSelected ? "In batch list" : canSelectIndividually ? "Manageable" : "Needs user_id"}
                                    </span>
                                    {member.inTracker ? (
                                      <span style={{ fontSize: "0.6875rem", color: "#C2410C" }}>
                                        In follow push
                                      </span>
                                    ) : null}
                                  </div>
                                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                                    Latest: {member.latestTitle || "no sample title"}
                                  </div>
                                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    {currentGroupLabels.length > 0 ? currentGroupLabels.slice(0, 3).map((label) => (
                                      <span
                                        key={`manager-current-group-${member.profileId}-${label}`}
                                        style={{
                                          padding: "3px 7px",
                                          borderRadius: "999px",
                                          background: "rgba(255, 138, 0, 0.10)",
                                          color: "#C2410C",
                                          fontSize: "0.6875rem",
                                          fontWeight: 700,
                                        }}
                                      >
                                        {label}
                                      </span>
                                    )) : (
                                      <span
                                        style={{
                                          padding: "3px 7px",
                                          borderRadius: "999px",
                                          background: "rgba(148, 163, 184, 0.14)",
                                          color: "var(--text-secondary)",
                                          fontSize: "0.6875rem",
                                          fontWeight: 700,
                                        }}
                                      >
                                        Ungrouped
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                                  {memberExpanded ? "Collapse details" : "Expand details"}
                                </span>
                              </button>

                              {memberExpanded ? (
                                <div
                                  style={{
                                    padding: "0 12px 12px",
                                    borderTop: "1px solid rgba(255, 36, 66, 0.10)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "10px",
                                  }}
                                >
                                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "10px" }}>
                                    {member.sourceSummary || "Source: local bookmarks / group sorting"}
                                  </div>

                                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    {member.sampleLabels.slice(0, 5).map((label) => (
                                      <span
                                        key={`manager-label-${member.profileId}-${label}`}
                                        style={{
                                          padding: "3px 7px",
                                          borderRadius: "999px",
                                          background: "var(--bg-hover)",
                                          color: "var(--text-secondary)",
                                          fontSize: "0.6875rem",
                                        }}
                                      >
                                        {label}
                                      </span>
                                    ))}
                                  </div>

                                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-start" }}>
                                    <button
                                      type="button"
                                      onClick={() => toggleCreatorBatchSelection(member.profileId)}
                                      disabled={!canSelectIndividually}
                                      style={{
                                        padding: "6px 10px",
                                        borderRadius: "999px",
                                        border: `1px solid ${memberSelected ? "rgba(255, 36, 66, 0.24)" : "var(--border-light)"}`,
                                        background: memberSelected ? "rgba(255, 36, 66, 0.10)" : "var(--bg-card)",
                                        color: memberSelected ? "var(--color-primary)" : canSelectIndividually ? "var(--text-secondary)" : "var(--text-muted)",
                                        fontSize: "0.75rem",
                                        fontWeight: 700,
                                        cursor: canSelectIndividually ? "pointer" : "not-allowed",
                                        opacity: canSelectIndividually ? 1 : 0.55,
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {!canSelectIndividually ? "Needs user_id" : memberSelected ? "Deselect" : "Add to batch crawl"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void runCreatorRecentFetch(member.authorId || member.author, {
                                        recentDays: creatorRecentDays,
                                        maxNotes: creatorRecentLimit,
                                      })}
                                      disabled={!canSelectIndividually || creatorRecentBatchRunning}
                                      style={{
                                        ...segmentedButtonStyle(true),
                                        padding: "6px 10px",
                                        fontSize: "0.75rem",
                                        opacity: !canSelectIndividually || creatorRecentBatchRunning ? 0.55 : 1,
                                        cursor: !canSelectIndividually || creatorRecentBatchRunning ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      Crawl individually
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void openExternalUrl(member.profileUrl, `${member.author}'s profile`)}
                                      disabled={!member.profileUrl}
                                      style={{
                                        ...segmentedButtonStyle(false),
                                        padding: "6px 10px",
                                        fontSize: "0.75rem",
                                        opacity: member.profileUrl ? 1 : 0.55,
                                        cursor: member.profileUrl ? "pointer" : "not-allowed",
                                      }}
                                    >
                                      Profile
                                    </button>
                                  </div>

                                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                      Shared groups
                                    </span>
                                    {trackerCreatorGroupOptions.map((option) => {
                                      const active = currentGroups.includes(option.value);
                                      return (
                                        <button
                                          key={`manager-group-toggle-${member.profileId}-${option.value}`}
                                          type="button"
                                          onClick={() => void toggleSharedCreatorGroupMembership(member.profileId, option.value)}
                                          disabled={savingSharedGroup}
                                          style={{
                                            padding: "6px 10px",
                                            borderRadius: "999px",
                                            border: `1px solid ${active ? "rgba(255, 36, 66, 0.26)" : "var(--border-light)"}`,
                                            background: active ? "rgba(255, 36, 66, 0.10)" : "var(--bg-card)",
                                            color: active ? "var(--color-primary)" : "var(--text-secondary)",
                                            fontSize: "0.75rem",
                                            fontWeight: 700,
                                            cursor: savingSharedGroup ? "wait" : "pointer",
                                            opacity: savingSharedGroup ? 0.65 : 1,
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {active ? `In ${option.label}` : `Join ${option.label}`}
                                        </button>
                                      );
                                    })}
                                    <button
                                      type="button"
                                      onClick={() => void saveSharedCreatorGroupMembership(member.profileId, [])}
                                      disabled={savingSharedGroup || currentGroups.length === 0}
                                      style={{
                                        padding: "6px 10px",
                                        borderRadius: "999px",
                                        border: "1px solid var(--border-light)",
                                        background: currentGroups.length === 0 ? "rgba(148, 163, 184, 0.10)" : "var(--bg-card)",
                                        color: currentGroups.length === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                                        fontSize: "0.75rem",
                                        fontWeight: 700,
                                        cursor: savingSharedGroup || currentGroups.length === 0 ? "not-allowed" : "pointer",
                                        opacity: savingSharedGroup || currentGroups.length === 0 ? 0.55 : 1,
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      Move to ungrouped
                                    </button>
                                    <span style={{ fontSize: "0.6875rem", color: savingSharedGroup ? "#C2410C" : "var(--text-muted)" }}>
                                      {savingSharedGroup ? "Saving..." : "Multiple groups supported"}
                                    </span>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            No shared group members match the current search.
          </div>
        )}
          </>
        ) : null}
      </div>
    );
  };

  const renderFrequentAuthorQuickPicker = () => {
    if (authorCandidates.length === 0) {
      return (
        <div
          style={{
            padding: "14px",
            borderRadius: "var(--radius-md)",
            border: "1px dashed var(--border-light)",
            background: "var(--bg-hover)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
              Quick-add frequent bloggers
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "4px" }}>
              After shared smart grouping finishes, frequent bloggers are sorted by how often authors appear in local content; <span style={{ fontWeight: 800, color: "var(--color-primary)" }}>click an avatar to add</span>, or use the card buttons to add them to targeted follow crawls.
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button type="button" onClick={handleBuildSmartGroups} style={segmentedButtonStyle(true)}>
              Generate shared smart groups
            </button>
            <button type="button" onClick={handleRefreshSharedCreatorAssignments} style={segmentedButtonStyle(false)}>
              Organize creators only
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          padding: "14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid rgba(255, 36, 66, 0.16)",
          background: "linear-gradient(180deg, rgba(255, 36, 66, 0.06), rgba(255, 138, 0, 0.04))",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
              Quick-add frequent bloggers
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "4px" }}>
              Sorted by frequency in bookmarks, 12 per page; <span style={{ fontWeight: 800, color: "var(--color-primary)" }}>click an avatar to add</span>, or use the card buttons to add or remove.
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button type="button" onClick={handleBuildSmartGroups} style={segmentedButtonStyle(false)}>
              Refresh shared smart groups
            </button>
            <button type="button" onClick={handleRefreshSharedCreatorAssignments} style={segmentedButtonStyle(false)}>
              Organize creators only
            </button>
          </div>
        </div>

        {authorCandidateMeta && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            {authorCandidateMeta.message}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setFrequentAuthorGroupFilter("all")}
            style={segmentedButtonStyle(frequentAuthorGroupFilter === "all")}
          >
            All · {frequentAuthorCandidates.length}
          </button>
          {frequentAuthorGroupOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFrequentAuthorGroupFilter(option.value)}
              style={segmentedButtonStyle(frequentAuthorGroupFilter === option.value)}
            >
              {option.label} · {frequentAuthorGroupCounts[option.value] || 0}
            </button>
          ))}
        </div>

        {filteredFrequentAuthorCandidates.length > 0 ? (
          <>
            <PaginationControls
              totalCount={filteredFrequentAuthorCandidates.length}
              page={safeFrequentAuthorPage}
              pageSize={FREQUENT_AUTHOR_PAGE_SIZE}
              itemLabel="bloggers"
              onPageChange={setFrequentAuthorPage}
              emptyText="No bloggers match the current filter"
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
            {visibleFrequentAuthorCandidates.map((candidate, index) => {
              const candidateAuthorId = normalizeXhsProfileUserId(candidate.author_id || resolveKnownAuthorId(candidate.author));
              const alreadyTracked = Boolean(candidateAuthorId) && creatorMonitorByUserId.has(candidateAuthorId);
              const groupLabels = getCandidateGroupLabels(candidate);
              const avatarText = (candidate.author || "?").trim().slice(0, 2) || "?";
              const rank = ((safeFrequentAuthorPage - 1) * FREQUENT_AUTHOR_PAGE_SIZE) + index + 1;
              return (
                <div
                  key={`${candidate.author}-${candidate.author_id || index}`}
                  style={{
                    padding: "12px",
                    borderRadius: "var(--radius-sm)",
                    border: alreadyTracked ? "1px solid rgba(255, 36, 66, 0.28)" : "1px solid var(--border-light)",
                    background: alreadyTracked ? "rgba(255, 36, 66, 0.06)" : "var(--bg-card)",
                    display: "flex",
                    gap: "12px",
                    alignItems: "flex-start",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void handleAddFrequentAuthorToCreatorMonitor(candidate)}
                    disabled={!candidateAuthorId}
                    title={candidateAuthorId ? "Click the avatar to add to targeted follow crawls" : "No user_id resolved for this author yet"}
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "50%",
                      border: "none",
                      background: alreadyTracked
                        ? "linear-gradient(135deg, rgba(255, 36, 66, 0.92), rgba(255, 138, 0, 0.88))"
                        : "linear-gradient(135deg, rgba(255, 36, 66, 0.16), rgba(255, 138, 0, 0.14))",
                      color: alreadyTracked ? "white" : "var(--color-primary)",
                      fontSize: "0.875rem",
                      fontWeight: 800,
                      cursor: candidateAuthorId ? "pointer" : "not-allowed",
                      opacity: candidateAuthorId ? 1 : 0.45,
                      flexShrink: 0,
                    }}
                  >
                    {avatarText}
                  </button>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                      <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {candidate.author}
                      </span>
                      <span style={{ fontSize: "0.6875rem", color: alreadyTracked ? "var(--color-primary)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {alreadyTracked ? "Added" : `TOP ${rank}`}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      Appears {candidate.note_count} times in bookmarks · saves {candidate.total_collects} · likes {candidate.total_likes}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                      Latest: {candidate.latest_title || "none"}
                    </div>
                    {groupLabels.length > 0 ? (
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {groupLabels.slice(0, 3).map((label) => (
                          <span
                            key={label}
                            style={{
                              padding: "3px 6px",
                              borderRadius: "var(--radius-sm)",
                              background: "rgba(255, 138, 0, 0.10)",
                              color: "#C2410C",
                              fontSize: "0.6875rem",
                              fontWeight: 700,
                            }}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "2px" }}>
                      {alreadyTracked ? (
                        <button
                          type="button"
                          onClick={() => void handleRemoveCreatorUser(candidateAuthorId)}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid rgba(239, 68, 68, 0.22)",
                            background: "rgba(239, 68, 68, 0.08)",
                            color: "#DC2626",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleAddFrequentAuthorToCreatorMonitor(candidate)}
                          disabled={!candidateAuthorId}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid rgba(255, 36, 66, 0.22)",
                            background: candidateAuthorId ? "rgba(255, 36, 66, 0.10)" : "var(--bg-hover)",
                            color: candidateAuthorId ? "var(--color-primary)" : "var(--text-muted)",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: candidateAuthorId ? "pointer" : "not-allowed",
                          }}
                        >
                          {candidateAuthorId ? "One-click add" : "user_id pending"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
            <PaginationControls
              totalCount={filteredFrequentAuthorCandidates.length}
              page={safeFrequentAuthorPage}
              pageSize={FREQUENT_AUTHOR_PAGE_SIZE}
              itemLabel="bloggers"
              onPageChange={setFrequentAuthorPage}
              emptyText="No bloggers match the current filter"
            />
          </>
        ) : (
          <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            No bloggers match the current filter. Switch back to "All" or re-run smart grouping first.
          </div>
        )}
      </div>
    );
  };

  const renderCreatorRecentWorkbenchContent = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <button
        type="button"
        aria-expanded={showCreatorRecentWorkbench}
        onClick={() => setShowCreatorRecentWorkbench((value) => !value)}
        style={{
          width: "100%",
          padding: "0",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
              Enter a blogger name, profile link, or `user_id` to manually crawl recent posts
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "4px" }}>
              Collapsed by default. Expand to crawl recent content directly; whole-group crawls and batch selections in shared groups reuse this same flow.
            </div>
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              borderRadius: "999px",
              border: "1px solid var(--border-light)",
              background: "var(--bg-card)",
              color: "var(--text-secondary)",
              fontSize: "0.75rem",
              fontWeight: 700,
            }}
          >
            {showCreatorRecentWorkbench ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {showCreatorRecentWorkbench ? "Collapse" : "Expand"}
          </div>
        </div>
      </button>

      {showCreatorRecentWorkbench && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            If you enter a name, it first matches against the locally recorded name-to-ID mapping, then crawls recent days. Below you can also use shared group results for whole-group or multi-blogger batch crawls and manually sort group members.
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              value={creatorSearchQuery}
              onChange={(e) => setCreatorSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (isActionEnterKey(e)) {
                  e.preventDefault();
                  void handleFetchCreatorRecent();
                }
              }}
              placeholder="Enter blogger name, profile link, or user_id"
              style={{ ...compactControlStyle, flex: 1, minWidth: "260px" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              Last
              <input
                type="number"
                min={1}
                max={365}
                value={creatorRecentDays}
                onChange={(e) => setCreatorRecentDays(Number(e.target.value || 1))}
                style={{ ...compactControlStyle, width: "88px" }}
              />
              days
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              Fetch
              <input
                type="number"
                min={1}
                max={50}
                value={creatorRecentLimit}
                onChange={(e) => setCreatorRecentLimit(Number(e.target.value || 1))}
                style={{ ...compactControlStyle, width: "88px" }}
              />
              items
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <input
                type="checkbox"
                checked={creatorRecentAutoSaveAfterFetch}
                onChange={(e) => setCreatorRecentAutoSaveAfterFetch(e.target.checked)}
              />
              Auto-save after crawling
            </label>
            <button
              type="button"
              onClick={() => void handleFetchCreatorRecent()}
              disabled={creatorRecentRunning || !creatorSearchQuery.trim()}
              style={segmentedButtonStyle(true)}
            >
              {creatorRecentRunning ? "Crawling..." : "Crawl recent posts"}
            </button>
            {creatorRecentRunning && creatorRecentTaskId ? (
              <button
                type="button"
                onClick={() => void handleCancelCreatorRecent()}
                style={segmentedButtonStyle(false)}
              >
                Stop
              </button>
            ) : null}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Targeted blogger crawls use the extension-bridge-first path: the browser extension opens the blogger's profile and reads page state / DOM, consistent with album and search crawls.
            There is no silent Playwright fallback; if the extension is disconnected, no notes are read, or rate-limit / QR / login restrictions occur, the task stops and prompts you. Keep batch crawl frequency low.
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(245, 158, 11, 0.45)",
              background: "rgba(245, 158, 11, 0.12)",
              color: "#92400e",
              fontSize: "0.8125rem",
              fontWeight: 700,
              lineHeight: 1.6,
            }}
          >
            Risk note: visiting a blogger's profile can itself trigger Xiaohongshu rate limiting / security verification, even via the extension bridge. Prefer the extension path, run small low-frequency batches, and stop immediately when restricted.
          </div>

          {renderSharedCreatorBatchSelector()}
        </div>
      )}

      {creatorBatchResults.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
              Batch crawl results · {creatorBatchResults.filter((item) => item.result).length} succeeded / {creatorBatchResults.filter((item) => item.error).length} failed
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => void handleSaveCreatorRecentNotes(
                  creatorBatchResults.flatMap((item) => item.result?.notes || []),
                  "Blogger recent posts batch crawl",
                  "Batch crawl results saved",
                )}
                disabled={previewSaveRunning || creatorBatchResults.every((item) => !item.result?.notes?.length)}
                style={{
                  ...segmentedButtonStyle(true),
                  opacity: previewSaveRunning || creatorBatchResults.every((item) => !item.result?.notes?.length) ? 0.55 : 1,
                  cursor: previewSaveRunning || creatorBatchResults.every((item) => !item.result?.notes?.length) ? "not-allowed" : "pointer",
                }}
              >
                <FolderDown style={{ width: "14px", height: "14px" }} />
                {previewSaveRunning ? "Saving..." : "Save all results"}
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshCreatorBatchResults()}
                disabled={creatorRecentBatchRunning}
                style={{
                  ...segmentedButtonStyle(false),
                  opacity: creatorRecentBatchRunning ? 0.55 : 1,
                  cursor: creatorRecentBatchRunning ? "not-allowed" : "pointer",
                }}
              >
                <RefreshCw style={{ width: "14px", height: "14px" }} />
                {creatorRecentBatchRunning ? "Refreshing..." : "Refresh results"}
              </button>
              <button
                type="button"
                onClick={() => setCreatorBatchResults([])}
                disabled={creatorRecentBatchRunning}
                style={{
                  ...segmentedButtonStyle(false),
                  opacity: creatorRecentBatchRunning ? 0.55 : 1,
                  cursor: creatorRecentBatchRunning ? "not-allowed" : "pointer",
                }}
              >
                Clear results
              </button>
            </div>
          </div>

          {creatorBatchResults.map((item) => (
            <div
              key={`creator-batch-${item.target.profileId}`}
              style={{
                padding: "14px",
                borderRadius: "var(--radius-md)",
                border: item.result ? "1px solid rgba(255, 138, 0, 0.18)" : "1px solid rgba(239, 68, 68, 0.20)",
                background: item.result ? "var(--bg-card)" : "rgba(239, 68, 68, 0.05)",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                      {resolveCreatorDisplayLabel(
                        item.result?.resolved_author || item.target.author,
                        item.result?.notes || [],
                        item.result?.resolved_user_id || item.target.authorId,
                      )}
                    </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                    {item.target.groupLabel ? `${item.target.groupLabel} · ` : ""}
                    {item.result
                      ? `Last ${item.result.recent_days} days, ${item.result.total_found} items`
                      : item.error || "Crawl failed"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  {item.result ? (
                    <button
                      type="button"
                      onClick={() => void handleSaveCreatorRecentNotes(
                        item.result?.notes || [],
                        resolveCreatorDisplayLabel(
                          item.result?.resolved_author || item.target.author,
                          item.result?.notes || [],
                          item.result?.resolved_user_id || item.target.authorId,
                        ),
                        `${resolveCreatorDisplayLabel(
                          item.result?.resolved_author || item.target.author,
                          item.result?.notes || [],
                          item.result?.resolved_user_id || item.target.authorId,
                        )} posts saved`,
                        item.result?.resolved_user_id || item.target.authorId,
                      )}
                      disabled={previewSaveRunning || item.result.notes.length === 0}
                      style={{
                        ...segmentedButtonStyle(true),
                        opacity: previewSaveRunning || item.result.notes.length === 0 ? 0.55 : 1,
                        cursor: previewSaveRunning || item.result.notes.length === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      <FolderDown style={{ width: "14px", height: "14px" }} />
                      {previewSaveRunning ? "Saving..." : "Save all"}
                    </button>
                  ) : null}
                  {item.result?.profile_url || item.target.authorId ? (
                    <button
                      type="button"
                      onClick={() => void openExternalUrl(
                        item.result?.profile_url || buildXhsProfileUrl(item.target.authorId),
                        `${resolveCreatorDisplayLabel(
                          item.result?.resolved_author || item.target.author,
                          item.result?.notes || [],
                          item.result?.resolved_user_id || item.target.authorId,
                        )}'s profile`,
                      )}
                      style={segmentedButtonStyle(false)}
                    >
                      Profile
                    </button>
                  ) : null}
                </div>
              </div>

              {item.result ? (
                item.result.notes.length > 0 ? (
                  renderCreatorNoteResults({
                    notes: item.result.notes,
                    carouselRef: creatorBatchResultCarouselRef,
                    layout: creatorBatchResultLayout,
                    onLayoutChange: setCreatorBatchResultLayout,
                    expandedIds: expandedCreatorBatchNotes,
                    onToggleExpand: (noteId) => setExpandedCreatorBatchNotes((prev) => {
                      const next = new Set(prev);
                      if (next.has(noteId)) next.delete(noteId);
                      else next.add(noteId);
                      return next;
                    }),
                    sourceLabel: resolveCreatorDisplayLabel(
                      item.result.resolved_author || item.target.author,
                      item.result.notes,
                      item.result.resolved_user_id || item.target.authorId,
                    ),
                    saveAllTitle: `${resolveCreatorDisplayLabel(
                      item.result.resolved_author || item.target.author,
                      item.result.notes,
                      item.result.resolved_user_id || item.target.authorId,
                    )} posts saved`,
                  })
                ) : (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    This blogger has no available content in the current time range.
                  </div>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {creatorRecentResult ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 700 }}>
              {creatorRecentDisplayLabel} · last {creatorRecentResult.recent_days} days, {creatorRecentResult.total_found} items
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => void handleSaveCreatorRecentNotes(
                  creatorRecentResult.notes,
                  creatorRecentResult.resolved_author || creatorRecentResult.creator_query,
                  "Blogger's recent posts saved",
                  creatorRecentResult.resolved_user_id,
                )}
                disabled={previewSaveRunning || creatorRecentResult.notes.length === 0}
                style={{
                  ...segmentedButtonStyle(true),
                  opacity: previewSaveRunning || creatorRecentResult.notes.length === 0 ? 0.55 : 1,
                  cursor: previewSaveRunning || creatorRecentResult.notes.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                <FolderDown style={{ width: "14px", height: "14px" }} />
                {previewSaveRunning ? "Saving..." : "Save all"}
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshCreatorRecentResult()}
                disabled={creatorRecentRunning}
                style={{
                  ...segmentedButtonStyle(false),
                  opacity: creatorRecentRunning ? 0.55 : 1,
                  cursor: creatorRecentRunning ? "not-allowed" : "pointer",
                }}
              >
                <RefreshCw style={{ width: "14px", height: "14px" }} />
                {creatorRecentRunning ? "Refreshing..." : "Refresh results"}
              </button>
              <button
                type="button"
                onClick={() => void handleAddFrequentAuthorToCreatorMonitor({
                  author: creatorRecentDisplayLabel,
                  author_id: creatorRecentResult.resolved_user_id,
                  note_count: creatorRecentResult.total_found,
                  total_likes: creatorRecentResult.notes.reduce((sum, item) => sum + (item.likes || 0), 0),
                  total_collects: creatorRecentResult.notes.reduce((sum, item) => sum + (item.collects || 0), 0),
                  total_comments: creatorRecentResult.notes.reduce((sum, item) => sum + (item.comments_count || 0), 0),
                  latest_date: creatorRecentResult.notes[0]?.published_at || "",
                  latest_title: creatorRecentResult.notes[0]?.title || "",
                  sample_note_urls: creatorRecentResult.notes.map((item) => item.url).filter(Boolean).slice(0, 6),
                  sample_titles: creatorRecentResult.notes.map((item) => item.title).filter(Boolean).slice(0, 6),
                  sample_albums: [],
                  sample_tags: [],
                  source_summary: `From targeted blogger crawl: ${creatorRecentResult.creator_query}`,
                  score: creatorRecentResult.notes.reduce((sum, item) => sum + (item.likes || 0) + (item.collects || 0), 0),
                })}
                style={segmentedButtonStyle(
                  trackerCreatorMonitors.some((monitor) => monitor.user_id === creatorRecentResult.resolved_user_id)
                )}
              >
                {trackerCreatorMonitors.some((monitor) => monitor.user_id === creatorRecentResult.resolved_user_id)
                  ? "Already followed"
                  : "Add targeted follow"}
              </button>
              <button
                type="button"
                onClick={() => void openExternalUrl(
                  creatorRecentResult.profile_url || buildXhsProfileUrl(creatorRecentResult.resolved_user_id),
                  `${creatorRecentDisplayLabel}'s profile`,
                )}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "var(--color-primary)",
                  textDecoration: "none",
                  fontSize: "0.8125rem",
                  fontWeight: 700,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <ExternalLink size={14} />
                Open profile
              </button>
            </div>
          </div>
          {creatorRecentResult.notes.length > 0 ? renderCreatorNoteResults({
            notes: creatorRecentResult.notes,
            carouselRef: creatorRecentResultCarouselRef,
            layout: creatorRecentResultLayout,
            onLayoutChange: setCreatorRecentResultLayout,
            expandedIds: expandedCreatorRecentNotes,
            onToggleExpand: (noteId) => setExpandedCreatorRecentNotes((prev) => {
              const next = new Set(prev);
              if (next.has(noteId)) next.delete(noteId);
              else next.add(noteId);
              return next;
            }),
            sourceLabel: creatorRecentDisplayLabel,
            saveAllTitle: "Blogger's recent posts saved",
          }) : (
            <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              No usable content was read for this blogger within your day range.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  const renderCreatorRecentPanel = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <Card title="Manual Crawl / Targeted Blogger Recent Posts" icon={<Search style={{ width: "18px", height: "18px" }} />}>
        {renderCreatorRecentWorkbenchContent()}
      </Card>
      {renderSharedCreatorGroupManager()}
    </div>
  );

  const renderCreatorPushList = () => {
    const enabledCreatorCount = creatorEntries.filter((monitor) => monitor.enabled).length;
    const hasSmartGroups = visibleSharedCreatorGroups.length > 0;
    const filterLabel = creatorMonitorGroupFilter === "all"
      ? "All"
      : creatorMonitorGroupFilter === "__ungrouped__"
        ? "Ungrouped"
        : creatorGroupLabelMap.get(creatorMonitorGroupFilter) || creatorMonitorGroupFilter;
    const startIndex = filteredCreatorEntries.length === 0 ? 0 : safeCreatorMonitorPage * creatorMonitorPageSize + 1;
    const endIndex = Math.min(filteredCreatorEntries.length, startIndex + visibleCreatorEntries.length - 1);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {renderPushRow(
          "creator",
          "Targeted follow crawl",
          `${creatorEntries.length} blogger definitions · ${enabledCreatorCount} individually enabled · current filter ${filterLabel} · 8 per page · the title switch toggles all on/off`,
          trackerCreatorPushEnabled,
          handleToggleCreatorPush,
          handleDeleteCreatorPush,
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>
                Blogger definitions
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6, marginTop: "4px" }}>
                Each blogger can be enabled, disabled, and deleted independently; when adding manually, fill in a display name and the user number after /user/profile/ in the URL, not the Xiaohongshu ID.
              </div>
              <div
                style={{
                  marginTop: "8px",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgba(245, 158, 11, 0.45)",
                  background: "rgba(245, 158, 11, 0.12)",
                  color: "#92400e",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  lineHeight: 1.6,
                }}
              >
                May trigger anti-crawling and is unstable: targeted follows / targeted bloggers visit profile pages, and high frequency easily triggers rate limiting or verification pages. Run in small low-frequency batches.
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-light)", background: "var(--bg-card)" }}>
              <button
                type="button"
                onClick={() => setShowCreatorImportPanel((value) => !value)}
                style={{ ...segmentedButtonStyle(showCreatorImportPanel), justifyContent: "space-between", width: "100%" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <FolderDown style={{ width: "14px", height: "14px" }} />
                  Quick import from smart groups
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{showCreatorImportPanel ? "Collapse" : "Expand"}</span>
              </button>
              {showCreatorImportPanel ? (
                <>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {hasSmartGroups ? "Pick a group and click add; only bloggers not yet added are imported." : "Run shared smart grouping first to import by group."}
                  </span>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {visibleSharedCreatorGroups.map((group) => {
                      const importableCount = group.members.filter((member) => member.authorId && !trackedCreatorUserIds.has(normalizeXhsProfileUserId(member.authorId))).length;
                      return (
                        <button
                          key={`import-${group.value}`}
                          type="button"
                          onClick={() => void handleImportCreatorGroup(group.value)}
                          disabled={importableCount === 0}
                          style={segmentedButtonStyle(false)}
                          title={importableCount === 0 ? "All bloggers in this group are already in targeted follows" : `Import ${importableCount} unadded bloggers`}
                        >
                          <FolderDown style={{ width: "14px", height: "14px" }} />
                          {group.label} · add {importableCount}
                        </button>
                      );
                    })}
                    {!hasSmartGroups ? (
                      <button type="button" onClick={handleRefreshSharedCreatorAssignments} style={segmentedButtonStyle(false)}>
                        Generate smart groups
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-light)", background: "var(--bg-card)" }}>
              <button
                type="button"
                onClick={() => setShowCreatorFilterPanel((value) => !value)}
                style={{ ...segmentedButtonStyle(showCreatorFilterPanel), justifyContent: "space-between", width: "100%" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <Filter style={{ width: "14px", height: "14px" }} />
                  Tag filter
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{filterLabel} · {showCreatorFilterPanel ? "Collapse" : "Expand"}</span>
              </button>
              {showCreatorFilterPanel ? (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setCreatorMonitorGroupFilter("all"); setCreatorMonitorPage(0); }}
                style={segmentedButtonStyle(creatorMonitorGroupFilter === "all")}
              >
                All · {creatorEntries.length}
              </button>
              {creatorGroupDisplayOptions.map((option) => (
                <button
                  key={`monitor-filter-${option.value}`}
                  type="button"
                  onClick={() => { setCreatorMonitorGroupFilter(option.value); setCreatorMonitorPage(0); }}
                  style={segmentedButtonStyle(creatorMonitorGroupFilter === option.value)}
                >
                  {option.label} · {creatorEntries.filter((monitor) => getMonitorGroupValues(monitor).includes(option.value)).length}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setCreatorMonitorGroupFilter("__ungrouped__"); setCreatorMonitorPage(0); }}
                style={segmentedButtonStyle(creatorMonitorGroupFilter === "__ungrouped__")}
              >
                Ungrouped · {creatorEntries.filter((monitor) => getMonitorGroupValues(monitor).length === 0).length}
              </button>
                </div>
              ) : null}
            </div>

            {visibleCreatorEntries.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
                {visibleCreatorEntries.map((creatorMonitor) => {
                  const userId = normalizeXhsProfileUserId(creatorMonitor.user_id);
                  const profile = trackerCreatorProfiles[userId];
                  const active = creatorMonitor.enabled;
                  const source = profile?.source_summary || profile?.latest_title || "From shared smart grouping / manual add";
                  const groupLabels = getCreatorMonitorGroupLabels(creatorMonitor);
                  return (
                    <div
                      key={creatorMonitor.id}
                      style={{
                        position: "relative",
                        textAlign: "left",
                        padding: "10px",
                        borderRadius: "var(--radius-sm)",
                        background: active ? "rgba(255, 36, 66, 0.10)" : "var(--bg-hover)",
                        border: active ? "1px solid rgba(255, 36, 66, 0.30)" : "1px solid var(--border-light)",
                        color: "var(--text-main)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        minWidth: 0,
                      }}
                    >
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span
                          style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            background: active ? "var(--color-primary)" : "var(--text-muted)",
                            flexShrink: 0,
                          }}
                        />
                        <strong style={{ fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {profile?.author || creatorMonitor.label || userId || "No user number set"}
                        </strong>
                      </div>
                      <input
                        type="text"
                        value={creatorMonitor.label}
                        onChange={(e) => setTrackerCreatorMonitors((prev) => prev.map((monitor) => (
                          monitor.id === creatorMonitor.id
                            ? { ...monitor, label: e.target.value, author: e.target.value || monitor.author }
                            : monitor
                        )))}
                        placeholder="Blogger display name"
                        style={{ ...compactControlStyle, width: "100%" }}
                      />
                      <input
                        type="text"
                        value={creatorMonitor.user_id}
                        onChange={(e) => setTrackerCreatorMonitors((prev) => prev.map((monitor) => (
                          monitor.id === creatorMonitor.id
                            ? { ...monitor, user_id: normalizeXhsProfileUserId(e.target.value) }
                            : monitor
                        )))}
                        placeholder="User number after /user/profile/ in the URL, not the Xiaohongshu ID"
                        style={{ ...compactControlStyle, width: "100%" }}
                      />
                      <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem", lineHeight: 1.45, minHeight: "2.1em", overflow: "hidden" }}>
                        {source}
                      </span>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => creatorMonitor.user_id && void handleToggleCreatorUser(creatorMonitor.user_id)}
                          disabled={!creatorMonitor.user_id}
                          style={segmentedButtonStyle(active)}
                        >
                          {active ? "On" : "Off"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveCreatorMonitor(creatorMonitor)}
                          style={{ ...segmentedButtonStyle(false), color: "var(--color-danger)" }}
                        >
                          Delete
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {resolveCreatorProfileUrl(profile, userId) ? (
                          <button
                            type="button"
                            onClick={() => void openExternalUrl(resolveCreatorProfileUrl(profile, userId), `${profile?.author || userId}'s profile`)}
                            style={{ ...segmentedButtonStyle(false), fontSize: "0.6875rem", padding: "5px 8px" }}
                          >
                            Visit profile
                            <ExternalLink size={12} />
                          </button>
                        ) : null}
                        {profile?.sample_note_urls?.[0] ? (
                          <button
                            type="button"
                            onClick={() => void openExternalUrl(profile.sample_note_urls?.[0], `${profile?.author || userId}'s sample content`)}
                            style={{ ...segmentedButtonStyle(false), fontSize: "0.6875rem", padding: "5px 8px" }}
                          >
                            Preview sample
                            <ExternalLink size={12} />
                          </button>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Per crawl</label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={creatorMonitor?.per_user_limit ?? 3}
                          onChange={(e) => setTrackerCreatorMonitors((prev) => prev.map((monitor) => (
                            monitor.id === creatorMonitor.id
                              ? { ...monitor, per_user_limit: Number(e.target.value || 1) }
                              : monitor
                          )))}
                          style={{ ...compactControlStyle, width: "72px" }}
                        />
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>items</span>
                        <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Last</label>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={creatorMonitor?.recent_days ?? DEFAULT_XHS_RECENT_DAYS}
                          onChange={(e) => setTrackerCreatorMonitors((prev) => prev.map((monitor) => (
                            monitor.id === creatorMonitor.id
                              ? { ...monitor, recent_days: Math.max(1, Math.min(365, Number(e.target.value || 1))) }
                              : monitor
                          )))}
                          style={{ ...compactControlStyle, width: "72px" }}
                        />
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>days</span>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                        <input
                          type="checkbox"
                          checked={creatorMonitor?.include_comments ?? false}
                          onChange={(e) => setTrackerCreatorMonitors((prev) => prev.map((monitor) => (
                            monitor.id === creatorMonitor.id
                              ? { ...monitor, include_comments: e.target.checked }
                              : monitor
                          )))}
                        />
                        Fetch comments
                      </label>
                      {groupLabels.length > 0 ? (
                        <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {groupLabels.slice(0, 3).map((label) => (
                            <span
                              key={label}
                              style={{
                                padding: "3px 6px",
                                borderRadius: "var(--radius-sm)",
                                background: "rgba(255, 138, 0, 0.10)",
                                color: "#FF8A00",
                                fontSize: "0.6875rem",
                                fontWeight: 700,
                              }}
                            >
                              {label}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: "14px", borderRadius: "var(--radius-sm)", border: "1px dashed var(--border-light)", color: "var(--text-muted)", fontSize: "0.8125rem" }}>
                No bloggers under the current filter; import from smart groups or add manually.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {filteredCreatorEntries.length > 0 ? `${startIndex}-${endIndex} of ${filteredCreatorEntries.length}` : "0 total"}
              </span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" disabled={safeCreatorMonitorPage <= 0} onClick={() => setCreatorMonitorPage((page) => Math.max(0, page - 1))} style={segmentedButtonStyle(false)}>
                  Previous
                </button>
                <button type="button" disabled={safeCreatorMonitorPage >= creatorMonitorPageCount - 1} onClick={() => setCreatorMonitorPage((page) => Math.min(creatorMonitorPageCount - 1, page + 1))} style={segmentedButtonStyle(false)}>
                  Next
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setTrackerCreatorMonitors((prev) => [
                ...prev,
                createCreatorMonitor({ label: `Manually added ${prev.length + 1}`, enabled: true }),
              ])} style={segmentedButtonStyle(false)}>
                <Plus style={{ width: "14px", height: "14px" }} />
                Add manually
              </button>
              <button type="button" onClick={() => persistTrackerDefinitions("Targeted follow definitions saved")} style={segmentedButtonStyle(true)}>
                Save targeted follow definitions
              </button>
              <button type="button" onClick={() => void handleClearCreatorMonitors("page")} style={{ ...segmentedButtonStyle(false), color: "var(--color-danger)" }}>
                Delete this page's follows
              </button>
              <button type="button" onClick={() => void handleClearCreatorMonitors("filtered")} style={{ ...segmentedButtonStyle(false), color: "var(--color-danger)" }}>
                Delete current filter
              </button>
              <button type="button" onClick={() => void handleClearCreatorMonitors("all")} style={{ ...segmentedButtonStyle(false), color: "var(--color-danger)" }}>
                Delete all follows
              </button>
            </div>
          </div>,
        )}
      </div>
    );
  };

  const renderFollowingWorkbenchCard = () => (
    <Card title="Follow Monitor Workbench" icon={<Users style={{ width: "18px", height: "18px" }} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: 0 }}>
          Searches the keyword on the search page first, then auto-clicks "Filter -&gt; Followed", preferring the extension bridge to read real page state before falling back to the browser path.
          {!cookieVerified && (
            <span style={{ color: "var(--color-warning)" }}>(cookie required)</span>
          )}
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setAlbumDedicatedWindowMode((v) => !v)}
            style={segmentedButtonStyle(albumDedicatedWindowMode)}
          >
            {albumDedicatedWindowMode ? "Dedicated Edge window" : "Use current window"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem" }}>
            Extension port
            <input
              type="number"
              min={1024}
              max={65535}
              value={albumExtensionPort}
              onChange={(e) => setAlbumExtensionPort(Number(e.target.value || 9334))}
              style={{ ...compactControlStyle, width: "88px" }}
            />
          </label>
        </div>

        <div style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
          Crawl path: extension first (port {albumExtensionPort}, {albumDedicatedWindowMode ? "dedicated window" : "current window"}){` -> `}Playwright fallback
        </div>

        <div style={{ height: "1px", background: "var(--border-light)" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>Follow-feed keyword search</div>
          <div style={{ color: "var(--text-secondary)", fontSize: "0.8125rem" }}>
            Searches by keyword, then switches to the "Followed" filter, keeping only results from bloggers you follow.
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem" }}>
          Fetch limit
          <input
            type="number"
            min={1}
            max={300}
            value={followingLimit}
            onChange={(e) => setFollowingLimit(normalizeFollowingLimit(e.target.value))}
            onBlur={(e) => setFollowingLimit(normalizeFollowingLimit(e.target.value))}
            style={{ ...compactControlStyle, width: "88px" }}
          />
          items
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem" }}>
          Keep only last
          <input
            type="number"
            min={1}
            max={365}
            value={followingRecentDays}
            onChange={(e) => setFollowingRecentDays(Math.max(1, Math.min(365, Number(e.target.value || 1))))}
            style={{ ...compactControlStyle, width: "88px" }}
          />
          days of posts
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-main)", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={followingAutoSaveAfterFetch}
            onChange={(e) => setFollowingAutoSaveAfterFetch(e.target.checked)}
          />
          Auto-save after crawling
        </label>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input
            type="text"
            value={followingKeywords}
            onChange={(e) => setFollowingKeywords(e.target.value)}
            onKeyDown={(e) => {
              if (isActionEnterKey(e)) {
                e.preventDefault();
                handleFollowingFeed();
              }
            }}
            placeholder="Enter keywords, comma-separated..."
            disabled={!cookieVerified}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              background: "var(--bg-card)",
              color: "var(--text-main)",
              fontSize: "0.9375rem",
              outline: "none",
              opacity: cookieVerified ? 1 : 0.5,
            }}
          />
          <button
            onClick={handleFollowingFeed}
            disabled={followingRunning || !followingKeywords.trim() || !cookieVerified}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px 24px",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: followingRunning || !cookieVerified ? "var(--bg-hover)" : "var(--color-primary)",
              color: "white",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: followingRunning || !cookieVerified ? "not-allowed" : "pointer",
              opacity: followingRunning || !cookieVerified ? 0.6 : 1,
            }}
          >
            {followingRunning ? (
              <span>⟳ Fetching...</span>
            ) : (
              <>
                <Users style={{ width: "16px", height: "16px" }} />
                Fetch
              </>
            )}
          </button>
          {followingRunning && followingFeedTaskId ? (
            <button
              type="button"
              onClick={() => void handleCancelFollowingFeed()}
              style={segmentedButtonStyle(false)}
            >
              Stop
            </button>
            ) : null}
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", lineHeight: 1.6 }}>
          By default only returns results without auto-saving; when checked, the entire follow-feed result batch is written to the Intel Library when the crawl finishes.
        </div>
      </div>
    </Card>
  );

  const renderFollowingResultCard = () => followingResult ? (
    <Card title={`Followed Filter Results (${followingResult.total_found})`} icon={<BookOpen style={{ width: "18px", height: "18px" }} />}>
      <div ref={followingResultTopRef} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "rgba(255, 255, 255, 0.7)",
          }}
        >
          <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            The results area is compressed. Collapse the whole block or expand single items; jump to top or bottom for quick navigation.
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => setShowFollowingResults((value) => !value)} style={segmentedButtonStyle(false)}>
              {showFollowingResults ? "Collapse results" : "Expand results"}
            </button>
            <button type="button" onClick={() => scrollToAnchor(followingResultTopRef)} style={segmentedButtonStyle(false)}>
              Back to top
            </button>
            <button type="button" onClick={() => scrollToAnchor(followingResultBottomRef)} style={segmentedButtonStyle(false)}>
              Jump to bottom
            </button>
          </div>
        </div>

        {showFollowingResults ? (
          renderHorizontalNoteResults({
            notes: followingResult.notes,
            carouselRef: followingResultCarouselRef,
            layout: followingResultLayout,
            onLayoutChange: setFollowingResultLayout,
            expandedIds: expandedFollowingNotes,
            onToggleExpand: (noteId) => setExpandedFollowingNotes((prev) => {
              const next = new Set(prev);
              if (next.has(noteId)) next.delete(noteId);
              else next.add(noteId);
              return next;
            }),
            saveSubfolder: (note) => buildFollowingSaveSubfolder(
              note.matched_keywords?.join("，") || followingKeywords,
            ),
            saveSuccessTitle: "Follow-feed search note saved",
            saveAllSubfolder: buildFollowingSaveSubfolder(keywordLabelFromFollowingResult(followingResult, followingKeywords)),
            saveAllSuccessTitle: "Follow-feed search results saved",
            creatorSourceLabel: (note) => ({
              tags: note.matched_keywords?.length ? note.matched_keywords : parseKeywordInput(followingKeywords),
              summary: note.matched_keywords?.length ? `From follow-feed search: ${note.matched_keywords.join(", ")}` : "From follow-feed search",
            }),
            showMatchedKeywords: true,
          })
        ) : (
          <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            Results collapsed. Click "Expand results" above to continue viewing.
          </div>
        )}
        <div ref={followingResultBottomRef} />
      </div>
    </Card>
  ) : null;

  const renderFollowingTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "16px",
          alignItems: "start",
        }}
      >
        <Card title="Search Keyword Intel Push" icon={<Filter style={{ width: "18px", height: "18px" }} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {renderPushRow(
              "keyword",
              "Search keyword intel push",
              `${trackerKeywordMonitors.length} definitions · ${trackerEnableKeywordSearch ? "enabled" : "disabled"}`,
              trackerEnableKeywordSearch,
              handleToggleKeywordPush,
              handleDeleteKeywordPush,
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {trackerKeywordMonitors.map((monitor) => (
                  <div
                    key={monitor.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                      padding: "12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-card)",
                    }}
                  >
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: "180px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                        Keyword definition
                      </div>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexShrink: 0, flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => setTrackerKeywordMonitors((prev) => prev.map((item) => (
                            item.id === monitor.id ? { ...item, enabled: !item.enabled } : item
                          )))}
                          style={segmentedButtonStyle(monitor.enabled)}
                        >
                          {monitor.enabled ? "On" : "Off"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveKeywordMonitor(monitor.id)}
                          style={segmentedButtonStyle(false)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={trackerKeywordMonitorDrafts[monitor.id] ?? (monitor.keywords[0] || "")}
                      onChange={(e) => setTrackerKeywordMonitorDrafts((prev) => ({
                        ...prev,
                        [monitor.id]: e.target.value,
                      }))}
                      onBlur={(e) => commitKeywordMonitorDraft(monitor.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (isActionEnterKey(e)) {
                          e.preventDefault();
                          commitKeywordMonitorDraft(monitor.id, (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      placeholder="e.g. 科研工具"
                      style={{ ...compactControlStyle, width: "100%" }}
                    />
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        Min likes
                        <input
                          type="number"
                          min={0}
                          value={monitor.min_likes}
                          onChange={(e) => setTrackerKeywordMonitors((prev) => prev.map((item) => (
                            item.id === monitor.id ? { ...item, min_likes: Number(e.target.value || 0) } : item
                          )))}
                          style={{ ...compactControlStyle, width: "88px" }}
                        />
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        Per-keyword fetch
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={monitor.per_keyword_limit}
                          onChange={(e) => setTrackerKeywordMonitors((prev) => prev.map((item) => (
                            item.id === monitor.id ? { ...item, per_keyword_limit: Number(e.target.value || 1) } : item
                          )))}
                          style={{ ...compactControlStyle, width: "88px" }}
                        />
                        items
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        Last
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={monitor.recent_days}
                          onChange={(e) => setTrackerKeywordMonitors((prev) => prev.map((item) => (
                            item.id === monitor.id ? { ...item, recent_days: Math.max(1, Math.min(365, Number(e.target.value || 1))) } : item
                          )))}
                          style={{ ...compactControlStyle, width: "72px" }}
                        />
                        days of posts
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        <input
                          type="checkbox"
                          checked={monitor.include_comments}
                          onChange={(e) => setTrackerKeywordMonitors((prev) => prev.map((item) => (
                            item.id === monitor.id ? { ...item, include_comments: e.target.checked } : item
                          )))}
                        />
                        Fetch comments
                      </label>
                      {monitor.include_comments ? (
                        <>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                            Top
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={monitor.comments_limit}
                              onChange={(e) => setTrackerKeywordMonitors((prev) => prev.map((item) => (
                                item.id === monitor.id ? { ...item, comments_limit: Number(e.target.value || 1) } : item
                              )))}
                              style={{ ...compactControlStyle, width: "72px" }}
                            />
                            items
                          </label>
                          <select
                            value={monitor.comments_sort_by}
                            onChange={(e) => setTrackerKeywordMonitors((prev) => prev.map((item) => (
                              item.id === monitor.id ? { ...item, comments_sort_by: e.target.value as "likes" | "time" } : item
                            )))}
                            style={{ ...compactControlStyle, width: "120px" }}
                          >
                            <option value="likes">Most liked first</option>
                            <option value="time">Newest first</option>
                          </select>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
                {trackerKeywordMonitors.length === 0 ? (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    Enter keywords below and save. Saving generates one definition per word, so each keyword can be toggled and have its comment crawling configured individually.
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setTrackerKeywordMonitors((prev) => [
                      ...prev,
                      createKeywordMonitor({
                        min_likes: trackerKeywordMinLikes,
                        per_keyword_limit: trackerKeywordLimit,
                      }),
                    ])}
                    style={segmentedButtonStyle(false)}
                  >
                    <Plus style={{ width: "14px", height: "14px" }} />
                    Add definition
                  </button>
                  <button type="button" onClick={handleSaveTrackerKeywords} style={segmentedButtonStyle(true)}>
                    Save search keyword intel push
                  </button>
                </div>
              </div>,
            )}

            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
                Search keyword intel push
              </div>
              <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
                Quickly add keywords here; they split automatically into the independent definitions above. Adjust like thresholds, fetch counts, and comment strategy in the definitions directly.
              </p>
            </div>

            <input
              type="text"
              value={trackerKeywordDraft}
              onChange={(e) => setTrackerKeywordDraft(e.target.value)}
              onBlur={(e) => {
                applyKeywordDraftToMonitors(e.target.value);
              }}
              onKeyDown={(e) => {
                if (isActionEnterKey(e)) {
                  e.preventDefault();
                  applyKeywordDraftToMonitors((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="科研工具, 论文写作, AI 工作流, 学术日常"
              style={{ ...compactControlStyle, width: "100%" }}
            />

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={handleToggleKeywordPush}
                style={segmentedButtonStyle(trackerEnableKeywordSearch)}
              >
                {trackerEnableKeywordSearch ? "Search keyword intel push on" : "Search keyword intel push off"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const preset = ["科研工具", "论文写作", "学术日常", "AI 工作流", "知识管理", "Obsidian"];
                  mergeKeywordsIntoKeywordMonitors(preset);
                }}
                style={segmentedButtonStyle(false)}
              >
                Use suggested keywords
              </button>
            </div>
          </div>
        </Card>

        <Card title="Follow-Feed Intel Push" icon={<Users style={{ width: "18px", height: "18px" }} />}>
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {renderPushRow(
              "following-scan",
              "Follow-feed intel push",
              `${trackerFollowingScanMonitors.length} definitions · ${trackerFollowingScanMonitors.filter((monitor) => monitor.enabled).length} enabled · followed-filter path · ${trackerFollowingScan.enabled ? "on" : "off"}`,
              trackerFollowingScan.enabled,
              handleToggleFollowingScanPush,
              handleDeleteFollowingScanPush,
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {trackerFollowingScanMonitors.map((monitor) => (
                  <div
                    key={monitor.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                      padding: "12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-card)",
                    }}
                  >
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: "180px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                        Follow-feed keyword
                      </div>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexShrink: 0, flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => {
                            const nextMonitors = trackerFollowingScanMonitors.map((item) => (
                              item.id === monitor.id ? { ...item, enabled: !item.enabled } : item
                            ));
                            setTrackerFollowingScanMonitors(nextMonitors);
                            syncFollowingScanFromMonitors(nextMonitors);
                          }}
                          style={segmentedButtonStyle(monitor.enabled)}
                        >
                          {monitor.enabled ? "On" : "Off"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveFollowingScanMonitor(monitor.id)}
                          style={segmentedButtonStyle(false)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={trackerFollowingScanMonitorDrafts[monitor.id] ?? (monitor.keywords[0] || "")}
                      onChange={(e) => setTrackerFollowingScanMonitorDrafts((prev) => ({
                        ...prev,
                        [monitor.id]: e.target.value,
                      }))}
                      onBlur={(e) => commitFollowingScanMonitorDraft(monitor.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (isActionEnterKey(e)) {
                          e.preventDefault();
                          commitFollowingScanMonitorDraft(monitor.id, (e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      placeholder="e.g. 科研工具"
                      style={{ ...compactControlStyle, width: "100%" }}
                    />
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        Per-keyword fetch
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={monitor.fetch_limit}
                          onChange={(e) => {
                            const nextMonitors = trackerFollowingScanMonitors.map((item) => (
                              item.id === monitor.id ? { ...item, fetch_limit: Number(e.target.value || 1) } : item
                            ));
                            setTrackerFollowingScanMonitors(nextMonitors);
                            syncFollowingScanFromMonitors(nextMonitors);
                          }}
                          style={{ ...compactControlStyle, width: "88px" }}
                        />
                        items
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        Keep only last
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={monitor.recent_days}
                          onChange={(e) => {
                            const nextMonitors = trackerFollowingScanMonitors.map((item) => (
                              item.id === monitor.id
                                ? { ...item, recent_days: Math.max(1, Math.min(365, Number(e.target.value || 1))) }
                                : item
                            ));
                            setTrackerFollowingScanMonitors(nextMonitors);
                            syncFollowingScanFromMonitors(nextMonitors);
                          }}
                          style={{ ...compactControlStyle, width: "72px" }}
                        />
                        days
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        <input
                          type="checkbox"
                          checked={monitor.include_comments}
                          onChange={(e) => {
                            const nextMonitors = trackerFollowingScanMonitors.map((item) => (
                              item.id === monitor.id ? { ...item, include_comments: e.target.checked } : item
                            ));
                            setTrackerFollowingScanMonitors(nextMonitors);
                            syncFollowingScanFromMonitors(nextMonitors);
                          }}
                        />
                        Fetch comments
                      </label>
                      {monitor.include_comments ? (
                        <>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                            Top
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={monitor.comments_limit}
                              onChange={(e) => {
                                const nextMonitors = trackerFollowingScanMonitors.map((item) => (
                                  item.id === monitor.id ? { ...item, comments_limit: Number(e.target.value || 1) } : item
                                ));
                                setTrackerFollowingScanMonitors(nextMonitors);
                                syncFollowingScanFromMonitors(nextMonitors);
                              }}
                              style={{ ...compactControlStyle, width: "72px" }}
                            />
                            items
                          </label>
                          <select
                            value={monitor.comments_sort_by}
                            onChange={(e) => {
                              const nextMonitors = trackerFollowingScanMonitors.map((item) => (
                                item.id === monitor.id ? { ...item, comments_sort_by: e.target.value as "likes" | "time" } : item
                              ));
                              setTrackerFollowingScanMonitors(nextMonitors);
                              syncFollowingScanFromMonitors(nextMonitors);
                            }}
                            style={{ ...compactControlStyle, width: "120px" }}
                          >
                            <option value="likes">Most liked first</option>
                            <option value="time">Newest first</option>
                          </select>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
                {trackerFollowingScanMonitors.length === 0 ? (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    Enter keywords below and save. One definition per word is generated, same as Search keyword intel push — each word toggles and configures independently.
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setTrackerFollowingScanMonitors((prev) => [
                      ...prev,
                      createFollowingScanMonitor({
                        fetch_limit: 20,
                        recent_days: DEFAULT_XHS_RECENT_DAYS,
                        keyword_filter: true,
                      }),
                    ])}
                    style={segmentedButtonStyle(false)}
                  >
                    <Plus style={{ width: "14px", height: "14px" }} />
                    Add definition
                  </button>
                  <button type="button" onClick={handleSaveFollowingScan} style={segmentedButtonStyle(true)}>
                    Save follow-feed intel push
                  </button>
                </div>
              </div>,
            )}

            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
                Follow-feed intel push
              </div>
              <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
                Quickly add keywords here; they split into the independent definitions above. Execution reuses the follow monitor workbench flow: search the keyword, then switch to the "Followed" filter.
              </p>
            </div>

            <input
              type="text"
              value={trackerFollowingScanKeywordDraft}
              onChange={(e) => setTrackerFollowingScanKeywordDraft(e.target.value)}
              onBlur={(e) => {
                applyFollowingScanDraftToMonitors(e.target.value);
              }}
              onKeyDown={(e) => {
                if (isActionEnterKey(e)) {
                  e.preventDefault();
                  applyFollowingScanDraftToMonitors((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="科研工具, 论文写作, AI 工作流, 学术日常"
              style={{ ...compactControlStyle, width: "100%" }}
            />

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={handleToggleFollowingScanPush}
                style={segmentedButtonStyle(trackerFollowingScan.enabled)}
              >
                {trackerFollowingScan.enabled ? "Follow-feed intel push on" : "Follow-feed intel push off"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const preset = ["科研工具", "论文写作", "学术日常", "AI 工作流", "知识管理", "Obsidian"];
                  mergeKeywordsIntoFollowingScanMonitors(preset);
                }}
                style={segmentedButtonStyle(false)}
              >
                Use suggested keywords
              </button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Blogger Latest Posts Crawl" icon={<BookOpen style={{ width: "18px", height: "18px" }} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            This workbench takes a full column, separate from the two intel push configs above. It handles frequent blogger top-ups, targeted follow definitions, shared-group batch crawls, and manual group sorting.
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(245, 158, 11, 0.45)",
              background: "rgba(245, 158, 11, 0.12)",
              color: "#92400e",
              fontSize: "0.8125rem",
              fontWeight: 700,
              lineHeight: 1.6,
            }}
          >
            Risk note: "Blogger latest posts crawl" visits blogger profiles; high frequency can trigger Xiaohongshu rate limiting or security verification and is unstable. Prefer the extension bridge path, run small low-frequency batches, and stop and wait if restricted.
          </div>
          {renderFrequentAuthorQuickPicker()}
          {renderCreatorPushList()}
          <div style={{ height: "1px", background: "var(--border-light)" }} />
          {renderCreatorRecentWorkbenchContent()}
          {renderSharedCreatorGroupManager()}
        </div>
      </Card>

      {renderDetailDivider()}

      <Card title="Shared Smart Grouping" icon={<Zap style={{ width: "18px", height: "18px" }} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
              Shared smart grouping
            </div>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 }}>
              Full mode scans local Xiaohongshu + Bilibili content and maintains the shared tag library; if tags and groups already exist, click "Organize creators only" to refresh author grouping only. Xiaohongshu maps authors from local notes only — no web follow list.
            </p>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "8px", lineHeight: 1.7 }}>
              Raw tag -&gt; shared rule -&gt; shared group -&gt; author joins group. Bloggers join shared groups based on how their note tags are grouped; this manages the tag-to-group relations.
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <SmartGroupActionButton
              onClick={handleBuildSmartGroups}
              running={smartGroupRunning}
              secondaryLabel="Organize creators only"
              onSecondaryClick={handleRefreshSharedCreatorAssignments}
              gradient="linear-gradient(135deg, #FF6B81, #FF8A00)"
              borderColor="rgba(255, 138, 0, 0.28)"
            />
          </div>

          <div
            style={{
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(255, 138, 0, 0.18)",
              background: "rgba(255, 138, 0, 0.08)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              aria-expanded={showSharedGroupingDetail}
              onClick={() => setShowSharedGroupingDetail((value) => !value)}
              style={{
                width: "100%",
                padding: "12px 14px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>
                    {smartGroupRunning ? "Organizing shared smart groups" : smartGroupResult?.message || (Object.keys(trackerCreatorProfiles).length > 0
                      ? "Shared smart groups generated — manage pushes by group."
                      : "Click \"Shared smart grouping\" for full initialization first; later, to refresh author grouping only, click \"Organize creators only\".")}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                    {trackerUserIds.length} bloggers · {trackerCreatorGroupOptions.length} shared groups ·
                    {vaultSignalCount > 0 ? ` ${vaultSignalCount} vault tags · ${vaultIndexedFileCount} tagged notes ·` : ""}
                    {showSharedGroupingDetail ? " click to collapse details" : " click to expand details and the rule dictionary"}
                  </div>
                  {sharedTagIndexPath && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px", lineHeight: 1.5 }}>
                      Shared tag library written to Intel Library: {sharedTagIndexPath}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  {smartGroupResult && (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Added {smartGroupResult.new_profile_count} · updated {smartGroupResult.updated_profile_count}
                    </div>
                  )}
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: "1px solid rgba(255, 138, 0, 0.20)",
                      background: "rgba(255, 255, 255, 0.7)",
                      color: "#C2410C",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                    }}
                  >
                    {showSharedGroupingDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showSharedGroupingDetail ? "Collapse" : "Expand"}
                  </div>
                </div>
              </div>
            </button>

            {showSharedGroupingDetail && (
              <div
                style={{
                  padding: "0 14px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  borderTop: "1px solid rgba(255, 138, 0, 0.12)",
                }}
              >
                <div
                  style={{
                    borderRadius: "var(--radius-md)",
                    border: "1px solid rgba(255, 138, 0, 0.18)",
                    background: "rgba(255, 138, 0, 0.05)",
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={showSharedSignalRules}
                    onClick={() => setShowSharedSignalRules((value) => !value)}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>
                          Shared grouping rule dictionary
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                          These are the "raw tag -&gt; shared group" mapping rules. Only expand and fine-tune when grouping is off.
                        </div>
                      </div>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 10px",
                          borderRadius: "999px",
                          border: "1px solid rgba(255, 138, 0, 0.18)",
                          background: "rgba(255, 255, 255, 0.72)",
                          color: "#C2410C",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                        }}
                      >
                        {showSharedSignalRules ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {showSharedSignalRules ? "Collapse rules" : "Expand rules"}
                      </div>
                    </div>
                  </button>

                  {showSharedSignalRules && (
                    <div style={{ padding: "0 12px 12px", borderTop: "1px solid rgba(255, 138, 0, 0.12)" }}>
                      <SharedSignalMappingPanel
                        title="Shared Grouping Rules"
                        entries={sharedSignalEntries}
                        groupOptions={trackerCreatorGroupOptions}
                        saving={savingSignalMappings}
                        updatedAt={sharedCreatorGrouping.updated_at}
                        onSave={handleSaveSharedSignalMappings}
                        description="Raw tag -> shared rule -> shared group -> author joins group. Merge similar tags into one shared group, or attach one tag to multiple shared groups. After saving, re-run Organize creators only or Shared smart grouping and authors are re-sorted by these rules."
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {renderFollowingResultCard()}

      {!followingResult && !followingRunning && !searchResult && !searchRunning && (
        <EmptyState
          icon={Users}
          title="Follow Monitors"
          description="Scan followed users' recent posts, then decide which authors are worth tracking long-term"
        />
      )}

    </div>
  );

  const renderCookieConfigModal = () => showCookieModal && (
    <div
      onClick={() => hasCookie && setShowCookieModal(false)}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(7, 10, 18, 0.62)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 130,
        padding: "24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 96vw)",
          maxHeight: "88vh",
          overflow: "auto",
          borderRadius: "20px",
          border: "1px solid var(--border-light)",
          background: "var(--bg-card)",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>Configure Xiaohongshu Cookie</div>
            <div style={{ marginTop: "4px", fontSize: "0.875rem", color: "var(--text-muted)" }}>
              Only pops up on first use or when the cookie is missing. Once configured, it no longer appears on the page.
            </div>
          </div>
          {hasCookie && (
            <button
              type="button"
              onClick={() => setShowCookieModal(false)}
              style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "14px",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-hover)",
            border: "1px solid var(--border-light)",
          }}
        >
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)" }}>One-click browser cookie</div>
            <div style={{ marginTop: "4px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              Reads the background browser environment first; on success it saves and reuses automatically.
            </div>
          </div>
          <button
            onClick={() => handleGetCookieFromBrowser()}
            disabled={gettingCookie}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: gettingCookie ? "var(--bg-muted)" : "var(--color-primary)",
              color: "white",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: gettingCookie ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Cookie size={16} />
            {gettingCookie ? "Getting..." : "One-click get"}
          </button>
        </div>

        <button
          onClick={() => setShowManualCookie((value) => !value)}
          style={{
            alignSelf: "flex-start",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 0",
            border: "none",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: "0.8125rem",
            cursor: "pointer",
          }}
        >
          {showManualCookie ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Manual cookie fallback
        </button>

        {showManualCookie && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              padding: "12px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-hover)",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <input type="checkbox" checked={showFullCookie} onChange={(e) => setShowFullCookie(e.target.checked)} />
              Show full cookie
            </label>

            {showFullCookie && (
              <textarea
                readOnly
                value={fullCookie || buildCookie()}
                placeholder="No full cookie yet — click one-click get first."
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "transparent",
                  color: "var(--text-main)",
                  fontSize: "0.8125rem",
                  fontFamily: "monospace",
                  resize: "vertical",
                  minHeight: "120px",
                }}
              />
            )}

            <textarea
              value={webSession}
              onChange={(e) => {
                setFullCookie("");
                setWebSession(e.target.value);
                setCookieVerified(false);
                setBackendCookieConfigured(false);
              }}
              placeholder="Paste web_session..."
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-light)",
                background: "transparent",
                color: "var(--text-main)",
                fontSize: "0.8125rem",
                fontFamily: "monospace",
                resize: "vertical",
                minHeight: "60px",
              }}
            />

            <textarea
              value={idToken}
              onChange={(e) => {
                setFullCookie("");
                setIdToken(e.target.value);
                setCookieVerified(false);
                setBackendCookieConfigured(false);
              }}
              placeholder="Paste id_token (optional)..."
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-light)",
                background: "transparent",
                color: "var(--text-main)",
                fontSize: "0.8125rem",
                fontFamily: "monospace",
                resize: "vertical",
                minHeight: "60px",
              }}
            />

            <CookieGuide platform="xiaohongshu" cookieName="web_session" />
            <button
              onClick={handleVerifyCookie}
              disabled={verifying || !webSession.trim()}
              style={{
                padding: "10px 16px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                background: verifying ? "var(--bg-muted)" : "var(--color-primary)",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: verifying || !webSession.trim() ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              {verifying ? "Verifying..." : cookieVerified ? <><CheckCircle size={16} />Verified</> : <><AlertCircle size={16} />Verify and save</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderSearchTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div
        style={{
          padding: "12px 14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid rgba(255, 138, 0, 0.18)",
          background: "rgba(255, 138, 0, 0.08)",
          fontSize: "0.8125rem",
          color: "#C2410C",
          lineHeight: 1.7,
          fontWeight: 600,
        }}
      >
        <div>Due to Xiaohongshu limits, only one task can run at a time. Wait for the current task to finish before starting another crawl or save.</div>
        <div>The desktop must not be fullscreen, and a few pixels of the background browser must remain visible for scrolling and crawling to work.</div>
      </div>

      <Card title="Keyword Scan" icon={<Filter style={{ width: "18px", height: "18px" }} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Reuses the existing search flow, preferring the extension bridge to read real page state before falling back to the browser path, scanning public highly-liked notes.
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (isActionEnterKey(e)) {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="Enter keywords to search public Xiaohongshu notes..."
              disabled={!cookieVerified}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.9375rem",
                outline: "none",
                opacity: cookieVerified ? 1 : 0.5,
              }}
            />
            <button
              onClick={handleSearch}
              disabled={searchRunning || !searchKeyword.trim() || !cookieVerified}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 24px",
                borderRadius: "var(--radius-md)",
                border: "none",
                background: searchRunning || !cookieVerified ? "var(--bg-hover)" : "var(--color-primary)",
                color: "white",
                fontSize: "0.9375rem",
                fontWeight: 600,
                cursor: searchRunning || !searchKeyword.trim() || !cookieVerified ? "not-allowed" : "pointer",
                opacity: searchRunning || !searchKeyword.trim() || !cookieVerified ? 0.6 : 1,
                transition: "all 0.2s ease",
              }}
            >
              {searchRunning ? (
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="animate-spin">⟳</span>
                  Scanning...
                </span>
              ) : (
                <>
                  <Search style={{ width: "16px", height: "16px" }} />
                  Scan
                </>
              )}
            </button>
          </div>

          <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Sort:</span>
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  padding: "4px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "transparent",
                }}
              >
                <button type="button" disabled style={{ ...segmentedButtonStyle(true), cursor: "default" }}>
                  Default order
                </button>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Heart style={{ width: "14px", height: "14px", color: "var(--color-danger)" }} />
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Min likes：</span>
              <input
                type="number"
                value={minLikes}
                onChange={(e) => setMinLikes(Number(e.target.value))}
                min={0}
                style={{
                  width: "80px",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Search limit:</span>
              <input
                type="number"
                value={searchLimit}
                onChange={(e) => setSearchLimit(Number(e.target.value || 1))}
                min={1}
                max={300}
                style={{
                  width: "88px",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                }}
              />
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>items</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Keep only last：</span>
              <input
                type="number"
                value={searchRecentDays}
                onChange={(e) => setSearchRecentDays(Math.max(1, Math.min(365, Number(e.target.value || 1))))}
                min={1}
                max={365}
                style={{
                  width: "80px",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                }}
              />
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>days</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <input
                type="checkbox"
                checked={searchAutoSaveAfterFetch}
                onChange={(e) => setSearchAutoSaveAfterFetch(e.target.checked)}
              />
              Auto-save after crawling
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              <input
                type="checkbox"
                checked={searchSaveComments}
                onChange={(e) => setSearchSaveComments(e.target.checked)}
              />
              Fetch comments when saving
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.875rem", color: "var(--text-main)" }}>
              Comment limit
              <input
                type="number"
                min={1}
                max={100}
                value={searchSaveCommentsLimit}
                onChange={(e) => setSearchSaveCommentsLimit(Number(e.target.value || 1))}
                disabled={!searchSaveComments}
                style={{
                  width: "88px",
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                  opacity: searchSaveComments ? 1 : 0.5,
                }}
              />
              items
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Comment sort:</span>
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  padding: "4px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "transparent",
                  opacity: searchSaveComments ? 1 : 0.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => setSearchSaveCommentsSortBy("likes")}
                  disabled={!searchSaveComments}
                  style={segmentedButtonStyle(searchSaveCommentsSortBy === "likes")}
                >
                  Most liked first
                </button>
                <button
                  type="button"
                  onClick={() => setSearchSaveCommentsSortBy("time")}
                  disabled={!searchSaveComments}
                  style={segmentedButtonStyle(searchSaveCommentsSortBy === "time")}
                >
                  Newest first
                </button>
              </div>
            </div>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              Unchecked, results are fetched but not saved. Comments are only fetched on single saves; bulk "Save all" and auto-save skip comments by default.
            </span>
          </div>
        </div>
      </Card>

      {renderFollowingWorkbenchCard()}
      {renderFollowingResultCard()}

      {/* Search Results */}
      {searchResult && (
        <Card
          title={`Keyword Scan Results (${searchResult.total_found})`}
          icon={<BookOpen style={{ width: "18px", height: "18px" }} />}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-light)",
                background: "rgba(255, 255, 255, 0.72)",
              }}
            >
              <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                Saved in the unified format under the current keyword folder; short text notes get local images filled in first.
              </span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" onClick={() => setShowSearchResults((value) => !value)} style={segmentedButtonStyle(false)}>
                  {showSearchResults ? "Collapse results" : "Expand results"}
                </button>
                <button
                  onClick={() => void handleSaveSearchResults(searchResult.notes, searchResult.keyword)}
                  disabled={previewSaveRunning || searchResult.notes.length === 0}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    background: previewSaveRunning ? "var(--bg-hover)" : "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    cursor: previewSaveRunning ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <FolderDown style={{ width: "14px", height: "14px" }} />
                  {previewSaveRunning ? "Saving..." : "Save all"}
                </button>
              </div>
            </div>
            {showSearchResults ? (
              renderHorizontalNoteResults({
                notes: searchResult.notes,
                carouselRef: searchResultCarouselRef,
                layout: searchResultLayout,
                onLayoutChange: setSearchResultLayout,
                expandedIds: expandedNotes,
                onToggleExpand: toggleNoteExpand,
                saveSubfolder: () => buildKeywordSaveSubfolder(searchResult.keyword),
                saveSuccessTitle: "Keyword note saved",
                saveAllSubfolder: buildKeywordSaveSubfolder(searchResult.keyword),
                saveAllSuccessTitle: "Keyword results saved",
                creatorSourceLabel: () => ({
                  tags: searchResult.keyword ? [searchResult.keyword] : [],
                  summary: searchResult.keyword ? `From keyword search: ${searchResult.keyword}` : "From keyword search",
                }),
              })
            ) : (
              <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                Keyword scan results collapsed. Click "Expand results" above to continue viewing.
              </div>
            )}
          </div>
        </Card>
      )}
      {renderCreatorRecentPanel()}
    </div>
  );

  const renderManualCrawlWorkbench = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        style={{
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-light)",
          background: "var(--bg-card)",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          aria-expanded={showManualCrawlWorkbench}
          onClick={() => setShowManualCrawlWorkbench((value) => !value)}
          style={{
            width: "100%",
            padding: "14px 16px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
                Manual crawl / manual save tools
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                Single save, bulk save, and comment crawling all live here. Collapsed by default to save page space.
              </div>
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "999px",
                border: "1px solid var(--border-light)",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 700,
              }}
            >
              {showManualCrawlWorkbench ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showManualCrawlWorkbench ? "Collapse tools" : "Expand tools"}
            </div>
          </div>
        </button>
      </div>

      {showManualCrawlWorkbench && renderManualCrawlTools()}
    </div>
  );

  const renderCommentsTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Comments Input */}
      <Card title="Fetch Comments" icon={<MessageCircle style={{ width: "18px", height: "18px" }} />}>
        <div style={{ display: "flex", gap: "12px" }}>
          <input
            type="text"
            value={noteId}
            onChange={(e) => setNoteId(e.target.value)}
            onKeyDown={(e) => {
              if (isActionEnterKey(e)) {
                e.preventDefault();
                handleComments();
              }
            }}
            placeholder="Enter a Xiaohongshu note ID or full link..."
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
            onClick={handleComments}
            disabled={commentsRunning || !noteId.trim()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "12px 24px",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: commentsRunning ? "var(--bg-hover)" : "var(--color-primary)",
              color: "white",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: commentsRunning || !noteId.trim() ? "not-allowed" : "pointer",
              opacity: commentsRunning || !noteId.trim() ? 0.6 : 1,
            }}
          >
            {commentsRunning ? (
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="animate-spin">⟳</span>
                Fetching...
              </span>
            ) : (
              <>
                <MessageCircle style={{ width: "16px", height: "16px" }} />
                Fetch comments
              </>
            )}
          </button>
        </div>
      </Card>

      {/* Comments Results */}
      {commentsResult && (
        <Card
          title={`Comments (${commentsResult.total_comments})`}
          icon={<Users style={{ width: "18px", height: "18px" }} />}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {commentsResult.strategy ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
                Read path: {formatStrategyLabel(commentsResult.strategy)}
              </div>
            ) : null}
            {commentsResult.comments.map((comment) => (
              <div
                key={comment.id}
                style={{
                  padding: "16px",
                  borderRadius: "var(--radius-lg)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border-light)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span
                    style={{
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: "var(--color-primary)",
                    }}
                  >
                    {comment.author}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {comment.is_top && (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--color-warning)20",
                          color: "var(--color-warning)",
                          fontSize: "0.75rem",
                        }}
                      >
                        Pinned
                      </span>
                    )}
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "0.8125rem",
                        color: "var(--color-danger)",
                      }}
                    >
                      <Heart style={{ width: "14px", height: "14px" }} />
                      {comment.likes.toLocaleString()}
                    </span>
                  </div>
                </div>

                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--text-main)",
                    lineHeight: 1.6,
                  }}
                >
                  {expandedComments.has(comment.id)
                    ? comment.content
                    : comment.content.slice(0, 200) + (comment.content.length > 200 ? "..." : "")}
                </p>

                {comment.content.length > 200 && (
                  <button
                    onClick={() => {
                      setExpandedComments((prev) => {
                        const next = new Set(prev);
                        if (next.has(comment.id)) next.delete(comment.id);
                        else next.add(comment.id);
                        return next;
                      });
                    }}
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
                    {expandedComments.has(comment.id) ? (
                      <>
                        <ChevronUp style={{ width: "14px", height: "14px" }} />
                        Collapse
                      </>
                    ) : (
                      <>
                        <ChevronDown style={{ width: "14px", height: "14px" }} />
                        Expand
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {!commentsResult && !commentsRunning && (
        <EmptyState
          icon={MessageCircle}
          title="Fetch comments"
          description="Enter a note ID to fetch Xiaohongshu comments (sorted by likes)"
        />
      )}
    </div>
  );

  const normalizedTaskQuery = taskHistoryQuery.trim().toLowerCase();
  const filteredTaskHistory = taskHistory.filter((task) => {
    if (!normalizedTaskQuery) return true;
    const searchable = [
      task.kind,
      task.status,
      task.stage,
      task.input_summary,
      task.error,
      JSON.stringify(task.input || {}),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalizedTaskQuery);
  });
  const taskHistoryPageSize = 9;
  const taskHistoryPageCount = Math.max(1, Math.ceil(filteredTaskHistory.length / taskHistoryPageSize));
  const normalizedTaskHistoryPage = Math.min(taskHistoryPage, taskHistoryPageCount - 1);
  const pagedTaskHistory = filteredTaskHistory.slice(
    normalizedTaskHistoryPage * taskHistoryPageSize,
    normalizedTaskHistoryPage * taskHistoryPageSize + taskHistoryPageSize,
  );
  const selectedTask = taskHistory.find((task) => task.task_id === selectedTaskId) || null;
  const creatorRecentDisplayLabel = creatorRecentResult
    ? resolveCreatorDisplayLabel(
        creatorRecentResult.resolved_author || creatorRecentResult.creator_query,
        creatorRecentResult.notes,
        creatorRecentResult.resolved_user_id,
      )
    : "";

  return (
    <PageContainer>
      {renderCookieConfigModal()}
      <PageHeader
        title="Xiaohongshu Tools"
        subtitle="Bookmark album crawls, manual crawls, follow monitors; one-click cookie and saves into the Intel Library under xhs/主动保存 and xhs/专辑"
        icon={Search}
        actions={
          <button
            type="button"
            onClick={() => setShowCookieModal(true)}
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-light)",
              background: hasCookie ? "transparent" : "rgba(239, 68, 68, 0.08)",
              color: hasCookie ? "var(--text-secondary)" : "var(--color-danger)",
              fontSize: "0.875rem",
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <Cookie size={16} />
            {hasCookie ? "Cookie settings" : "Configure cookie"}
          </button>
        }
      />
      <PageContent maxWidth="1200px">
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {renderTabs()}

          {backgroundTask && (
            <Card title="Background Tasks" icon={<Zap style={{ width: "18px", height: "18px" }} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)" }}>
                  {backgroundTask.stage}
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                  Task type: {formatTaskKindLabel(backgroundTask.kind)} · Task ID: {backgroundTask.taskId}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    borderRadius: "999px",
                    background: "var(--bg-hover)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: "38%",
                      height: "100%",
                      background: "var(--color-primary)",
                      animation: "pulse 1.2s ease-in-out infinite",
                    }}
                  />
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  Keeps running when you switch pages; results reattach automatically when you return.
                </div>
              </div>
            </Card>
          )}

          {taskHistory.length > 0 && (
            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <button
                  type="button"
                  onClick={() => setShowTaskHistory((prev) => !prev)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-hover)",
                    color: "var(--text-main)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
                    {taskHistory.length} recent tasks
                  </span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-card)",
                      color: "var(--text-secondary)",
                      flexShrink: 0,
                    }}
                  >
                    {showTaskHistory ? (
                      <>
                        <ChevronUp style={{ width: "16px", height: "16px" }} />
                        Collapse
                      </>
                    ) : (
                      <>
                        <ChevronDown style={{ width: "16px", height: "16px" }} />
                        Expand
                      </>
                    )}
                  </span>
                </button>

                {showTaskHistory && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        type="text"
                        value={taskHistoryQuery}
                        onChange={(e) => {
                          setTaskHistoryQuery(e.target.value);
                          setTaskHistoryPage(0);
                        }}
                        placeholder="Search history keywords, links, task types..."
                        style={{
                          flex: "1 1 260px",
                          minWidth: 0,
                          padding: "10px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-card)",
                          color: "var(--text-main)",
                          fontSize: "0.875rem",
                          outline: "none",
                        }}
                      />
                      <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                        {filteredTaskHistory.length} matches
                      </span>
                    </div>

                    {pagedTaskHistory.length > 0 ? (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                          gap: "8px",
                        }}
                      >
                        {pagedTaskHistory.map((task) => {
                          const color =
                            task.status === "completed"
                              ? "#22c55e"
                              : task.status === "failed" || task.status === "interrupted"
                                ? "#ef4444"
                                : "var(--color-primary)";
                          const active = selectedTaskId === task.task_id;
                          return (
                            <button
                              key={task.task_id}
                              type="button"
                              onClick={() => setSelectedTaskId(task.task_id)}
                              style={{
                                minHeight: "62px",
                                padding: "8px 10px",
                                borderRadius: "var(--radius-sm)",
                                border: `1px solid ${active ? "var(--color-primary)" : "var(--border-light)"}`,
                                background: active ? "rgba(59, 130, 246, 0.08)" : "var(--bg-hover)",
                                color: "var(--text-main)",
                                cursor: "pointer",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: "4px",
                                textAlign: "left",
                                overflow: "hidden",
                              }}
                            >
                              <span
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: "8px",
                                  width: "100%",
                                  fontSize: "0.75rem",
                                  fontWeight: 700,
                                }}
                              >
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {formatTaskKindLabel(task.kind)}
                                </span>
                                <span style={{ color, flexShrink: 0 }}>
                                  {task.status === "completed"
                                    ? "Done"
                                    : task.status === "failed"
                                      ? "Failed"
                                      : task.status === "interrupted"
                                        ? "Interrupted"
                                        : "Running"}
                                </span>
                              </span>
                              <span
                                title={task.input_summary || task.stage}
                                style={{
                                  maxWidth: "100%",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  fontSize: "0.75rem",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {task.input_summary || task.stage}
                              </span>
                              <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                                {formatTaskTime(task.updated_at || task.created_at)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: "14px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px dashed var(--border-light)",
                          color: "var(--text-muted)",
                          fontSize: "0.875rem",
                          textAlign: "center",
                        }}
                      >
                        No matching task history
                      </div>
                    )}

                    {filteredTaskHistory.length > taskHistoryPageSize && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                        <button
                          type="button"
                          onClick={() => setTaskHistoryPage((prev) => Math.max(0, prev - 1))}
                          disabled={normalizedTaskHistoryPage === 0}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--border-light)",
                            background: "var(--bg-card)",
                            color: "var(--text-main)",
                            cursor: normalizedTaskHistoryPage === 0 ? "not-allowed" : "pointer",
                            opacity: normalizedTaskHistoryPage === 0 ? 0.5 : 1,
                          }}
                        >
                          Previous
                        </button>
                        <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                          Page {normalizedTaskHistoryPage + 1} / {taskHistoryPageCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => setTaskHistoryPage((prev) => Math.min(taskHistoryPageCount - 1, prev + 1))}
                          disabled={normalizedTaskHistoryPage >= taskHistoryPageCount - 1}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--border-light)",
                            background: "var(--bg-card)",
                            color: "var(--text-main)",
                            cursor: normalizedTaskHistoryPage >= taskHistoryPageCount - 1 ? "not-allowed" : "pointer",
                            opacity: normalizedTaskHistoryPage >= taskHistoryPageCount - 1 ? 0.5 : 1,
                          }}
                        >
                          Next
                        </button>
                      </div>
                    )}

                    {selectedTask && (
                      <div
                        style={{
                          padding: "12px 14px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-card)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          userSelect: "text",
                          WebkitUserSelect: "text",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                            {formatTaskKindLabel(selectedTask.kind)}
                          </span>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            {selectedTask.task_id}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>{selectedTask.stage}</div>
                        {renderTaskInputDetails(selectedTask)}
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {formatTaskTime(selectedTask.updated_at || selectedTask.created_at)}
                        </div>
                        {selectedTask.error && (
                          <div style={{ fontSize: "0.75rem", color: "#ef4444" }}>{selectedTask.error}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          {activeTab === "collections" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {renderManualCrawlWorkbench()}
              {renderCollectionsTab()}
            </div>
          )}
          {activeTab === "search" && renderSearchTab()}
          {activeTab === "following" && renderFollowingTab()}
          {false && renderCommentsTab()}
        </div>
      </PageContent>
    </PageContainer>
  );
}
