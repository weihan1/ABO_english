import { API_BASE_URL } from "../core/api";

export interface BiliDynamic {
  id: string;
  dynamic_id: string;
  title: string;
  content: string;
  author: string;
  author_id: string;
  url: string;
  published_at: string | null;
  dynamic_type: "video" | "image" | "text" | "article";
  pic: string;
  images: string[];
  bvid: string;
  tags: string[];
  matched_keywords?: string[];
  matched_tags?: string[];
  monitor_label?: string;
  monitor_subfolder?: string;
  crawl_source?: string;
  crawl_source_label?: string;
}

export interface FetchFollowedRequest {
  sessdata: string;
  keywords?: string[];
  tag_filters?: string[];
  author_ids?: string[];
  dynamic_types?: number[];
  limit?: number;
  days_back?: number;
  page_limit?: number;
  scan_cutoff_days?: number;
  monitor_label?: string;
  monitor_subfolder?: string;
}

export interface FetchLinksRequest {
  sessdata: string;
  urls: string[];
}

export interface BilibiliDailyDynamicMonitor {
  id: string;
  label: string;
  keywords: string[];
  tag_filters: string[];
  enabled: boolean;
  days_back: number;
  limit: number;
  page_limit: number;
}

export interface BilibiliFollowedGroupMonitor {
  id: string;
  group_value: string;
  label: string;
  enabled: boolean;
  days_back: number;
  limit: number;
  page_limit: number;
}

export interface BiliDynamicFetchStats {
  source?: "global-followed" | "author-space" | "direct-links";
  pages_scanned?: number;
  pages_with_recent_candidates?: number;
  matched_count_before_keep?: number;
  kept_count?: number;
  keep_limit?: number;
  scan_result_limit?: number;
  scanned_author_count?: number;
  authors_with_hits?: number;
  input_count?: number;
  failed_count?: number;
  skipped_count?: number;
  warnings?: string[];
}

export interface FetchFollowedResponse {
  total_found: number;
  fetch_stats?: BiliDynamicFetchStats;
  dynamics: BiliDynamic[];
}

export interface StartFollowedDynamicsCrawlResponse {
  success: boolean;
  task_id: string;
}

export interface FollowedDynamicsCrawlTask {
  task_id: string;
  kind: "followed-dynamics";
  status: BilibiliTaskStatus;
  stage: string;
  updated_at: string;
  can_cancel?: boolean;
  error?: string | null;
  total_found?: number;
  pages_scanned?: number;
  matched_count_before_keep?: number;
  kept_count?: number;
  result?: FetchFollowedResponse | null;
}

export interface BiliFollowedUp {
  mid: string;
  uname: string;
  face: string;
  sign: string;
  official_desc: string;
  special: number;
  tag_ids: number[];
  tag_names: string[];
}

export interface BiliOriginalFollowedGroup {
  tag_id: number;
  name: string;
  count: number;
  tip: string;
}

export interface FetchFollowedUpsRequest {
  sessdata: string;
  max_count?: number;
}

export interface FetchFollowedUpsResponse {
  total: number;
  groups: BiliOriginalFollowedGroup[];
  ups: BiliFollowedUp[];
}

export type BilibiliTaskStatus =
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed";

export interface StartFollowedUpsCrawlResponse {
  success: boolean;
  task_id: string;
}

export interface FollowedUpsCrawlTask {
  task_id: string;
  kind: "followed-ups";
  status: BilibiliTaskStatus;
  stage: string;
  current_page: number;
  page_size: number;
  fetched_count: number;
  updated_at: string;
  can_cancel?: boolean;
  error?: string | null;
  result?: FetchFollowedUpsResponse | null;
}

export interface BilibiliSmartGroupOption {
  value: string;
  label: string;
  count?: number;
  sample_authors?: string[];
  sample_tags?: string[];
}

export interface BilibiliSmartGroupProfile {
  author?: string;
  author_id?: string;
  pending_author_id?: boolean;
  matched_author?: string;
  manual_override?: boolean;
  manual_original_group_ids?: number[];
  manual_original_group_labels?: string[];
  favorite_note_count?: number;
  smart_groups?: string[];
  smart_group_labels?: string[];
  latest_title?: string;
  sample_titles?: string[];
  sample_tags?: string[];
  sample_folders?: string[];
  sample_oids?: string[];
  sample_urls?: string[];
  source_summary?: string;
}

export interface BilibiliSmartGroupResult {
  success: boolean;
  workflow_mode?: "full" | "creator-only";
  bilibili_dir: string;
  favorites_dir: string;
  total_files: number;
  total_notes: number;
  total_authors: number;
  matched_followed_count: number;
  unmatched_author_count: number;
  group_options: BilibiliSmartGroupOption[];
  profiles: Record<string, BilibiliSmartGroupProfile>;
  message: string;
}

export interface BilibiliSmartGroupTask {
  task_id: string;
  kind: "followed-up-smart-groups";
  workflow_mode?: "full" | "creator-only";
  status: BilibiliTaskStatus;
  stage: string;
  progress: number;
  total_files: number;
  processed_files: number;
  matched_followed_count: number;
  total_groups: number;
  total_followed_count?: number;
  processed_followed_count?: number;
  current_followed_name?: string;
  fetched_count?: number;
  current_page?: number;
  page_size?: number;
  updated_at: string;
  can_cancel?: boolean;
  error?: string | null;
  result?: BilibiliSmartGroupResult | null;
}

export interface BilibiliSmartGroupRequest {
  sessdata: string;
  vault_path?: string;
  max_count?: number;
  mode?: "full" | "creator-only";
}

export interface VerifySessdataRequest {
  sessdata: string;
}

export interface VerifySessdataResponse {
  valid: boolean;
  message: string;
}

export interface CookieConfigResponse {
  cookie_configured: boolean;
  cookie_preview: string | null;
}

export interface CookieSaveRequest {
  cookie: string;
}

export interface CookieSaveResponse {
  success: boolean;
  cookie_configured: boolean;
  cookie_preview: string;
}

export interface BrowserCookieResponse {
  success: boolean;
  cookie?: string;
  cookie_count?: number;
  cookie_preview?: string;
  message?: string;
  error?: string;
}

export interface CrawlToVaultRequest {
  cookie?: string;
  vault_path?: string;
  include_dynamics?: boolean;
  include_favorites?: boolean;
  include_watch_later?: boolean;
  dynamic_limit?: number;
  favorite_folder_limit?: number;
  favorite_item_limit?: number;
  watch_later_limit?: number;
  use_cdp?: boolean;
  cdp_port?: number;
}

export interface CrawlToVaultResponse {
  success: boolean;
  vault_path: string;
  output_dir: string;
  written_count: number;
  written_files: string[];
  renamed_favorite_count?: number;
  renamed_favorite_files?: string[];
  dynamic_count: number;
  favorite_count: number;
  watch_later_count: number;
  login?: {
    valid: boolean;
    mid: string;
    uname: string;
  };
}

export interface SaveSelectedDynamicsRequest {
  vault_path?: string;
  dynamics: BiliDynamic[];
}

export interface BilibiliFavoriteFolder {
  id: string;
  title: string;
  media_count: number;
  cover: string;
  first_video_title: string;
  first_video_bvid: string;
  crawled_count: number;
  last_crawled_at: string;
  source_type?: "favorite" | "watch_later";
}

export interface FavoriteFoldersRequest {
  cookie?: string;
  use_cdp?: boolean;
  cdp_port?: number;
}

export interface FavoriteFoldersResponse {
  success: boolean;
  folder_count: number;
  folders: BilibiliFavoriteFolder[];
  login?: {
    valid: boolean;
    mid: string;
    uname: string;
  };
}

export interface FavoriteFoldersTask {
  task_id: string;
  kind: "favorite-folders";
  status: BilibiliTaskStatus;
  stage: string;
  processed_folders: number;
  total_folders: number;
  current_folder: string;
  updated_at: string;
  can_cancel?: boolean;
  error?: string | null;
  result?: FavoriteFoldersResponse | null;
}

export interface FavoriteCrawlRequest {
  cookie?: string;
  vault_path?: string;
  folder_ids: string[];
  crawl_mode?: "full" | "incremental";
  item_limit?: number;
  since_days?: number;
  since_date?: string;
  use_cdp?: boolean;
  cdp_port?: number;
}

export interface FavoriteCrawlResponse extends CrawlToVaultResponse {
  selected_folder_count: number;
  matched_folder_count: number;
  fetched_count: number;
  favorite_count: number;
  skipped_count: number;
  state_path: string;
  watch_later_count: number;
  crawl_mode?: "full" | "incremental";
}

export interface FavoriteCrawlTask {
  task_id: string;
  kind: "favorite-crawl";
  status: BilibiliTaskStatus;
  stage: string;
  selected_folder_count: number;
  current_step: string;
  current_folder: string;
  current_page: number;
  fetched_count: number;
  saved_count: number;
  skipped_count: number;
  updated_at: string;
  can_cancel?: boolean;
  error?: string | null;
  result?: FavoriteCrawlResponse | null;
}

export interface BilibiliTaskCancelResponse {
  success: boolean;
  status: BilibiliTaskStatus;
}

const API_BASE = `${API_BASE_URL}/api/tools`;
export const BILIBILI_TASK_STORAGE_KEYS = [
  "bilibili_followed_dynamics_task_id",
  "bilibili_followed_ups_task_id",
  "bilibili_followed_smart_group_task_id",
  "bilibili_favorites_list_task_id",
  "bilibili_favorites_crawl_task_id",
] as const;

async function readError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    return data.detail || data.error || text || fallback;
  } catch {
    return text || fallback;
  }
}

async function readJsonResponse<T>(res: Response, fallback: string): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(fallback);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const preview = text.slice(0, 240);
    throw new Error(
      `${fallback}: ${error instanceof Error ? error.message : "response could not be parsed"}${preview ? `; response snippet: ${preview}` : ""}`
    );
  }
}

export async function bilibiliFetchFollowed(
  req: FetchFollowedRequest
): Promise<FetchFollowedResponse> {
  const res = await fetch(`${API_BASE}/bilibili/followed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Fetch failed"));
  }
  return readJsonResponse<FetchFollowedResponse>(res, "Fetch succeeded but response body was invalid");
}

export async function bilibiliFetchByLinks(
  req: FetchLinksRequest
): Promise<FetchFollowedResponse> {
  const res = await fetch(`${API_BASE}/bilibili/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Fetch bilibili links failed"));
  }
  return readJsonResponse<FetchFollowedResponse>(
    res,
    "Bilibili link fetch succeeded but response body was invalid",
  );
}

export async function bilibiliStartFollowedCrawl(
  req: FetchFollowedRequest
): Promise<StartFollowedDynamicsCrawlResponse> {
  const res = await fetch(`${API_BASE}/bilibili/followed/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Start followed dynamics crawl failed"));
  }
  return readJsonResponse<StartFollowedDynamicsCrawlResponse>(
    res,
    "Followed dynamics crawl started but response body was invalid",
  );
}

export async function bilibiliGetFollowedCrawlTask(
  taskId: string
): Promise<FollowedDynamicsCrawlTask> {
  const res = await fetch(`${API_BASE}/bilibili/followed/crawl/${taskId}`);
  if (!res.ok) {
    throw new Error(await readError(res, "Read followed dynamics crawl progress failed"));
  }
  return readJsonResponse<FollowedDynamicsCrawlTask>(
    res,
    "Followed dynamics crawl progress response was invalid",
  );
}

export async function bilibiliFetchFollowedUps(
  req: FetchFollowedUpsRequest
): Promise<FetchFollowedUpsResponse> {
  const res = await fetch(`${API_BASE}/bilibili/followed-ups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Fetch followed ups failed"));
  }
  return readJsonResponse<FetchFollowedUpsResponse>(res, "Fetch followed ups response was invalid");
}

export async function bilibiliStartFollowedUpsCrawl(
  req: FetchFollowedUpsRequest
): Promise<StartFollowedUpsCrawlResponse> {
  const res = await fetch(`${API_BASE}/bilibili/followed-ups/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Start followed ups crawl failed"));
  }
  return readJsonResponse<StartFollowedUpsCrawlResponse>(res, "Followed ups crawl start response was invalid");
}

export async function bilibiliGetFollowedUpsCrawlTask(
  taskId: string
): Promise<FollowedUpsCrawlTask> {
  const res = await fetch(`${API_BASE}/bilibili/followed-ups/crawl/${taskId}`);
  if (!res.ok) {
    const error = await readError(res, "Read followed ups crawl progress failed");
    throw new Error(error);
  }
  return readJsonResponse<FollowedUpsCrawlTask>(res, "Followed ups crawl progress response was invalid");
}

export async function bilibiliStartSmartGroupTask(
  req: BilibiliSmartGroupRequest
): Promise<StartFollowedUpsCrawlResponse> {
  const res = await fetch(`${API_BASE}/bilibili/followed-ups/smart-groups/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const error = await readError(res, "Start smart grouping failed");
    throw new Error(error);
  }
  return res.json();
}

export async function bilibiliGetSmartGroupTask(
  taskId: string
): Promise<BilibiliSmartGroupTask> {
  const res = await fetch(`${API_BASE}/bilibili/followed-ups/smart-groups/${taskId}`);
  if (!res.ok) {
    const error = await readError(res, "Read smart grouping progress failed");
    throw new Error(error);
  }
  return res.json();
}

export async function bilibiliVerifySessdata(
  req: VerifySessdataRequest
): Promise<VerifySessdataResponse> {
  const res = await fetch(`${API_BASE}/bilibili/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Verification failed");
  return res.json();
}

export async function bilibiliGetConfig(): Promise<CookieConfigResponse> {
  const res = await fetch(`${API_BASE}/bilibili/config`);
  if (!res.ok) throw new Error("Failed to get config");
  return res.json();
}

export async function bilibiliSaveConfig(req: CookieSaveRequest): Promise<CookieSaveResponse> {
  const res = await fetch(`${API_BASE}/bilibili/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error("Failed to save config");
  return res.json();
}

export async function bilibiliGetCookieFromBrowser(): Promise<BrowserCookieResponse> {
  try {
    const res = await fetch(`${API_BASE}/bilibili/config/from-browser`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail || "Failed to get browser cookie");
    }
    return res.json();
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error("ABO backend is not running. Restart ABO, then click one-click browser cookie connect again");
    }
    throw err;
  }
}

export async function bilibiliCrawlToVault(
  req: CrawlToVaultRequest
): Promise<CrawlToVaultResponse> {
  const res = await fetch(`${API_BASE}/bilibili/crawl-to-vault`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || "Crawl to vault failed");
  }
  return res.json();
}

export async function bilibiliSaveSelectedDynamics(
  req: SaveSelectedDynamicsRequest
): Promise<CrawlToVaultResponse> {
  const res = await fetch(`${API_BASE}/bilibili/dynamics/save-selected`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Save selected dynamics failed"));
  }
  return res.json();
}

export async function bilibiliListFavoriteFolders(
  req: FavoriteFoldersRequest = {}
): Promise<FavoriteFoldersResponse> {
  const res = await fetch(`${API_BASE}/bilibili/favorites/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Favorite folders failed"));
  }
  return res.json();
}

export async function bilibiliStartListFavoriteFolders(
  req: FavoriteFoldersRequest = {}
): Promise<StartFollowedUpsCrawlResponse> {
  const res = await fetch(`${API_BASE}/bilibili/favorites/folders/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Favorite folder preview start failed"));
  }
  return res.json();
}

export async function bilibiliGetListFavoriteFoldersTask(
  taskId: string
): Promise<FavoriteFoldersTask> {
  const res = await fetch(`${API_BASE}/bilibili/favorites/folders/crawl/${taskId}`);
  if (!res.ok) {
    throw new Error(await readError(res, "Favorite folder preview progress failed"));
  }
  return res.json();
}

export async function bilibiliCrawlFavoriteFolders(
  req: FavoriteCrawlRequest
): Promise<FavoriteCrawlResponse> {
  const res = await fetch(`${API_BASE}/bilibili/favorites/crawl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Favorite crawl failed"));
  }
  return res.json();
}

export async function bilibiliStartCrawlFavoriteFolders(
  req: FavoriteCrawlRequest
): Promise<StartFollowedUpsCrawlResponse> {
  const res = await fetch(`${API_BASE}/bilibili/favorites/crawl/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Favorite crawl start failed"));
  }
  return res.json();
}

export async function bilibiliGetCrawlFavoriteFoldersTask(
  taskId: string
): Promise<FavoriteCrawlTask> {
  const res = await fetch(`${API_BASE}/bilibili/favorites/crawl/${taskId}`);
  if (!res.ok) {
    throw new Error(await readError(res, "Favorite crawl progress failed"));
  }
  return res.json();
}

export async function bilibiliCancelTask(
  taskId: string
): Promise<BilibiliTaskCancelResponse> {
  const res = await fetch(`${API_BASE}/bilibili/tasks/${taskId}/cancel`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(await readError(res, "Cancel bilibili task failed"));
  }
  return res.json();
}

export function bilibiliCancelTaskSilently(taskId: string): void {
  const url = `${API_BASE}/bilibili/tasks/${taskId}/cancel`;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon(url);
      if (sent) {
        return;
      }
    }
  } catch {
    // Ignore and fall back to keepalive fetch below.
  }
  void fetch(url, { method: "POST", keepalive: true }).catch(() => {
    // Page is leaving or backend is already gone; nothing else to do.
  });
}

function readStoredBilibiliTaskIds(): string[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  const taskIds = BILIBILI_TASK_STORAGE_KEYS
    .map((key) => localStorage.getItem(key))
    .filter((taskId): taskId is string => Boolean(taskId));
  return Array.from(new Set(taskIds));
}

function clearStoredBilibiliTaskIds(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  BILIBILI_TASK_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key);
  });
}

export async function bilibiliCancelAllKnownTasks(): Promise<number> {
  const taskIds = readStoredBilibiliTaskIds();
  clearStoredBilibiliTaskIds();
  if (taskIds.length === 0) {
    return 0;
  }
  await Promise.allSettled(taskIds.map((taskId) => bilibiliCancelTask(taskId)));
  return taskIds.length;
}

export function bilibiliCancelAllKnownTasksSilently(): number {
  const taskIds = readStoredBilibiliTaskIds();
  clearStoredBilibiliTaskIds();
  taskIds.forEach((taskId) => {
    bilibiliCancelTaskSilently(taskId);
  });
  return taskIds.length;
}

export interface DebugTestResult {
  sessdata_preview: string;
  tests: Record<string, {
    status_code?: number;
    code?: number;
    message?: string;
    cards_count?: number;
    first_card_types?: number[];
    error?: string;
  }>;
  suggestions: string[];
}

export async function bilibiliDebugTest(sessdata: string): Promise<DebugTestResult> {
  const res = await fetch(`${API_BASE}/bilibili/debug`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessdata }),
  });
  if (!res.ok) throw new Error("Debug test failed");
  return res.json();
}
