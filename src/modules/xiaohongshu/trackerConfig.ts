export type XHSCommentSortBy = "likes" | "time";
export type XHSTrackerSortBy = "likes" | "time";

export const DEFAULT_XHS_RECENT_DAYS = 180;

export interface XHSTrackerKeywordMonitor {
  id: string;
  label: string;
  keywords: string[];
  enabled: boolean;
  min_likes: number;
  per_keyword_limit: number;
  recent_days: number;
  sort_by: XHSTrackerSortBy;
  include_comments: boolean;
  comments_limit: number;
  comments_sort_by: XHSCommentSortBy;
}

export interface XHSTrackerFollowingScan {
  id: string;
  label: string;
  keywords: string[];
  enabled: boolean;
  fetch_limit: number;
  recent_days: number;
  sort_by: XHSTrackerSortBy;
  keyword_filter: boolean;
  include_comments: boolean;
  comments_limit: number;
  comments_sort_by: XHSCommentSortBy;
}

export interface XHSTrackerFollowingScanMonitor {
  id: string;
  label: string;
  keywords: string[];
  enabled: boolean;
  fetch_limit: number;
  recent_days: number;
  sort_by: XHSTrackerSortBy;
  keyword_filter: boolean;
  include_comments: boolean;
  comments_limit: number;
  comments_sort_by: XHSCommentSortBy;
}

export interface XHSTrackerCreatorMonitor {
  id: string;
  user_id: string;
  label: string;
  author: string;
  enabled: boolean;
  per_user_limit: number;
  recent_days: number;
  sort_by: XHSTrackerSortBy;
  include_comments: boolean;
  comments_limit: number;
  comments_sort_by: XHSCommentSortBy;
  smart_groups: string[];
  smart_group_labels: string[];
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function toStringList(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n，]+/)
      : value == null
        ? []
        : [String(value)];

  const result: string[] = [];
  const seen = new Set<string>();
  rawItems.forEach((item) => {
    const text = String(item ?? "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function clampPositiveInt(value: unknown, fallback: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(1, Math.round(parsed));
  return max ? Math.min(normalized, max) : normalized;
}

function clampNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
}

function normalizeCommentSortBy(value: unknown): XHSCommentSortBy {
  return String(value || "").trim().toLowerCase() === "time" ? "time" : "likes";
}

function normalizeTrackerSortBy(value: unknown): XHSTrackerSortBy {
  return String(value || "").trim().toLowerCase() === "time" ? "time" : "likes";
}

export function parseKeywordInput(value: string): string[] {
  return toStringList(value);
}

export function formatKeywordInput(keywords: string[]): string {
  return (keywords || []).join(", ");
}

export function createKeywordMonitor(seed: Partial<XHSTrackerKeywordMonitor> = {}): XHSTrackerKeywordMonitor {
  const keywords = toStringList(seed.keywords);
  const label = String(keywords[0] || seed.label || "New intel push").trim() || "New intel push";
  return {
    id: String(seed.id || createLocalId("xhs-km")),
    label,
    keywords,
    enabled: seed.enabled ?? true,
    min_likes: clampNonNegativeInt(seed.min_likes, 500),
    per_keyword_limit: clampPositiveInt(seed.per_keyword_limit, 10, 100),
    recent_days: clampPositiveInt(seed.recent_days, DEFAULT_XHS_RECENT_DAYS, 365),
    sort_by: normalizeTrackerSortBy(seed.sort_by),
    include_comments: seed.include_comments ?? false,
    comments_limit: clampPositiveInt(seed.comments_limit, 20, 100),
    comments_sort_by: normalizeCommentSortBy(seed.comments_sort_by),
  };
}

export function createFollowingScan(seed: Partial<XHSTrackerFollowingScan> = {}): XHSTrackerFollowingScan {
  return {
    id: String(seed.id || "xhs-following-default"),
    label: String(seed.label || "Follow-feed scan").trim() || "Follow-feed scan",
    keywords: toStringList(seed.keywords),
    enabled: seed.enabled ?? false,
    fetch_limit: clampPositiveInt(seed.fetch_limit, 20, 200),
    recent_days: clampPositiveInt(seed.recent_days, DEFAULT_XHS_RECENT_DAYS, 365),
    sort_by: normalizeTrackerSortBy(seed.sort_by ?? "time"),
    keyword_filter: seed.keyword_filter ?? true,
    include_comments: seed.include_comments ?? false,
    comments_limit: clampPositiveInt(seed.comments_limit, 20, 100),
    comments_sort_by: normalizeCommentSortBy(seed.comments_sort_by),
  };
}

export function createFollowingScanMonitor(seed: Partial<XHSTrackerFollowingScanMonitor> = {}): XHSTrackerFollowingScanMonitor {
  const keywords = toStringList(seed.keywords);
  const label = String(keywords[0] || seed.label || "Follow-feed push").trim() || "Follow-feed push";
  return {
    id: String(seed.id || createLocalId("xhs-fm")),
    label,
    keywords,
    enabled: seed.enabled ?? true,
    fetch_limit: clampPositiveInt(seed.fetch_limit, 20, 200),
    recent_days: clampPositiveInt(seed.recent_days, DEFAULT_XHS_RECENT_DAYS, 365),
    sort_by: normalizeTrackerSortBy(seed.sort_by ?? "time"),
    keyword_filter: seed.keyword_filter ?? true,
    include_comments: seed.include_comments ?? false,
    comments_limit: clampPositiveInt(seed.comments_limit, 20, 100),
    comments_sort_by: normalizeCommentSortBy(seed.comments_sort_by),
  };
}

export function createCreatorMonitor(seed: Partial<XHSTrackerCreatorMonitor> = {}): XHSTrackerCreatorMonitor {
  const userId = String(seed.user_id || "").trim();
  const author = String(seed.author || seed.label || userId || "Unnamed blogger").trim() || "Unnamed blogger";
  return {
    id: String(seed.id || createLocalId("xhs-cm")),
    user_id: userId,
    label: String(seed.label || author || userId || "Unnamed blogger").trim() || "Unnamed blogger",
    author,
    enabled: seed.enabled ?? true,
    per_user_limit: clampPositiveInt(seed.per_user_limit, 3, 20),
    recent_days: clampPositiveInt(seed.recent_days, DEFAULT_XHS_RECENT_DAYS, 365),
    sort_by: normalizeTrackerSortBy(seed.sort_by ?? "time"),
    include_comments: seed.include_comments ?? false,
    comments_limit: clampPositiveInt(seed.comments_limit, 20, 100),
    comments_sort_by: normalizeCommentSortBy(seed.comments_sort_by),
    smart_groups: toStringList(seed.smart_groups),
    smart_group_labels: toStringList(seed.smart_group_labels),
  };
}

export function normalizeXhsTrackerConfig(raw: any): {
  keywordMonitors: XHSTrackerKeywordMonitor[];
  followingScan: XHSTrackerFollowingScan;
  followingScanMonitors: XHSTrackerFollowingScanMonitor[];
  creatorMonitors: XHSTrackerCreatorMonitor[];
} {
  const keywordMonitors = Array.isArray(raw?.keyword_monitors) && raw.keyword_monitors.length > 0
    ? raw.keyword_monitors.map((item: any) => createKeywordMonitor(item))
    : toStringList(raw?.keywords).length > 0
      ? [
          createKeywordMonitor({
            label: "Default intel push",
            keywords: raw?.keywords,
            enabled: raw?.enable_keyword_search ?? true,
            min_likes: raw?.keyword_min_likes ?? 500,
            per_keyword_limit: raw?.keyword_search_limit ?? 10,
          }),
        ]
      : [];

  const followingScan = createFollowingScan(
    raw?.following_scan && typeof raw.following_scan === "object"
      ? raw.following_scan
      : {
          label: "Follow-feed scan",
          keywords: raw?.keywords,
          enabled: raw?.follow_feed ?? false,
          fetch_limit: raw?.fetch_follow_limit ?? 20,
          keyword_filter: true,
        }
  );
  const followingScanMonitors = Array.isArray(raw?.following_scan_monitors) && raw.following_scan_monitors.length > 0
    ? raw.following_scan_monitors.map((item: any) => createFollowingScanMonitor(item))
    : toStringList(followingScan.keywords).map((keyword) => createFollowingScanMonitor({
        label: keyword,
        keywords: [keyword],
        enabled: followingScan.enabled,
        fetch_limit: followingScan.fetch_limit,
        recent_days: followingScan.recent_days,
        sort_by: followingScan.sort_by,
        keyword_filter: followingScan.keyword_filter,
        include_comments: followingScan.include_comments,
        comments_limit: followingScan.comments_limit,
        comments_sort_by: followingScan.comments_sort_by,
      }));

  const creatorProfiles = raw?.creator_profiles || {};
  const disabledCreatorIds = new Set<string>((raw?.disabled_creator_ids || []).map((item: unknown) => String(item)));
  const creatorMonitors = Array.isArray(raw?.creator_monitors) && raw.creator_monitors.length > 0
    ? raw.creator_monitors.map((item: any) => createCreatorMonitor(item))
    : (raw?.user_ids || []).map((userId: string) => {
        const profile = creatorProfiles?.[userId] || {};
        return createCreatorMonitor({
          user_id: userId,
          label: profile.author || userId,
          author: profile.author || userId,
          enabled: !disabledCreatorIds.has(userId),
          recent_days: profile.recent_days || DEFAULT_XHS_RECENT_DAYS,
          sort_by: profile.sort_by || "time",
          smart_groups: profile.smart_groups || [],
          smart_group_labels: profile.smart_group_labels || [],
        });
      });

  return {
    keywordMonitors,
    followingScan,
    followingScanMonitors,
    creatorMonitors,
  };
}
