import { useState, useEffect, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Tv,
  Search,
  Filter,
  Hash,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Play,
  Image as ImageIcon,
  FileText,
  MessageSquare,
  X,
  Plus,
  Cookie,
  FolderHeart,
  Users,
} from "lucide-react";
import { PageContainer, PageHeader, PageContent, Card, EmptyState, LoadingState } from "../../components/Layout";
import { PaginationControls } from "../../components/PaginationControls";
import { SmartGroupActionButton } from "../../components/SmartGroupActionButton";
import { SharedSignalMappingPanel, type SharedSignalEntry } from "../../components/SharedSignalMappingPanel";
import { useToast } from "../../components/Toast";
import { api } from "../../core/api";
import { isActionEnterKey } from "../../core/keyboard";
import { withLocationSuffix } from "../../core/pathDisplay";
import {
  readJsonStorage,
  readStringStorage,
  removeStorageKey,
  writeJsonStorage,
  writeStringStorage,
} from "../../core/storage";
import { useStore } from "../../core/store";
import { BilibiliCookieModal } from "./BilibiliCookieModal";
import BilibiliDynamicCard from "./BilibiliDynamicCard";
import { BilibiliFavoritesPage } from "./BilibiliFavoritesPage";
import {
  BiliDynamic,
  BiliDynamicFetchStats,
  BilibiliDailyDynamicMonitor,
  BilibiliFollowedGroupMonitor,
  BiliFollowedUp,
  BiliOriginalFollowedGroup,
  BilibiliSmartGroupOption,
  BilibiliSmartGroupProfile,
  BilibiliSmartGroupTask,
  bilibiliCancelTaskSilently,
  bilibiliFetchByLinks,
  bilibiliFetchFollowed,
  bilibiliFetchFollowedUps,
  bilibiliGetConfig,
  bilibiliGetCookieFromBrowser,
  bilibiliGetFollowedCrawlTask,
  bilibiliDebugTest,
  DebugTestResult,
  CrawlToVaultResponse,
  bilibiliSaveSelectedDynamics,
  bilibiliStartFollowedCrawl,
  bilibiliStartFollowedUpsCrawl,
  bilibiliGetFollowedUpsCrawlTask,
  FollowedDynamicsCrawlTask,
  FollowedUpsCrawlTask,
  bilibiliStartSmartGroupTask,
  bilibiliGetSmartGroupTask,
} from "../../api/bilibili";

const DYNAMIC_TYPE_MAP: Record<string, { label: string; icon: typeof Play; color: string }> = {
  video: { label: "Video", icon: Play, color: "#00AEEC" },
  image: { label: "Image post", icon: ImageIcon, color: "#FB7299" },
  text: { label: "Text", icon: MessageSquare, color: "#FF7F50" },
  article: { label: "Article", icon: FileText, color: "#52C41A" },
};

const PRESET_KEYWORDS = [
  "生活",
  "教程",
  "评测",
  "Vlog",
  "游戏",
];

const TIME_RANGE_OPTIONS = [
  { value: 1, label: "1 day" },
  { value: 3, label: "3 days" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

const LIMIT_OPTIONS = [10, 20, 50];
const FREQUENT_UP_PAGE_SIZE = 12;

type BilibiliPanelTab = "dynamics" | "favorites" | "following";
type TrackerFilterMode = "and" | "smart_only";
type ManualGroupingScope = "all" | "filtered" | "managed";
type DynamicFetchScope = "global" | "group" | "ups" | "links";
type PaginatedPageSize = 20 | 50;

interface DynamicFetchMeta {
  scope: DynamicFetchScope;
  label: string;
  authorCount?: number;
  fetchStats?: BiliDynamicFetchStats;
  daysBack?: number;
  keepLimit?: number;
}

const DEFAULT_SMART_GROUP_OPTIONS: BilibiliSmartGroupOption[] = [
  { value: "ai-tech", label: "AI & Tech" },
  { value: "study", label: "Learning" },
  { value: "digital", label: "Digital & AV" },
  { value: "game", label: "Gaming" },
  { value: "finance", label: "Finance & Business" },
  { value: "creative", label: "Design & Creation" },
  { value: "entertainment", label: "Lifestyle & Entertainment" },
  { value: "other", label: "Other" },
];

const DEFAULT_SMART_GROUP_META: Record<string, { label: string; accent: string; bg: string }> = {
  "ai-tech": { label: "AI & Tech", accent: "#0EA5E9", bg: "rgba(14, 165, 233, 0.14)" },
  study: { label: "Learning", accent: "#10B981", bg: "rgba(16, 185, 129, 0.14)" },
  digital: { label: "Digital & AV", accent: "#F59E0B", bg: "rgba(245, 158, 11, 0.14)" },
  game: { label: "Gaming", accent: "#EF4444", bg: "rgba(239, 68, 68, 0.14)" },
  finance: { label: "Finance & Business", accent: "#8B5CF6", bg: "rgba(139, 92, 246, 0.14)" },
  creative: { label: "Design & Creation", accent: "#EC4899", bg: "rgba(236, 72, 153, 0.14)" },
  entertainment: { label: "Lifestyle & Entertainment", accent: "#F97316", bg: "rgba(249, 115, 22, 0.14)" },
  other: { label: "Other", accent: "#64748B", bg: "rgba(100, 116, 139, 0.14)" },
};

const FOLLOWED_DYNAMICS_TASK_KEY = "bilibili_followed_dynamics_task_id";
const FOLLOWED_UPS_TASK_KEY = "bilibili_followed_ups_task_id";
const SMART_GROUP_TASK_KEY = "bilibili_followed_smart_group_task_id";
const BILIBILI_DYNAMICS_CACHE_KEY = "bilibili_dynamics_cache";
const BILIBILI_FOLLOWED_CACHE_KEY = "bilibili_followed_cache";
const DEFAULT_DYNAMIC_FETCH_META: DynamicFetchMeta = { scope: "global", label: "Full follow feed" };
const MAX_DYNAMIC_KEEP_LIMIT = 1000;
const PAGINATION_SIZE_OPTIONS = [20, 50];
const FIXED_UP_IMPORT_GROUPS_PAGE_SIZE = 10;
const TARGETED_DYNAMIC_GROUPS_PAGE_SIZE = 10;
const TARGETED_DYNAMIC_RESULTS_PAGE_SIZE = 12;
const DYNAMIC_RESULTS_PAGE_SIZE = 10;
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

function cancelStoredTask(taskStorageKey: string): void {
  const taskId = readStringStorage(taskStorageKey, "");
  if (!taskId) {
    return;
  }
  removeStorageKey(taskStorageKey);
  bilibiliCancelTaskSilently(taskId);
}

function resolveDynamicSourceUrl(dynamic: BiliDynamic): string {
  const rawUrl = String(dynamic.url || "").trim();
  if (rawUrl) {
    if (/^https?:\/\//i.test(rawUrl)) {
      return rawUrl;
    }
    if (rawUrl.startsWith("//")) {
      return `https:${rawUrl}`;
    }
    if (rawUrl.startsWith("/")) {
      return `https://www.bilibili.com${rawUrl}`;
    }
  }

  if (dynamic.bvid) {
    return `https://www.bilibili.com/video/${dynamic.bvid}`;
  }
  if (dynamic.dynamic_type === "article") {
    return dynamic.dynamic_id ? `https://www.bilibili.com/opus/${dynamic.dynamic_id}` : "";
  }
  if (dynamic.dynamic_id) {
    return dynamic.dynamic_type === "image" || dynamic.dynamic_type === "text"
      ? `https://t.bilibili.com/${dynamic.dynamic_id}`
      : `https://www.bilibili.com/opus/${dynamic.dynamic_id}`;
  }
  return "";
}

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /not found|404/i.test(message);
}

function classifyFollowedUp(up: BiliFollowedUp): string {
  const haystack = `${up.uname} ${up.sign} ${up.official_desc}`.toLowerCase();

  const matchers: Array<[string, string[]]> = [
    ["ai-tech", ["ai", "人工智能", "大模型", "算法", "程序", "编程", "开发", "科技", "机器人", "芯片", "科普", "computer", "code"]],
    ["study", ["教程", "学习", "知识", "考研", "读书", "数学", "英语", "教育", "课堂", "论文", "学术", "老师"]],
    ["digital", ["数码", "手机", "相机", "耳机", "电脑", "测评", "评测", "影音", "摄影", "设备", "镜头"]],
    ["game", ["游戏", "电竞", "主机", "steam", "switch", "moba", "fps", "实况", "攻略"]],
    ["finance", ["财经", "商业", "投资", "股票", "基金", "创业", "营销", "副业", "理财", "经济"]],
    ["creative", ["设计", "插画", "绘画", "ui", "产品", "建筑", "摄影后期", "创作", "剪辑", "3d", "建模"]],
    ["entertainment", ["vlog", "生活", "旅行", "美食", "音乐", "舞蹈", "综艺", "动画", "影视", "电影", "追番", "二次元", "搞笑"]],
  ];

  for (const [group, keywords] of matchers) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return group;
    }
  }

  return "other";
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function resolveSmartGroupMeta(
  groupValue: string,
  label: string,
): { label: string; accent: string; bg: string } {
  const defaultMeta = DEFAULT_SMART_GROUP_META[groupValue];
  if (defaultMeta) {
    return defaultMeta;
  }
  const palette = [
    { accent: "#059669", bg: "rgba(5, 150, 105, 0.14)" },
    { accent: "#0EA5E9", bg: "rgba(14, 165, 233, 0.14)" },
    { accent: "#E11D48", bg: "rgba(225, 29, 72, 0.14)" },
    { accent: "#7C3AED", bg: "rgba(124, 58, 237, 0.14)" },
    { accent: "#EA580C", bg: "rgba(234, 88, 12, 0.14)" },
    { accent: "#0891B2", bg: "rgba(8, 145, 178, 0.14)" },
  ];
  return { label, ...palette[hashString(`${groupValue}-${label}`) % palette.length] };
}

function matchesUpQuery(up: BiliFollowedUp, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [up.uname, up.sign, up.official_desc].some((value) => value?.toLowerCase().includes(q));
}

function parseStringListInput(value: string): string[] {
  const rawItems = String(value || "").split(/[,\n，]+/);
  const normalized: string[] = [];
  const seen = new Set<string>();
  rawItems.forEach((item) => {
    const text = String(item || "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(text);
  });
  return normalized;
}

function parseLinkListInput(value: string): string[] {
  const rawItems = String(value || "")
    .replace(/[，,]+/g, "\n")
    .split(/\s*\n+\s*/);
  const normalized: string[] = [];
  const seen = new Set<string>();
  rawItems.forEach((item) => {
    const text = String(item || "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(text);
  });
  return normalized;
}

function clampPositiveInt(value: unknown, fallback: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(1, Math.round(parsed));
  return max ? Math.min(normalized, max) : normalized;
}

const LEGACY_MONITOR_PAGE_LIMIT = 5;
const FIXED_UP_MONITOR_DEFAULT_DAYS_BACK = 3;
const FOLLOWED_GROUP_MONITOR_DEFAULT_DAYS_BACK = 3;

function normalizeMonitorPageLimit(value: unknown, fallback: number): number {
  const normalized = clampPositiveInt(value, fallback, 1000);
  if (normalized === LEGACY_MONITOR_PAGE_LIMIT) {
    return fallback;
  }
  return normalized;
}

function getDailyMonitorDefaults(config?: Partial<BilibiliTrackerConfig>) {
  return {
    daysBack: clampPositiveInt((config as { days_back?: number } | undefined)?.days_back, 7, 365),
    limit: 50,
    pageLimit: normalizeMonitorPageLimit((config as { page_limit?: number } | undefined)?.page_limit, 1000),
  };
}

function createLocalMonitorId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function normalizeDailyDynamicMonitor(
  seed: Partial<BilibiliDailyDynamicMonitor> = {},
  defaults: { daysBack?: number; limit?: number; pageLimit?: number } = {},
): BilibiliDailyDynamicMonitor {
  const keywords = Array.isArray(seed.keywords) ? parseStringListInput(seed.keywords.join(", ")) : [];
  const tagFilters = Array.isArray(seed.tag_filters) ? parseStringListInput(seed.tag_filters.join(", ")) : [];
  const label = String(seed.label || keywords[0] || tagFilters[0] || "Daily feed monitor").trim() || "Daily feed monitor";
  return {
    id: String(seed.id || createLocalMonitorId("bili-dm")),
    label,
    keywords,
    tag_filters: tagFilters,
    enabled: seed.enabled ?? true,
    days_back: clampPositiveInt(seed.days_back, defaults.daysBack ?? 7, 365),
    limit: clampPositiveInt(
      seed.limit ?? (seed as { fetch_limit?: number }).fetch_limit,
      defaults.limit ?? 50,
      MAX_DYNAMIC_KEEP_LIMIT,
    ),
    page_limit: normalizeMonitorPageLimit(
      seed.page_limit ?? (seed as { pages?: number; max_pages?: number }).pages ?? (seed as { max_pages?: number }).max_pages,
      defaults.pageLimit ?? 1000,
    ),
  };
}

function resolveSharedSignalEntryLabels(entry: SharedSignalEntry): string[] {
  const rawLabels = entry.group_labels && entry.group_labels.length > 0
    ? entry.group_labels
    : [entry.group_label];
  return Array.from(
    new Set(
      rawLabels
        .map((label) => String(label || "").trim())
        .filter(Boolean)
    )
  );
}

function buildDailyMonitorSubfolder(label: string): string {
  return `每日关键词监控/${normalizeSubfolderSegment(label, "未命名监控")}`;
}

function normalizeSubfolderSegment(value: string, fallback: string): string {
  const normalized = String(value || "")
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function uniqueSubfolderSegments(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeSubfolderSegment(value, "");
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result;
}

function buildKeywordContextSubfolders(keywords: string[] = [], tagFilters: string[] = []): string[] {
  const normalizedKeywords = uniqueSubfolderSegments(keywords);
  const normalizedTags = uniqueSubfolderSegments(tagFilters);
  const parts: string[] = [];
  if (normalizedKeywords.length > 0) {
    parts.push(`关键词/${normalizedKeywords.join("，")}`);
  }
  if (normalizedTags.length > 0) {
    parts.push(`标签/${normalizedTags.join("，")}`);
  }
  if (parts.length === 0) {
    parts.push("全部条件");
  }
  return parts;
}

function buildGlobalSearchSubfolder(keywords: string[] = [], tagFilters: string[] = []): string {
  return ["全关注流搜索", ...buildKeywordContextSubfolders(keywords, tagFilters)].join("/");
}

function buildDailyMonitorSaveSubfolder(
  label: string,
  keywords: string[] = [],
  tagFilters: string[] = [],
): string {
  return [
    "每日关键词监控",
    normalizeSubfolderSegment(label, "未命名监控"),
    ...buildKeywordContextSubfolders(keywords, tagFilters),
  ].join("/");
}

function buildTrackedUpsSubfolder(label: string): string {
  void label;
  return ["每日监视UP", "固定UP监督"].join("/");
}

function buildTargetedGroupSubfolder(label: string): string {
  return ["定向动态爬取", "智能分组", normalizeSubfolderSegment(label, "未命名分组")].join("/");
}

function buildSelectedUpsSubfolder(label: string): string {
  return ["定向动态爬取", "指定UP", normalizeSubfolderSegment(label, "未命名UP")].join("/");
}

function getDailyMonitorTerms(monitor: Partial<BilibiliDailyDynamicMonitor>): string[] {
  return parseStringListInput([
    ...(Array.isArray(monitor.keywords) ? monitor.keywords : []),
    ...(Array.isArray(monitor.tag_filters) ? monitor.tag_filters : []),
  ].join(", "));
}

function normalizeFollowedGroupMonitor(
  seed: Partial<BilibiliFollowedGroupMonitor> = {},
  labelLookup: Record<string, string> = {},
  defaults: { daysBack?: number; limit?: number; pageLimit?: number } = {},
): BilibiliFollowedGroupMonitor {
  const groupValue = String(
    seed.group_value
    || (seed as { value?: string }).value
    || (seed as { group?: string }).group
    || ""
  ).trim();
  const label = String(seed.label || labelLookup[groupValue] || groupValue || "Unnamed group").trim() || "Unnamed group";
  return {
    id: String(seed.id || createLocalMonitorId("bili-gm")),
    group_value: groupValue,
    label,
    enabled: seed.enabled ?? true,
    days_back: clampPositiveInt(seed.days_back, FOLLOWED_GROUP_MONITOR_DEFAULT_DAYS_BACK, 365),
    limit: clampPositiveInt(
      seed.limit ?? (seed as { fetch_limit?: number }).fetch_limit,
      defaults.limit ?? 50,
      MAX_DYNAMIC_KEEP_LIMIT,
    ),
    page_limit: normalizeMonitorPageLimit(
      seed.page_limit ?? (seed as { pages?: number; max_pages?: number }).pages ?? (seed as { max_pages?: number }).max_pages,
      defaults.pageLimit ?? 1000,
    ),
  };
}

interface VaultSignalStat {
  signal: string;
  count?: number;
  platforms?: string[];
  sample_titles?: string[];
  sample_authors?: string[];
}

interface BilibiliTrackerConfig {
  up_uids: string[];
  favorite_up_uids: string[];
  favorite_up_excluded_uids: string[];
  fixed_up_days_back?: number;
  daily_dynamic_monitors: BilibiliDailyDynamicMonitor[];
  followed_up_group_monitors: BilibiliFollowedGroupMonitor[];
  followed_up_groups: string[];
  followed_up_original_groups: number[];
  followed_up_filter_mode: TrackerFilterMode;
  followed_up_group_options: BilibiliSmartGroupOption[];
  creator_profiles: Record<string, BilibiliSmartGroupProfile>;
  favorite_up_profiles: Record<string, BilibiliSmartGroupProfile>;
  shared_signal_entries: SharedSignalEntry[];
  shared_creator_grouping: {
    updated_at?: string;
    signal_group_labels?: Record<string, string | string[]>;
    vault_signal_database?: {
      indexed_files?: number;
      signal_count?: number;
      signals?: VaultSignalStat[];
      database_path?: string;
      tag_index_path?: string;
      saved_at?: string;
    };
    shared_data_paths?: {
      tag_index_path?: string;
      shared_groups_path?: string;
      creator_profiles_path?: string;
    };
  };
}

interface FrequentUpCandidate {
  upId: string;
  up?: BiliFollowedUp;
  profile: BilibiliSmartGroupProfile;
  displayName: string;
  description: string;
  noteCount: number;
  latestTitle: string;
  smartGroups: string[];
  originalGroupNames: string[];
  tracked: boolean;
}

interface ExpandableSectionProps {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  badge?: string;
  accent?: string;
  icon?: ReactNode;
  children: ReactNode;
}

function ExpandableSection({
  title,
  summary,
  open,
  onToggle,
  badge,
  accent = "var(--color-primary)",
  icon,
  children,
}: ExpandableSectionProps) {
  return (
    <div
      style={{
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-light)",
        background: "var(--bg-card)",
        overflow: "hidden",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          width: "100%",
          padding: "16px 18px",
          border: "none",
          background: "transparent",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "14px",
          alignItems: "center",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", minWidth: 0 }}>
          {icon && (
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "12px",
                background: "var(--bg-hover)",
                color: accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {icon}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>
              {title}
            </div>
            <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {summary}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          {badge && (
            <span
              style={{
                padding: "5px 10px",
                borderRadius: "999px",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {badge}
            </span>
          )}
          <span
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "999px",
              border: "1px solid var(--border-light)",
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <ChevronDown size={15} />
          </span>
        </div>
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div
            style={{
              padding: "18px",
              borderTop: "1px solid var(--border-light)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BilibiliTool() {
  const toast = useToast();
  const config = useStore((state) => state.config);
  const [panelTab, setPanelTab] = useState<BilibiliPanelTab>(() => {
    const saved = readStringStorage("bilibili_tool_panel", "");
    if (saved === "favorites" || saved === "following") return saved;
    return "dynamics";
  });

  // Cookie configuration state
  const [cookieConfigured, setCookieConfigured] = useState(false);
  const [cookiePreview, setCookiePreview] = useState<string | null>(null);
  const [cookieInput, setCookieInput] = useState("");
  const [gettingFromBrowser, setGettingFromBrowser] = useState(false);
  const [showFullCookie, setShowFullCookie] = useState(false);
  const [showCookieModal, setShowCookieModal] = useState(false);

  // SESSDATA state (extracted from cookie)
  const [sessdata, setSessdata] = useState(() => readStringStorage("bilibili_sessdata", ""));

  // Filter state
  const [keywords, setKeywords] = useState<string[]>(() => {
    const storedKeywords = readJsonStorage("bilibili_keywords", [] as string[]);
    const storedTagFilters = readJsonStorage("bilibili_tag_filters", [] as string[]);
    return parseStringListInput([...storedKeywords, ...storedTagFilters].join(", "));
  });
  const [keywordInput, setKeywordInput] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>(() => {
    const storedKeywords = readJsonStorage("bilibili_keywords", [] as string[]);
    const storedTagFilters = readJsonStorage("bilibili_tag_filters", [] as string[]);
    return parseStringListInput([...storedKeywords, ...storedTagFilters].join(", "));
  });
  const [dailyMonitorTermInput, setDailyMonitorTermInput] = useState("");
  const [dailyMonitorDaysBackInput, setDailyMonitorDaysBackInput] = useState("7");
  const [dailyMonitorLimitInput, setDailyMonitorLimitInput] = useState("50");
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["video", "image", "text", "article"]);
  const [daysBack, setDaysBack] = useState(7);
  const [daysBackInput, setDaysBackInput] = useState("7");
  const [limit, setLimit] = useState(50);
  const [limitInput, setLimitInput] = useState("50");
  const [targetedGroupDaysBack, setTargetedGroupDaysBack] = useState(7);
  const [targetedGroupDaysBackInput, setTargetedGroupDaysBackInput] = useState("7");
  const [targetedGroupLimit, setTargetedGroupLimit] = useState(50);
  const [targetedGroupLimitInput, setTargetedGroupLimitInput] = useState("50");
  const [directLinkInput, setDirectLinkInput] = useState("");
  const [directLinkRunning, setDirectLinkRunning] = useState<"preview" | "save" | null>(null);

  // Results state
  const [dynamics, setDynamics] = useState<BiliDynamic[]>(() => readJsonCache(BILIBILI_DYNAMICS_CACHE_KEY, []));
  const [loading, setLoading] = useState(false);
  const [followedDynamicsTask, setFollowedDynamicsTask] = useState<FollowedDynamicsCrawlTask | null>(null);
  const [totalFound, setTotalFound] = useState(() => readJsonCache<number>("bilibili_dynamics_total", 0));
  const [hasFetchedDynamics, setHasFetchedDynamics] = useState(() => readJsonCache<boolean>("bilibili_dynamics_has_fetched", false));
  const [dynamicFetchMeta, setDynamicFetchMeta] = useState<DynamicFetchMeta>(() => (
    readJsonCache<DynamicFetchMeta>("bilibili_dynamics_fetch_meta", DEFAULT_DYNAMIC_FETCH_META)
  ));
  const [selectedDynamicIds, setSelectedDynamicIds] = useState<Set<string>>(new Set());
  const [showDynamicResultList, setShowDynamicResultList] = useState(true);
  const [showSuggestedSmartGroupTags, setShowSuggestedSmartGroupTags] = useState(false);
  const [expandedSuggestedSmartGroupTagGroups, setExpandedSuggestedSmartGroupTagGroups] = useState<Set<string>>(new Set());
  const [dynamicResultsPage, setDynamicResultsPage] = useState(1);
  const [followedUps, setFollowedUps] = useState<BiliFollowedUp[]>(() => readJsonCache(BILIBILI_FOLLOWED_CACHE_KEY, []));
  const [originalGroups, setOriginalGroups] = useState<BiliOriginalFollowedGroup[]>(() => readJsonCache("bilibili_followed_groups_cache", []));
  const [followedUpsLoading, setFollowedUpsLoading] = useState(false);
  const [followedUpsLoaded, setFollowedUpsLoaded] = useState(() => readJsonCache<boolean>("bilibili_followed_loaded", false));
  const [followedUpsTask, setFollowedUpsTask] = useState<FollowedUpsCrawlTask | null>(null);
  const [smartGroupTask, setSmartGroupTask] = useState<BilibiliSmartGroupTask | null>(null);
  const [smartGroupRunning, setSmartGroupRunning] = useState(false);
  const [savingSignalMappings, setSavingSignalMappings] = useState(false);
  const [followedUpSearch, setFollowedUpSearch] = useState("");
  const [selectedOriginalGroup, setSelectedOriginalGroup] = useState<number | "all">("all");
  const [selectedFollowedGroup, setSelectedFollowedGroup] = useState<string>("all");
  const [showOriginalGroupFilter, setShowOriginalGroupFilter] = useState(false);
  const [showSmartGroupFilter, setShowSmartGroupFilter] = useState(false);
  const [showFeedBreakdown, setShowFeedBreakdown] = useState(true);
  const [showFollowedCatalog, setShowFollowedCatalog] = useState(false);
  const [showFollowedResultCards, setShowFollowedResultCards] = useState(true);
  const [showFixedUpMonitorSavedList, setShowFixedUpMonitorSavedList] = useState(true);
  const [showFixedUpMonitorImportPanel, setShowFixedUpMonitorImportPanel] = useState(false);
  const [showSmartGroupSourceDetail, setShowSmartGroupSourceDetail] = useState(false);
  const [showFixedUpTrackingDetail, setShowFixedUpTrackingDetail] = useState(false);
  const [showSmartGroupManagementDetail, setShowSmartGroupManagementDetail] = useState(false);
  const [expandedFixedUpImportGroup, setExpandedFixedUpImportGroup] = useState("");
  const [fixedUpImportSearch, setFixedUpImportSearch] = useState("");
  const [frequentUpGroupFilter, setFrequentUpGroupFilter] = useState<string>("all");
  const [frequentUpPage, setFrequentUpPage] = useState(1);
  const [fixedUpImportGroupPage, setFixedUpImportGroupPage] = useState(1);
  const [showManualGroupingUpList, setShowManualGroupingUpList] = useState(true);
  const [targetedDynamicGroup, setTargetedDynamicGroup] = useState("all");
  const [targetedDynamicGroupPage, setTargetedDynamicGroupPage] = useState(1);
  const [targetedDynamicUpSearch, setTargetedDynamicUpSearch] = useState("");
  const [targetedDynamicUpIds, setTargetedDynamicUpIds] = useState<Set<string>>(new Set());
  const [targetedDynamicPage, setTargetedDynamicPage] = useState(1);
  const [showTargetedDynamicQuickSection, setShowTargetedDynamicQuickSection] = useState(false);
  const [showTargetedDynamicGroupSection, setShowTargetedDynamicGroupSection] = useState(true);
  const [fixedUpSavedPage, setFixedUpSavedPage] = useState(1);
  const [fixedUpSavedPageSize, setFixedUpSavedPageSize] = useState<PaginatedPageSize>(20);
  const [fixedUpImportPage, setFixedUpImportPage] = useState(1);
  const [fixedUpImportPageSize, setFixedUpImportPageSize] = useState<PaginatedPageSize>(20);
  const [managedSmartGroup, setManagedSmartGroup] = useState<string>(
    DEFAULT_SMART_GROUP_OPTIONS[0]?.value || "other"
  );
  const [manualGroupingScope, setManualGroupingScope] = useState<ManualGroupingScope>("all");
  const [manualGroupingSearch, setManualGroupingSearch] = useState("");
  const [manualGroupingPage, setManualGroupingPage] = useState(1);
  const [manualGroupingPageSize, setManualGroupingPageSize] = useState<PaginatedPageSize>(20);
  const [editingGroupedUpId, setEditingGroupedUpId] = useState("");
  const [editingSmartGroupValues, setEditingSmartGroupValues] = useState<string[]>([]);
  const [editingManualOriginalGroupIds, setEditingManualOriginalGroupIds] = useState<number[]>([]);
  const [savingGroupingEditor, setSavingGroupingEditor] = useState(false);
  const [followedResultPage, setFollowedResultPage] = useState(1);
  const [followedResultPageSize, setFollowedResultPageSize] = useState<PaginatedPageSize>(20);
  const [trackerConfig, setTrackerConfig] = useState<BilibiliTrackerConfig>({
    up_uids: [],
    favorite_up_uids: [],
    favorite_up_excluded_uids: [],
    fixed_up_days_back: FIXED_UP_MONITOR_DEFAULT_DAYS_BACK,
    daily_dynamic_monitors: [],
    followed_up_group_monitors: [],
    followed_up_groups: [],
    followed_up_original_groups: [],
    followed_up_filter_mode: "and",
    followed_up_group_options: DEFAULT_SMART_GROUP_OPTIONS,
    creator_profiles: {},
    favorite_up_profiles: {},
    shared_signal_entries: [],
    shared_creator_grouping: {},
  });

  // Debug state
  const [debugResult, setDebugResult] = useState<DebugTestResult | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  // Vault crawl state
  const [vaultCrawling, setVaultCrawling] = useState(false);
  const [vaultResult, setVaultResult] = useState<CrawlToVaultResponse | null>(null);

  // Persist keywords
  useEffect(() => {
    writeJsonStorage("bilibili_keywords", keywords);
  }, [keywords]);

  useEffect(() => {
    writeJsonStorage("bilibili_tag_filters", tagFilters);
  }, [tagFilters]);

  // Persist sessdata
  useEffect(() => {
    if (sessdata) {
      writeStringStorage("bilibili_sessdata", sessdata);
    } else {
      removeStorageKey("bilibili_sessdata");
    }
  }, [sessdata]);

  useEffect(() => {
    writeStringStorage("bilibili_tool_panel", panelTab);
  }, [panelTab]);

  useEffect(() => {
    writeJsonStorage(BILIBILI_DYNAMICS_CACHE_KEY, dynamics);
    writeJsonStorage("bilibili_dynamics_total", totalFound);
    writeJsonStorage("bilibili_dynamics_has_fetched", hasFetchedDynamics);
    writeJsonStorage("bilibili_dynamics_fetch_meta", dynamicFetchMeta);
  }, [dynamics, totalFound, hasFetchedDynamics, dynamicFetchMeta]);

  useEffect(() => {
    writeJsonStorage(BILIBILI_FOLLOWED_CACHE_KEY, followedUps);
    writeJsonStorage("bilibili_followed_groups_cache", originalGroups);
    writeJsonStorage("bilibili_followed_loaded", followedUpsLoaded);
  }, [followedUps, originalGroups, followedUpsLoaded]);

  useEffect(() => {
    const taskId = readStringStorage(FOLLOWED_DYNAMICS_TASK_KEY, "");
    if (!taskId) {
      return;
    }
    void resumeFollowedDynamicsTask({
      taskId,
      scope: dynamicFetchMeta.scope,
      label: dynamicFetchMeta.label || "Full follow feed",
      authorCount: dynamicFetchMeta.authorCount,
      daysBackValue: dynamicFetchMeta.daysBack ?? daysBack,
      keepLimit: dynamicFetchMeta.keepLimit ?? limit,
      switchToResult: true,
      silent: true,
    });
  }, []);

  useEffect(() => {
    const taskId = readStringStorage(FOLLOWED_UPS_TASK_KEY, "");
    if (!taskId) {
      return;
    }
    void resumeFollowedUpsTask(taskId, true);
  }, []);

  useEffect(() => {
    const taskId = readStringStorage(SMART_GROUP_TASK_KEY, "");
    if (!taskId) {
      return;
    }
    void resumeSmartGroupTask(taskId, true);
  }, []);

  useEffect(() => {
    const handlePageHide = () => {
      cancelStoredTask(FOLLOWED_DYNAMICS_TASK_KEY);
      cancelStoredTask(FOLLOWED_UPS_TASK_KEY);
      cancelStoredTask(SMART_GROUP_TASK_KEY);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  useEffect(() => {
    setDaysBackInput(String(daysBack));
  }, [daysBack]);

  useEffect(() => {
    setLimitInput(String(limit));
  }, [limit]);

  useEffect(() => {
    setTargetedGroupDaysBackInput(String(targetedGroupDaysBack));
  }, [targetedGroupDaysBack]);

  useEffect(() => {
    setTargetedGroupLimitInput(String(targetedGroupLimit));
  }, [targetedGroupLimit]);

  useEffect(() => {
    if (selectedOriginalGroup !== "all" && !originalGroups.some((group) => group.tag_id === selectedOriginalGroup)) {
      setSelectedOriginalGroup("all");
    }
  }, [originalGroups, selectedOriginalGroup]);

  // Load config on mount
  useEffect(() => {
    loadConfig();
    void refreshTrackerConfig();
  }, []);

  async function loadConfig() {
    try {
      const config = await bilibiliGetConfig();
      setCookieConfigured(config.cookie_configured);
      setCookiePreview(config.cookie_preview);

      // If we have a configured cookie, try to extract SESSDATA
      if (config.cookie_configured && config.cookie_preview) {
        const extractedSessdata = extractSessdataFromCookie(config.cookie_preview.replace("...", ""));
        if (extractedSessdata && !sessdata) {
          setSessdata(extractedSessdata);
        }
      } else if (!sessdata) {
        setShowCookieModal(true);
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  }

  async function refreshTrackerConfig() {
    try {
      const config = await api.get<any>("/api/modules/bilibili-tracker/config");
      const monitorDefaults = getDailyMonitorDefaults(config);
      const groupLabelLookup = Object.fromEntries(
        ((config.followed_up_group_options || DEFAULT_SMART_GROUP_OPTIONS) as BilibiliSmartGroupOption[])
          .map((option) => [option.value, option.label])
      );
    setTrackerConfig({
      up_uids: config.up_uids || [],
      favorite_up_uids: config.favorite_up_uids || [],
      favorite_up_excluded_uids: config.favorite_up_excluded_uids || [],
      fixed_up_days_back: clampPositiveInt(config.fixed_up_days_back, FIXED_UP_MONITOR_DEFAULT_DAYS_BACK, 365),
      daily_dynamic_monitors: (config.daily_dynamic_monitors || []).map((item: Partial<BilibiliDailyDynamicMonitor>) => normalizeDailyDynamicMonitor(item, monitorDefaults)),
        followed_up_group_monitors: (config.followed_up_group_monitors || []).map((item: Partial<BilibiliFollowedGroupMonitor>) => normalizeFollowedGroupMonitor(
          item,
          groupLabelLookup,
          monitorDefaults,
        )),
        followed_up_groups: config.followed_up_groups || [],
        followed_up_original_groups: config.followed_up_original_groups || [],
        followed_up_filter_mode: config.followed_up_filter_mode === "smart_only" ? "smart_only" : "and",
        followed_up_group_options: (config.followed_up_group_options || DEFAULT_SMART_GROUP_OPTIONS).length > 0
          ? (config.followed_up_group_options || DEFAULT_SMART_GROUP_OPTIONS)
          : DEFAULT_SMART_GROUP_OPTIONS,
        creator_profiles: config.creator_profiles || {},
        favorite_up_profiles: config.favorite_up_profiles || {},
        shared_signal_entries: config.shared_signal_entries || [],
        shared_creator_grouping: config.shared_creator_grouping || {},
      });
    } catch (err) {
      console.error("Failed to load bilibili tracker config:", err);
    }
  }

  function extractSessdataFromCookie(cookieStr: string): string | null {
    try {
      // Try JSON format
      if (cookieStr.startsWith("[") || cookieStr.startsWith("{")) {
        const parsed = JSON.parse(cookieStr);
        if (Array.isArray(parsed)) {
          const sessdataCookie = parsed.find((c: any) => c.name === "SESSDATA");
          if (sessdataCookie) return sessdataCookie.value;
        }
      }

      // Try "SESSDATA=value" format
      const match = cookieStr.match(/SESSDATA=([^;\s]+)/);
      if (match) return match[1];

      // Try direct value (just the SESSDATA string)
      if (cookieStr.length > 20 && !cookieStr.includes("=") && !cookieStr.includes("{")) {
        return cookieStr.trim();
      }
    } catch (e) {
      console.error("Failed to parse cookie:", e);
    }
    return null;
  }

  async function handleGetFromBrowser() {
    setGettingFromBrowser(true);
    try {
      const res = await bilibiliGetCookieFromBrowser();
      if (res.success && (res.cookie || res.cookie_preview)) {
        const fullCookie = res.cookie || "";
        if (fullCookie) {
          setCookieInput(fullCookie);
        }
        setCookieConfigured(true);
        setCookiePreview(res.cookie_preview || null);

        // Extract and set SESSDATA
        const extractedSessdata = extractSessdataFromCookie(fullCookie || res.cookie_preview?.replace("...", "") || "");
        if (extractedSessdata) {
          setSessdata(extractedSessdata);
          writeStringStorage("bilibili_sessdata", extractedSessdata);
        }

        setShowCookieModal(false);
        toast.success("Browser cookie connected", res.message || `Got ${res.cookie_count} cookies`);
      } else {
        toast.error("Fetch failed", res.error || "Cookie not found");
      }
    } catch (err) {
      toast.error("Fetch failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGettingFromBrowser(false);
    }
  }

  async function ensureSessdataFromEdge(): Promise<string> {
    if (sessdata.trim()) return sessdata.trim();

    const res = await bilibiliGetCookieFromBrowser();
    const fullCookie = res.cookie || "";
    const extracted = extractSessdataFromCookie(fullCookie);
    if (!res.success || !extracted) {
      throw new Error(res.error || "Could not get SESSDATA from the browser. Make sure Chrome or Edge is logged in to Bilibili");
    }

    setCookieInput(fullCookie);
    setCookieConfigured(true);
    setCookiePreview(res.cookie_preview || null);
    setSessdata(extracted);
    writeStringStorage("bilibili_sessdata", extracted);
    return extracted;
  }

  const dynamicSearchTerms = parseStringListInput([...keywords, ...tagFilters].join(", "));
  const directLinkUrls = parseLinkListInput(directLinkInput);

  const handleAddKeyword = () => {
    const nextTerms = parseStringListInput(keywordInput);
    if (nextTerms.length === 0) return;
    const mergedTerms = parseStringListInput([...dynamicSearchTerms, ...nextTerms].join(", "));
    if (mergedTerms.length === dynamicSearchTerms.length) {
      toast.info("This word already exists");
      return;
    }
    setKeywords(mergedTerms);
    setTagFilters(mergedTerms);
    setKeywordInput("");
  };

  const handleRemoveKeyword = (kw: string) => {
    const nextTerms = dynamicSearchTerms.filter((item) => item !== kw);
    setKeywords(nextTerms);
    setTagFilters(nextTerms);
  };

  const handleAddPresetKeyword = (kw: string) => {
    if (dynamicSearchTerms.includes(kw)) {
      toast.info(`"${kw}" added`);
      return;
    }
    const nextTerms = [...dynamicSearchTerms, kw];
    setKeywords(nextTerms);
    setTagFilters(nextTerms);
  };

  const handleAddSuggestedTagFilter = (tag: string) => {
    if (dynamicSearchTerms.some((item) => item.toLowerCase() === tag.toLowerCase())) {
      toast.info(`"${tag}" added`);
      return;
    }
    const nextTerms = parseStringListInput([...dynamicSearchTerms, tag].join(", "));
    setKeywords(nextTerms);
    setTagFilters(nextTerms);
  };

  const updateDailyDynamicMonitors = async (
    nextMonitors: BilibiliDailyDynamicMonitor[],
    successTitle: string,
  ) => {
    await saveTrackerConfig(
      {
        daily_dynamic_monitors: nextMonitors.map((monitor) => normalizeDailyDynamicMonitor(monitor)),
      },
      successTitle,
    );
  };

  const handleAddDailyDynamicMonitor = async () => {
    const terms = parseStringListInput(dailyMonitorTermInput);
    const label = terms.join(" + ").trim();
    if (!label || terms.length === 0) {
      toast.error("Enter a monitor word first. This input accepts both keywords and tags");
      return;
    }
    if (trackerConfig.daily_dynamic_monitors.some((monitor) => monitor.label.trim().toLowerCase() === label.toLowerCase())) {
      toast.error("A daily monitor with this name already exists — pick another name");
      return;
    }
    const nextMonitor = normalizeDailyDynamicMonitor({
      label,
      keywords: [],
      tag_filters: terms,
      enabled: true,
      days_back: clampPositiveInt(dailyMonitorDaysBackInput, 7, 365),
      limit: clampPositiveInt(dailyMonitorLimitInput, 50, MAX_DYNAMIC_KEEP_LIMIT),
    });
    const nextMonitors = [
      ...trackerConfig.daily_dynamic_monitors.filter((monitor) => monitor.id !== nextMonitor.id),
      nextMonitor,
    ];
    await updateDailyDynamicMonitors(nextMonitors, "Daily feed monitor added");
    setDailyMonitorTermInput("");
    setDailyMonitorDaysBackInput("7");
    setDailyMonitorLimitInput("50");
  };

  const handleToggleDailyDynamicMonitor = async (monitorId: string) => {
    const nextMonitors = trackerConfig.daily_dynamic_monitors.map((monitor) => (
      monitor.id === monitorId ? { ...monitor, enabled: !monitor.enabled } : monitor
    ));
    await updateDailyDynamicMonitors(nextMonitors, "Monitor toggle updated");
  };

  const handleRemoveDailyDynamicMonitor = async (monitorId: string) => {
    const nextMonitors = trackerConfig.daily_dynamic_monitors.filter((monitor) => monitor.id !== monitorId);
    await updateDailyDynamicMonitors(nextMonitors, "Daily feed monitor removed");
  };

  const handleRemoveMonitorTerm = async (monitorId: string, term: string) => {
    const nextMonitors = trackerConfig.daily_dynamic_monitors.map((monitor) => (
      monitor.id === monitorId
        ? normalizeDailyDynamicMonitor({
            ...monitor,
            keywords: monitor.keywords.filter((item) => item !== term),
            tag_filters: monitor.tag_filters.filter((item) => item !== term),
          })
        : monitor
    )).filter((monitor) => monitor.keywords.length > 0 || monitor.tag_filters.length > 0);
    await updateDailyDynamicMonitors(nextMonitors, "Monitor words updated");
  };

  const handleUpdateDailyMonitorDaysBack = async (monitorId: string, value: string) => {
    const currentMonitor = trackerConfig.daily_dynamic_monitors.find((monitor) => monitor.id === monitorId);
    if (!currentMonitor) {
      return;
    }
    const nextDaysBack = clampPositiveInt(value, currentMonitor.days_back || 14, 365);
    if (nextDaysBack === currentMonitor.days_back) {
      return;
    }
    const nextMonitors = trackerConfig.daily_dynamic_monitors.map((monitor) => (
      monitor.id === monitorId
        ? normalizeDailyDynamicMonitor({
            ...monitor,
            days_back: nextDaysBack,
          })
        : monitor
    ));
    await updateDailyDynamicMonitors(nextMonitors, "Monitor time range updated");
  };

  const handleUpdateDailyMonitorLimit = async (monitorId: string, value: string) => {
    const currentMonitor = trackerConfig.daily_dynamic_monitors.find((monitor) => monitor.id === monitorId);
    if (!currentMonitor) {
      return;
    }
    const nextLimit = clampPositiveInt(value, currentMonitor.limit || 50, MAX_DYNAMIC_KEEP_LIMIT);
    if (nextLimit === currentMonitor.limit) {
      return;
    }
    const nextMonitors = trackerConfig.daily_dynamic_monitors.map((monitor) => (
      monitor.id === monitorId
        ? normalizeDailyDynamicMonitor({
            ...monitor,
            limit: nextLimit,
          })
        : monitor
    ));
    await updateDailyDynamicMonitors(nextMonitors, "Monitor item limit updated");
  };

  const handleUpdateFixedUpMonitorDaysBack = async (value: string) => {
    const currentDaysBack = clampPositiveInt(
      trackerConfig.fixed_up_days_back,
      FIXED_UP_MONITOR_DEFAULT_DAYS_BACK,
      365,
    );
    const nextDaysBack = clampPositiveInt(value, currentDaysBack, 365);
    if (nextDaysBack === currentDaysBack) {
      return;
    }
    await saveTrackerConfig(
      { fixed_up_days_back: nextDaysBack },
      "Pinned creator time range updated",
    );
  };


  const toggleType = (type: string) => {
    if (selectedTypes.includes(type)) {
      setSelectedTypes(selectedTypes.filter((t) => t !== type));
    } else {
      setSelectedTypes([...selectedTypes, type]);
    }
  };

  const getDynamicTypeNumber = (type: string): number => {
    const map: Record<string, number> = {
      video: 8,
      image: 2,
      text: 4,
      article: 64,
    };
    return map[type] || 0;
  };

  const normalizePositiveInput = (
    value: string,
    fallback: number,
    commit: (next: number) => void,
    reflect: (next: string) => void,
    max?: number,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) {
      commit(fallback);
      reflect(String(fallback));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 1) {
      commit(fallback);
      reflect(String(fallback));
      return;
    }
    const normalized = max ? Math.min(Math.floor(parsed), max) : Math.floor(parsed);
    commit(normalized);
    reflect(String(normalized));
  };

  const normalizeDynamicRequestInputs = () => {
    const safeDaysBack = clampPositiveInt(daysBackInput.trim(), daysBack);
    const safeLimit = clampPositiveInt(limitInput.trim(), limit, MAX_DYNAMIC_KEEP_LIMIT);

    if (safeDaysBack !== daysBack) {
      setDaysBack(safeDaysBack);
    }
    if (String(safeDaysBack) !== daysBackInput) {
      setDaysBackInput(String(safeDaysBack));
    }
    if (safeLimit !== limit) {
      setLimit(safeLimit);
    }
    if (String(safeLimit) !== limitInput) {
      setLimitInput(String(safeLimit));
    }

    return { safeDaysBack, safeLimit };
  };

  const normalizeTargetedGroupRequestInputs = () => {
    const safeDaysBack = clampPositiveInt(targetedGroupDaysBackInput.trim(), targetedGroupDaysBack, 365);
    const safeLimit = clampPositiveInt(targetedGroupLimitInput.trim(), targetedGroupLimit, MAX_DYNAMIC_KEEP_LIMIT);

    if (safeDaysBack !== targetedGroupDaysBack) {
      setTargetedGroupDaysBack(safeDaysBack);
    }
    if (String(safeDaysBack) !== targetedGroupDaysBackInput) {
      setTargetedGroupDaysBackInput(String(safeDaysBack));
    }
    if (safeLimit !== targetedGroupLimit) {
      setTargetedGroupLimit(safeLimit);
    }
    if (String(safeLimit) !== targetedGroupLimitInput) {
      setTargetedGroupLimitInput(String(safeLimit));
    }

    return { safeDaysBack, safeLimit };
  };

  const applyDynamicsPreviewResult = ({
    res,
    scope,
    label,
    authorCount,
    daysBackValue,
    keepLimit,
    switchToResult = false,
  }: {
    res: { dynamics: BiliDynamic[]; total_found: number; fetch_stats?: BiliDynamicFetchStats };
    scope: DynamicFetchScope;
    label: string;
    authorCount?: number;
    daysBackValue?: number;
    keepLimit: number;
    switchToResult?: boolean;
  }) => {
    setDynamics(res.dynamics || []);
    setSelectedDynamicIds(new Set());
    setTotalFound(res.total_found || 0);
    setHasFetchedDynamics(true);
    setShowDynamicResultList(true);
    setDynamicResultsPage(1);
    setDynamicFetchMeta({
      scope,
      label,
      authorCount,
      fetchStats: res.fetch_stats,
      daysBack: daysBackValue,
      keepLimit,
    });

    if (switchToResult) {
      switchPanel("dynamics");
    }

    if ((res.dynamics || []).length === 0) {
      if (scope === "links") {
        const inputCount = res.fetch_stats?.input_count ?? 0;
        toast.info("No previewable links parsed", inputCount > 0 ? `Tried ${inputCount} links` : undefined);
      } else {
        toast.info(scope === "global" ? "No matching posts found" : `${label} has no recent matching posts`);
      }
    } else if (scope === "global") {
      toast.success(`Matched ${res.total_found} posts; keeping the first ${res.dynamics.length}`);
    } else if (scope === "links") {
      const inputCount = res.fetch_stats?.input_count ?? res.dynamics.length;
      const failedCount = res.fetch_stats?.failed_count ?? 0;
      toast.success(
        `Parsed ${res.dynamics.length}/${inputCount} specified links`,
        failedCount > 0 ? `${failedCount} more failed` : label,
      );
    } else {
      toast.success(`Targeted posts ready · matched ${res.total_found}`, label);
    }
  };

  const resetDynamicsPreviewResult = ({
    scope,
    label,
    authorCount,
  }: {
    scope: DynamicFetchScope;
    label: string;
    authorCount?: number;
  }) => {
    setDynamics([]);
    setSelectedDynamicIds(new Set());
    setTotalFound(0);
    setHasFetchedDynamics(false);
    setDynamicResultsPage(1);
    setDynamicFetchMeta({
      scope,
      label,
      authorCount,
    });
  };

  const finalizeFollowedDynamicsTask = (taskId?: string | null) => {
    if (!taskId) return;
    if (readStringStorage(FOLLOWED_DYNAMICS_TASK_KEY, "") === taskId) {
      removeStorageKey(FOLLOWED_DYNAMICS_TASK_KEY);
    }
  };

  const resumeFollowedDynamicsTask = async ({
    taskId,
    scope,
    label,
    authorCount,
    daysBackValue,
    keepLimit,
    switchToResult = false,
    silent = false,
  }: {
    taskId: string;
    scope: DynamicFetchScope;
    label: string;
    authorCount?: number;
    daysBackValue: number;
    keepLimit: number;
    switchToResult?: boolean;
    silent?: boolean;
  }) => {
    let consecutiveErrors = 0;
    try {
      while (true) {
        try {
          const task = await bilibiliGetFollowedCrawlTask(taskId);
          consecutiveErrors = 0;
          setFollowedDynamicsTask(task);

          if (task.status === "completed") {
            finalizeFollowedDynamicsTask(taskId);
            if (!task.result) {
              throw createTerminalTaskError("Background task finished but returned no result");
            }
            applyDynamicsPreviewResult({
              res: task.result,
              scope,
              label,
              authorCount,
              daysBackValue,
              keepLimit,
              switchToResult,
            });
            break;
          }

          if (task.status === "failed") {
            finalizeFollowedDynamicsTask(taskId);
            throw createTerminalTaskError(task.error || "Post crawl failed");
          }

          if (task.status === "cancelled") {
            finalizeFollowedDynamicsTask(taskId);
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
              finalizeFollowedDynamicsTask(taskId);
            }
            throw err;
          }
          await sleep(TASK_POLL_RETRY_DELAY_MS);
        }
      }
    } catch (err) {
      const message = consecutiveErrors > 0
        ? `${getErrorMessage(err)}; the background task may still be running and can resume automatically later`
        : getErrorMessage(err);
      resetDynamicsPreviewResult({ scope, label, authorCount });
      if (!silent) {
        toast.error(scope === "global" ? "Fetch failed" : "Targeted crawl failed", message);
      }
    }
  };

  const runDynamicsPreview = async ({
    authorIds,
    keywordsOverride,
    tagFiltersOverride,
    daysBackOverride,
    limitOverride,
    pageLimitOverride,
    label,
    scope,
    monitorLabel,
    monitorSubfolder,
    switchToResult = false,
  }: {
    authorIds?: string[];
    keywordsOverride?: string[];
    tagFiltersOverride?: string[];
    daysBackOverride?: number;
    limitOverride?: number;
    pageLimitOverride?: number;
    label: string;
    scope: DynamicFetchScope;
    monitorLabel?: string;
    monitorSubfolder?: string;
    switchToResult?: boolean;
  }) => {
    setLoading(true);
    setFollowedDynamicsTask(null);
    try {
      const { safeDaysBack: activeDaysBack, safeLimit: activeLimit } = normalizeDynamicRequestInputs();
      const safeDaysBack = daysBackOverride !== undefined
        ? clampPositiveInt(daysBackOverride, activeDaysBack, 365)
        : activeDaysBack;
      const safeLimit = limitOverride !== undefined
        ? clampPositiveInt(limitOverride, activeLimit, MAX_DYNAMIC_KEEP_LIMIT)
        : activeLimit;
      const safePageLimit = pageLimitOverride !== undefined
        ? clampPositiveInt(pageLimitOverride, 5, 1000)
        : undefined;
      const activeSessdata = await ensureSessdataFromEdge();
      const dynamicTypes = selectedTypes.map(getDynamicTypeNumber);
      const normalizedAuthorIds = Array.from(
        new Set(
          (authorIds || [])
            .map((authorId) => String(authorId || "").trim())
            .filter(Boolean)
        )
      );
      const normalizedKeywords = Array.from(
        new Set(
          (keywordsOverride !== undefined
            ? keywordsOverride
            : normalizedAuthorIds.length === 0
              ? keywords
              : []
          )
            .map((keyword) => String(keyword || "").trim())
            .filter(Boolean)
        )
      );
      const normalizedTagFilters = Array.from(
        new Set(
          (tagFiltersOverride !== undefined
            ? tagFiltersOverride
            : normalizedAuthorIds.length === 0
              ? tagFilters
              : []
          )
            .map((tag) => String(tag || "").trim())
            .filter(Boolean)
        )
      );
      const requestPayload = {
        sessdata: activeSessdata,
        keywords: normalizedKeywords.length > 0 ? normalizedKeywords : undefined,
        tag_filters: normalizedTagFilters.length > 0 ? normalizedTagFilters : undefined,
        author_ids: normalizedAuthorIds.length > 0 ? normalizedAuthorIds : undefined,
        dynamic_types: dynamicTypes.length > 0 ? dynamicTypes : undefined,
        days_back: safeDaysBack,
        limit: safeLimit,
        page_limit: safePageLimit,
        monitor_label: monitorLabel,
        monitor_subfolder: monitorSubfolder,
      };
      const authorCount = normalizedAuthorIds.length > 0 ? normalizedAuthorIds.length : undefined;

      try {
        const started = await bilibiliStartFollowedCrawl(requestPayload);
        writeStringStorage(FOLLOWED_DYNAMICS_TASK_KEY, started.task_id);
        await resumeFollowedDynamicsTask({
          taskId: started.task_id,
          scope,
          label,
          authorCount,
          daysBackValue: safeDaysBack,
          keepLimit: safeLimit,
          switchToResult,
        });
      } catch (err) {
        if (!isNotFoundError(err)) {
          throw err;
        }
        finalizeFollowedDynamicsTask(readStringStorage(FOLLOWED_DYNAMICS_TASK_KEY, ""));
        const res = await bilibiliFetchFollowed(requestPayload);
        applyDynamicsPreviewResult({
          res,
          scope,
          label,
          authorCount,
          daysBackValue: safeDaysBack,
          keepLimit: safeLimit,
          switchToResult,
        });
      }
    } catch (err) {
      resetDynamicsPreviewResult({
        scope,
        label,
        authorCount: authorIds?.length || undefined,
      });
      toast.error(scope === "global" ? "Fetch failed" : "Targeted crawl failed", getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleFetch = async () => {
    const label = dynamicSearchTerms.length > 0
      ? `Full follow-feed filter · words / tags: ${dynamicSearchTerms.join(" / ")}`
      : "Full follow feed";
    await runDynamicsPreview({
      label,
      scope: "global",
      monitorSubfolder: buildGlobalSearchSubfolder(dynamicSearchTerms, dynamicSearchTerms),
    });
  };

  const handleFetchDirectLinks = async (saveImmediately = false) => {
    if (directLinkUrls.length === 0) {
      toast.error("Please enter at least one Bilibili link");
      return;
    }

    const resultLabel = `${directLinkUrls.length} specified links`;
    setLoading(true);
    setFollowedDynamicsTask(null);
    setDirectLinkRunning(saveImmediately ? "save" : "preview");
    try {
      const activeSessdata = await ensureSessdataFromEdge();
      const res = await bilibiliFetchByLinks({
        sessdata: activeSessdata,
        urls: directLinkUrls,
      });
      applyDynamicsPreviewResult({
        res,
        scope: "links",
        label: resultLabel,
        keepLimit: Math.max(res.dynamics.length, directLinkUrls.length, 1),
        switchToResult: true,
      });
      setLoading(false);

      if (saveImmediately && (res.dynamics || []).length > 0) {
        await saveDynamicsToVault(res.dynamics, `Auto-saved ${res.dynamics.length} posts from specified links`);
      }
    } catch (err) {
      resetDynamicsPreviewResult({
        scope: "links",
        label: resultLabel,
      });
      toast.error("Link crawl failed", getErrorMessage(err));
    } finally {
      setDirectLinkRunning(null);
      setLoading(false);
    }
  };

  const handlePreviewDailyMonitor = async (monitor: BilibiliDailyDynamicMonitor) => {
    const normalizedMonitor = normalizeDailyDynamicMonitor(monitor);
    const label = `Daily keyword monitor: ${normalizedMonitor.label}`;
    await runDynamicsPreview({
      keywordsOverride: normalizedMonitor.keywords,
      tagFiltersOverride: normalizedMonitor.tag_filters,
      daysBackOverride: normalizedMonitor.days_back,
      limitOverride: normalizedMonitor.limit,
      pageLimitOverride: normalizedMonitor.page_limit,
      label,
      scope: "global",
      monitorLabel: normalizedMonitor.label,
      monitorSubfolder: buildDailyMonitorSaveSubfolder(
        normalizedMonitor.label,
        normalizedMonitor.keywords,
        normalizedMonitor.tag_filters,
      ),
      switchToResult: true,
    });
  };

  const finalizeFollowedUpsTask = (taskId?: string | null) => {
    if (!taskId) return;
    if (readStringStorage(FOLLOWED_UPS_TASK_KEY, "") === taskId) {
      removeStorageKey(FOLLOWED_UPS_TASK_KEY);
    }
  };

  const resumeFollowedUpsTask = async (taskId: string, silent = false) => {
    setFollowedUpsLoading(true);
    let consecutiveErrors = 0;
    try {
      while (true) {
        try {
          const task = await bilibiliGetFollowedUpsCrawlTask(taskId);
          consecutiveErrors = 0;
          setFollowedUpsTask(task);

          if (task.status === "completed") {
            const result = task.result;
            setOriginalGroups(result?.groups || []);
            setFollowedUps(result?.ups || []);
            setFollowedUpsLoaded(true);
            finalizeFollowedUpsTask(taskId);
            if (!silent) {
              toast.success("Followed creators loaded", `${result?.total || 0} follows total`);
            }
            break;
          }

          if (task.status === "failed") {
            finalizeFollowedUpsTask(taskId);
            throw createTerminalTaskError(task.error || "Failed to fetch follow list");
          }

          if (task.status === "cancelled") {
            finalizeFollowedUpsTask(taskId);
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
              finalizeFollowedUpsTask(taskId);
            }
            throw err;
          }
          await sleep(TASK_POLL_RETRY_DELAY_MS);
        }
      }
    } catch (err) {
      if (!silent) {
        const message = consecutiveErrors > 0
          ? `${getErrorMessage(err)}; the background task may still be running and can resume automatically later`
          : getErrorMessage(err);
        toast.error("Failed to load follows", message);
      }
    } finally {
      setFollowedUpsLoading(false);
    }
  };

  const handleLoadFollowedUps = async (silent = false, force = false) => {
    if (followedUpsLoading) return;
    if (followedUpsLoaded && !force) return;

    setFollowedUpsLoading(true);
    setFollowedUpsTask(null);
    try {
      const activeSessdata = await ensureSessdataFromEdge();
      try {
        const started = await bilibiliStartFollowedUpsCrawl({
          sessdata: activeSessdata,
          max_count: 5000,
        });
        writeStringStorage(FOLLOWED_UPS_TASK_KEY, started.task_id);
        await resumeFollowedUpsTask(started.task_id, silent);
      } catch (err) {
        if (!isNotFoundError(err)) {
          throw err;
        }
        finalizeFollowedUpsTask(readStringStorage(FOLLOWED_UPS_TASK_KEY, ""));
        const result = await bilibiliFetchFollowedUps({
          sessdata: activeSessdata,
          max_count: 5000,
        });
        setOriginalGroups(result.groups || []);
        setFollowedUps(result.ups || []);
        setFollowedUpsLoaded(true);
        if (!silent) {
          toast.success("Followed creators loaded", `${result.total || 0} follows total`);
        }
      }
    } catch (err) {
      if (!silent) {
        toast.error("Failed to load follows", err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setFollowedUpsLoading(false);
    }
  };

  const saveTrackerConfig = async (patch: Partial<BilibiliTrackerConfig>, successTitle?: string) => {
    const nextConfig = {
      ...trackerConfig,
      ...patch,
      followed_up_filter_mode: patch.followed_up_filter_mode || trackerConfig.followed_up_filter_mode,
      followed_up_group_options: patch.followed_up_group_options || trackerConfig.followed_up_group_options,
      creator_profiles: patch.creator_profiles || trackerConfig.creator_profiles,
      favorite_up_profiles: patch.favorite_up_profiles || trackerConfig.favorite_up_profiles,
    };
    await api.post("/api/modules/bilibili-tracker/config", nextConfig);
    setTrackerConfig(nextConfig);
    if (successTitle) {
      toast.success(successTitle);
    }
  };

  const finalizeSmartGroupTask = (taskId?: string | null) => {
    if (!taskId) return;
    if (readStringStorage(SMART_GROUP_TASK_KEY, "") === taskId) {
      removeStorageKey(SMART_GROUP_TASK_KEY);
    }
  };

  const resumeSmartGroupTask = async (taskId: string, silent = false) => {
    setSmartGroupRunning(true);
    let consecutiveErrors = 0;
    try {
      while (true) {
        try {
          const task = await bilibiliGetSmartGroupTask(taskId);
          consecutiveErrors = 0;
          setSmartGroupTask(task);

          if (task.status === "completed") {
            finalizeSmartGroupTask(taskId);
            await refreshTrackerConfig();
            if (!silent) {
              const workflowMode = task.result?.workflow_mode || task.workflow_mode;
              toast.success(
                workflowMode === "creator-only" ? "Creators re-organized" : "Smart groups updated",
                task.result?.message || "Synced to the daily crawler monitor",
              );
            }
            break;
          }

          if (task.status === "failed") {
            finalizeSmartGroupTask(taskId);
            throw createTerminalTaskError(task.error || "Smart grouping failed");
          }

          if (task.status === "cancelled") {
            finalizeSmartGroupTask(taskId);
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
              finalizeSmartGroupTask(taskId);
            }
            throw err;
          }
          await sleep(TASK_POLL_RETRY_DELAY_MS);
        }
      }
    } catch (err) {
      if (!silent) {
        const message = consecutiveErrors > 0
          ? `${getErrorMessage(err)}; the background task may still be running and can resume automatically later`
          : getErrorMessage(err);
        toast.error("Smart grouping failed", message);
      }
    } finally {
      setSmartGroupRunning(false);
    }
  };

  const handleRunSmartGroups = async (mode: "full" | "creator-only" = "full") => {
    if (smartGroupRunning) return;
    try {
      const activeSessdata = await ensureSessdataFromEdge();
      const started = await bilibiliStartSmartGroupTask({
        sessdata: activeSessdata,
        max_count: 5000,
        mode,
      });
      writeStringStorage(SMART_GROUP_TASK_KEY, started.task_id);
      setSmartGroupTask(null);
      await resumeSmartGroupTask(started.task_id);
    } catch (err) {
      toast.error("Smart grouping failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleBuildSmartGroups = async () => {
    await handleRunSmartGroups("full");
  };

  const handleRefreshSharedCreatorAssignments = async () => {
    await handleRunSmartGroups("creator-only");
  };

  const handleSaveSharedSignalMappings = async (mapping: Record<string, string[]>) => {
    setSavingSignalMappings(true);
    try {
      await api.post("/api/modules/bilibili-tracker/config", {
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

  const saveManualMonitoredUps = async (upIds: string[], successTitle?: string) => {
    await saveTrackerConfig({
      up_uids: Array.from(new Set(upIds.map((upId) => String(upId || "").trim()).filter(Boolean))),
      followed_up_original_groups: [],
    }, successTitle);
  };

  const toggleManualMonitoredUp = async (upId: string) => {
    const current = trackerConfig.up_uids || [];
    const next = current.includes(upId)
      ? current.filter((item) => item !== upId)
      : [...current, upId];
    try {
      await saveManualMonitoredUps(next);
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleAddFrequentUpToManualMonitor = async (upId: string, displayName?: string) => {
    const normalizedUpId = String(upId || "").trim();
    if (!normalizedUpId) {
      toast.error("No mid resolved for this creator yet");
      return;
    }
    const current = Array.from(new Set((trackerConfig.up_uids || []).map((item) => String(item || "").trim()).filter(Boolean)));
    if (current.includes(normalizedUpId)) {
      toast.info(`${displayName || "This creator"} is already pinned`);
      return;
    }
    try {
      await saveManualMonitoredUps([...current, normalizedUpId], "Creator pinned");
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleClearManualMonitoredUps = async () => {
    try {
      await saveManualMonitoredUps([], "Pinned creators cleared");
    } catch (err) {
      toast.error("Clear failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleImportManualMonitorGroup = async (groupValue: string) => {
    const members = followedUps.filter((up) => getUpSmartGroups(up).includes(groupValue));
    const currentSet = new Set((trackerConfig.up_uids || []).map((upId) => String(upId || "").trim()).filter(Boolean));
    const importableIds = members
      .map((up) => up.mid)
      .filter((upId) => upId && !currentSet.has(upId));
    if (importableIds.length === 0) {
      toast.info("All creators in this smart group are already pinned");
      return;
    }
    try {
      await saveManualMonitoredUps(
        [...currentSet, ...importableIds],
        `Imported ${importableIds.length} pinned creators from the smart group`,
      );
      setExpandedFixedUpImportGroup(groupValue);
      setShowFixedUpMonitorSavedList(true);
    } catch (err) {
      toast.error("Import failed", err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleDebugTest = async () => {
    setDebugLoading(true);
    try {
      const activeSessdata = await ensureSessdataFromEdge();
      const result = await bilibiliDebugTest(activeSessdata);
      setDebugResult(result);
      toast.success("Diagnostics finished");
    } catch (err) {
      toast.error("Diagnostics failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDebugLoading(false);
    }
  };

  const smartGroupOptions = trackerConfig.followed_up_group_options.length > 0
    ? trackerConfig.followed_up_group_options
    : DEFAULT_SMART_GROUP_OPTIONS;
  const smartGroupLabelMap = new Map(smartGroupOptions.map((option) => [option.value, option.label]));
  const hasBuiltSmartGroups = Object.keys(trackerConfig.creator_profiles || {}).length > 0;
  const smartGroupsReady = !(smartGroupOptions.length === DEFAULT_SMART_GROUP_OPTIONS.length && !hasBuiltSmartGroups);

  useEffect(() => {
    if (selectedFollowedGroup !== "all" && !smartGroupOptions.some((group) => group.value === selectedFollowedGroup)) {
      setSelectedFollowedGroup("all");
    }
  }, [selectedFollowedGroup, smartGroupOptions]);

  useEffect(() => {
    if (smartGroupOptions.length === 0) {
      return;
    }
    if (!smartGroupOptions.some((group) => group.value === managedSmartGroup)) {
      setManagedSmartGroup(selectedFollowedGroup !== "all" && smartGroupOptions.some((group) => group.value === selectedFollowedGroup)
        ? selectedFollowedGroup
        : smartGroupOptions[0].value);
    }
  }, [managedSmartGroup, selectedFollowedGroup, smartGroupOptions]);

  useEffect(() => {
    if (selectedFollowedGroup !== "all" && smartGroupOptions.some((group) => group.value === selectedFollowedGroup)) {
      setManagedSmartGroup(selectedFollowedGroup);
    }
  }, [selectedFollowedGroup, smartGroupOptions]);

  useEffect(() => {
    const trackedGroup = (trackerConfig.followed_up_groups || []).find((groupValue) => (
      smartGroupOptions.some((group) => group.value === groupValue)
    ));
    const preferredGroup = trackedGroup
      || (selectedFollowedGroup !== "all" && smartGroupOptions.some((group) => group.value === selectedFollowedGroup)
        ? selectedFollowedGroup
        : "")
      || smartGroupOptions[0]?.value
      || "";
    if (!preferredGroup) {
      return;
    }
    if (targetedDynamicGroup === "all" || (targetedDynamicGroup && smartGroupOptions.some((group) => group.value === targetedDynamicGroup))) {
      return;
    }
    setTargetedDynamicGroup(preferredGroup);
  }, [targetedDynamicGroup, trackerConfig.followed_up_groups, selectedFollowedGroup, smartGroupOptions]);

  const originalGroupMap = new Map(originalGroups.map((group) => [group.tag_id, group]));

  const getUpProfile = (up: BiliFollowedUp): BilibiliSmartGroupProfile | null => (
    trackerConfig.creator_profiles?.[up.mid] || null
  );

  const getUpManualOriginalGroupIds = (up: BiliFollowedUp): number[] => {
    const profile = getUpProfile(up);
    return Array.from(
      new Set(
        (profile?.manual_original_group_ids || [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && originalGroupMap.has(value))
      )
    );
  };

  const getUpOriginalGroupIds = (up: BiliFollowedUp): number[] => (
    Array.from(new Set([...(up.tag_ids || []), ...getUpManualOriginalGroupIds(up)]))
  );

  const getUpOriginalGroupNames = (up: BiliFollowedUp): string[] => {
    const rawNames = Array.isArray(up.tag_names) ? up.tag_names.filter(Boolean) : [];
    const manualNames = getUpManualOriginalGroupIds(up)
      .map((groupId) => originalGroupMap.get(groupId)?.name || "")
      .filter(Boolean);
    return Array.from(new Set([...rawNames, ...manualNames]));
  };

  const isUpRawOriginalGroupMember = (up: BiliFollowedUp, groupId: number): boolean => (
    (up.tag_ids || []).includes(groupId)
  );

  const isUpInOriginalGroup = (up: BiliFollowedUp, groupId: number): boolean => (
    getUpOriginalGroupIds(up).includes(groupId)
  );

  const getUpSmartGroups = (up: BiliFollowedUp): string[] => {
    const profile = getUpProfile(up);
    const profileGroups = profile?.smart_groups || [];
    if (profile?.manual_override) {
      return profileGroups.filter((group) => group.trim());
    }
    if (profileGroups.length > 0) {
      return profileGroups;
    }
    return [classifyFollowedUp(up)];
  };

  const getSmartGroupLabel = (groupValue: string): string => (
    smartGroupLabelMap.get(groupValue)
    || DEFAULT_SMART_GROUP_META[groupValue]?.label
    || groupValue
  );

  const matchesFollowedUpSearch = (up: BiliFollowedUp): boolean => {
    return matchesUpQuery(up, followedUpSearch);
  };

  const resetFollowedUpFilters = () => {
    setSelectedOriginalGroup("all");
    setSelectedFollowedGroup("all");
    setFollowedUpSearch("");
  };

  const syncEditUpGroupingDraft = (up: BiliFollowedUp) => {
    setEditingGroupedUpId(up.mid);
    setEditingSmartGroupValues(getUpSmartGroups(up));
    setEditingManualOriginalGroupIds(getUpManualOriginalGroupIds(up));
  };

  const beginEditUpGrouping = (up: BiliFollowedUp) => {
    if (editingGroupedUpId === up.mid) {
      return;
    }
    syncEditUpGroupingDraft(up);
  };

  const closeEditUpGrouping = () => {
    setEditingGroupedUpId("");
    setEditingSmartGroupValues([]);
    setEditingManualOriginalGroupIds([]);
  };

  const toggleEditingSmartGroup = (groupValue: string) => {
    setEditingSmartGroupValues((prev) => (
      prev.includes(groupValue)
        ? prev.filter((value) => value !== groupValue)
        : [...prev, groupValue]
    ));
  };

  const toggleEditingOriginalGroup = (up: BiliFollowedUp, groupId: number) => {
    if (isUpRawOriginalGroupMember(up, groupId)) {
      return;
    }
    setEditingManualOriginalGroupIds((prev) => (
      prev.includes(groupId)
        ? prev.filter((value) => value !== groupId)
        : [...prev, groupId]
    ));
  };

  const saveEditedUpGrouping = async () => {
    const up = followedUpByAuthorId[editingGroupedUpId];
    if (!up) {
      toast.error("Creator to edit not found");
      return;
    }

    const nextSmartGroups = Array.from(
      new Set(editingSmartGroupValues.map((value) => value.trim()).filter(Boolean))
    );
    if (nextSmartGroups.length === 0) {
      toast.info("Keep at least one smart group");
      return;
    }

    const nextManualOriginalIds = Array.from(
      new Set(
        editingManualOriginalGroupIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && originalGroupMap.has(value) && !isUpRawOriginalGroupMember(up, value))
      )
    );

    const currentProfiles = trackerConfig.creator_profiles || {};
    const currentProfile = currentProfiles[up.mid] || {};
    const nextProfiles = {
      ...currentProfiles,
      [up.mid]: {
        ...currentProfile,
        author: currentProfile.author || up.uname,
        author_id: currentProfile.author_id || up.mid,
        matched_author: currentProfile.matched_author || up.uname,
        manual_override: true,
        smart_groups: nextSmartGroups,
        smart_group_labels: nextSmartGroups.map((group) => getSmartGroupLabel(group)),
        manual_original_group_ids: nextManualOriginalIds,
        manual_original_group_labels: nextManualOriginalIds
          .map((groupId) => originalGroupMap.get(groupId)?.name || "")
          .filter(Boolean),
      },
    };

    setSavingGroupingEditor(true);
    try {
      await saveTrackerConfig({ creator_profiles: nextProfiles }, "Creator groups saved");
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSavingGroupingEditor(false);
    }
  };

  const followedGroupByAuthorId = Object.fromEntries(
    followedUps.map((up) => [up.mid, getUpSmartGroups(up)[0] || ""])
  ) as Record<string, string>;
  const followedUpByAuthorId = Object.fromEntries(
    followedUps.map((up) => [up.mid, up])
  ) as Record<string, BiliFollowedUp>;

  const filteredFollowedUps = followedUps.filter((up) => {
    if (selectedOriginalGroup !== "all" && !isUpInOriginalGroup(up, selectedOriginalGroup)) {
      return false;
    }
    if (selectedFollowedGroup !== "all" && !getUpSmartGroups(up).includes(selectedFollowedGroup)) {
      return false;
    }
    return matchesFollowedUpSearch(up);
  });

  const displayedDynamics = dynamics.filter((dynamic) => {
    if (dynamicFetchMeta.scope !== "global") {
      return true;
    }
    const up = followedUpByAuthorId[dynamic.author_id];
    if (selectedOriginalGroup !== "all" && up && !isUpInOriginalGroup(up, selectedOriginalGroup)) {
      return false;
    }
    if (selectedFollowedGroup !== "all" && !getUpSmartGroups(up || {
      mid: dynamic.author_id,
      uname: dynamic.author,
      face: "",
      sign: "",
      official_desc: "",
      special: 0,
      tag_ids: [],
      tag_names: [],
    } as BiliFollowedUp).includes(selectedFollowedGroup)) {
      return false;
    }
    return true;
  });

  const groupCounts = smartGroupOptions.reduce<Record<string, number>>((acc, group) => {
    acc[group.value] = followedUps.filter((up) => getUpSmartGroups(up).includes(group.value)).length;
    return acc;
  }, {});

  const originalGroupCounts = originalGroups.reduce<Record<number, number>>((acc, group) => {
    acc[group.tag_id] = followedUps.filter((up) => isUpInOriginalGroup(up, group.tag_id)).length;
    return acc;
  }, {});
  const selectedOriginalGroupLabel = selectedOriginalGroup === "all"
    ? "All default groups"
    : originalGroups.find((group) => group.tag_id === selectedOriginalGroup)?.name || "Selected default group";
  const selectedSmartGroupLabel = selectedFollowedGroup === "all"
    ? "All smart groups"
    : getSmartGroupLabel(selectedFollowedGroup);
  const activeFollowedFilterCount = [
    selectedOriginalGroup !== "all",
    selectedFollowedGroup !== "all",
    followedUpSearch.trim().length > 0,
  ].filter(Boolean).length;
  const targetedDynamicGroupLabel = targetedDynamicGroup === "all"
    ? "All smart groups"
    : targetedDynamicGroup
      ? getSmartGroupLabel(targetedDynamicGroup)
      : "No smart group selected";
  const targetedDynamicGroupMeta = targetedDynamicGroup === "all"
    ? { label: "All smart groups", accent: "#0EA5E9", bg: "rgba(14, 165, 233, 0.10)" }
    : targetedDynamicGroup
      ? resolveSmartGroupMeta(targetedDynamicGroup, targetedDynamicGroupLabel)
      : resolveSmartGroupMeta("other", "No smart group selected");
  const targetedDynamicGroupMembers = targetedDynamicGroup === "all"
    ? followedUps
    : targetedDynamicGroup
      ? followedUps.filter((up) => getUpSmartGroups(up).includes(targetedDynamicGroup))
      : [];
  const targetedDynamicGroupTotalPages = Math.max(1, Math.ceil(smartGroupOptions.length / TARGETED_DYNAMIC_GROUPS_PAGE_SIZE));
  const safeTargetedDynamicGroupPage = Math.min(targetedDynamicGroupPage, targetedDynamicGroupTotalPages);
  const pagedTargetedDynamicGroups = smartGroupOptions.slice(
    (safeTargetedDynamicGroupPage - 1) * TARGETED_DYNAMIC_GROUPS_PAGE_SIZE,
    safeTargetedDynamicGroupPage * TARGETED_DYNAMIC_GROUPS_PAGE_SIZE,
  );
  const targetedDynamicCandidates = targetedDynamicGroupMembers.filter((up) => matchesUpQuery(up, targetedDynamicUpSearch));
  const targetedDynamicSelectedUps = followedUps.filter((up) => targetedDynamicUpIds.has(up.mid));
  const targetedDynamicSearchActive = targetedDynamicUpSearch.trim().length > 0;
  const targetedDynamicFetchMembers = targetedDynamicSearchActive ? targetedDynamicCandidates : targetedDynamicGroupMembers;
  const targetedDynamicVisibleSelectedCount = targetedDynamicCandidates.reduce(
    (count, up) => count + (targetedDynamicUpIds.has(up.mid) ? 1 : 0),
    0
  );
  const targetedDynamicTotalPages = Math.max(1, Math.ceil(targetedDynamicCandidates.length / TARGETED_DYNAMIC_RESULTS_PAGE_SIZE));
  const safeTargetedDynamicPage = Math.min(targetedDynamicPage, targetedDynamicTotalPages);
  const pagedTargetedDynamicCandidates = targetedDynamicCandidates.slice(
    (safeTargetedDynamicPage - 1) * TARGETED_DYNAMIC_RESULTS_PAGE_SIZE,
    safeTargetedDynamicPage * TARGETED_DYNAMIC_RESULTS_PAGE_SIZE,
  );
  const dynamicResultsTotalPages = Math.max(1, Math.ceil(displayedDynamics.length / DYNAMIC_RESULTS_PAGE_SIZE));
  const safeDynamicResultsPage = Math.min(dynamicResultsPage, dynamicResultsTotalPages);
  const pagedDisplayedDynamics = displayedDynamics.slice(
    (safeDynamicResultsPage - 1) * DYNAMIC_RESULTS_PAGE_SIZE,
    safeDynamicResultsPage * DYNAMIC_RESULTS_PAGE_SIZE,
  );

  useEffect(() => {
    const allowedIds = new Set(followedUps.map((up) => up.mid));
    setTargetedDynamicUpIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((upId) => {
        if (allowedIds.has(upId)) {
          next.add(upId);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [followedUps]);

  useEffect(() => {
    setTargetedDynamicPage(1);
  }, [targetedDynamicGroup, targetedDynamicUpSearch]);

  useEffect(() => {
    setDynamicResultsPage(1);
  }, [dynamics, dynamicFetchMeta.label, selectedOriginalGroup, selectedFollowedGroup]);

  const followStatusTitle = followedUpsLoading
    ? "Fetching follow list"
    : followedUpsLoaded
      ? "Last fetch finished"
      : "Not fetched yet";
  const followStatusStage = followedUpsTask?.stage
    || (followedUpsLoaded ? "Follow list ready — continue filtering groups." : "Click the button above to fetch this account's follow list.");
  const followStatusCount = followedUpsTask?.fetched_count ?? followedUps.length;
  const followStatusPage = followedUpsTask?.current_page ?? 0;
  const followStatusProgress = followedUpsLoading
    ? Math.min(96, Math.max(10, Math.round(followStatusCount / 50)))
    : followedUpsLoaded
      ? 100
      : 0;
  const smartGroupStatusTitle = smartGroupRunning
    ? "Incrementally maintaining shared smart groups"
    : smartGroupTask?.status === "completed"
      ? "Last shared smart grouping finished"
      : "Shared smart groups not generated yet";
  const smartGroupStatusStage = smartGroupTask?.stage
    || (smartGroupOptions.length > 0 && trackerConfig.creator_profiles && Object.keys(trackerConfig.creator_profiles).length > 0
      ? "Shared smart groups generated — usable for follow monitors and shared with Xiaohongshu."
      : "Click \"Shared smart grouping\" for a full rebuild; to only attach new creators to existing groups, click \"Organize creators only\".");
  const smartGroupStatusProgress = smartGroupRunning
    ? smartGroupTask?.progress || 18
    : smartGroupTask?.status === "completed"
      ? 100
      : 0;
  const smartGroupTotalUpCount = smartGroupTask?.total_followed_count
    ?? (smartGroupTask?.status === "completed" ? Object.keys(trackerConfig.creator_profiles || {}).length : 0);
  const smartGroupProcessedUpCount = smartGroupTask?.processed_followed_count
    ?? (smartGroupTask?.status === "completed" ? smartGroupTotalUpCount : 0);
  const smartGroupCollectedUpCount = smartGroupTask?.fetched_count ?? followedUps.length;
  const smartGroupCurrentUpName = String(smartGroupTask?.current_followed_name || "").trim();
  const smartGroupMetricLabel = smartGroupRunning && smartGroupTotalUpCount > 0 ? "Processed creators" : "Matched creators";
  const smartGroupMetricValue = smartGroupRunning && smartGroupTotalUpCount > 0
    ? smartGroupProcessedUpCount
    : (smartGroupTask?.matched_followed_count || Object.keys(trackerConfig.creator_profiles || {}).length);
  const smartGroupStatusDetails = [
    smartGroupCollectedUpCount > 0 ? `Collected ${smartGroupCollectedUpCount} creators` : "",
    (smartGroupTask?.total_groups || smartGroupOptions.length) > 0
      ? `${smartGroupTask?.total_groups || smartGroupOptions.length} shared categories`
      : "",
    smartGroupTotalUpCount > 0 ? `Processed ${smartGroupProcessedUpCount} / ${smartGroupTotalUpCount} creators` : "",
    smartGroupCurrentUpName ? `Current: ${smartGroupCurrentUpName}` : "",
  ].filter(Boolean);
  const sharedTagIndexPath = trackerConfig.shared_creator_grouping.shared_data_paths?.tag_index_path
    || trackerConfig.shared_creator_grouping.vault_signal_database?.tag_index_path
    || trackerConfig.shared_creator_grouping.vault_signal_database?.database_path
    || "";
  const dailyDynamicMonitors = (trackerConfig.daily_dynamic_monitors || []).map((monitor) => normalizeDailyDynamicMonitor(monitor));
  const activeDailyDynamicMonitors = dailyDynamicMonitors.filter((monitor) => monitor.enabled);
  const allSmartGroupBundles = smartGroupOptions.map((group) => {
    const members = followedUps.filter((up) => getUpSmartGroups(up).includes(group.value));
    const sampleTags = group.sample_tags && group.sample_tags.length > 0
      ? group.sample_tags
      : Array.from(
        new Set(
          members.flatMap((up) => getUpProfile(up)?.sample_tags || [])
        )
      ).slice(0, 4);
    return {
      ...group,
      meta: resolveSmartGroupMeta(group.value, group.label),
      members,
      sampleAuthors: members.slice(0, 4).map((up) => up.uname),
      sampleTags,
    };
  });
  const suggestedSmartGroupTags = allSmartGroupBundles
    .map((group) => {
      const mappedSignals = (trackerConfig.shared_signal_entries || [])
        .filter((entry) => resolveSharedSignalEntryLabels(entry).includes(group.label))
        .map((entry) => ({
          signal: String(entry.signal || "").trim(),
          count: Number(entry.count || 0),
        }))
        .filter((item) => item.signal)
        .sort((a, b) => b.count - a.count || a.signal.localeCompare(b.signal))
        .slice(0, 6);
      const fallbackSignals = mappedSignals.length > 0
        ? []
        : (group.sampleTags || []).map((tag) => ({
            signal: String(tag || "").trim(),
            count: 0,
          })).filter((item) => item.signal);
      const tags = mappedSignals.length > 0 ? mappedSignals : fallbackSignals;
      return {
        ...group,
        tags,
      };
    })
    .filter((group) => group.tags.length > 0);
  const manualPoolIds = Array.from(new Set(trackerConfig.up_uids || []));
  const manualPoolIdSet = new Set(manualPoolIds);
  const frequentUpCandidates = Object.entries(trackerConfig.creator_profiles || {})
    .reduce<FrequentUpCandidate[]>((acc, [profileId, profile]) => {
      const upId = String(profile.author_id || profileId || "").trim();
      if (!upId) {
        return acc;
      }
      const up = followedUpByAuthorId[upId];
      const smartGroups = (profile.smart_groups?.length ? profile.smart_groups : (up ? getUpSmartGroups(up) : []))
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const latestTitle = String(profile.latest_title || profile.sample_titles?.[0] || "").trim();
      const description = String(up?.sign || up?.official_desc || profile.source_summary || "").trim();
      acc.push({
        upId,
        up,
        profile,
        displayName: String(up?.uname || profile.author || upId).trim() || upId,
        description,
        noteCount: Number(profile.favorite_note_count || 0),
        latestTitle,
        smartGroups,
        originalGroupNames: up ? getUpOriginalGroupNames(up) : [],
        tracked: manualPoolIdSet.has(upId),
      });
      return acc;
    }, [])
    .filter((candidate) => (
      candidate.noteCount > 0
      || candidate.smartGroups.length > 0
      || Boolean(candidate.latestTitle)
    ))
    .sort((left, right) =>
      right.noteCount - left.noteCount
      || Number(right.tracked) - Number(left.tracked)
      || left.displayName.localeCompare(right.displayName, "zh-CN")
    );
  const frequentUpGroupCounts = smartGroupOptions.reduce<Record<string, number>>((acc, option) => {
    acc[option.value] = frequentUpCandidates.filter((candidate) => candidate.smartGroups.includes(option.value)).length;
    return acc;
  }, {});
  const frequentUpGroupOptions = smartGroupOptions.filter((option) => (frequentUpGroupCounts[option.value] || 0) > 0);
  const filteredFrequentUpCandidates = frequentUpCandidates.filter((candidate) => (
    frequentUpGroupFilter === "all" ? true : candidate.smartGroups.includes(frequentUpGroupFilter)
  ));
  const frequentUpTotalPages = Math.max(1, Math.ceil(filteredFrequentUpCandidates.length / FREQUENT_UP_PAGE_SIZE));
  const safeFrequentUpPage = Math.min(frequentUpPage, frequentUpTotalPages);
  const pagedFrequentUpCandidates = filteredFrequentUpCandidates.slice(
    (safeFrequentUpPage - 1) * FREQUENT_UP_PAGE_SIZE,
    safeFrequentUpPage * FREQUENT_UP_PAGE_SIZE,
  );
  const manualPoolMembers = manualPoolIds.map((upId) => ({
    id: upId,
    up: followedUpByAuthorId[upId],
  }));
  const selectedTrackedSmartGroups = allSmartGroupBundles.flatMap((group) => {
    const members = group.members.filter((up) => manualPoolIdSet.has(up.mid));
    if (members.length === 0) {
      return [];
    }
    return [{
      ...group,
      members,
      sampleAuthors: members.slice(0, 4).map((up) => up.uname),
      sampleTags: group.sample_tags && group.sample_tags.length > 0
        ? group.sample_tags
        : Array.from(
            new Set(
              members.flatMap((up) => getUpProfile(up)?.sample_tags || [])
            )
          ).slice(0, 4),
    }];
  });
  const trackedUpIds = new Set<string>(manualPoolIds);
  const trackedUpMembers = manualPoolMembers
    .map((entry) => entry.up)
    .filter((up): up is BiliFollowedUp => Boolean(up));
  const monitorCategoryCount = selectedTrackedSmartGroups.length + (manualPoolMembers.length > 0 ? 1 : 0);
  const fixedUpSavedTotalPages = Math.max(1, Math.ceil(manualPoolMembers.length / fixedUpSavedPageSize));
  const safeFixedUpSavedPage = Math.min(fixedUpSavedPage, fixedUpSavedTotalPages);
  const pagedFixedUpSavedMembers = manualPoolMembers.slice(
    (safeFixedUpSavedPage - 1) * fixedUpSavedPageSize,
    safeFixedUpSavedPage * fixedUpSavedPageSize,
  );
  const fixedUpImportGroups = allSmartGroupBundles.filter((group) => group.members.length > 0);
  const fixedUpImportGroupsTotalPages = Math.max(1, Math.ceil(fixedUpImportGroups.length / FIXED_UP_IMPORT_GROUPS_PAGE_SIZE));
  const safeFixedUpImportGroupPage = Math.min(fixedUpImportGroupPage, fixedUpImportGroupsTotalPages);
  const pagedFixedUpImportGroups = fixedUpImportGroups.slice(
    (safeFixedUpImportGroupPage - 1) * FIXED_UP_IMPORT_GROUPS_PAGE_SIZE,
    safeFixedUpImportGroupPage * FIXED_UP_IMPORT_GROUPS_PAGE_SIZE,
  );
  const expandedFixedUpGroupBundle = fixedUpImportGroups.find((group) => group.value === expandedFixedUpImportGroup) || null;
  const expandedFixedUpImportMembers = expandedFixedUpGroupBundle
    ? expandedFixedUpGroupBundle.members.filter((up) => matchesUpQuery(up, fixedUpImportSearch))
    : [];
  const fixedUpImportableCount = expandedFixedUpGroupBundle
    ? expandedFixedUpGroupBundle.members.filter((up) => !manualPoolIdSet.has(up.mid)).length
    : 0;
  const fixedUpImportTotalPages = Math.max(1, Math.ceil(expandedFixedUpImportMembers.length / fixedUpImportPageSize));
  const safeFixedUpImportPage = Math.min(fixedUpImportPage, fixedUpImportTotalPages);
  const pagedFixedUpImportMembers = expandedFixedUpImportMembers.slice(
    (safeFixedUpImportPage - 1) * fixedUpImportPageSize,
    safeFixedUpImportPage * fixedUpImportPageSize,
  );
  const managedSmartGroupOption = smartGroupOptions.find((group) => group.value === managedSmartGroup) || smartGroupOptions[0];
  const managedSmartGroupMeta = managedSmartGroupOption
    ? resolveSmartGroupMeta(managedSmartGroupOption.value, managedSmartGroupOption.label)
    : resolveSmartGroupMeta("other", "Other");
  const managedSmartGroupMembers = managedSmartGroupOption
    ? followedUps.filter((up) => getUpSmartGroups(up).includes(managedSmartGroupOption.value))
    : [];
  const manualGroupingBaseUps = manualGroupingScope === "filtered"
    ? filteredFollowedUps
    : manualGroupingScope === "managed"
      ? managedSmartGroupMembers
      : followedUps;
  const manualGroupingUps = manualGroupingBaseUps.filter((up) => matchesUpQuery(up, manualGroupingSearch));
  const manualGroupingTotalPages = Math.max(1, Math.ceil(manualGroupingUps.length / manualGroupingPageSize));
  const safeManualGroupingPage = Math.min(manualGroupingPage, manualGroupingTotalPages);
  const pagedManualGroupingUps = manualGroupingUps.slice(
    (safeManualGroupingPage - 1) * manualGroupingPageSize,
    safeManualGroupingPage * manualGroupingPageSize,
  );
  const editingGroupedUp = editingGroupedUpId ? followedUpByAuthorId[editingGroupedUpId] : null;
  const editingGroupedUpSmartGroups = editingGroupedUp
    ? editingSmartGroupValues
    : [];
  const editingGroupedUpEffectiveOriginalIds = editingGroupedUp
    ? Array.from(new Set([...(editingGroupedUp.tag_ids || []), ...editingManualOriginalGroupIds]))
    : [];

  useEffect(() => {
    setFrequentUpPage(1);
  }, [frequentUpGroupFilter]);

  useEffect(() => {
    if (frequentUpPage > frequentUpTotalPages) {
      setFrequentUpPage(frequentUpTotalPages);
    }
  }, [frequentUpPage, frequentUpTotalPages]);

  useEffect(() => {
    if (!editingGroupedUpId) {
      return;
    }
    if (followedUpByAuthorId[editingGroupedUpId]) {
      return;
    }
    setEditingGroupedUpId("");
    setEditingSmartGroupValues([]);
    setEditingManualOriginalGroupIds([]);
  }, [editingGroupedUpId, followedUpByAuthorId]);

  useEffect(() => {
    setFixedUpSavedPage(1);
  }, [manualPoolMembers.length, fixedUpSavedPageSize]);

  useEffect(() => {
    setFixedUpImportGroupPage(1);
  }, [fixedUpImportGroups.length]);

  useEffect(() => {
    if (!expandedFixedUpImportGroup) {
      return;
    }
    if (fixedUpImportGroups.some((group) => group.value === expandedFixedUpImportGroup)) {
      return;
    }
    setExpandedFixedUpImportGroup("");
  }, [expandedFixedUpImportGroup, fixedUpImportGroups]);

  useEffect(() => {
    setFixedUpImportPage(1);
  }, [expandedFixedUpImportGroup, fixedUpImportSearch, fixedUpImportPageSize]);

  useEffect(() => {
    setFollowedResultPage(1);
  }, [selectedOriginalGroup, selectedFollowedGroup, followedUpSearch, followedUps.length, followedResultPageSize]);

  useEffect(() => {
    setManualGroupingPage(1);
  }, [
    manualGroupingScope,
    manualGroupingSearch,
    managedSmartGroup,
    selectedOriginalGroup,
    selectedFollowedGroup,
    followedUpSearch,
    followedUps.length,
    manualGroupingPageSize,
  ]);

  const followedResultTotalPages = Math.max(1, Math.ceil(filteredFollowedUps.length / followedResultPageSize));
  const safeFollowedResultPage = Math.min(followedResultPage, followedResultTotalPages);
  const pagedFollowedUps = filteredFollowedUps.slice(
    (safeFollowedResultPage - 1) * followedResultPageSize,
    safeFollowedResultPage * followedResultPageSize,
  );

  const toggleTargetedDynamicUp = (upId: string) => {
    setTargetedDynamicUpIds((prev) => {
      const next = new Set(prev);
      if (next.has(upId)) {
        next.delete(upId);
      } else {
        next.add(upId);
      }
      return next;
    });
  };

  const selectAllTargetedDynamicCandidates = () => {
    setTargetedDynamicUpIds((prev) => {
      const next = new Set(prev);
      targetedDynamicCandidates.forEach((up) => next.add(up.mid));
      return next;
    });
  };

  const clearTargetedDynamicSelection = () => {
    setTargetedDynamicUpIds(new Set());
  };

  const handleFetchTrackedUpsDynamics = async () => {
    if (trackedUpMembers.length === 0) {
      toast.info("First add the smart groups or manual creators you want monitored to the intel Feed");
      return;
    }
    await runDynamicsPreview({
      authorIds: trackedUpMembers.map((up) => up.mid),
      daysBackOverride: clampPositiveInt(
        trackerConfig.fixed_up_days_back,
        FIXED_UP_MONITOR_DEFAULT_DAYS_BACK,
        365,
      ),
      limitOverride: MAX_DYNAMIC_KEEP_LIMIT,
      label: `Daily monitored creators · ${trackedUpMembers.length}`,
      scope: "ups",
      monitorSubfolder: buildTrackedUpsSubfolder(`已启用监视UP ${trackedUpMembers.length} 个`),
      switchToResult: true,
    });
  };

  const handleFetchTargetedGroupDynamics = async () => {
    if (!targetedDynamicGroup) {
      toast.error("Pick a browse scope first");
      return;
    }
    const { safeDaysBack, safeLimit } = normalizeTargetedGroupRequestInputs();
    if (targetedDynamicFetchMembers.length === 0) {
      toast.info(
        targetedDynamicSearchActive
          ? `No creators in ${targetedDynamicGroupLabel} match the current search`
          : `No crawlable creators in ${targetedDynamicGroupLabel} yet`
      );
      return;
    }
    const scopeLabel = targetedDynamicSearchActive ? "current filter" : "whole group";
    const label = targetedDynamicGroup === "all"
      ? `All smart groups · ${scopeLabel} ${targetedDynamicFetchMembers.length} creators`
      : `${targetedDynamicGroupLabel} · ${scopeLabel} ${targetedDynamicFetchMembers.length} creators`;
    await runDynamicsPreview({
      authorIds: targetedDynamicFetchMembers.map((up) => up.mid),
      daysBackOverride: safeDaysBack,
      limitOverride: safeLimit,
      label,
      scope: "group",
      monitorSubfolder: buildTargetedGroupSubfolder(
        targetedDynamicGroup === "all" ? "All smart groups" : targetedDynamicGroupLabel,
      ),
      switchToResult: true,
    });
  };

  const handleFetchSelectedUpsDynamics = async () => {
    if (targetedDynamicSelectedUps.length === 0) {
      toast.error("Select at least one creator first");
      return;
    }
    const { safeDaysBack, safeLimit } = normalizeTargetedGroupRequestInputs();
    const sampleNames = targetedDynamicSelectedUps.slice(0, 3).map((up) => up.uname);
    const overflowCount = targetedDynamicSelectedUps.length - sampleNames.length;
    const label = overflowCount > 0
      ? `${sampleNames.join(" / ")} and ${targetedDynamicSelectedUps.length} creators total`
      : sampleNames.join(" / ");
    await runDynamicsPreview({
      authorIds: targetedDynamicSelectedUps.map((up) => up.mid),
      daysBackOverride: safeDaysBack,
      limitOverride: safeLimit,
      label,
      scope: "ups",
      monitorSubfolder: buildSelectedUpsSubfolder(label),
      switchToResult: true,
    });
  };

  const saveDynamicsToVault = async (targetDynamics: BiliDynamic[], successLabel: string) => {
    if (targetDynamics.length === 0) {
      toast.error("No posts to save");
      return;
    }
    setVaultCrawling(true);
    try {
      const result = await bilibiliSaveSelectedDynamics({
        dynamics: targetDynamics,
      });
      setVaultResult(result);
      toast.success(
        "Bilibili saved to Intel Library",
        withLocationSuffix(successLabel, result.output_dir, "vault", config),
      );
    } catch (err) {
      toast.error("Save failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setVaultCrawling(false);
    }
  };

  const handleSaveSelectedDynamics = async () => {
    const selectedDynamics = displayedDynamics.filter((dynamic) => selectedDynamicIds.has(dynamic.id));
    if (selectedDynamics.length === 0) {
      toast.error("Select posts to save first");
      return;
    }
    await saveDynamicsToVault(selectedDynamics, `Saved ${selectedDynamics.length} selected posts`);
  };

  const handleSaveAllDisplayedDynamics = async () => {
    if (displayedDynamics.length === 0) {
      toast.error("No posts available to save");
      return;
    }
    await saveDynamicsToVault(displayedDynamics, `One-click saved ${displayedDynamics.length} current results`);
  };

  const handleSaveSingleDynamic = async (dynamic: BiliDynamic) => {
    await saveDynamicsToVault([dynamic], `Saved 1 post: ${dynamic.title || dynamic.author}`);
  };

  const handleOpenDynamicSource = async (dynamic: BiliDynamic) => {
    const targetUrl = resolveDynamicSourceUrl(dynamic);
    if (!targetUrl) {
      toast.info("This post has no original link to open yet");
      return;
    }
    try {
      await openUrl(targetUrl);
    } catch (err) {
      try {
        window.open(targetUrl, "_blank", "noopener,noreferrer");
        return;
      } catch {
        // fall through
      }
      toast.error("Failed to open original", err instanceof Error ? err.message : "Unknown error");
    }
  };

  const displayedSelectedCount = displayedDynamics.reduce(
    (count, dynamic) => count + (selectedDynamicIds.has(dynamic.id) ? 1 : 0),
    0
  );

  function toggleDynamicSelection(dynamicId: string) {
    setSelectedDynamicIds((prev) => {
      const next = new Set(prev);
      if (next.has(dynamicId)) {
        next.delete(dynamicId);
      } else {
        next.add(dynamicId);
      }
      return next;
    });
  }

  function selectAllDisplayedDynamics() {
    setSelectedDynamicIds((prev) => {
      const next = new Set(prev);
      displayedDynamics.forEach((dynamic) => next.add(dynamic.id));
      return next;
    });
  }

  function clearDisplayedDynamicsSelection() {
    setSelectedDynamicIds((prev) => {
      const next = new Set(prev);
      displayedDynamics.forEach((dynamic) => next.delete(dynamic.id));
      return next;
    });
  }

  const switchPanel = (tab: BilibiliPanelTab) => {
    setPanelTab(tab);
    writeStringStorage("bilibili_tool_panel", tab);
  };

  const renderTabs = () => {
    const tabs = [
      { key: "dynamics" as const, label: "Post tracking", icon: Tv, accent: "#00AEEC", bg: "rgba(0, 174, 236, 0.12)" },
      { key: "favorites" as const, label: "Favorites organizing", icon: FolderHeart, accent: "#FB7299", bg: "rgba(251, 114, 153, 0.12)" },
      { key: "following" as const, label: "Follow monitors", icon: Users, accent: "#10B981", bg: "rgba(16, 185, 129, 0.12)" },
    ];

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "12px",
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = panelTab === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchPanel(tab.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "14px 16px",
                borderRadius: "var(--radius-md)",
                border: `1px solid ${active ? tab.accent : "var(--border-light)"}`,
                background: active ? tab.bg : "var(--bg-card)",
                color: active ? tab.accent : "var(--text-main)",
                fontSize: "0.9375rem",
                fontWeight: 700,
                cursor: "pointer",
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
                  background: active ? tab.bg : "var(--bg-hover)",
                  color: active ? tab.accent : "var(--text-secondary)",
                  flexShrink: 0,
                }}
              >
                <Icon size={18} />
              </span>
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderTargetedDynamicCrawlBody = () => (
    followedUpsLoading && followedUps.length === 0 ? (
      <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
        Reading follow list...
      </div>
    ) : followedUps.length === 0 ? (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Fetch the follow list once first; then daily post scoping by smart group or specific creator becomes available here.
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void handleLoadFollowedUps(false, true)}
            disabled={followedUpsLoading}
            style={{
              padding: "10px 14px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(14, 165, 233, 0.32)",
              background: "linear-gradient(135deg, #10B981, #00AEEC)",
              color: "white",
              fontSize: "0.8125rem",
              fontWeight: 800,
              cursor: followedUpsLoading ? "not-allowed" : "pointer",
              opacity: followedUpsLoading ? 0.7 : 1,
            }}
          >
            {followedUpsLoading ? "Reading..." : "Read follow list first"}
          </button>
        </div>
      </div>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          This only controls the temporary post preview scope; it does not change pinned creators or intel Feed config.
          {!smartGroupsReady && " Before \"shared smart grouping\" has run, items are temporarily classified from current Bilibili info."}
        </div>

        <div
          style={{
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "var(--bg-card)",
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            onClick={() => setShowTargetedDynamicQuickSection((value) => !value)}
            style={{
              width: "100%",
              padding: "16px",
              border: "none",
              background: "transparent",
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              alignItems: "flex-start",
              flexWrap: "wrap",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Quick same-day crawl</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                Set the time window, item count, and post types first, then crawl the current monitored scope directly.
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "999px",
                background: "rgba(16, 185, 129, 0.10)",
                color: "#0F9F6E",
                fontSize: "0.75rem",
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {showTargetedDynamicQuickSection ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Currently monitoring {trackedUpMembers.length} creators
            </span>
          </button>

          {showTargetedDynamicQuickSection && (
            <div
              style={{
                padding: "0 16px 16px",
                borderTop: "1px solid var(--border-light)",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", paddingTop: "16px" }}>
                <button
                  type="button"
                  onClick={() => void handleFetchTrackedUpsDynamics()}
                  disabled={loading || trackedUpMembers.length === 0}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    background: loading || trackedUpMembers.length === 0
                      ? "var(--bg-muted)"
                      : "linear-gradient(135deg, #10B981, #00AEEC)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 800,
                    cursor: loading || trackedUpMembers.length === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Crawling..." : `Crawl current monitored scope · ${trackedUpMembers.length}`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDynamicResultList(true)}
                  disabled={!hasFetchedDynamics}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-card)",
                    color: hasFetchedDynamics ? "var(--text-secondary)" : "var(--text-muted)",
                    fontSize: "0.8125rem",
                    fontWeight: 700,
                    cursor: hasFetchedDynamics ? "pointer" : "not-allowed",
                  }}
                >
                  View post results
                </button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {selectedTrackedSmartGroups.slice(0, 8).map((group) => (
                  <span
                    key={`daily-track-${group.value}`}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: group.meta.bg,
                      color: group.meta.accent,
                      fontSize: "0.75rem",
                      fontWeight: 800,
                    }}
                  >
                    {group.label} · {group.members.length}
                  </span>
                ))}
                {manualPoolMembers.length > 0 && (
                  <span
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: "rgba(0, 174, 236, 0.08)",
                      color: "#078FBF",
                      fontSize: "0.75rem",
                      fontWeight: 800,
                    }}
                  >
                    Pinned · {manualPoolMembers.length}
                  </span>
                )}
                {monitorCategoryCount === 0 && (
                  <span
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      background: "var(--bg-card)",
                      color: "var(--text-muted)",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                    }}
                  >
                    Pick smart groups or pinned creators first and the temporary crawl scope appears
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "16px",
                  alignItems: "start",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-main)" }}>Time window</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {TIME_RANGE_OPTIONS.map((opt) => (
                      <button
                        key={`targeted-time-${opt.value}`}
                        type="button"
                        onClick={() => {
                          setDaysBack(opt.value);
                          setDaysBackInput(String(opt.value));
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid",
                          borderColor: daysBack === opt.value ? "var(--color-primary)" : "var(--border-light)",
                          background: daysBack === opt.value ? "rgba(188, 164, 227, 0.15)" : "var(--bg-hover)",
                          color: daysBack === opt.value ? "var(--color-primary)" : "var(--text-secondary)",
                          fontSize: "0.8125rem",
                          fontWeight: daysBack === opt.value ? 700 : 500,
                          cursor: "pointer",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min={1}
                      value={daysBackInput}
                      onChange={(e) => setDaysBackInput(e.target.value)}
                      onBlur={() => normalizePositiveInput(daysBackInput, daysBack, setDaysBack, setDaysBackInput)}
                      placeholder="Custom days"
                      style={{
                        width: "110px",
                        padding: "8px 10px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-input)",
                        color: "var(--text-main)",
                        fontSize: "0.8125rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>days</span>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-main)" }}>Max kept after filtering</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {LIMIT_OPTIONS.map((opt) => (
                      <button
                        key={`targeted-limit-${opt}`}
                        type="button"
                        onClick={() => {
                          setLimit(opt);
                          setLimitInput(String(opt));
                        }}
                        style={{
                          minWidth: "88px",
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid",
                          borderColor: limit === opt ? "var(--color-primary)" : "var(--border-light)",
                          background: limit === opt ? "rgba(188, 164, 227, 0.15)" : "var(--bg-hover)",
                          color: limit === opt ? "var(--color-primary)" : "var(--text-secondary)",
                          fontSize: "0.8125rem",
                          fontWeight: limit === opt ? 700 : 500,
                          cursor: "pointer",
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min={1}
                      max={MAX_DYNAMIC_KEEP_LIMIT}
                      value={limitInput}
                      onChange={(e) => setLimitInput(e.target.value)}
                      onBlur={() => normalizePositiveInput(limitInput, limit, setLimit, setLimitInput, MAX_DYNAMIC_KEEP_LIMIT)}
                      placeholder={`1-${MAX_DYNAMIC_KEEP_LIMIT}`}
                      style={{
                        width: "110px",
                        padding: "8px 10px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-input)",
                        color: "var(--text-main)",
                        fontSize: "0.8125rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>items</span>
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    The system may scan more posts; this controls how many are finally kept after filtering, capped at {MAX_DYNAMIC_KEEP_LIMIT}.
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-main)" }}>Post types</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {Object.entries(DYNAMIC_TYPE_MAP).map(([type, config]) => {
                    const Icon = config.icon;
                    const selected = selectedTypes.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleType(type)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid",
                          borderColor: selected ? config.color : "var(--border-light)",
                          background: selected ? `${config.color}15` : "var(--bg-card)",
                          color: selected ? config.color : "var(--text-secondary)",
                          fontSize: "0.8125rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <Icon size={14} />
                        {config.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "var(--bg-card)",
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            onClick={() => setShowTargetedDynamicGroupSection((value) => !value)}
            style={{
              width: "100%",
              padding: "16px",
              border: "none",
              background: "transparent",
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              alignItems: "flex-start",
              flexWrap: "wrap",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Custom group crawl</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                Group buttons stay above the list. Select across smart groups continuously — switching groups does not clear selected creators.
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "999px",
                background: `${targetedDynamicGroupMeta.accent}14`,
                color: targetedDynamicGroupMeta.accent,
                fontSize: "0.75rem",
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {showTargetedDynamicGroupSection ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Current: {targetedDynamicGroupLabel}
            </span>
          </button>

          {showTargetedDynamicGroupSection && (
            <div
              style={{
                padding: "0 16px 16px",
                borderTop: "1px solid var(--border-light)",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6, paddingTop: "16px" }}>
                Shows 12 creators per page. Whole-group crawls ignore the keywords above; if you type a creator search term here, only the matching list is crawled.
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "14px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-main)" }}>Time window for this group</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {TIME_RANGE_OPTIONS.map((opt) => (
                      <button
                        key={`targeted-group-time-${opt.value}`}
                        type="button"
                        onClick={() => {
                          setTargetedGroupDaysBack(opt.value);
                          setTargetedGroupDaysBackInput(String(opt.value));
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid",
                          borderColor: targetedGroupDaysBack === opt.value ? targetedDynamicGroupMeta.accent : "var(--border-light)",
                          background: targetedGroupDaysBack === opt.value ? targetedDynamicGroupMeta.bg : "var(--bg-hover)",
                          color: targetedGroupDaysBack === opt.value ? targetedDynamicGroupMeta.accent : "var(--text-secondary)",
                          fontSize: "0.8125rem",
                          fontWeight: targetedGroupDaysBack === opt.value ? 700 : 500,
                          cursor: "pointer",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min={1}
                      value={targetedGroupDaysBackInput}
                      onChange={(e) => setTargetedGroupDaysBackInput(e.target.value)}
                      onBlur={() => normalizePositiveInput(
                        targetedGroupDaysBackInput,
                        targetedGroupDaysBack,
                        setTargetedGroupDaysBack,
                        setTargetedGroupDaysBackInput,
                        365,
                      )}
                      placeholder="Custom days"
                      style={{
                        width: "110px",
                        padding: "8px 10px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-input)",
                        color: "var(--text-main)",
                        fontSize: "0.8125rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>days</span>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-main)" }}>Max shown for this group</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {LIMIT_OPTIONS.map((opt) => (
                      <button
                        key={`targeted-group-limit-${opt}`}
                        type="button"
                        onClick={() => {
                          setTargetedGroupLimit(opt);
                          setTargetedGroupLimitInput(String(opt));
                        }}
                        style={{
                          minWidth: "88px",
                          padding: "8px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid",
                          borderColor: targetedGroupLimit === opt ? targetedDynamicGroupMeta.accent : "var(--border-light)",
                          background: targetedGroupLimit === opt ? targetedDynamicGroupMeta.bg : "var(--bg-hover)",
                          color: targetedGroupLimit === opt ? targetedDynamicGroupMeta.accent : "var(--text-secondary)",
                          fontSize: "0.8125rem",
                          fontWeight: targetedGroupLimit === opt ? 700 : 500,
                          cursor: "pointer",
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min={1}
                      max={MAX_DYNAMIC_KEEP_LIMIT}
                      value={targetedGroupLimitInput}
                      onChange={(e) => setTargetedGroupLimitInput(e.target.value)}
                      onBlur={() => normalizePositiveInput(
                        targetedGroupLimitInput,
                        targetedGroupLimit,
                        setTargetedGroupLimit,
                        setTargetedGroupLimitInput,
                        MAX_DYNAMIC_KEEP_LIMIT,
                      )}
                      placeholder={`1-${MAX_DYNAMIC_KEEP_LIMIT}`}
                      style={{
                        width: "110px",
                        padding: "8px 10px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-input)",
                        color: "var(--text-main)",
                        fontSize: "0.8125rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>items</span>
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    Targeted groups scan 3 pages of each author space by default, then sort matching results by time; the frontend shows at most this many.
                  </div>
                </div>
              </div>

              {smartGroupOptions.length > TARGETED_DYNAMIC_GROUPS_PAGE_SIZE && (
                <PaginationControls
                  totalCount={smartGroupOptions.length}
                  page={safeTargetedDynamicGroupPage}
                  pageSize={TARGETED_DYNAMIC_GROUPS_PAGE_SIZE}
                  itemLabel="groups"
                  onPageChange={setTargetedDynamicGroupPage}
                  emptyText="No smart groups available"
                />
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => setTargetedDynamicGroup("all")}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid",
                    borderColor: targetedDynamicGroup === "all" ? "#0EA5E9" : "var(--border-light)",
                    background: targetedDynamicGroup === "all" ? "rgba(14, 165, 233, 0.10)" : "var(--bg-card)",
                    color: targetedDynamicGroup === "all" ? "#0284C7" : "var(--text-secondary)",
                    fontSize: "0.8125rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  All smart groups · {followedUps.length}
                </button>
                {pagedTargetedDynamicGroups.map((group) => {
                  const active = targetedDynamicGroup === group.value;
                  const meta = resolveSmartGroupMeta(group.value, group.label);
                  return (
                    <button
                      key={group.value}
                      type="button"
                      onClick={() => setTargetedDynamicGroup(group.value)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid",
                        borderColor: active ? meta.accent : "var(--border-light)",
                        background: active ? meta.bg : "var(--bg-card)",
                        color: active ? meta.accent : "var(--text-secondary)",
                        fontSize: "0.8125rem",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {group.label} {groupCounts[group.value] ? `· ${groupCounts[group.value]}` : ""}
                    </button>
                  );
                })}
              </div>

              <input
                type="text"
                value={targetedDynamicUpSearch}
                onChange={(e) => setTargetedDynamicUpSearch(e.target.value)}
                placeholder={`Search creator names / bios in ${targetedDynamicGroupLabel}`}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-input)",
                  color: "var(--text-main)",
                  fontSize: "0.875rem",
                }}
              />

              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${targetedDynamicGroupMeta.accent}33`,
                  background: targetedDynamicGroupMeta.bg,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                  <span style={{ color: targetedDynamicGroupMeta.accent, fontWeight: 800 }}>Current scope: {targetedDynamicGroupLabel}</span>
                  <span>{targetedDynamicGroupMembers.length} creators in scope</span>
                  <span>{targetedDynamicCandidates.length} search hits</span>
                  <span>{targetedDynamicFetchMembers.length} in this whole-group crawl</span>
                  <span>{targetedDynamicVisibleSelectedCount} selected on this page</span>
                  <span>{targetedDynamicSelectedUps.length} selected total</span>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={selectAllTargetedDynamicCandidates}
                    disabled={targetedDynamicCandidates.length === 0}
                    style={{
                      padding: "7px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-card)",
                      color: targetedDynamicCandidates.length === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      cursor: targetedDynamicCandidates.length === 0 ? "not-allowed" : "pointer",
                    }}
                  >
                    Select all in current list
                  </button>
                  <button
                    type="button"
                    onClick={clearTargetedDynamicSelection}
                    disabled={targetedDynamicUpIds.size === 0}
                    style={{
                      padding: "7px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-card)",
                      color: targetedDynamicUpIds.size === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      cursor: targetedDynamicUpIds.size === 0 ? "not-allowed" : "pointer",
                    }}
                  >
                    Clear selection
                  </button>
                </div>
              </div>

              {targetedDynamicCandidates.length > 0 ? (
                <>
                  <PaginationControls
                    totalCount={targetedDynamicCandidates.length}
                    page={safeTargetedDynamicPage}
                    pageSize={TARGETED_DYNAMIC_RESULTS_PAGE_SIZE}
                    itemLabel="creators"
                    onPageChange={setTargetedDynamicPage}
                    emptyText="No matching creators"
                  />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                      gap: "10px",
                    }}
                  >
                    {pagedTargetedDynamicCandidates.map((up) => {
                      const selected = targetedDynamicUpIds.has(up.mid);
                      return (
                        <button
                          key={up.mid}
                          type="button"
                          onClick={() => toggleTargetedDynamicUp(up.mid)}
                          style={{
                            padding: "12px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid",
                            borderColor: selected ? targetedDynamicGroupMeta.accent : "var(--border-light)",
                            background: selected ? targetedDynamicGroupMeta.bg : "var(--bg-hover)",
                            textAlign: "left",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            cursor: "pointer",
                            minHeight: "108px",
                          }}
                        >
                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: selected ? targetedDynamicGroupMeta.accent : "var(--text-main)" }}>
                            {up.uname}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {(up.tag_names[0] || "Ungrouped")} · {selected ? "Selected" : "Click to add to this crawl"}
                          </div>
                          {(up.sign || up.official_desc) && (
                            <div
                              style={{
                                fontSize: "0.6875rem",
                                color: "var(--text-muted)",
                                lineHeight: 1.5,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {up.sign || up.official_desc}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <PaginationControls
                    totalCount={targetedDynamicCandidates.length}
                    page={safeTargetedDynamicPage}
                    pageSize={TARGETED_DYNAMIC_RESULTS_PAGE_SIZE}
                    itemLabel="creators"
                    onPageChange={setTargetedDynamicPage}
                    emptyText="No matching creators"
                  />
                </>
              ) : (
                <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                  {targetedDynamicGroupMembers.length > 0
                    ? "No creators in this scope match the current search."
                    : "No crawlable followed creators in the current scope yet."}
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void handleFetchTargetedGroupDynamics()}
                  disabled={loading || targetedDynamicFetchMembers.length === 0}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    background: loading || targetedDynamicFetchMembers.length === 0
                      ? "var(--bg-muted)"
                      : `linear-gradient(135deg, ${targetedDynamicGroupMeta.accent}, #10B981)`,
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 800,
                    cursor: loading || targetedDynamicFetchMembers.length === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {loading
                    ? "Crawling..."
                    : targetedDynamicSearchActive
                      ? `Crawl current filter: ${targetedDynamicFetchMembers.length} creators`
                      : targetedDynamicGroup === "all"
                        ? "Crawl all current creators"
                        : `Crawl the whole ${targetedDynamicGroupLabel} group`}
                </button>
                <button
                  type="button"
                  onClick={() => void handleFetchSelectedUpsDynamics()}
                  disabled={loading || targetedDynamicSelectedUps.length === 0}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-light)",
                    background: loading || targetedDynamicSelectedUps.length === 0 ? "var(--bg-muted)" : "var(--bg-card)",
                    color: loading || targetedDynamicSelectedUps.length === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                    fontSize: "0.8125rem",
                    fontWeight: 800,
                    cursor: loading || targetedDynamicSelectedUps.length === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  Crawl only the {targetedDynamicSelectedUps.length} selected creators
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  );

  const renderTargetedDynamicCrawlWorkbench = () => (
    <Card
      title="Manual Crawl / Group Search"
      icon={<Search size={18} />}
      actions={(
        <span
          style={{
            padding: "5px 10px",
            borderRadius: "999px",
            background: "rgba(16, 185, 129, 0.12)",
            color: "#0F9F6E",
            fontSize: "0.75rem",
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          Current scope {trackedUpMembers.length}
        </span>
      )}
    >
      <div
        style={{
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(14, 165, 233, 0.18)",
          background: "linear-gradient(135deg, rgba(14, 165, 233, 0.09), rgba(16, 185, 129, 0.06))",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>Manual crawl / group search</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.7, maxWidth: "760px" }}>
              This handles temporary post crawls separately. The top supports crawling specified links directly; below it remain the monitored-scope crawl and the cross-group creator picker workbench.
            </div>
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              borderRadius: "999px",
              border: "1px solid var(--border-light)",
              background: "rgba(255,255,255,0.74)",
              color: "var(--text-secondary)",
              fontSize: "0.75rem",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            Temporary crawl workbench
          </span>
        </div>

        <div
          style={{
            padding: "16px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(251, 114, 153, 0.22)",
            background: "rgba(251, 114, 153, 0.06)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Crawl specified links</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.7, maxWidth: "760px" }}>
                One Bilibili video / post / opus / article link per line. Crawls reuse the existing post card preview, and direct saves still use the same Markdown save format.
              </div>
            </div>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.72)",
                border: "1px solid rgba(251, 114, 153, 0.18)",
                color: "#D64078",
                fontSize: "0.75rem",
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              Saves to bilibili/主动保存/ by default
            </span>
          </div>

          <textarea
            value={directLinkInput}
            onChange={(event) => setDirectLinkInput(event.target.value)}
            placeholder={[
              "One link per line, e.g.:",
              "https://www.bilibili.com/video/BV1xx411c7mD",
              "https://t.bilibili.com/123456789012345678",
              "https://www.bilibili.com/opus/123456789012345678",
            ].join("\n")}
            style={{
              width: "100%",
              minHeight: "124px",
              padding: "12px 14px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-light)",
              background: "var(--bg-card)",
              color: "var(--text-main)",
              fontSize: "0.8125rem",
              lineHeight: 1.6,
              resize: "vertical",
            }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              Currently recognizing {directLinkUrls.length} links. Preview-only sends them to the same results area below; direct save previews first, then writes locally in the current Bilibili save format.
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void handleFetchDirectLinks(false)}
                disabled={loading || directLinkRunning !== null || directLinkUrls.length === 0}
                style={{
                  padding: "9px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: loading || directLinkRunning !== null || directLinkUrls.length === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                  fontSize: "0.8125rem",
                  fontWeight: 700,
                  cursor: loading || directLinkRunning !== null || directLinkUrls.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                {directLinkRunning === "preview" ? "Parsing..." : "Preview only"}
              </button>
              <button
                type="button"
                onClick={() => void handleFetchDirectLinks(true)}
                disabled={loading || directLinkRunning !== null || directLinkUrls.length === 0}
                style={{
                  padding: "9px 14px",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  background: loading || directLinkRunning !== null || directLinkUrls.length === 0
                    ? "var(--bg-muted)"
                    : "linear-gradient(135deg, #FB7299, #00AEEC)",
                  color: loading || directLinkRunning !== null || directLinkUrls.length === 0 ? "var(--text-muted)" : "white",
                  fontSize: "0.8125rem",
                  fontWeight: 800,
                  cursor: loading || directLinkRunning !== null || directLinkUrls.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                {directLinkRunning === "save" ? "Crawling and saving..." : "Crawl and save directly"}
              </button>
            </div>
          </div>
        </div>

        {renderTargetedDynamicCrawlBody()}
      </div>
    </Card>
  );

  const renderDailyGroupMonitorWorkbench = () => (
    <Card
      title="Smart Group Tracking"
      icon={<Users size={18} />}
      actions={(
        <span
          style={{
            padding: "5px 10px",
            borderRadius: "999px",
            background: "rgba(0, 174, 236, 0.10)",
            color: "#078FBF",
            fontSize: "0.75rem",
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          Pinned {manualPoolMembers.length}
        </span>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <button
          type="button"
          onClick={() => setShowSmartGroupSourceDetail((value) => !value)}
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "var(--bg-hover)",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>Get grouping status</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                Keeps the shared tag library and smart grouping acquisition flow; this section only fetches follows, organizes the tag library, and shows current grouping status.
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "999px",
                border: "1px solid var(--border-light)",
                background: "rgba(255,255,255,0.74)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {showSmartGroupSourceDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showSmartGroupSourceDetail ? "Collapse" : "Expand"}
            </span>
          </div>
        </button>

        {showSmartGroupSourceDetail && (
          <div
            style={{
              padding: "16px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-light)",
              background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(14, 165, 233, 0.06))",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid rgba(236, 72, 153, 0.18)",
                background: "rgba(236, 72, 153, 0.06)",
                fontSize: "0.75rem",
                color: "var(--text-secondary)",
                lineHeight: 1.7,
              }}
            >
              <strong style={{ color: "var(--text-main)" }}>Raw tag -&gt; shared rule -&gt; shared group -&gt; author joins group</strong>
              . That is, creators join shared groups based on their sample notes' tag grouping; this keeps the shared tag library and grouping results, and monitors are no longer configured from here.
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void handleLoadFollowedUps(false, true)}
                disabled={followedUpsLoading}
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid rgba(16, 185, 129, 0.42)",
                  background: "linear-gradient(135deg, #10B981, #00AEEC)",
                  color: "white",
                  fontSize: "0.8125rem",
                  fontWeight: 800,
                  cursor: followedUpsLoading ? "not-allowed" : "pointer",
                  opacity: followedUpsLoading ? 0.62 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Users size={14} />
                {followedUpsLoading ? "Crawling..." : "Crawl follow list"}
              </button>
              <SmartGroupActionButton
                onClick={() => void handleBuildSmartGroups()}
                running={smartGroupRunning}
                secondaryLabel="Organize creators only"
                onSecondaryClick={() => void handleRefreshSharedCreatorAssignments()}
              />
            </div>

            {sharedTagIndexPath && (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                Shared tag library written to Intel Library: {sharedTagIndexPath}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
              }}
            >
              {[
                { label: "Follow list", value: followedUps.length, detail: followedUpsLoaded ? "Follows fetched" : "Waiting to fetch" },
                { label: "Smart groups", value: fixedUpImportGroups.length, detail: "Groups available now" },
                { label: "Creator profiles", value: Object.keys(trackerConfig.creator_profiles || {}).length, detail: "Group profiles generated" },
                { label: "Pinned", value: manualPoolMembers.length, detail: "Bulk import below" },
              ].map((metric) => (
                <div
                  key={metric.label}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-card)",
                  }}
                >
                  <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--text-main)" }}>{metric.value}</div>
                  <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>{metric.label}</div>
                  <div style={{ marginTop: "2px", fontSize: "0.6875rem", color: "var(--text-muted)" }}>{metric.detail}</div>
                </div>
              ))}
            </div>

            {fixedUpImportGroups.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "12px",
                }}
              >
                {fixedUpImportGroups.slice(0, 8).map((group) => (
                  <div
                    key={`smart-group-overview-${group.value}`}
                    style={{
                      padding: "14px",
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${group.meta.accent}22`,
                      background: "var(--bg-card)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div style={{ fontSize: "0.875rem", fontWeight: 800, color: group.meta.accent }}>
                      {group.label}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      {group.members.length} creators
                    </div>
                    {group.sampleAuthors.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {group.sampleAuthors.map((author) => (
                          <span
                            key={`smart-group-overview-author-${group.value}-${author}`}
                            style={{
                              padding: "3px 8px",
                              borderRadius: "999px",
                              background: "rgba(255,255,255,0.72)",
                              color: "var(--text-main)",
                              fontSize: "0.6875rem",
                              fontWeight: 700,
                            }}
                          >
                            {author}
                          </span>
                        ))}
                      </div>
                    )}
                    {group.sampleTags.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {group.sampleTags.slice(0, 4).map((tag) => (
                          <span
                            key={`smart-group-overview-tag-${group.value}-${tag}`}
                            style={{
                              padding: "3px 8px",
                              borderRadius: "999px",
                              background: "var(--bg-hover)",
                              color: "var(--text-muted)",
                              fontSize: "0.6875rem",
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                No smart grouping results yet. Run "shared smart grouping" once first and the current grouping status appears here.
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowFixedUpTrackingDetail((value) => !value)}
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "var(--bg-hover)",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>Pinned creators</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                This is where long-term pinned creator monitoring and bulk import happen. Everything that actually joins the intel Feed and daily post crawls enters from here.
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "999px",
                border: "1px solid var(--border-light)",
                background: "rgba(255,255,255,0.74)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {showFixedUpTrackingDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showFixedUpTrackingDetail ? "Collapse" : "Expand"}
            </span>
          </div>
        </button>

        {showFixedUpTrackingDetail && (
          <div
            style={{
              padding: "16px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-light)",
              background: "rgba(0, 174, 236, 0.05)",
            }}
          >
            {renderFixedUpMonitorWorkbench()}
          </div>
        )}
      </div>
    </Card>
  );

  const renderFixedUpMonitorWorkbench = () => (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          This manages the pinned creators that actually join long-term monitoring. Smart groups only provide the acquisition and import layer above; what enters daily posts and the intel Feed is governed by the list saved here.
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "10px",
          }}
        >
          {[
            { label: "Pinned", value: manualPoolMembers.length, detail: "Manually specified creators" },
            { label: "Matched smart groups", value: selectedTrackedSmartGroups.length, detail: "Groups these pinned creators fall into" },
            { label: "Total monitored scope", value: trackedUpMembers.length, detail: "Will join daily post crawls" },
          ].map((metric) => (
            <div
              key={metric.label}
              style={{
                padding: "12px 14px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-hover)",
              }}
            >
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--text-main)" }}>{metric.value}</div>
              <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>{metric.label}</div>
              <div style={{ marginTop: "2px", fontSize: "0.6875rem", color: "var(--text-muted)" }}>{metric.detail}</div>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: "14px",
            borderRadius: "var(--radius-md)",
            border: frequentUpCandidates.length > 0 ? "1px solid rgba(0, 174, 236, 0.18)" : "1px dashed var(--border-light)",
            background: frequentUpCandidates.length > 0
              ? "linear-gradient(180deg, rgba(0, 174, 236, 0.07), rgba(251, 114, 153, 0.05))"
              : "var(--bg-hover)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Quick-add frequent creators</div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                Sorted by how often creators appear in local Bilibili content, 12 per page; <span style={{ fontWeight: 800, color: "#078FBF" }}>click an avatar to add</span>, or use the card buttons to add/remove pinned creators.
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void handleBuildSmartGroups()}
                style={{
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Refresh shared smart groups
              </button>
              <button
                type="button"
                onClick={() => void handleRefreshSharedCreatorAssignments()}
                style={{
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Organize creators only
              </button>
            </div>
          </div>

          {frequentUpCandidates.length > 0 ? (
            <>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Organized {frequentUpCandidates.length} reusable creators from local content; {frequentUpCandidates.filter((candidate) => candidate.tracked).length} already pinned.
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setFrequentUpGroupFilter("all")}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-light)",
                    background: frequentUpGroupFilter === "all" ? "rgba(0, 174, 236, 0.10)" : "var(--bg-card)",
                    color: frequentUpGroupFilter === "all" ? "#078FBF" : "var(--text-secondary)",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  All · {frequentUpCandidates.length}
                </button>
                {frequentUpGroupOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFrequentUpGroupFilter(option.value)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: frequentUpGroupFilter === option.value ? "rgba(0, 174, 236, 0.10)" : "var(--bg-card)",
                      color: frequentUpGroupFilter === option.value ? "#078FBF" : "var(--text-secondary)",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {option.label} · {frequentUpGroupCounts[option.value] || 0}
                  </button>
                ))}
              </div>

              {filteredFrequentUpCandidates.length > 0 ? (
                <>
                  <PaginationControls
                    totalCount={filteredFrequentUpCandidates.length}
                    page={safeFrequentUpPage}
                    pageSize={FREQUENT_UP_PAGE_SIZE}
                    itemLabel="creators"
                    onPageChange={setFrequentUpPage}
                    emptyText="No matching creators under the current filter"
                  />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                      gap: "10px",
                    }}
                  >
                    {pagedFrequentUpCandidates.map((candidate, index) => {
                      const smartLabels = candidate.smartGroups
                        .map((groupValue) => getSmartGroupLabel(groupValue))
                        .filter(Boolean);
                      const avatarText = candidate.displayName.charAt(0).toUpperCase() || "?";
                      const rank = ((safeFrequentUpPage - 1) * FREQUENT_UP_PAGE_SIZE) + index + 1;
                      return (
                        <div
                          key={`frequent-up-${candidate.upId}`}
                          style={{
                            padding: "12px",
                            borderRadius: "var(--radius-sm)",
                            border: candidate.tracked ? "1px solid rgba(0, 174, 236, 0.24)" : "1px solid var(--border-light)",
                            background: candidate.tracked ? "rgba(0, 174, 236, 0.08)" : "var(--bg-card)",
                            display: "flex",
                            gap: "12px",
                            alignItems: "flex-start",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => void handleAddFrequentUpToManualMonitor(candidate.upId, candidate.displayName)}
                            title={candidate.tracked ? "This creator is already pinned" : "Click the avatar to pin"}
                            style={{
                              position: "relative",
                              width: "46px",
                              height: "46px",
                              borderRadius: "50%",
                              border: "none",
                              background: candidate.tracked
                                ? "linear-gradient(135deg, rgba(0, 174, 236, 0.92), rgba(251, 114, 153, 0.9))"
                                : "linear-gradient(135deg, rgba(0, 174, 236, 0.14), rgba(251, 114, 153, 0.14))",
                              color: candidate.tracked ? "white" : "#078FBF",
                              fontSize: "0.95rem",
                              fontWeight: 800,
                              cursor: "pointer",
                              flexShrink: 0,
                              overflow: "hidden",
                            }}
                          >
                            <span>{avatarText}</span>
                            {candidate.up?.face ? (
                              <img
                                src={candidate.up.face}
                                alt=""
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                              />
                            ) : null}
                          </button>

                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {candidate.displayName}
                              </span>
                              <span style={{ fontSize: "0.6875rem", color: candidate.tracked ? "#078FBF" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                                {candidate.tracked ? "Added" : `TOP ${rank}`}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                              Appears {candidate.noteCount} times in local content{candidate.profile.source_summary ? ` · ${candidate.profile.source_summary}` : ""}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                              Latest: {candidate.latestTitle || "none"}
                            </div>
                            {(smartLabels.length > 0 || candidate.originalGroupNames.length > 0) && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                {smartLabels.slice(0, 3).map((label) => (
                                  <span
                                    key={`frequent-smart-${candidate.upId}-${label}`}
                                    style={{
                                      padding: "3px 8px",
                                      borderRadius: "999px",
                                      background: "rgba(14, 165, 233, 0.10)",
                                      color: "#0284C7",
                                      fontSize: "0.6875rem",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {label}
                                  </span>
                                ))}
                                {candidate.originalGroupNames.slice(0, 2).map((label) => (
                                  <span
                                    key={`frequent-original-${candidate.upId}-${label}`}
                                    style={{
                                      padding: "3px 8px",
                                      borderRadius: "999px",
                                      background: "rgba(251, 114, 153, 0.10)",
                                      color: "#D64078",
                                      fontSize: "0.6875rem",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {label}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "2px" }}>
                              {candidate.tracked ? (
                                <button
                                  type="button"
                                  onClick={() => void toggleManualMonitoredUp(candidate.upId)}
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
                                  Remove
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleAddFrequentUpToManualMonitor(candidate.upId, candidate.displayName)}
                                  style={{
                                    padding: "7px 10px",
                                    borderRadius: "var(--radius-sm)",
                                    border: "1px solid rgba(0, 174, 236, 0.22)",
                                    background: "rgba(0, 174, 236, 0.10)",
                                    color: "#078FBF",
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  One-click add
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <PaginationControls
                    totalCount={filteredFrequentUpCandidates.length}
                    page={safeFrequentUpPage}
                    pageSize={FREQUENT_UP_PAGE_SIZE}
                    itemLabel="creators"
                    onPageChange={setFrequentUpPage}
                    emptyText="No matching creators under the current filter"
                  />
                </>
              ) : (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                  No frequent creators match this smart-group filter; switch back to "All" or re-run smart grouping.
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                Read the follow list and run shared smart grouping once first; then candidates are organized by how often creators appear in local bookmarks, so you can quickly top up pinned creators.
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void handleLoadFollowedUps(false, true)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {followedUpsLoading ? "Reading..." : (followedUpsLoaded ? "Refresh follow list" : "Read follow list first")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleBuildSmartGroups()}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Shared smart grouping
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "var(--bg-hover)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Saved pinned creators</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                This holds only the specific creators you explicitly want to watch long-term; once added, they join daily crawls continuously.
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {manualPoolMembers.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleClearManualMonitoredUps()}
                  style={{
                    padding: "7px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(239, 68, 68, 0.24)",
                    background: "rgba(239, 68, 68, 0.08)",
                    color: "#DC2626",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowFixedUpMonitorSavedList((value) => !value)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {showFixedUpMonitorSavedList ? "Hide list" : "Show list"}
              </button>
            </div>
          </div>

          {manualPoolMembers.length === 0 ? (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
              No pinned creators yet. Expand members from the smart tags / smart groups below, or add them one by one in the detailed filter further down.
            </div>
          ) : showFixedUpMonitorSavedList ? (
            <>
              <PaginationControls
                totalCount={manualPoolMembers.length}
                page={safeFixedUpSavedPage}
                pageSize={fixedUpSavedPageSize}
                itemLabel="creators"
                pageSizeOptions={PAGINATION_SIZE_OPTIONS}
                onPageChange={setFixedUpSavedPage}
                onPageSizeChange={(nextPageSize) => setFixedUpSavedPageSize(nextPageSize === 50 ? 50 : 20)}
                emptyText="No pinned creators yet"
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "12px",
                }}
              >
                {pagedFixedUpSavedMembers.map((entry) => {
                  const up = entry.up;
                  const smartLabels = up ? getUpSmartGroups(up).map((groupValue) => getSmartGroupLabel(groupValue)).filter(Boolean) : [];
                  const originalLabels = up ? getUpOriginalGroupNames(up) : [];
                  return (
                    <div
                      key={`fixed-up-saved-${entry.id}`}
                      style={{
                        padding: "12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid rgba(0, 174, 236, 0.24)",
                        background: "rgba(0, 174, 236, 0.08)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "#078FBF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {up?.uname || entry.id}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                            {up ? "Pinned" : "Not in the current follow list, but config is kept"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void toggleManualMonitoredUp(entry.id)}
                          style={{
                            padding: "6px 8px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--border-light)",
                            background: "var(--bg-card)",
                            color: "var(--text-secondary)",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          Remove
                        </button>
                      </div>
                      {(up?.sign || up?.official_desc) && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {up.sign || up.official_desc}
                        </div>
                      )}
                      {(smartLabels.length > 0 || originalLabels.length > 0) && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {smartLabels.slice(0, 3).map((label) => (
                            <span
                              key={`fixed-smart-${entry.id}-${label}`}
                              style={{
                                padding: "3px 8px",
                                borderRadius: "999px",
                                background: "rgba(14, 165, 233, 0.10)",
                                color: "#0284C7",
                                fontSize: "0.6875rem",
                                fontWeight: 700,
                              }}
                            >
                              {label}
                            </span>
                          ))}
                          {originalLabels.slice(0, 2).map((label) => (
                            <span
                              key={`fixed-original-${entry.id}-${label}`}
                              style={{
                                padding: "3px 8px",
                                borderRadius: "999px",
                                background: "rgba(251, 114, 153, 0.10)",
                                color: "#D64078",
                                fontSize: "0.6875rem",
                                fontWeight: 700,
                              }}
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <PaginationControls
                totalCount={manualPoolMembers.length}
                page={safeFixedUpSavedPage}
                pageSize={fixedUpSavedPageSize}
                itemLabel="creators"
                pageSizeOptions={PAGINATION_SIZE_OPTIONS}
                onPageChange={setFixedUpSavedPage}
                onPageSizeChange={(nextPageSize) => setFixedUpSavedPageSize(nextPageSize === 50 ? 50 : 20)}
                emptyText="No pinned creators yet"
              />
            </>
          ) : null}
        </div>

        <div
          style={{
            padding: "12px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "var(--bg-hover)",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <button
            type="button"
            onClick={() => setShowFixedUpMonitorImportPanel((value) => !value)}
            style={{
              width: "100%",
              padding: 0,
              border: "none",
              background: "transparent",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Quick add from smart tags / smart groups</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                  Mirrors the Xiaohongshu follow-group import logic: expand a group first, then import all unadded creators, or pick them one by one within the group.
                </div>
              </div>
              <span
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
                  whiteSpace: "nowrap",
                }}
              >
                {showFixedUpMonitorImportPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showFixedUpMonitorImportPanel ? "Collapse" : "Expand"}
              </span>
            </div>
          </button>

          {showFixedUpMonitorImportPanel ? (
            fixedUpImportGroups.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                  Click a group to expand its members; each group supports whole-group import or per-member toggling. Pinned creators accumulate across smart groups — switching groups never loses selections. Groups are paginated, 10 per page.
                </div>
                {fixedUpImportGroups.length > FIXED_UP_IMPORT_GROUPS_PAGE_SIZE && (
                  <PaginationControls
                    totalCount={fixedUpImportGroups.length}
                    page={safeFixedUpImportGroupPage}
                    pageSize={FIXED_UP_IMPORT_GROUPS_PAGE_SIZE}
                    itemLabel="groups"
                    onPageChange={setFixedUpImportGroupPage}
                    emptyText="No smart groups available to import"
                  />
                )}
                {pagedFixedUpImportGroups.map((group) => {
                  const groupOpen = expandedFixedUpImportGroup === group.value;
                  const importableCount = group.members.filter((up) => !manualPoolIdSet.has(up.mid)).length;
                  return (
                    <div
                      key={`fixed-group-${group.value}`}
                      style={{
                        padding: "14px",
                        borderRadius: "var(--radius-sm)",
                        border: `1px solid ${group.meta.accent}22`,
                        background: groupOpen ? group.meta.bg : "var(--bg-card)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <div style={{ fontSize: "0.875rem", fontWeight: 800, color: group.meta.accent }}>
                              {group.label}
                            </div>
                            <span
                              style={{
                                padding: "4px 8px",
                                borderRadius: "999px",
                                background: "rgba(255,255,255,0.72)",
                                color: "var(--text-secondary)",
                                fontSize: "0.6875rem",
                                fontWeight: 700,
                              }}
                            >
                              {group.members.length} creators
                            </span>
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                            {group.members.filter((up) => manualPoolIdSet.has(up.mid)).length} already pinned · {importableCount} more can be added
                          </div>
                          {group.sampleTags.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                              {group.sampleTags.slice(0, 5).map((tag) => (
                                <span
                                  key={`fixed-group-tag-${group.value}-${tag}`}
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: "999px",
                                    background: "rgba(255,255,255,0.72)",
                                    color: "var(--text-muted)",
                                    fontSize: "0.6875rem",
                                  }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedFixedUpImportGroup((value) => value === group.value ? "" : group.value);
                              setFixedUpImportSearch("");
                            }}
                            style={{
                              padding: "7px 10px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-card)",
                              color: "var(--text-secondary)",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {groupOpen ? "Collapse members" : "Expand members"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleImportManualMonitorGroup(group.value)}
                            disabled={importableCount === 0}
                            style={{
                              padding: "7px 10px",
                              borderRadius: "var(--radius-sm)",
                              border: "none",
                              background: importableCount === 0 ? "var(--bg-muted)" : `linear-gradient(135deg, ${group.meta.accent}, #10B981)`,
                              color: importableCount === 0 ? "var(--text-muted)" : "white",
                              fontSize: "0.75rem",
                              fontWeight: 800,
                              cursor: importableCount === 0 ? "not-allowed" : "pointer",
                            }}
                          >
                            Add remaining {importableCount}
                          </button>
                        </div>
                      </div>

                      {groupOpen && expandedFixedUpGroupBundle?.value === group.value && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "12px",
                            paddingTop: "12px",
                            borderTop: `1px solid ${group.meta.accent}22`,
                          }}
                        >
                          <input
                            type="text"
                            value={fixedUpImportSearch}
                            onChange={(e) => setFixedUpImportSearch(e.target.value)}
                            placeholder={`Search creator names / bios in ${group.label}`}
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-input)",
                              color: "var(--text-main)",
                              fontSize: "0.875rem",
                            }}
                          />

                          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            <span>{expandedFixedUpGroupBundle.members.length} creators in this group</span>
                            <span>{expandedFixedUpImportMembers.length} search hits</span>
                            <span>{fixedUpImportableCount} more can be added</span>
                            <span>Paginated, {fixedUpImportPageSize} per page</span>
                          </div>

                          {expandedFixedUpImportMembers.length > 0 ? (
                            <>
                              <PaginationControls
                                totalCount={expandedFixedUpImportMembers.length}
                                page={safeFixedUpImportPage}
                                pageSize={fixedUpImportPageSize}
                                itemLabel="creators"
                                pageSizeOptions={PAGINATION_SIZE_OPTIONS}
                                onPageChange={setFixedUpImportPage}
                                onPageSizeChange={(nextPageSize) => setFixedUpImportPageSize(nextPageSize === 50 ? 50 : 20)}
                                emptyText="No matching creators"
                              />
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                  gap: "12px",
                                }}
                              >
                                {pagedFixedUpImportMembers.map((up) => {
                                  const selected = manualPoolIdSet.has(up.mid);
                                  const originalGroupNames = getUpOriginalGroupNames(up);
                                  return (
                                    <div
                                      key={`fixed-up-import-${group.value}-${up.mid}`}
                                      style={{
                                        padding: "12px",
                                        borderRadius: "var(--radius-sm)",
                                        border: "1px solid",
                                        borderColor: selected ? group.meta.accent : "var(--border-light)",
                                        background: selected ? "rgba(255,255,255,0.72)" : "var(--bg-hover)",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "8px",
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start" }}>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: selected ? group.meta.accent : "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {up.uname}
                                          </div>
                                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                                            {selected ? "Pinned" : "Can be pinned"}
                                          </div>
                                        </div>
                                      </div>
                                      {(up.sign || up.official_desc) && (
                                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                          {up.sign || up.official_desc}
                                        </div>
                                      )}
                                      {originalGroupNames.length > 0 && (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                          {originalGroupNames.slice(0, 3).map((label) => (
                                            <span
                                              key={`fixed-up-import-original-${up.mid}-${label}`}
                                              style={{
                                                padding: "3px 8px",
                                                borderRadius: "999px",
                                                background: "rgba(251, 114, 153, 0.10)",
                                                color: "#D64078",
                                                fontSize: "0.6875rem",
                                                fontWeight: 700,
                                              }}
                                            >
                                              {label}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => void toggleManualMonitoredUp(up.mid)}
                                        style={{
                                          marginTop: "auto",
                                          padding: "8px 10px",
                                          borderRadius: "var(--radius-sm)",
                                          border: "1px solid var(--border-light)",
                                          background: selected ? group.meta.bg : "var(--bg-card)",
                                          color: selected ? group.meta.accent : "var(--text-secondary)",
                                          fontSize: "0.75rem",
                                          fontWeight: 700,
                                          cursor: "pointer",
                                        }}
                                      >
                                        {selected ? "Unpin" : "Pin"}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                              <PaginationControls
                                totalCount={expandedFixedUpImportMembers.length}
                                page={safeFixedUpImportPage}
                                pageSize={fixedUpImportPageSize}
                                itemLabel="creators"
                                pageSizeOptions={PAGINATION_SIZE_OPTIONS}
                                onPageChange={setFixedUpImportPage}
                                onPageSizeChange={(nextPageSize) => setFixedUpImportPageSize(nextPageSize === 50 ? 50 : 20)}
                                emptyText="No matching creators"
                              />
                            </>
                          ) : (
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              No creators in this smart group match the current search.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                  Run shared smart grouping once first; then members expand by tag here, making it easy to bulk-import pinned creators.
                </div>
                {!smartGroupsReady && (
                  <button
                    type="button"
                    onClick={() => void handleRefreshSharedCreatorAssignments()}
                    style={{
                      alignSelf: "flex-start",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-card)",
                      color: "var(--text-secondary)",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Generate smart groups first
                  </button>
                )}
              </div>
            )
          ) : null}
        </div>
      </div>
  );

  const renderResultList = (emptyDescription: string) => {
    const fetchStats = dynamicFetchMeta.fetchStats;
    const matchedBeforeKeep = fetchStats?.matched_count_before_keep ?? totalFound;
    const keptCount = fetchStats?.kept_count ?? dynamics.length;
    const keepLimit = fetchStats?.keep_limit ?? dynamicFetchMeta.keepLimit ?? limit;
    const pagesScanned = fetchStats?.pages_scanned ?? 0;
    const scannedAuthorCount = fetchStats?.scanned_author_count ?? dynamicFetchMeta.authorCount ?? 0;
    const fetchDaysBack = dynamicFetchMeta.daysBack ?? daysBack;
    const isDirectLinkResult = dynamicFetchMeta.scope === "links" || fetchStats?.source === "direct-links";
    const directLinkInputCount = fetchStats?.input_count ?? 0;
    const directLinkFailedCount = fetchStats?.failed_count ?? 0;
    const directLinkSkippedCount = fetchStats?.skipped_count ?? 0;

    if (loading) {
      return <LoadingState message={followedDynamicsTask?.stage || "Fetching posts..."} />;
    }

    if (!hasFetchedDynamics) {
      return (
        <EmptyState
          icon={Tv}
          title="No Posts Yet"
          description={
            sessdata
              ? emptyDescription
              : "Click connect cookie in the top right, or preview directly and the system will try to get the cookie automatically"
          }
        />
      );
    }

    if (dynamics.length === 0) {
      return (
        <EmptyState
          icon={Tv}
          title="No Posts Yet"
          description={`${dynamicFetchMeta.label} has no matching posts in the last ${fetchDaysBack} days.`}
        />
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: "var(--bg-card)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-light)",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {isDirectLinkResult ? (
                <>
                  Parsed <strong style={{ color: "var(--text-main)" }}>{directLinkInputCount || matchedBeforeKeep}</strong> links,
                  previewed <strong style={{ color: "var(--text-main)" }}>{keptCount}</strong> successfully,
                  current filter <strong style={{ color: "var(--text-main)" }}>{displayedDynamics.length}</strong>,
                  showing <strong style={{ color: "var(--text-main)" }}>{pagedDisplayedDynamics.length}</strong> on this page,
                  source <strong style={{ color: "var(--text-main)" }}>{dynamicFetchMeta.label}</strong>
                </>
              ) : (
                <>
                  Matched <strong style={{ color: "var(--text-main)" }}>{matchedBeforeKeep}</strong> posts,
                  keeping <strong style={{ color: "var(--text-main)" }}>{keptCount}</strong>,
                  current filter <strong style={{ color: "var(--text-main)" }}>{displayedDynamics.length}</strong>,
                  showing <strong style={{ color: "var(--text-main)" }}>{pagedDisplayedDynamics.length}</strong> on this page,
                  crawl scope <strong style={{ color: "var(--text-main)" }}>{dynamicFetchMeta.label}</strong>
                </>
              )}
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              {isDirectLinkResult ? (
                <>
                  Parsed directly from links — no follow-page scanning.
                  {directLinkFailedCount > 0 ? ` ${directLinkFailedCount} failed.` : " "}
                  {directLinkSkippedCount > 0 ? `Skipped ${directLinkSkippedCount} blank or duplicate lines.` : ""}
                </>
              ) : (
                <>
                  Actually scanned <strong style={{ color: "var(--text-main)" }}>{pagesScanned}</strong> pages
                  {scannedAuthorCount > 0 ? ` / ${scannedAuthorCount} creators` : ""}
                  , matched <strong style={{ color: "var(--text-main)" }}>{matchedBeforeKeep}</strong>,
                  showing only the first <strong style={{ color: "var(--text-main)" }}>{keepLimit}</strong>.
                </>
              )}
            </span>
          </div>
          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            {isDirectLinkResult ? "Parsed from specified links" : `Last ${fetchDaysBack} days`}
          </span>
        </div>

        {displayedDynamics.length === 0 ? (
          <EmptyState
            icon={Filter}
            title={
              dynamicFetchMeta.scope === "links"
                ? "These links produced no previewable content yet"
                : dynamicFetchMeta.scope === "global"
                  ? "No matching pushes in this group"
                  : "No matching posts in the current scope"
            }
            description={
              dynamicFetchMeta.scope === "links"
                ? "Check the link format and cookie login state, or retry with original video / post / opus / article links."
                : dynamicFetchMeta.scope === "global"
                  ? "Try another group, clear the creator selection, or adjust push keywords."
                  : "Widen the day range, switch groups, or clear the creator search and retry."
            }
          />
        ) : (
          <>
            <PaginationControls
              totalCount={displayedDynamics.length}
              page={safeDynamicResultsPage}
              pageSize={DYNAMIC_RESULTS_PAGE_SIZE}
              itemLabel="posts"
              onPageChange={setDynamicResultsPage}
              emptyText="No matching posts"
            />
            <Card
              style={{
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
                    Save one by one, or all in one click
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    Current filter {displayedDynamics.length}, this page {pagedDisplayedDynamics.length}, {displayedSelectedCount} selected for the Intel Library
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={selectAllDisplayedDynamics}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-hover)",
                      color: "var(--text-secondary)",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Select all in current filter
                  </button>
                  <button
                    type="button"
                    onClick={clearDisplayedDynamicsSelection}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-hover)",
                      color: "var(--text-secondary)",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveSelectedDynamics}
                    disabled={vaultCrawling || displayedSelectedCount === 0}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: "none",
                      background: vaultCrawling || displayedSelectedCount === 0
                        ? "var(--bg-muted)"
                        : "linear-gradient(135deg, #00AEEC, #52C41A)",
                      color: "white",
                      fontSize: "0.875rem",
                      fontWeight: 700,
                      cursor: vaultCrawling || displayedSelectedCount === 0 ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <CheckCircle size={16} />
                    {vaultCrawling ? "Saving..." : `Save ${displayedSelectedCount} selected`}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAllDisplayedDynamics}
                    disabled={vaultCrawling || displayedDynamics.length === 0}
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(16, 185, 129, 0.24)",
                      background: vaultCrawling || displayedDynamics.length === 0
                        ? "var(--bg-muted)"
                        : "rgba(16, 185, 129, 0.12)",
                      color: vaultCrawling || displayedDynamics.length === 0 ? "var(--text-muted)" : "#0F9F6E",
                      fontSize: "0.875rem",
                      fontWeight: 800,
                      cursor: vaultCrawling || displayedDynamics.length === 0 ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <FolderHeart size={16} />
                    {vaultCrawling ? "Saving..." : `Save all ${displayedDynamics.length} current results`}
                  </button>
                </div>
              </div>
            </Card>

            {pagedDisplayedDynamics.map((dynamic) => {
              const selected = selectedDynamicIds.has(dynamic.id);
              const sourceUrl = resolveDynamicSourceUrl(dynamic);
              const groupValue = dynamic.author_id ? followedGroupByAuthorId[dynamic.author_id] : "";
              const groupLabel = groupValue ? getSmartGroupLabel(groupValue) : "";
              const groupMeta = groupValue ? resolveSmartGroupMeta(groupValue, groupLabel) : null;

              return (
                <div
                  key={dynamic.id}
                  role="checkbox"
                  aria-checked={selected}
                  tabIndex={0}
                  onClick={() => toggleDynamicSelection(dynamic.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleDynamicSelection(dynamic.id);
                    }
                  }}
                  style={{
                    cursor: "pointer",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <BilibiliDynamicCard
                    dynamic={dynamic}
                    selected={selected}
                    onToggleSelect={toggleDynamicSelection}
                    onOpenSource={() => handleOpenDynamicSource(dynamic)}
                    sourceDisabled={!sourceUrl}
                    primaryAction={{
                      label: "Save now",
                      onClick: () => handleSaveSingleDynamic(dynamic),
                      disabled: vaultCrawling,
                      pending: vaultCrawling,
                      pendingLabel: "Saving...",
                      primary: true,
                      icon: <FolderHeart size={14} />,
                    }}
                    secondaryAction={{
                      label: "Original",
                      onClick: () => handleOpenDynamicSource(dynamic),
                      disabled: !sourceUrl,
                      icon: <ExternalLink size={14} />,
                    }}
                    authorGroupLabel={groupLabel}
                    authorGroupAccent={groupMeta?.accent}
                  />
                </div>
              );
            })}
            <PaginationControls
              totalCount={displayedDynamics.length}
              page={safeDynamicResultsPage}
              pageSize={DYNAMIC_RESULTS_PAGE_SIZE}
              itemLabel="posts"
              onPageChange={setDynamicResultsPage}
              emptyText="No matching posts"
            />
          </>
        )}
      </div>
    );
  };

  return (
    <PageContainer>
      <BilibiliCookieModal
        open={showCookieModal}
        canClose={cookieConfigured || Boolean(sessdata.trim())}
        onClose={() => setShowCookieModal(false)}
        gettingFromBrowser={gettingFromBrowser}
        onFetchFromBrowser={handleGetFromBrowser}
        cookiePreview={cookiePreview}
        cookieInput={cookieInput}
        showFullCookie={showFullCookie}
        onToggleFullCookie={() => setShowFullCookie((visible) => !visible)}
      />
      <PageHeader
        title="Bilibili Tools"
        subtitle="One-click cookie connect; preview posts by full follow feed, smart group, or specific creator, then choose what to save"
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
        <div style={{ display: "flex", flexDirection: "column", gap: "24px", height: "100%" }}>
          {renderTabs()}

          {/* Top controls */}
          {panelTab === "dynamics" && <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {renderTargetedDynamicCrawlWorkbench()}

            <Card title="Full Follow-Feed Post Tracking" icon={<Hash size={18} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  This handles temporary searches and previews of the full follow feed. One word matches both body keywords and post tags, so there is no longer a split into two inputs.
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: "16px",
                    alignItems: "start",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>Words / tags</div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (isActionEnterKey(e)) {
                            e.preventDefault();
                            handleAddKeyword();
                          }
                        }}
                        placeholder="Enter keywords, tags, or topic words — one input handles all"
                        style={{
                          flex: 1,
                          padding: "10px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-input)",
                          color: "var(--text-main)",
                          fontSize: "0.875rem",
                        }}
                      />
                      <button
                        onClick={handleAddKeyword}
                        disabled={parseStringListInput(keywordInput).length === 0}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "var(--radius-sm)",
                          border: "none",
                          background: "var(--color-secondary)",
                          color: "white",
                          cursor: parseStringListInput(keywordInput).length > 0 ? "pointer" : "not-allowed",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {PRESET_KEYWORDS.map((kw) => (
                        <button
                          key={kw}
                          onClick={() => handleAddPresetKeyword(kw)}
                          disabled={dynamicSearchTerms.includes(kw)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: "9999px",
                            border: "1px solid var(--border-light)",
                            background: dynamicSearchTerms.includes(kw) ? "var(--bg-muted)" : "var(--bg-hover)",
                            color: dynamicSearchTerms.includes(kw) ? "var(--text-muted)" : "var(--text-secondary)",
                            fontSize: "0.75rem",
                            cursor: dynamicSearchTerms.includes(kw) ? "not-allowed" : "pointer",
                          }}
                        >
                          + {kw}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>Post types</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {Object.entries(DYNAMIC_TYPE_MAP).map(([type, config]) => {
                        const Icon = config.icon;
                        const selected = selectedTypes.includes(type);
                        return (
                          <button
                            key={type}
                            onClick={() => toggleType(type)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "8px 14px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid",
                              borderColor: selected ? config.color : "var(--border-light)",
                              background: selected ? `${config.color}15` : "var(--bg-hover)",
                              color: selected ? config.color : "var(--text-secondary)",
                              fontSize: "0.8125rem",
                              fontWeight: 500,
                              cursor: "pointer",
                            }}
                          >
                            <Icon size={14} />
                            {config.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {dynamicSearchTerms.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {dynamicSearchTerms.map((kw) => (
                      <span
                        key={kw}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "4px 10px",
                          borderRadius: "9999px",
                          background: "rgba(188, 164, 227, 0.15)",
                          color: "var(--color-primary)",
                          fontSize: "0.8125rem",
                          fontWeight: 500,
                        }}
                      >
                        {kw}
                        <button
                          onClick={() => handleRemoveKeyword(kw)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "2px",
                            borderRadius: "50%",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: "inherit",
                          }}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-hover)",
                      color: "var(--text-muted)",
                      fontSize: "0.75rem",
                      lineHeight: 1.6,
                    }}
                  >
                    Leave it empty to browse the follow-feed overview directly; if you have a clear topic today, adding keywords or tags keeps it cleaner.
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => setShowSuggestedSmartGroupTags((value) => !value)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-hover)",
                      color: "var(--text-main)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <div style={{ fontSize: "0.8125rem", fontWeight: 700 }}>Frequent tags from smart groups</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                        Collapsed by smart group; open a group to expand its tags.
                      </div>
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "var(--text-muted)", flexShrink: 0 }}>
                      <span style={{ fontSize: "0.75rem" }}>{showSuggestedSmartGroupTags ? "Collapse" : "Expand"}</span>
                      {showSuggestedSmartGroupTags ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </div>
                  </button>
                  {showSuggestedSmartGroupTags ? (
                    suggestedSmartGroupTags.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          These frequent tags are filed by smart group first, then added to the unified word pool above — no longer flattened by raw tag.
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                            gap: "10px",
                          }}
                        >
                          {suggestedSmartGroupTags.map((group) => {
                            const groupExpanded = expandedSuggestedSmartGroupTagGroups.has(group.value);
                            return (
                              <div
                                key={`dynamics-smart-tag-group-${group.value}`}
                                style={{
                                  padding: "12px",
                                  borderRadius: "var(--radius-sm)",
                                  border: `1px solid ${group.meta.accent}22`,
                                  background: group.meta.bg,
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "8px",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedSuggestedSmartGroupTagGroups((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(group.value)) {
                                        next.delete(group.value);
                                      } else {
                                        next.add(group.value);
                                      }
                                      return next;
                                    });
                                  }}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: "10px",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    width: "100%",
                                    padding: 0,
                                    border: "none",
                                    background: "transparent",
                                    cursor: "pointer",
                                    textAlign: "left",
                                  }}
                                >
                                  <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: group.meta.accent }}>
                                    {group.label}
                                  </div>
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "var(--text-muted)" }}>
                                    <span style={{ fontSize: "0.6875rem" }}>
                                      {group.tags.length} tags
                                    </span>
                                    {groupExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  </div>
                                </button>
                                {groupExpanded ? (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                    {group.tags.map((item) => (
                                      <button
                                        key={`dynamics-smart-tag-${group.value}-${item.signal}`}
                                        type="button"
                                        onClick={() => handleAddSuggestedTagFilter(item.signal)}
                                        disabled={dynamicSearchTerms.some((tag) => tag.toLowerCase() === item.signal.toLowerCase())}
                                        style={{
                                          padding: "6px 10px",
                                          borderRadius: "999px",
                                          border: "1px solid var(--border-light)",
                                          background: dynamicSearchTerms.some((tag) => tag.toLowerCase() === item.signal.toLowerCase()) ? "var(--bg-muted)" : "rgba(255, 255, 255, 0.72)",
                                          color: dynamicSearchTerms.some((tag) => tag.toLowerCase() === item.signal.toLowerCase()) ? "var(--text-muted)" : group.meta.accent,
                                          fontSize: "0.75rem",
                                          fontWeight: 700,
                                          cursor: dynamicSearchTerms.some((tag) => tag.toLowerCase() === item.signal.toLowerCase()) ? "not-allowed" : "pointer",
                                        }}
                                      >
                                        + {item.signal} {item.count > 0 ? `· ${item.count}` : ""}
                                      </button>
                                    ))}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                                    Click to expand this smart group and see its frequent tags.
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                        No reusable smart-group tags yet. Run "shared smart grouping" once and frequent tags appear here by group; otherwise just type words in the unified input above.
                      </div>
                    )
                  ) : null}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "16px",
                    paddingTop: "16px",
                    borderTop: "1px solid var(--border-light)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>Time range</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {TIME_RANGE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setDaysBack(opt.value);
                            setDaysBackInput(String(opt.value));
                          }}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid",
                            borderColor: daysBack === opt.value ? "var(--color-primary)" : "var(--border-light)",
                            background: daysBack === opt.value ? "rgba(188, 164, 227, 0.15)" : "var(--bg-hover)",
                            color: daysBack === opt.value ? "var(--color-primary)" : "var(--text-secondary)",
                            fontSize: "0.8125rem",
                            fontWeight: daysBack === opt.value ? 600 : 400,
                            cursor: "pointer",
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Custom days</span>
                      <input
                        type="number"
                        min={1}
                        value={daysBackInput}
                        onChange={(e) => setDaysBackInput(e.target.value)}
                        onBlur={() => normalizePositiveInput(daysBackInput, daysBack, setDaysBack, setDaysBackInput)}
                        style={{
                          width: "110px",
                          padding: "8px 10px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-input)",
                          color: "var(--text-main)",
                          fontSize: "0.8125rem",
                        }}
                      />
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>days</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>Count limit</div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {LIMIT_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => {
                            setLimit(opt);
                            setLimitInput(String(opt));
                          }}
                          style={{
                            minWidth: "88px",
                            padding: "10px 14px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid",
                            borderColor: limit === opt ? "var(--color-primary)" : "var(--border-light)",
                            background: limit === opt ? "rgba(188, 164, 227, 0.15)" : "var(--bg-hover)",
                            color: limit === opt ? "var(--color-primary)" : "var(--text-secondary)",
                            fontSize: "0.8125rem",
                            fontWeight: limit === opt ? 600 : 400,
                            cursor: "pointer",
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Keep after filtering</span>
                      <input
                        type="number"
                        min={1}
                        max={MAX_DYNAMIC_KEEP_LIMIT}
                        value={limitInput}
                        onChange={(e) => setLimitInput(e.target.value)}
                        onBlur={() => normalizePositiveInput(limitInput, limit, setLimit, setLimitInput, MAX_DYNAMIC_KEEP_LIMIT)}
                        placeholder={`1-${MAX_DYNAMIC_KEEP_LIMIT}`}
                        style={{
                          width: "110px",
                          padding: "8px 10px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-input)",
                          color: "var(--text-main)",
                          fontSize: "0.8125rem",
                        }}
                      />
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>items</span>
                    </div>
                    <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                      This only limits what is finally shown and kept before saving; group crawls split the internal scan budget evenly across creators.
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Fetch Button */}
            <button
              onClick={handleFetch}
              disabled={loading}
              style={{
                padding: "14px 24px",
                borderRadius: "var(--radius-md)",
                border: "none",
                background: loading ? "var(--bg-muted)" : "linear-gradient(135deg, #00AEEC, #FB7299)",
                color: "white",
                fontSize: "0.9375rem",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                boxShadow: "0 4px 16px rgba(0, 174, 236, 0.25)",
              }}
            >
              {loading ? (
                <>
                  <div
                    style={{
                      width: "18px",
                      height: "18px",
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "white",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                    }}
                  />
                  Fetching...
                </>
              ) : (
                <>
                  <Search size={18} />
                  Preview current words / tags
                </>
              )}
            </button>

            {vaultResult && (
              <Card title="Save Results" icon={<CheckCircle size={18} />}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.8125rem" }}>
                  <div style={{ color: "var(--text-secondary)", wordBreak: "break-all" }}>
                    Output directory: {vaultResult.output_dir}
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>
                    {vaultResult.dynamic_count} posts
                  </div>
                  <div style={{ color: "var(--color-success)", fontWeight: 600 }}>
                    Wrote {vaultResult.written_count} Markdown files
                  </div>
                </div>
              </Card>
            )}

            {/* Diagnostic Button */}
            <button
              onClick={handleDebugTest}
              disabled={debugLoading || !sessdata.trim()}
              style={{
                padding: "12px 20px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-secondary)",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: debugLoading || !sessdata.trim() ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              {debugLoading ? (
                <>
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      border: "2px solid var(--text-muted)",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                    }}
                  />
                  Diagnosing...
                </>
              ) : (
                <>
                  <AlertCircle size={16} />
                  Run diagnostics
                </>
              )}
            </button>

            {/* Debug Results */}
            {debugResult && (
              <Card title="Diagnostic Results" icon={<AlertCircle size={18} />}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    SESSDATA: {debugResult.sessdata_preview}
                  </div>
                  {Object.entries(debugResult.tests).map(([name, test]) => (
                    <div
                      key={name}
                      style={{
                        padding: "12px",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--bg-hover)",
                        fontSize: "0.8125rem",
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "var(--text-main)", marginBottom: "4px" }}>
                        {name === "video_only" && "Video only (type_list=8)"}
                        {name === "all_types" && "All types (type_list=268435455)"}
                        {name === "no_params" && "No params"}
                      </div>
                      {test.error ? (
                        <div style={{ color: "var(--color-error)" }}>Error: {test.error}</div>
                      ) : (
                        <div style={{ color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span>Status code: {test.status_code}</span>
                          <span>Return code: {test.code}</span>
                          <span>Message: {test.message}</span>
                          <span style={{ fontWeight: 600, color: test.cards_count && test.cards_count > 0 ? "var(--color-success)" : "var(--text-muted)" }}>
                            Card count: {test.cards_count}
                          </span>
                          {test.first_card_types && test.first_card_types.length > 0 && (
                            <span>First 5 card types: {test.first_card_types.join(", ")}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <div
                    style={{
                      padding: "12px",
                      borderRadius: "var(--radius-sm)",
                      background: "rgba(255, 193, 7, 0.1)",
                      border: "1px solid rgba(255, 193, 7, 0.3)",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#FFB800", marginBottom: "8px", fontSize: "0.8125rem" }}>
                      Possible causes:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      {debugResult.suggestions.slice(1).map((s, i) => (
                        <li key={i} style={{ marginBottom: "4px" }}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Card>
            )}
          </div>}

          {/* Bottom content - Results */}
          {panelTab === "favorites" && (
            <div style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>
              <BilibiliFavoritesPage embedded />
            </div>
          )}

          {panelTab === "following" && (
            <div style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <Card
                  title="Persistent Follow-Feed Keyword Monitors"
                  icon={<Hash size={18} />}
                  actions={(
                    <span
                      style={{
                        padding: "5px 10px",
                        borderRadius: "999px",
                        background: "rgba(0, 174, 236, 0.1)",
                        color: "#078FBF",
                        fontSize: "0.75rem",
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Enabled {activeDailyDynamicMonitors.length}
                    </span>
                  )}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                      Only persistent monitors live here now. Create an empty one — it accepts both keywords and tags; after creating you can enable, disable, or delete each individually. Temporary manual searches happen in "Post tracking" above.
                    </div>

                    <div
                      style={{
                        padding: "16px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid rgba(14, 165, 233, 0.16)",
                        background: "linear-gradient(135deg, rgba(14, 165, 233, 0.08), rgba(16, 185, 129, 0.06))",
                        display: "flex",
                        flexDirection: "column",
                        gap: "14px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>Persistent keyword monitors</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.7, maxWidth: "760px" }}>
                            Each monitor toggles and crawls independently, and saves into its own folder. Tag conditions and keywords are peer-level match rules — no need to maintain two sets.
                          </div>
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {dailyDynamicMonitors.length} configured, {activeDailyDynamicMonitors.length} enabled
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) minmax(116px, 140px) minmax(116px, 140px) auto",
                          gap: "10px",
                          alignItems: "end",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700 }}>Words / tags</div>
                          <input
                            type="text"
                            value={dailyMonitorTermInput}
                            onChange={(e) => setDailyMonitorTermInput(e.target.value)}
                            placeholder="Enter a monitor word (keyword or tag); comma-separated supported"
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-card)",
                              color: "var(--text-main)",
                              fontSize: "0.8125rem",
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700 }}>Day range</div>
                          <input
                            type="number"
                            min={1}
                            value={dailyMonitorDaysBackInput}
                            onChange={(e) => setDailyMonitorDaysBackInput(e.target.value)}
                            onBlur={() => setDailyMonitorDaysBackInput(String(clampPositiveInt(dailyMonitorDaysBackInput, 7, 365)))}
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-card)",
                              color: "var(--text-main)",
                              fontSize: "0.8125rem",
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 700 }}>Item limit</div>
                          <input
                            type="number"
                            min={1}
                            max={MAX_DYNAMIC_KEEP_LIMIT}
                            value={dailyMonitorLimitInput}
                            onChange={(e) => setDailyMonitorLimitInput(e.target.value)}
                            onBlur={() => setDailyMonitorLimitInput(String(clampPositiveInt(dailyMonitorLimitInput, 50, MAX_DYNAMIC_KEEP_LIMIT)))}
                            style={{
                              width: "100%",
                              padding: "10px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-card)",
                              color: "var(--text-main)",
                              fontSize: "0.8125rem",
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleAddDailyDynamicMonitor()}
                          disabled={parseStringListInput(dailyMonitorTermInput).length === 0}
                          style={{
                            padding: "10px 14px",
                            borderRadius: "var(--radius-sm)",
                            border: "none",
                            background: parseStringListInput(dailyMonitorTermInput).length > 0 ? "linear-gradient(135deg, #10B981, #00AEEC)" : "var(--bg-muted)",
                            color: parseStringListInput(dailyMonitorTermInput).length > 0 ? "white" : "var(--text-muted)",
                            cursor: parseStringListInput(dailyMonitorTermInput).length > 0 ? "pointer" : "not-allowed",
                            fontWeight: 800,
                          }}
                        >
                          Create
                        </button>
                      </div>

                      {dailyDynamicMonitors.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {dailyDynamicMonitors.map((monitor) => {
                            const monitorTerms = getDailyMonitorTerms(monitor);
                            return (
                              <div
                                key={monitor.id}
                                style={{
                                  padding: "14px",
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid var(--border-light)",
                                  background: "var(--bg-card)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "12px",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
                                  <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                      <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>{monitor.label}</div>
                                      <span
                                        style={{
                                          padding: "4px 8px",
                                          borderRadius: "999px",
                                          background: monitor.enabled ? "rgba(16, 185, 129, 0.12)" : "var(--bg-muted)",
                                          color: monitor.enabled ? "#0F9F6E" : "var(--text-muted)",
                                          fontSize: "0.6875rem",
                                          fontWeight: 800,
                                        }}
                                      >
                                        {monitor.enabled ? "On" : "Off"}
                                      </span>
                                      <span
                                        style={{
                                          padding: "4px 8px",
                                          borderRadius: "999px",
                                          background: "rgba(14, 165, 233, 0.12)",
                                          color: "#0284C7",
                                          fontSize: "0.6875rem",
                                          fontWeight: 800,
                                        }}
                                      >
                                        Last {monitor.days_back} days
                                      </span>
                                      <span
                                        style={{
                                          padding: "4px 8px",
                                          borderRadius: "999px",
                                          background: "rgba(16, 185, 129, 0.12)",
                                          color: "#0F9F6E",
                                          fontSize: "0.6875rem",
                                          fontWeight: 800,
                                        }}
                                      >
                                        Limit {monitor.limit}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                                      Save folder: {buildDailyMonitorSubfolder(monitor.label)}
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Day range</span>
                                      <input
                                        key={`${monitor.id}-${monitor.days_back}`}
                                        type="number"
                                        min={1}
                                        defaultValue={monitor.days_back}
                                        onBlur={(e) => void handleUpdateDailyMonitorDaysBack(monitor.id, e.currentTarget.value)}
                                        onKeyDown={(e) => {
                                          if (isActionEnterKey(e)) {
                                            e.preventDefault();
                                            e.currentTarget.blur();
                                          }
                                        }}
                                        style={{
                                          width: "84px",
                                          padding: "6px 8px",
                                          borderRadius: "var(--radius-sm)",
                                          border: "1px solid var(--border-light)",
                                          background: "var(--bg-card)",
                                          color: "var(--text-main)",
                                          fontSize: "0.75rem",
                                        }}
                                      />
                                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>days of posts</span>
                                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Item limit</span>
                                      <input
                                        key={`${monitor.id}-${monitor.limit}`}
                                        type="number"
                                        min={1}
                                        max={MAX_DYNAMIC_KEEP_LIMIT}
                                        defaultValue={monitor.limit}
                                        onBlur={(e) => void handleUpdateDailyMonitorLimit(monitor.id, e.currentTarget.value)}
                                        onKeyDown={(e) => {
                                          if (isActionEnterKey(e)) {
                                            e.preventDefault();
                                            e.currentTarget.blur();
                                          }
                                        }}
                                        style={{
                                          width: "84px",
                                          padding: "6px 8px",
                                          borderRadius: "var(--radius-sm)",
                                          border: "1px solid var(--border-light)",
                                          background: "var(--bg-card)",
                                          color: "var(--text-main)",
                                          fontSize: "0.75rem",
                                        }}
                                      />
                                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>items</span>
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleDailyDynamicMonitor(monitor.id)}
                                      style={{
                                        padding: "8px 12px",
                                        borderRadius: "var(--radius-sm)",
                                        border: "1px solid var(--border-light)",
                                        background: "var(--bg-card)",
                                        color: "var(--text-secondary)",
                                        fontSize: "0.75rem",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                      }}
                                    >
                                      {monitor.enabled ? "Disable" : "Enable"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handlePreviewDailyMonitor(monitor)}
                                      disabled={loading}
                                      style={{
                                        padding: "8px 12px",
                                        borderRadius: "var(--radius-sm)",
                                        border: "none",
                                        background: loading ? "var(--bg-muted)" : "linear-gradient(135deg, #00AEEC, #10B981)",
                                        color: loading ? "var(--text-muted)" : "white",
                                        fontSize: "0.75rem",
                                        fontWeight: 800,
                                        cursor: loading ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      Crawl now
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveDailyDynamicMonitor(monitor.id)}
                                      style={{
                                        padding: "8px 12px",
                                        borderRadius: "var(--radius-sm)",
                                        border: "1px solid rgba(239, 68, 68, 0.24)",
                                        background: "rgba(239, 68, 68, 0.08)",
                                        color: "#DC2626",
                                        fontSize: "0.75rem",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                      }}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>

                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                  {monitorTerms.map((term) => (
                                    <span
                                      key={`${monitor.id}-term-${term}`}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "4px",
                                        padding: "4px 9px",
                                        borderRadius: "999px",
                                        background: "rgba(16, 185, 129, 0.12)",
                                        color: "#0F9F6E",
                                        fontSize: "0.75rem",
                                        fontWeight: 700,
                                      }}
                                    >
                                      {term}
                                      <button
                                        type="button"
                                        onClick={() => void handleRemoveMonitorTerm(monitor.id, term)}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          padding: 0,
                                          border: "none",
                                          background: "transparent",
                                          color: "inherit",
                                          cursor: "pointer",
                                        }}
                                      >
                                        <X size={12} />
                                      </button>
                                    </span>
                                  ))}
                                  {monitorTerms.length === 0 && (
                                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>This monitor has no match conditions yet</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                          No daily monitors yet. Try a round of keywords / tags above first, then solidify your usual combinations into these daily auto-running monitors.
                        </div>
                      )}
                    </div>

                  </div>
                </Card>

                {renderDailyGroupMonitorWorkbench()}

                <Card
                  title="Followed Creators' Latest Posts -> Intel Feed"
                  icon={<Users size={18} />}
                  actions={(
                    <span
                      style={{
                        padding: "5px 10px",
                        borderRadius: "999px",
                        background: "rgba(16, 185, 129, 0.12)",
                        color: "#0F9F6E",
                        fontSize: "0.75rem",
                        fontWeight: 800,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Current scope {trackedUpMembers.length}
                    </span>
                  )}
                >
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                        "Smart Group Tracking" above only views group sources and maintains the pinned list; this section doesn't change monitor config — it just shows the current scope, triggers today's crawl, and sends results into the intel Feed.
                      </div>

                      <div
                        style={{
                          padding: "14px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid rgba(0, 174, 236, 0.18)",
                          background: "rgba(0, 174, 236, 0.06)",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "14px",
                          alignItems: "flex-end",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Follow monitor time range</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                            Pinned creators default to 3 days, freely adjustable; creators are crawled in parallel and scanning continues to this date boundary before stopping.
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Day range</span>
                          <input
                            key={`fixed-up-days-back-${trackerConfig.fixed_up_days_back ?? FIXED_UP_MONITOR_DEFAULT_DAYS_BACK}`}
                            type="number"
                            min={1}
                            max={365}
                            defaultValue={trackerConfig.fixed_up_days_back ?? FIXED_UP_MONITOR_DEFAULT_DAYS_BACK}
                            onBlur={(e) => void handleUpdateFixedUpMonitorDaysBack(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (isActionEnterKey(e)) {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                            }}
                            style={{
                              width: "92px",
                              padding: "8px 10px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-card)",
                              color: "var(--text-main)",
                              fontSize: "0.8125rem",
                            }}
                          />
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>days of posts</span>
                        </div>
                      </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                        gap: "12px",
                      }}
                    >
                      <div
                        style={{
                          padding: "14px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid rgba(16, 185, 129, 0.24)",
                          background: "rgba(16, 185, 129, 0.08)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>{followStatusTitle}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>{followStatusStage}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Current page</div>
                            <div style={{ fontSize: "1rem", fontWeight: 800, color: "var(--text-main)" }}>{followStatusPage || "-"}</div>
                          </div>
                        </div>
                        <div style={{ width: "100%", height: "8px", borderRadius: "999px", background: "rgba(0, 0, 0, 0.08)", overflow: "hidden" }}>
                          <div style={{ width: `${followStatusProgress}%`, height: "100%", background: "linear-gradient(90deg, #10B981, #00AEEC)" }} />
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          <span>Fetched {followStatusCount} follows</span>
                          {followedUpsTask?.updated_at && <span>Last updated {new Date(followedUpsTask.updated_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "14px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid rgba(236, 72, 153, 0.24)",
                          background: "rgba(236, 72, 153, 0.08)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>{smartGroupStatusTitle}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>{smartGroupStatusStage}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{smartGroupMetricLabel}</div>
                            <div style={{ fontSize: "1rem", fontWeight: 800, color: "var(--text-main)" }}>
                              {smartGroupMetricValue}
                            </div>
                          </div>
                        </div>
                        <div style={{ width: "100%", height: "8px", borderRadius: "999px", background: "rgba(0, 0, 0, 0.08)", overflow: "hidden" }}>
                          <div style={{ width: `${smartGroupStatusProgress}%`, height: "100%", background: "linear-gradient(90deg, #FB7299, #8B5CF6)" }} />
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {smartGroupStatusDetails.map((detail) => (
                            <span key={detail}>{detail}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                        gap: "10px",
                      }}
                    >
                      {[
                        { label: "Feed groups", value: monitorCategoryCount, detail: "Will enter the intel feed" },
                        { label: "Creators covered", value: trackedUpIds.size, detail: "Being monitored" },
                        { label: "Monitored groups", value: selectedTrackedSmartGroups.length, detail: "Auto-grouped output" },
                        { label: "Pinned", value: manualPoolMembers.length, detail: "Manually pinned" },
                      ].map((metric) => (
                        <div
                          key={metric.label}
                          style={{
                            padding: "12px 14px",
                            borderRadius: "var(--radius-sm)",
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border-light)",
                          }}
                        >
                          <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--text-main)" }}>{metric.value}</div>
                          <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>{metric.label}</div>
                          <div style={{ marginTop: "2px", fontSize: "0.6875rem", color: "var(--text-muted)" }}>{metric.detail}</div>
                        </div>
                      ))}
                    </div>

                  </div>
                </Card>
              </div>

              <ExpandableSection
                title="Intel Feed Group Details"
                summary="This shows how things will finally appear in the intel Feed. Groups stay at the top level; specific authors and sample tags show after expanding."
                badge={monitorCategoryCount > 0 ? `${monitorCategoryCount} groups` : "Not configured"}
                accent="#10B981"
                icon={<Filter size={16} />}
                open={showFeedBreakdown}
                onToggle={() => setShowFeedBreakdown((value) => !value)}
              >
                {monitorCategoryCount > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    {selectedTrackedSmartGroups.map((group) => (
                      <div
                        key={group.value}
                        style={{
                          padding: "14px",
                          borderRadius: "var(--radius-sm)",
                          border: `1px solid ${group.meta.accent}33`,
                          background: group.meta.bg,
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: group.meta.accent }}>
                            {group.label}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                            {group.members.length} creators · pinned creators matching this smart group form their own Feed group
                          </div>
                        </div>
                        {group.sampleAuthors.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {group.sampleAuthors.map((author) => (
                              <span
                                key={author}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: "999px",
                                  background: "rgba(255,255,255,0.72)",
                                  color: "var(--text-main)",
                                  fontSize: "0.6875rem",
                                  fontWeight: 700,
                                }}
                              >
                                {author}
                              </span>
                            ))}
                          </div>
                        )}
                        {group.sampleTags.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {group.sampleTags.slice(0, 4).map((tag) => (
                              <span
                                key={tag}
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: "999px",
                                  background: "var(--bg-card)",
                                  color: "var(--text-muted)",
                                  fontSize: "0.6875rem",
                                }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {manualPoolMembers.length > 0 && (
                      <div
                        style={{
                          padding: "14px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid rgba(0, 174, 236, 0.28)",
                          background: "rgba(0, 174, 236, 0.08)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "#078FBF" }}>Pinned creators</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                            {manualPoolMembers.length} creators · manually pinned for long-term monitoring
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {manualPoolMembers.slice(0, 8).map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => void toggleManualMonitoredUp(entry.id)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-card)",
                                color: "var(--text-secondary)",
                                fontSize: "0.6875rem",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              <span>{entry.up?.uname || entry.id}</span>
                              <span style={{ color: "var(--text-muted)" }}>Remove</span>
                            </button>
                          ))}
                        </div>
                        {manualPoolMembers.length > 8 && (
                          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            The remaining {manualPoolMembers.length - 8} creators are also output as pinned.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                    No pinned scope yet. Add a few creators in the pinned creators section above and Feed groups split out by matched smart group here.
                  </div>
                )}
              </ExpandableSection>

              <ExpandableSection
                title="Creator and Group Filtering"
                summary="Default groups and smart groups narrow the follow list first, then decide which creators get pinned. Details remain below, collapsed by default."
                badge={followedUps.length > 0 ? `${filteredFollowedUps.length} results` : "Not loaded"}
                accent="#00AEEC"
                icon={<Users size={16} />}
                open={showFollowedCatalog}
                onToggle={() => setShowFollowedCatalog((value) => !value)}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "10px" }}>
                    <input
                      type="text"
                      value={followedUpSearch}
                      onChange={(e) => setFollowedUpSearch(e.target.value)}
                      placeholder="Search followed creators' names, bios"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-input)",
                        color: "var(--text-main)",
                        fontSize: "0.875rem",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleLoadFollowedUps(false, true)}
                      disabled={followedUpsLoading}
                      style={{
                        padding: "0 14px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-card)",
                        color: followedUpsLoading ? "var(--text-muted)" : "var(--text-secondary)",
                        fontSize: "0.8125rem",
                        fontWeight: 700,
                        cursor: followedUpsLoading ? "not-allowed" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {followedUpsLoading ? "Refreshing..." : "Refresh follows"}
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-hover)",
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setShowOriginalGroupFilter((value) => !value)}
                        style={{
                          width: "100%",
                          padding: "12px 14px",
                          border: "none",
                          background: "transparent",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "12px",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Default group filter</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            Current: {selectedOriginalGroupLabel}
                          </div>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "var(--text-muted)", flexShrink: 0 }}>
                          <span style={{ fontSize: "0.75rem" }}>{showOriginalGroupFilter ? "Collapse" : "Expand"}</span>
                          {showOriginalGroupFilter ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </button>
                      {showOriginalGroupFilter && (
                        <div style={{ padding: "0 14px 14px", display: "flex", flexWrap: "wrap", gap: "8px", borderTop: "1px solid var(--border-light)" }}>
                          <button
                            type="button"
                            onClick={() => setSelectedOriginalGroup("all")}
                            style={{
                              marginTop: "12px",
                              padding: "8px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid",
                              borderColor: selectedOriginalGroup === "all" ? "#00AEEC" : "var(--border-light)",
                              background: selectedOriginalGroup === "all" ? "rgba(0, 174, 236, 0.12)" : "var(--bg-card)",
                              color: selectedOriginalGroup === "all" ? "#078FBF" : "var(--text-secondary)",
                              fontSize: "0.8125rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            All default groups · {followedUps.length}
                          </button>
                          {originalGroups.map((group) => {
                            const active = selectedOriginalGroup === group.tag_id;
                            return (
                              <button
                                key={group.tag_id}
                                type="button"
                                onClick={() => setSelectedOriginalGroup(group.tag_id)}
                                title={group.tip || group.name}
                                style={{
                                  marginTop: "12px",
                                  padding: "8px 12px",
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid",
                                  borderColor: active ? "#FB7299" : "var(--border-light)",
                                  background: active ? "rgba(251, 114, 153, 0.12)" : "var(--bg-card)",
                                  color: active ? "#D64078" : "var(--text-secondary)",
                                  fontSize: "0.8125rem",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                {group.name} {originalGroupCounts[group.tag_id] ? `· ${originalGroupCounts[group.tag_id]}` : ""}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-hover)",
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setShowSmartGroupFilter((value) => !value)}
                        style={{
                          width: "100%",
                          padding: "12px 14px",
                          border: "none",
                          background: "transparent",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "12px",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Smart group filter</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            Current: {selectedSmartGroupLabel}
                          </div>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "var(--text-muted)", flexShrink: 0 }}>
                          <span style={{ fontSize: "0.75rem" }}>{showSmartGroupFilter ? "Collapse" : "Expand"}</span>
                          {showSmartGroupFilter ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </button>
                      {showSmartGroupFilter && (
                        <div style={{ padding: "0 14px 14px", display: "flex", flexWrap: "wrap", gap: "8px", borderTop: "1px solid var(--border-light)" }}>
                          {!smartGroupsReady ? (
                            <div style={{ paddingTop: "12px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                              Click "Shared smart grouping" above to maintain the shared tag library and author groups, then come back to pick a smart group.
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedFollowedGroup("all")}
                                style={{
                                  marginTop: "12px",
                                  padding: "8px 12px",
                                  borderRadius: "var(--radius-sm)",
                                  border: "1px solid",
                                  borderColor: selectedFollowedGroup === "all" ? "#00AEEC" : "var(--border-light)",
                                  background: selectedFollowedGroup === "all" ? "rgba(0, 174, 236, 0.12)" : "var(--bg-card)",
                                  color: selectedFollowedGroup === "all" ? "#078FBF" : "var(--text-secondary)",
                                  fontSize: "0.8125rem",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                All smart groups · {followedUps.length}
                              </button>
                              {smartGroupOptions.map((group) => {
                                const active = selectedFollowedGroup === group.value;
                                const meta = resolveSmartGroupMeta(group.value, group.label);
                                return (
                                  <button
                                    key={group.value}
                                    type="button"
                                    onClick={() => setSelectedFollowedGroup(group.value)}
                                    style={{
                                      marginTop: "12px",
                                      padding: "8px 12px",
                                      borderRadius: "var(--radius-sm)",
                                      border: "1px solid",
                                      borderColor: active ? meta.accent : "var(--border-light)",
                                      background: active ? meta.bg : "var(--bg-card)",
                                      color: active ? meta.accent : "var(--text-secondary)",
                                      fontSize: "0.8125rem",
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {group.label} {groupCounts[group.value] ? `· ${groupCounts[group.value]}` : ""}
                                  </button>
                                );
                              })}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "10px",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-hover)",
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                      <span>Following {followedUps.length} creators</span>
                      <span>Default filter: {selectedOriginalGroupLabel}</span>
                      <span>Smart filter: {selectedSmartGroupLabel}</span>
                      <span>{filteredFollowedUps.length} current results</span>
                      <span>{activeFollowedFilterCount} filters active</span>
                    </div>
                    {activeFollowedFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={resetFollowedUpFilters}
                        style={{
                          padding: "7px 10px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-card)",
                          color: "var(--text-secondary)",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                      padding: "12px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-card)",
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>Filter results</div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                          The result list can be expanded or hidden independently; refresh here to re-read follows. Card footers still support pinning specific creators.
                          </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => void handleLoadFollowedUps(false, true)}
                          disabled={followedUpsLoading}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--border-light)",
                            background: "var(--bg-hover)",
                            color: followedUpsLoading ? "var(--text-muted)" : "var(--text-secondary)",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: followedUpsLoading ? "not-allowed" : "pointer",
                          }}
                        >
                          {followedUpsLoading ? "Refreshing..." : "Refresh results"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowFollowedResultCards((value) => !value)}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--border-light)",
                            background: "var(--bg-hover)",
                            color: "var(--text-secondary)",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {showFollowedResultCards ? "Hide results" : "Show results"}
                        </button>
                      </div>
                    </div>

	                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
	                      <span>{filteredFollowedUps.length} creators matched</span>
	                      <span>Paginated, {followedResultPageSize} per page</span>
	                      <span>{manualPoolMembers.length} pinned</span>
	                    </div>

	                    {showFollowedResultCards && filteredFollowedUps.length > 0 && (
	                      <PaginationControls
	                        totalCount={filteredFollowedUps.length}
	                        page={safeFollowedResultPage}
	                        pageSize={followedResultPageSize}
	                        itemLabel="creators"
	                        pageSizeOptions={PAGINATION_SIZE_OPTIONS}
	                        onPageChange={setFollowedResultPage}
	                        onPageSizeChange={(nextPageSize) => setFollowedResultPageSize(nextPageSize === 50 ? 50 : 20)}
	                        emptyText="No matching creators"
	                      />
	                    )}

                    {showFollowedResultCards && (
                      followedUpsLoading && followedUps.length === 0 ? (
                        <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Reading follow list...</div>
                      ) : filteredFollowedUps.length > 0 ? (
                        <>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                              gap: "10px",
                            }}
                          >
                            {pagedFollowedUps.map((up) => {
                              const primarySmartGroup = getUpSmartGroups(up)[0] || "";
                              const meta = resolveSmartGroupMeta(primarySmartGroup || "other", primarySmartGroup ? getSmartGroupLabel(primarySmartGroup) : "Other");
                              const smartGroupLabel = primarySmartGroup ? meta.label : "No smart group assigned";
                              const originalGroupNames = getUpOriginalGroupNames(up);
                              const manualExtra = manualPoolIdSet.has(up.mid);
                              return (
                                <div
                                  key={up.mid}
                                  style={{
                                    padding: "12px",
                                    borderRadius: "var(--radius-sm)",
                                    border: "1px solid var(--border-light)",
                                    background: "var(--bg-hover)",
                                    textAlign: "left",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "8px",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    <div
                                      style={{
                                        width: "34px",
                                        height: "34px",
                                        borderRadius: "50%",
                                        background: "linear-gradient(135deg, #00AEEC, #FB7299)",
                                        color: "white",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                        fontSize: "0.875rem",
                                        fontWeight: 700,
                                      }}
                                    >
                                      {up.uname.charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {up.uname}
                                      </div>
                                      <div style={{ fontSize: "0.75rem", color: meta.accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {(originalGroupNames[0] || "Ungrouped")} · {smartGroupLabel}
                                      </div>
                                    </div>
                                  </div>
                                  {(up.sign || up.official_desc) && (
                                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                      {up.sign || up.official_desc}
                                    </div>
                                  )}
                                  {originalGroupNames.length > 0 && (
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                      {originalGroupNames.slice(0, 3).map((tagName) => (
                                        <span
                                          key={tagName}
                                          style={{
                                            padding: "3px 8px",
                                            borderRadius: "9999px",
                                            background: "rgba(251, 114, 153, 0.1)",
                                            color: "#D64078",
                                            fontSize: "0.6875rem",
                                            fontWeight: 700,
                                          }}
                                        >
                                          {tagName}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void toggleManualMonitoredUp(up.mid)}
                                    style={{
                                      marginTop: "auto",
                                      padding: "8px 10px",
                                      borderRadius: "var(--radius-sm)",
                                      border: "1px solid var(--border-light)",
                                      background: manualExtra ? "rgba(0, 174, 236, 0.12)" : "var(--bg-card)",
                                      color: manualExtra ? "#078FBF" : "var(--text-secondary)",
                                      fontSize: "0.75rem",
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {manualExtra ? "Unpin" : "Pin"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                          <PaginationControls
                            totalCount={filteredFollowedUps.length}
                            page={safeFollowedResultPage}
                            pageSize={followedResultPageSize}
                            itemLabel="creators"
                            pageSizeOptions={PAGINATION_SIZE_OPTIONS}
                            onPageChange={setFollowedResultPage}
                            onPageSizeChange={(nextPageSize) => setFollowedResultPageSize(nextPageSize === 50 ? 50 : 20)}
                            emptyText="No matching creators"
                          />
                        </>
                      ) : (
                        <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                          {followedUps.length > 0 ? "No creators match this filter." : "Your follow list loads automatically after connecting the cookie."}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </ExpandableSection>

              <ExpandableSection
                title="Manual Smart Group Management"
                summary="An all-creator group editor. Click a creator to edit multiple smart groups at once below the card, and add multiple default groups too."
                badge={smartGroupsReady && managedSmartGroupOption ? `${manualGroupingUps.length} editable creators` : "Waiting for smart grouping"}
                accent="#FB7299"
                icon={<FolderHeart size={16} />}
                open={showSmartGroupManagementDetail}
                onToggle={() => setShowSmartGroupManagementDetail((value) => !value)}
              >
                {!smartGroupsReady || !managedSmartGroupOption ? (
                  <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                    Complete a "shared smart grouping" run first; manageable group members appear here afterwards.
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "linear-gradient(135deg, rgba(251, 114, 153, 0.08), rgba(14, 165, 233, 0.05))",
                        fontSize: "0.75rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.7,
                      }}
                    >
                      This is no longer just "adding members to one group". Pick a creator from all creators, the current filter results, or a smart group,
                      then check the multiple smart groups it should join right under the card; default groups can be added manually too. Native default groups are preserved — you can only add groups.
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {smartGroupOptions.map((group) => {
                        const active = managedSmartGroup === group.value;
                        const meta = resolveSmartGroupMeta(group.value, group.label);
                        return (
                          <button
                            key={group.value}
                            type="button"
                            onClick={() => setManagedSmartGroup(group.value)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid",
                              borderColor: active ? meta.accent : "var(--border-light)",
                              background: active ? meta.bg : "var(--bg-hover)",
                              color: active ? meta.accent : "var(--text-secondary)",
                              fontSize: "0.8125rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {group.label} {groupCounts[group.value] ? `· ${groupCounts[group.value]}` : ""}
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                      <span>Focused: {managedSmartGroupOption.label}</span>
                      <span>{managedSmartGroupMembers.length} creators in group</span>
                      <span>{followedUps.length} creators total</span>
                      <span>{filteredFollowedUps.length} in current filter</span>
                      <span>Edit multiple smart and default groups at once</span>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {[
                        { value: "all" as const, label: `All creators · ${followedUps.length}` },
                        { value: "filtered" as const, label: `Current filter · ${filteredFollowedUps.length}` },
                        { value: "managed" as const, label: `${managedSmartGroupOption.label} · ${managedSmartGroupMembers.length}` },
                      ].map((scope) => {
                        const active = manualGroupingScope === scope.value;
                        return (
                          <button
                            key={scope.value}
                            type="button"
                            onClick={() => setManualGroupingScope(scope.value)}
                            style={{
                              padding: "8px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid",
                              borderColor: active ? managedSmartGroupMeta.accent : "var(--border-light)",
                              background: active ? managedSmartGroupMeta.bg : "var(--bg-hover)",
                              color: active ? managedSmartGroupMeta.accent : "var(--text-secondary)",
                              fontSize: "0.8125rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {scope.label}
                          </button>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        padding: "14px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-hover)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>
                            {manualGroupingScope === "all"
                              ? "All creators"
                              : manualGroupingScope === "filtered"
                                ? "Current filter results"
                                : `Creators in ${managedSmartGroupOption.label}`}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                            Click a creator and the group options expand right under that card, instead of being fixed on the right.
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => void handleLoadFollowedUps(false, true)}
                            disabled={followedUpsLoading}
                            style={{
                              padding: "7px 10px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-card)",
                              color: followedUpsLoading ? "var(--text-muted)" : "var(--text-secondary)",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: followedUpsLoading ? "not-allowed" : "pointer",
                            }}
                          >
                            {followedUpsLoading ? "Refreshing..." : "Refresh creator list"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowManualGroupingUpList((value) => !value)}
                            style={{
                              padding: "7px 10px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-card)",
                              color: "var(--text-secondary)",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {showManualGroupingUpList ? "Hide creator list" : "Show creator list"}
                          </button>
                        </div>
                      </div>

                      <input
                        type="text"
                        value={manualGroupingSearch}
                        onChange={(e) => setManualGroupingSearch(e.target.value)}
                        placeholder="Search creator names / bios to edit groups"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-input)",
                          color: "var(--text-main)",
                          fontSize: "0.875rem",
                        }}
                      />

                      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        <span>{manualGroupingUps.length} creators in scope</span>
                        <span>Focused smart group: {managedSmartGroupOption.label}</span>
                        <span>Search: {manualGroupingSearch.trim() || "none"}</span>
                        <span>About 3-4 creators per row on desktop</span>
                      </div>

                      {showManualGroupingUpList && manualGroupingUps.length > 0 && (
                        <PaginationControls
                          totalCount={manualGroupingUps.length}
                          page={safeManualGroupingPage}
                          pageSize={manualGroupingPageSize}
                          itemLabel="creators"
                          pageSizeOptions={PAGINATION_SIZE_OPTIONS}
                          onPageChange={setManualGroupingPage}
                          onPageSizeChange={(nextPageSize) => setManualGroupingPageSize(nextPageSize === 50 ? 50 : 20)}
                          emptyText="No editable creators in this scope"
                        />
                      )}

                      {showManualGroupingUpList ? (
                        manualGroupingUps.length > 0 ? (
                          <>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                gap: "12px",
                                alignItems: "start",
                              }}
                            >
                              {pagedManualGroupingUps.map((up) => {
                                const selected = editingGroupedUpId === up.mid;
                                const smartLabels = selected
                                  ? editingGroupedUpSmartGroups.map((groupValue) => getSmartGroupLabel(groupValue))
                                  : getUpSmartGroups(up).map((groupValue) => getSmartGroupLabel(groupValue));
                                const originalLabels = selected
                                  ? editingGroupedUpEffectiveOriginalIds
                                    .map((groupId) => originalGroupMap.get(groupId)?.name || "")
                                    .filter(Boolean)
                                  : getUpOriginalGroupNames(up);

                                return (
                                  <div
                                    key={up.mid}
                                    style={{
                                      padding: "12px",
                                      borderRadius: "var(--radius-sm)",
                                      border: "1px solid",
                                      borderColor: selected ? managedSmartGroupMeta.accent : "var(--border-light)",
                                      background: selected ? managedSmartGroupMeta.bg : "var(--bg-card)",
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: "10px",
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => beginEditUpGrouping(up)}
                                      style={{
                                        padding: 0,
                                        border: "none",
                                        background: "transparent",
                                        textAlign: "left",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "8px",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: selected ? managedSmartGroupMeta.accent : "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                            {up.uname}
                                          </div>
                                          {(up.sign || up.official_desc) && (
                                            <div style={{ marginTop: "4px", fontSize: "0.6875rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                              {up.sign || up.official_desc}
                                            </div>
                                          )}
                                        </div>
                                        <span
                                          style={{
                                            padding: "4px 8px",
                                            borderRadius: "999px",
                                            background: selected ? "rgba(255,255,255,0.74)" : "var(--bg-hover)",
                                            color: selected ? managedSmartGroupMeta.accent : "var(--text-secondary)",
                                            fontSize: "0.6875rem",
                                            fontWeight: 700,
                                            flexShrink: 0,
                                          }}
                                        >
                                          {selected ? "Expanded" : "Edit groups"}
                                        </span>
                                      </div>

                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                        {smartLabels.slice(0, 3).map((label) => (
                                          <span
                                            key={`${up.mid}-smart-${label}`}
                                            style={{
                                              padding: "3px 8px",
                                              borderRadius: "999px",
                                              background: "rgba(14, 165, 233, 0.10)",
                                              color: "#0284C7",
                                              fontSize: "0.6875rem",
                                              fontWeight: 700,
                                            }}
                                          >
                                            {label}
                                          </span>
                                        ))}
                                        {originalLabels.slice(0, 2).map((label) => (
                                          <span
                                            key={`${up.mid}-original-${label}`}
                                            style={{
                                              padding: "3px 8px",
                                              borderRadius: "999px",
                                              background: "rgba(251, 114, 153, 0.10)",
                                              color: "#D64078",
                                              fontSize: "0.6875rem",
                                              fontWeight: 700,
                                            }}
                                          >
                                            {label}
                                          </span>
                                        ))}
                                      </div>
                                    </button>

                                    {selected && editingGroupedUp?.mid === up.mid && (
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "12px",
                                          paddingTop: "12px",
                                          borderTop: `1px solid ${managedSmartGroupMeta.accent}33`,
                                        }}
                                      >
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start" }}>
                                        <div>
                                          <div style={{ fontSize: "0.875rem", fontWeight: 800, color: managedSmartGroupMeta.accent }}>
                                            Edit {up.uname}
                                          </div>
                                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                                            Check the smart groups this creator should join; default groups supplement the native tags and never overwrite original Bilibili groups.
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={closeEditUpGrouping}
                                          style={{
                                            padding: "6px 8px",
                                            borderRadius: "var(--radius-sm)",
                                            border: "1px solid var(--border-light)",
                                            background: "var(--bg-card)",
                                            color: "var(--text-secondary)",
                                            fontSize: "0.75rem",
                                            fontWeight: 700,
                                            cursor: "pointer",
                                            flexShrink: 0,
                                          }}
                                        >
                                          Collapse
                                        </button>
                                      </div>

                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                        {editingGroupedUpSmartGroups.map((groupValue) => {
                                          const meta = resolveSmartGroupMeta(groupValue, getSmartGroupLabel(groupValue));
                                          return (
                                            <span
                                              key={`current-smart-${up.mid}-${groupValue}`}
                                              style={{
                                                padding: "4px 8px",
                                                borderRadius: "999px",
                                                background: meta.bg,
                                                color: meta.accent,
                                                fontSize: "0.6875rem",
                                                fontWeight: 700,
                                              }}
                                            >
                                              Smart group · {getSmartGroupLabel(groupValue)}
                                            </span>
                                          );
                                        })}
                                        {editingGroupedUpEffectiveOriginalIds.map((groupId) => {
                                          const label = originalGroupMap.get(groupId)?.name || "";
                                          if (!label) {
                                            return null;
                                          }
                                          return (
                                            <span
                                              key={`current-original-${up.mid}-${groupId}`}
                                              style={{
                                                padding: "4px 8px",
                                                borderRadius: "999px",
                                                background: "rgba(251, 114, 153, 0.10)",
                                                color: "#D64078",
                                                fontSize: "0.6875rem",
                                                fontWeight: 700,
                                              }}
                                            >
                                              Default group · {label}
                                            </span>
                                          );
                                        })}
                                      </div>

                                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-main)" }}>Smart groups</div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                          {smartGroupOptions.map((group) => {
                                            const groupSelected = editingSmartGroupValues.includes(group.value);
                                            const meta = resolveSmartGroupMeta(group.value, group.label);
                                            return (
                                              <button
                                                key={`edit-smart-${up.mid}-${group.value}`}
                                                type="button"
                                                onClick={() => toggleEditingSmartGroup(group.value)}
                                                style={{
                                                  padding: "8px 12px",
                                                  borderRadius: "var(--radius-sm)",
                                                  border: "1px solid",
                                                  borderColor: groupSelected ? meta.accent : "var(--border-light)",
                                                  background: groupSelected ? meta.bg : "var(--bg-card)",
                                                  color: groupSelected ? meta.accent : "var(--text-secondary)",
                                                  fontSize: "0.8125rem",
                                                  fontWeight: 700,
                                                  cursor: "pointer",
                                                }}
                                              >
                                                {group.label}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>

                                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                        <div style={{ fontSize: "0.8125rem", fontWeight: 800, color: "var(--text-main)" }}>Additional default groups</div>
                                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                                          Default groups marked "native" come from Bilibili follow groups and are read-only. Check more default groups so this creator appears in multiple default filters.
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                          {originalGroups.map((group) => {
                                            const rawMember = isUpRawOriginalGroupMember(up, group.tag_id);
                                            const groupSelected = editingGroupedUpEffectiveOriginalIds.includes(group.tag_id);
                                            return (
                                              <button
                                                key={`edit-original-${up.mid}-${group.tag_id}`}
                                                type="button"
                                                onClick={() => toggleEditingOriginalGroup(up, group.tag_id)}
                                                disabled={rawMember}
                                                style={{
                                                  padding: "8px 12px",
                                                  borderRadius: "var(--radius-sm)",
                                                  border: "1px solid",
                                                  borderColor: groupSelected ? "#FB7299" : "var(--border-light)",
                                                  background: groupSelected ? "rgba(251, 114, 153, 0.12)" : "var(--bg-card)",
                                                  color: groupSelected ? "#D64078" : "var(--text-secondary)",
                                                  fontSize: "0.8125rem",
                                                  fontWeight: 700,
                                                  cursor: rawMember ? "default" : "pointer",
                                                  opacity: rawMember ? 0.92 : 1,
                                                }}
                                              >
                                                {group.name}{rawMember ? " · native" : groupSelected ? " · added" : ""}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>

                                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        <button
                                          type="button"
                                          onClick={() => syncEditUpGroupingDraft(up)}
                                          style={{
                                            padding: "8px 12px",
                                            borderRadius: "var(--radius-sm)",
                                            border: "1px solid var(--border-light)",
                                            background: "var(--bg-card)",
                                            color: "var(--text-secondary)",
                                            fontSize: "0.75rem",
                                            fontWeight: 700,
                                            cursor: "pointer",
                                          }}
                                        >
                                          Restore saved state
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void saveEditedUpGrouping()}
                                          disabled={savingGroupingEditor || editingSmartGroupValues.length === 0}
                                          style={{
                                            padding: "8px 12px",
                                            borderRadius: "var(--radius-sm)",
                                            border: "none",
                                            background: savingGroupingEditor || editingSmartGroupValues.length === 0
                                              ? "var(--bg-muted)"
                                              : `linear-gradient(135deg, ${managedSmartGroupMeta.accent}, #10B981)`,
                                            color: savingGroupingEditor || editingSmartGroupValues.length === 0 ? "var(--text-muted)" : "white",
                                            fontSize: "0.75rem",
                                            fontWeight: 800,
                                            cursor: savingGroupingEditor || editingSmartGroupValues.length === 0 ? "not-allowed" : "pointer",
                                          }}
                                        >
                                          {savingGroupingEditor ? "Saving..." : "Save group settings"}
                                        </button>
                                      </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <PaginationControls
                              totalCount={manualGroupingUps.length}
                              page={safeManualGroupingPage}
                              pageSize={manualGroupingPageSize}
                              itemLabel="creators"
                              pageSizeOptions={PAGINATION_SIZE_OPTIONS}
                              onPageChange={setManualGroupingPage}
                              onPageSizeChange={(nextPageSize) => setManualGroupingPageSize(nextPageSize === 50 ? 50 : 20)}
                              emptyText="No editable creators in this scope"
                            />
                          </>
                        ) : (
                          <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                            No editable creators in this scope. Switch to "All creators" or change the search term.
                          </div>
                        )
                      ) : (
                        <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                          Creator list hidden. Expand when needed.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </ExpandableSection>

              <SharedSignalMappingPanel
                title="Shared Grouping Rules"
                entries={trackerConfig.shared_signal_entries}
                groupOptions={smartGroupOptions}
                saving={savingSignalMappings}
                updatedAt={trackerConfig.shared_creator_grouping.updated_at}
                onSave={handleSaveSharedSignalMappings}
                description="Raw tag -> shared rule -> shared group -> author joins group. E.g. merge Obsidian, knowledge-base, and linked-notes tags into one shared group, or attach one tag to multiple shared groups. After saving, re-run Organize creators only or Shared smart grouping and authors are re-sorted by these rules."
              />
            </div>
          )}

          {panelTab === "dynamics" && (
            <div style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>
              <ExpandableSection
                title="Post Search Results"
                summary="Shows the recent full-feed previews, manual crawls, and group crawl results. The results area collapses independently without affecting the search and filters above."
                badge={hasFetchedDynamics ? `${displayedDynamics.length} posts` : "Not fetched"}
                accent="#00AEEC"
                icon={<Tv size={16} />}
                open={showDynamicResultList}
                onToggle={() => setShowDynamicResultList((value) => !value)}
              >
                {renderResultList("Click \"Preview current words / tags\" above to start")}
              </ExpandableSection>
            </div>
          )}
        </div>
      </PageContent>
    </PageContainer>
  );
}
