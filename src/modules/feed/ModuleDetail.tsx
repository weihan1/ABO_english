import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Play, Clock, Calendar, User, Plus, X, Trash2, HelpCircle, History, Info } from "lucide-react";
import { api } from "../../core/api";
import { isActionEnterKey } from "../../core/keyboard";
import { useStore, FeedModule } from "../../core/store";
import { PageContainer, PageHeader, PageContent, Card } from "../../components/Layout";
import { useToast } from "../../components/Toast";
import { CookieGuide } from "../../components/ConfigHelp";
import type { BilibiliDailyDynamicMonitor, BilibiliFollowedGroupMonitor } from "../../api/bilibili";
import { xiaohongshuGetCookieFromBrowser } from "../../api/xiaohongshu";
import {
  createCreatorMonitor,
  createFollowingScan,
  createFollowingScanMonitor,
  createKeywordMonitor,
  formatKeywordInput,
  normalizeXhsTrackerConfig,
  parseKeywordInput,
  type XHSTrackerCreatorMonitor,
  type XHSTrackerFollowingScan,
  type XHSTrackerFollowingScanMonitor,
  type XHSTrackerKeywordMonitor,
} from "../xiaohongshu/trackerConfig";

const SCHEDULE_OPTIONS = [
  { label: "8:00", value: "0 8 * * *" },
  { label: "8:30", value: "30 8 * * *" },
  { label: "9:00", value: "0 9 * * *" },
  { label: "9:30", value: "30 9 * * *" },
  { label: "10:00", value: "0 10 * * *" },
  { label: "11:00", value: "0 11 * * *" },
  { label: "13:00", value: "0 13 * * *" },
  { label: "20:00", value: "0 20 * * *" },
];

function formatScheduleOptionLabel(value: string): string {
  if (value.startsWith("*/5")) return "Every 5 minutes";
  const cronMatch = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(value.trim());
  if (!cronMatch) return value;
  const minute = Number(cronMatch[1]);
  const hour = Number(cronMatch[2]);
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return value;
  return `${hour}:${minute.toString().padStart(2, "0")}`;
}

const BILIBILI_GROUP_OPTIONS = [
  { value: "ai-tech", label: "AI & Tech" },
  { value: "study", label: "Learning" },
  { value: "digital", label: "Digital & AV" },
  { value: "game", label: "Gaming" },
  { value: "finance", label: "Finance & Business" },
  { value: "creative", label: "Design & Creation" },
  { value: "entertainment", label: "Lifestyle & Entertainment" },
  { value: "other", label: "Other" },
];

const XHS_CREATOR_GROUP_OPTIONS = [
  { value: "research", label: "Research & Study" },
  { value: "writing", label: "Paper Writing" },
  { value: "ai", label: "AI Tools" },
  { value: "productivity", label: "Productivity & PKM" },
  { value: "study_abroad", label: "Study Abroad & PhD" },
  { value: "lifestyle", label: "Daily Life" },
  { value: "other", label: "Other" },
];

const BILIBILI_DYNAMIC_TYPE_OPTIONS = [
  { value: 8, label: "Video" },
  { value: 2, label: "Image post" },
  { value: 4, label: "Text" },
  { value: 64, label: "Article" },
];

// Per-module subscription config (only for modules that support subscriptions)
const MODULE_SUB_CONFIG: Record<string, {
  types: { type: string; label: string; placeholder: string; example: string }[];
  desc: string;
}> = {
  "bilibili-tracker": {
    types: [
      { type: "up_uid", label: "Creator", placeholder: "Enter creator UID or space link", example: "1567748478" },
    ],
    desc: "Add creator UIDs to track their video updates"
  },
  "xiaohongshu-tracker": {
    types: [
      { type: "user_id", label: "User", placeholder: "Enter user profile link or ID", example: "5f3c8b9a0000000001001234" },
    ],
    desc: "Add user IDs to track Xiaohongshu notes"
  },
  "zhihu-tracker": {
    types: [
      { type: "topic", label: "Topic", placeholder: "Enter topic ID or link", example: "19550728" },
      { type: "user", label: "User", placeholder: "Enter user ID or profile link", example: "zhihu-user" },
    ],
    desc: "Add topics or users to track Zhihu content"
  },
  "xiaoyuzhou-tracker": {
    types: [
      { type: "podcast_id", label: "Podcast", placeholder: "Enter podcast ID or link", example: "6169c4c8d8b44c5da7ea2e9b" },
    ],
    desc: "Add podcast IDs to track episode updates"
  },
  "arxiv-tracker": {
    types: [],
    desc: "Configure keywords below"
  },
  "semantic-scholar-tracker": {
    types: [],
    desc: "Configure keywords below"
  },
  "folder-monitor": {
    types: [],
    desc: "Monitor folder changes"
  },
};

interface Props {
  module: FeedModule;
  onBack: () => void;
}

interface ModuleConfig {
  keywords?: string[];
  topics?: string[];
  users?: string[];
  podcast_ids?: string[];
  user_ids?: string[];
  folder_path?: string;
  up_uids?: string[];
  followed_up_groups?: string[];
  followed_up_original_groups?: number[];
  sessdata?: string;
  api_key?: string;
  cookie?: string;
  web_session?: string;
  id_token?: string;
  auth_ready?: boolean;
  auth_source?: "module" | "global" | null;
  extension_port?: number;
  dedicated_window_mode?: boolean;
  enable_keyword_search?: boolean;
  keyword_min_likes?: number;
  keyword_search_limit?: number;
  follow_feed?: boolean;
  follow_feed_types?: number[];
  fetch_follow_limit?: number;
  fixed_up_monitor_limit?: number;
  fixed_up_days_back?: number;
  days_back?: number;
  creator_push_enabled?: boolean;
  keyword_filter?: boolean;
  followed_up_group_options?: { value: string; label: string }[];
  creator_groups?: string[];
  creator_group_options?: { value: string; label: string }[];
  creator_profiles?: Record<string, {
    author?: string;
    author_id?: string;
    smart_groups?: string[];
    smart_group_labels?: string[];
    latest_title?: string;
    sample_titles?: string[];
  }>;
  favorite_up_profiles?: Record<string, {
    author?: string;
    author_id?: string;
    smart_groups?: string[];
    smart_group_labels?: string[];
    latest_title?: string;
    sample_titles?: string[];
  }>;
  keyword_monitors?: XHSTrackerKeywordMonitor[];
  following_scan?: XHSTrackerFollowingScan;
  following_scan_monitors?: XHSTrackerFollowingScanMonitor[];
  creator_monitors?: XHSTrackerCreatorMonitor[];
  daily_dynamic_monitors?: BilibiliDailyDynamicMonitor[];
  followed_up_group_monitors?: BilibiliFollowedGroupMonitor[];
  followed_up_filter_mode?: "and" | "smart_only";
}

interface BilibiliOriginalGroupOption {
  tag_id: number;
  name: string;
  count: number;
  tip: string;
}

interface BilibiliFollowedUpsConfigResponse {
  total: number;
  groups: BilibiliOriginalGroupOption[];
  ups: Array<{
    mid: string;
    uname: string;
    tag_ids: number[];
    tag_names: string[];
  }>;
}

interface BilibiliTrackedProfileSummary {
  uid: string;
  author: string;
  smartGroups: string[];
  latestTitle?: string;
  sampleTitles: string[];
}

function parseBilibiliStringListInput(value: string): string[] {
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

function createLocalBilibiliMonitorId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function normalizeBilibiliPositiveInt(value: unknown, fallback: number, max?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(1, Math.round(parsed));
  return max ? Math.min(normalized, max) : normalized;
}

const BILIBILI_FIXED_UP_MONITOR_DEFAULT_DAYS_BACK = 3;
const BILIBILI_FOLLOWED_GROUP_MONITOR_DEFAULT_DAYS_BACK = 3;

function getBilibiliMonitorDefaults(config: Partial<ModuleConfig> = {}) {
  return {
    daysBack: normalizeBilibiliPositiveInt(config.days_back, 7, 365),
    limit: 50,
    pageLimit: 5,
  };
}

function normalizeBilibiliDailyDynamicMonitor(
  seed: Partial<BilibiliDailyDynamicMonitor> = {},
  defaults: { daysBack?: number; limit?: number; pageLimit?: number } = {},
): BilibiliDailyDynamicMonitor {
  const keywords = Array.isArray(seed.keywords) ? parseBilibiliStringListInput(seed.keywords.join(", ")) : [];
  const tagFilters = Array.isArray(seed.tag_filters) ? parseBilibiliStringListInput(seed.tag_filters.join(", ")) : [];
  const label = String(seed.label || keywords[0] || tagFilters[0] || "Daily feed monitor").trim() || "Daily feed monitor";
  return {
    id: String(seed.id || createLocalBilibiliMonitorId("bili-dm")),
    label,
    keywords,
    tag_filters: tagFilters,
    enabled: seed.enabled ?? true,
    days_back: normalizeBilibiliPositiveInt(seed.days_back, defaults.daysBack ?? 7, 365),
    limit: normalizeBilibiliPositiveInt(
      seed.limit ?? (seed as { fetch_limit?: number }).fetch_limit,
      defaults.limit ?? 50,
      1000,
    ),
    page_limit: normalizeBilibiliPositiveInt(
      seed.page_limit ?? (seed as { pages?: number; max_pages?: number }).pages ?? (seed as { max_pages?: number }).max_pages,
      defaults.pageLimit ?? 5,
      100,
    ),
  };
}

function normalizeBilibiliFollowedGroupMonitor(
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
    id: String(seed.id || createLocalBilibiliMonitorId("bili-gm")),
    group_value: groupValue,
    label,
    enabled: seed.enabled ?? true,
    days_back: normalizeBilibiliPositiveInt(seed.days_back, BILIBILI_FOLLOWED_GROUP_MONITOR_DEFAULT_DAYS_BACK, 365),
    limit: normalizeBilibiliPositiveInt(
      seed.limit ?? (seed as { fetch_limit?: number }).fetch_limit,
      defaults.limit ?? 50,
      1000,
    ),
    page_limit: normalizeBilibiliPositiveInt(
      seed.page_limit ?? (seed as { pages?: number; max_pages?: number }).pages ?? (seed as { max_pages?: number }).max_pages,
      defaults.pageLimit ?? 5,
      100,
    ),
  };
}

function normalizeBilibiliTrackerModuleConfig(config: ModuleConfig): ModuleConfig {
  const monitorDefaults = getBilibiliMonitorDefaults(config);
  const labelLookup = Object.fromEntries(
    ((config.followed_up_group_options || BILIBILI_GROUP_OPTIONS) as { value: string; label: string }[])
      .map((option) => [option.value, option.label])
  );

  const dailyDynamicMonitors = Array.isArray(config.daily_dynamic_monitors) && config.daily_dynamic_monitors.length > 0
    ? config.daily_dynamic_monitors.map((item) => normalizeBilibiliDailyDynamicMonitor(item, monitorDefaults))
    : parseBilibiliStringListInput((config.keywords || []).join(", ")).map((keyword) => normalizeBilibiliDailyDynamicMonitor({
        label: keyword,
        keywords: [keyword],
        enabled: config.enable_keyword_search ?? true,
      }, monitorDefaults));

  const followedUpGroupMonitors = Array.isArray(config.followed_up_group_monitors) && config.followed_up_group_monitors.length > 0
    ? config.followed_up_group_monitors.map((item) => normalizeBilibiliFollowedGroupMonitor(item, labelLookup, monitorDefaults))
    : (config.followed_up_groups || []).map((groupValue) => normalizeBilibiliFollowedGroupMonitor({
        group_value: groupValue,
        enabled: true,
      }, labelLookup, monitorDefaults));

  return {
    ...config,
    up_uids: Array.isArray(config.up_uids) ? config.up_uids.map((item) => String(item || "").trim()).filter(Boolean) : [],
    fixed_up_days_back: normalizeBilibiliPositiveInt(
      config.fixed_up_days_back,
      BILIBILI_FIXED_UP_MONITOR_DEFAULT_DAYS_BACK,
      365,
    ),
    daily_dynamic_monitors: dailyDynamicMonitors,
    followed_up_group_monitors: followedUpGroupMonitors,
  };
}

function extractBilibiliUid(rawValue: string): string {
  const text = String(rawValue || "").trim();
  if (!text) return "";
  const match = text.match(/space\.bilibili\.com\/(\d+)/i);
  if (match) return match[1];
  return text;
}

function normalizeXhsProfileUserId(rawValue: string): string {
  const text = String(rawValue || "").trim();
  if (!text) return "";
  const match = text.match(/\/user\/profile\/([^/?#]+)/i);
  return decodeURIComponent(match?.[1] || text).trim();
}

interface SubscriptionDetail {
  type: string;
  value: string;
  added_at: string;
  added_by: string;
  last_fetched: string | null;
  fetch_count: number;
  is_active: boolean;
}

interface SubDetailData {
  module_id: string;
  module_name: string;
  subscriptions: SubscriptionDetail[];
}

const TYPE_LABELS: Record<string, string> = {
  up_uid: "Creator",
  user_id: "User ID",
  user: "User",
  topic: "Topic",
  podcast_id: "Podcast",
  keyword: "Keyword",
};

const TYPE_COLORS: Record<string, string> = {
  up_uid: "#FF6B6B",
  user_id: "#FF6B9D",
  user: "#C44569",
  topic: "#786FA6",
  podcast_id: "#63CDDA",
  keyword: "#F8B500",
};

export default function ModuleDetail({ module, onBack }: Props) {
  const toast = useToast();
  const { setFeedModules } = useStore();
  const [moduleConfig, setModuleConfig] = useState<ModuleConfig>({});
  const [running, setRunning] = useState(false);
  const [moduleEnabled, setModuleEnabled] = useState(module.enabled);
  const [schedule, setSchedule] = useState(module.schedule);
  const [subDetails, setSubDetails] = useState<SubDetailData | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [bilibiliOriginalGroups, setBilibiliOriginalGroups] = useState<BilibiliOriginalGroupOption[]>([]);
  const [loadingBilibiliGroups, setLoadingBilibiliGroups] = useState(false);
  const [bilibiliUpInput, setBilibiliUpInput] = useState("");
  const [gettingXhsCookie, setGettingXhsCookie] = useState(false);

  const subConfig = MODULE_SUB_CONFIG[module.id] || { types: [], desc: "" };
  const scheduleOptions = useMemo(() => {
    if (SCHEDULE_OPTIONS.some((option) => option.value === schedule)) return SCHEDULE_OPTIONS;
    return [
      { label: formatScheduleOptionLabel(schedule), value: schedule },
      ...SCHEDULE_OPTIONS,
    ];
  }, [schedule]);
  const bilibiliSmartGroupOptions = useMemo(() => {
    const options = moduleConfig.followed_up_group_options || BILIBILI_GROUP_OPTIONS;
    return options.length > 0 ? options : BILIBILI_GROUP_OPTIONS;
  }, [moduleConfig.followed_up_group_options]);
  const bilibiliSmartGroupLabelLookup = useMemo(
    () => Object.fromEntries(bilibiliSmartGroupOptions.map((option) => [option.value, option.label])),
    [bilibiliSmartGroupOptions]
  );
  const bilibiliTrackedProfiles = useMemo(() => {
    const merged = new Map<string, BilibiliTrackedProfileSummary>();
    const profileGroups = [moduleConfig.creator_profiles || {}, moduleConfig.favorite_up_profiles || {}];

    profileGroups.forEach((profiles) => {
      Object.entries(profiles).forEach(([key, profile]) => {
        const uid = extractBilibiliUid(String(profile?.author_id || key || "").trim());
        if (!uid) return;
        const existing = merged.get(uid);
        const smartGroups = Array.from(new Set([
          ...(existing?.smartGroups || []),
          ...((profile?.smart_groups || []).map((item) => String(item || "").trim()).filter(Boolean)),
        ]));
        const sampleTitles = Array.from(new Set([
          ...(existing?.sampleTitles || []),
          ...((profile?.sample_titles || []).map((item) => String(item || "").trim()).filter(Boolean)),
        ])).slice(0, 3);
        merged.set(uid, {
          uid,
          author: String(profile?.author || existing?.author || uid).trim() || uid,
          smartGroups,
          latestTitle: String(profile?.latest_title || existing?.latestTitle || "").trim() || undefined,
          sampleTitles,
        });
      });
    });

    return Array.from(merged.values());
  }, [moduleConfig.creator_profiles, moduleConfig.favorite_up_profiles]);
  const bilibiliTrackedProfileMap = useMemo(
    () => new Map(bilibiliTrackedProfiles.map((profile) => [profile.uid, profile])),
    [bilibiliTrackedProfiles]
  );
  const bilibiliSmartGroupImportOptions = useMemo(() => {
    const currentSet = new Set((moduleConfig.up_uids || []).map((item) => String(item || "").trim()).filter(Boolean));
    return bilibiliSmartGroupOptions
      .map((option) => {
        const members = bilibiliTrackedProfiles.filter((profile) => profile.smartGroups.includes(option.value));
        return {
          ...option,
          totalMembers: members.length,
          importableMembers: members.filter((profile) => !currentSet.has(profile.uid)).length,
          sampleAuthors: members.slice(0, 3).map((profile) => profile.author),
        };
      })
      .filter((option) => option.totalMembers > 0);
  }, [bilibiliSmartGroupOptions, bilibiliTrackedProfiles, moduleConfig.up_uids]);
  const bilibiliActiveGroupCount = useMemo(
    () => (moduleConfig.followed_up_group_monitors || []).filter((item) => item.enabled).length,
    [moduleConfig.followed_up_group_monitors]
  );
  const bilibiliMonitorDefaults = getBilibiliMonitorDefaults(moduleConfig);

  useEffect(() => {
    api.get<ModuleConfig>(`/api/modules/${module.id}/config`)
      .then((config) => {
        if (module.id === "xiaohongshu-tracker") {
          const normalized = normalizeXhsTrackerConfig(config);
          setModuleConfig({
            ...config,
            keyword_monitors: normalized.keywordMonitors,
            following_scan: normalized.followingScan,
            following_scan_monitors: normalized.followingScanMonitors,
            creator_monitors: normalized.creatorMonitors,
          });
          return;
        }
        if (module.id === "bilibili-tracker") {
          setModuleConfig(normalizeBilibiliTrackerModuleConfig(config));
          return;
        }
        setModuleConfig(config);
      })
      .catch(() => setModuleConfig({}));

    // Load global config for semantic-scholar-tracker (for API key)
    if (module.id === "semantic-scholar-tracker") {
      api.get<{ semantic_scholar_api_key?: string }>("/api/config")
        .then((globalConfig) => {
          setModuleConfig((prev) => ({ ...prev, api_key: globalConfig.semantic_scholar_api_key || "" }));
        })
        .catch(() => {});
    }

    fetchSubscriptionDetails();
  }, [module.id]);

  useEffect(() => {
    if (module.id !== "bilibili-tracker") return;
    if (!moduleConfig.sessdata?.trim()) {
      setBilibiliOriginalGroups([]);
      return;
    }

    let cancelled = false;
    setLoadingBilibiliGroups(true);
    api.post<BilibiliFollowedUpsConfigResponse>("/api/tools/bilibili/followed-ups", {
      sessdata: moduleConfig.sessdata,
      max_count: 5000,
    })
      .then((res) => {
        if (!cancelled) {
          setBilibiliOriginalGroups(res.groups || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBilibiliOriginalGroups([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBilibiliGroups(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [module.id, moduleConfig.sessdata]);

  // Set the default selected type
  useEffect(() => {
    if (subConfig.types.length > 0 && !selectedType) {
      setSelectedType(subConfig.types[0].type);
    }
  }, [subConfig.types, selectedType]);

  async function fetchSubscriptionDetails() {
    setLoadingDetails(true);
    try {
      const data = await api.get<SubDetailData>(`/api/modules/${module.id}/subscriptions/detail`);
      setSubDetails(data);
    } catch {
      setSubDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }

  async function saveRuntimeSettings() {
    try {
      await api.patch(`/api/modules/${module.id}`, {
        enabled: moduleEnabled,
        schedule: schedule,
      });
      toast.success("Saved");
      const modulesRes = await api.get<{ modules: FeedModule[] }>("/api/modules");
      if (modulesRes?.modules) {
        setFeedModules(modulesRes.modules);
      }
    } catch {
      toast.error("Save failed");
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      await api.post(`/api/modules/${module.id}/run`, {});
      toast.success("Run started");
    } catch {
      toast.error("Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function addSubscription() {
    if (!inputValue.trim()) {
      toast.error("Please enter a value");
      return;
    }
    if (!selectedType) {
      toast.error("Please choose a subscription type");
      return;
    }
    try {
      await api.post(`/api/modules/${module.id}/subscriptions`, {
        type: selectedType,
        value: inputValue.trim()
      });
      toast.success("Subscription added");
      fetchSubscriptionDetails();
      setInputValue("");
      setShowAddForm(false);
    } catch (err: any) {
      console.error("Add subscription error:", err);
      toast.error(`Failed to add: ${err.message || "Please check your network connection"}`);
    }
  }

  async function removeSubscription(type: string, value: string) {
    try {
      await api.delete(`/api/modules/${module.id}/subscriptions`, { type, value } as any);
      toast.success("Subscription removed");
      fetchSubscriptionDetails();
    } catch {
      toast.error("Failed to remove");
    }
  }

  async function toggleSubscription(type: string, value: string, isActive: boolean) {
    if (isActive) {
      // Disable (soft delete)
      await removeSubscription(type, value);
    } else {
      // Re-add
      try {
        await api.post(`/api/modules/${module.id}/subscriptions`, { type, value });
        toast.success("Subscription restored");
        fetchSubscriptionDetails();
      } catch {
        toast.error("Failed to restore");
      }
    }
  }

  function formatDateTime(isoString: string): string {
    try {
      const date = new Date(isoString);
      return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return isoString;
    }
  }

  const currentTypeConfig = subConfig.types.find(t => t.type === selectedType);

  async function saveModuleConfig(patch: Partial<ModuleConfig>, successTitle = "Saved") {
    try {
      const nextConfig = { ...moduleConfig, ...patch };
      await api.post(`/api/modules/${module.id}/config`, nextConfig);
      setModuleConfig(nextConfig);
      toast.success(successTitle);
    } catch {
      toast.error("Save failed");
    }
  }

  async function handleFetchXhsCookieFromBrowser() {
    setGettingXhsCookie(true);
    try {
      const result = await xiaohongshuGetCookieFromBrowser();
      if (!result.success) {
        toast.error(result.error || "Failed to get Xiaohongshu cookie");
        return;
      }
      setModuleConfig((prev) => ({
        ...prev,
        web_session: result.web_session || prev.web_session || "",
        id_token: result.id_token || prev.id_token || "",
        auth_ready: true,
        auth_source: "global",
      }));
      toast.success(result.message || "Reusing the Xiaohongshu cookie from the manual tool");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to get Xiaohongshu cookie");
    } finally {
      setGettingXhsCookie(false);
    }
  }

  function setBilibiliDailyDynamicMonitors(nextMonitors: BilibiliDailyDynamicMonitor[]) {
    const normalized = nextMonitors.map((item) => normalizeBilibiliDailyDynamicMonitor(item, bilibiliMonitorDefaults));
    const activeKeywords = parseBilibiliStringListInput(
      normalized
        .filter((item) => item.enabled)
        .flatMap((item) => item.keywords || [])
        .join(", ")
    );
    setModuleConfig({
      ...moduleConfig,
      daily_dynamic_monitors: normalized,
      keywords: activeKeywords,
      enable_keyword_search: normalized.some((item) => item.enabled),
    });
  }

  function setBilibiliGroupMonitors(nextMonitors: BilibiliFollowedGroupMonitor[]) {
    const normalized = nextMonitors.map((item) => normalizeBilibiliFollowedGroupMonitor(item, bilibiliSmartGroupLabelLookup, bilibiliMonitorDefaults));
    setModuleConfig({
      ...moduleConfig,
      followed_up_group_monitors: normalized,
      followed_up_groups: normalized.filter((item) => item.enabled).map((item) => item.group_value),
    });
  }

  function toggleBilibiliGroup(group: string) {
    const current = moduleConfig.followed_up_group_monitors || [];
    const existing = current.find((item) => item.group_value === group);
    const next = existing
      ? current.map((item) => item.group_value === group ? { ...item, enabled: !item.enabled } : item)
      : [
          ...current,
          normalizeBilibiliFollowedGroupMonitor({
            group_value: group,
            label: bilibiliSmartGroupLabelLookup[group] || group,
            enabled: true,
          }, bilibiliSmartGroupLabelLookup, bilibiliMonitorDefaults),
        ];
    setBilibiliGroupMonitors(next);
  }

  function toggleBilibiliOriginalGroup(groupId: number) {
    const current = moduleConfig.followed_up_original_groups || [];
    const next = current.includes(groupId)
      ? current.filter((item) => item !== groupId)
      : [...current, groupId];
    setModuleConfig({ ...moduleConfig, followed_up_original_groups: next });
  }

  function toggleXhsCreatorGroup(group: string) {
    const current = moduleConfig.creator_groups || [];
    const next = current.includes(group)
      ? current.filter((item) => item !== group)
      : [...current, group];
    setModuleConfig({ ...moduleConfig, creator_groups: next });
  }

  function buildNextXhsFollowingScan(
    nextMonitors: XHSTrackerFollowingScanMonitor[],
    scanOverrides: Partial<XHSTrackerFollowingScan> = {},
  ) {
    const baseScan = moduleConfig.following_scan || createFollowingScan();
    const primaryMonitor = nextMonitors.find((monitor) => monitor.enabled) || nextMonitors[0];
    const nextKeywords = Array.from(new Set(
      nextMonitors.flatMap((monitor) => monitor.keywords || []).filter((keyword) => keyword.trim())
    ));

    return createFollowingScan({
      ...baseScan,
      keywords: nextKeywords,
      fetch_limit: primaryMonitor?.fetch_limit ?? baseScan.fetch_limit,
      recent_days: primaryMonitor?.recent_days ?? baseScan.recent_days,
      sort_by: primaryMonitor?.sort_by ?? baseScan.sort_by,
      keyword_filter: primaryMonitor?.keyword_filter ?? baseScan.keyword_filter,
      include_comments: primaryMonitor?.include_comments ?? baseScan.include_comments,
      comments_limit: primaryMonitor?.comments_limit ?? baseScan.comments_limit,
      comments_sort_by: primaryMonitor?.comments_sort_by ?? baseScan.comments_sort_by,
      ...scanOverrides,
    });
  }

  function setXhsFollowingScanMonitors(
    nextMonitors: XHSTrackerFollowingScanMonitor[],
    scanOverrides: Partial<XHSTrackerFollowingScan> = {},
  ) {
    setModuleConfig({
      ...moduleConfig,
      following_scan_monitors: nextMonitors,
      following_scan: buildNextXhsFollowingScan(nextMonitors, scanOverrides),
    });
  }

  function toggleXhsCreatorPush() {
    setModuleConfig({
      ...moduleConfig,
      creator_push_enabled: !(moduleConfig.creator_push_enabled ?? false),
    });
  }

  function getXhsCreatorMonitorGroupLabels(monitor: XHSTrackerCreatorMonitor): string[] {
    const normalizedUserId = normalizeXhsProfileUserId(monitor.user_id);
    const profile = moduleConfig.creator_profiles?.[normalizedUserId];
    const profileLabels = (profile?.smart_group_labels || []).map((item) => String(item || "").trim()).filter(Boolean);
    if (profileLabels.length > 0) return profileLabels;
    return (monitor.smart_group_labels || []).map((item) => String(item || "").trim()).filter(Boolean);
  }

  function toggleBilibiliDynamicType(type: number) {
    const current = moduleConfig.follow_feed_types || [8, 2, 4, 64];
    if (current.includes(type) && current.length === 1) {
      return;
    }
    const next = current.includes(type)
      ? current.filter((item) => item !== type)
      : [...current, type].sort((a, b) => a - b);
    setModuleConfig({ ...moduleConfig, follow_feed_types: next });
  }

  function addBilibiliManualUps() {
    const parsed = parseBilibiliStringListInput(bilibiliUpInput)
      .map((item) => extractBilibiliUid(item))
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (parsed.length === 0) {
      toast.error("Please enter a valid creator UID or space link");
      return;
    }
    const next = Array.from(new Set([...(moduleConfig.up_uids || []), ...parsed]));
    setModuleConfig({ ...moduleConfig, up_uids: next });
    setBilibiliUpInput("");
  }

  function removeBilibiliManualUp(uid: string) {
    setModuleConfig({
      ...moduleConfig,
      up_uids: (moduleConfig.up_uids || []).filter((item) => item !== uid),
    });
  }

  function importBilibiliSmartGroupMembers(groupValue: string) {
    const memberIds = bilibiliTrackedProfiles
      .filter((profile) => profile.smartGroups.includes(groupValue))
      .map((profile) => profile.uid);
    if (memberIds.length === 0) {
      toast.info("No importable creators in this smart group yet");
      return;
    }
    const next = Array.from(new Set([...(moduleConfig.up_uids || []), ...memberIds]));
    if (next.length === (moduleConfig.up_uids || []).length) {
      toast.info("All creators in this smart group are already pinned");
      return;
    }
    setModuleConfig({ ...moduleConfig, up_uids: next });
    toast.success(`Imported ${next.length - (moduleConfig.up_uids || []).length} pinned creators`);
  }

  return (
    <PageContainer>
      <PageHeader
        title={module.name}
        subtitle={module.schedule}
        icon={Clock}
        actions={
          <>
            <button
              onClick={onBack}
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
                border: "none",
                cursor: "pointer",
              }}
            >
              <ArrowLeft style={{ width: "16px", height: "16px" }} />
              Back
            </button>
            <button
              onClick={runNow}
              disabled={running}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 20px",
                borderRadius: "var(--radius-full)",
                background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              <Play style={{ width: "16px", height: "16px" }} />
              {running ? "Running..." : "Run now"}
            </button>
          </>
        }
      />

      <PageContent maxWidth="700px">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Usage guide mini card */}
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            padding: "10px 14px",
            borderRadius: "var(--radius-md)",
            background: "rgba(99, 205, 218, 0.1)",
            border: "1px solid rgba(99, 205, 218, 0.3)",
          }}>
            <Info style={{ width: "16px", height: "16px", color: "#63CDDA", flexShrink: 0, marginTop: "2px" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "2px" }}>
                {subConfig.desc || `${module.name} module`}
              </div>
              {subConfig.types.length > 0 && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                  Supported types:{subConfig.types.map(t => (
                    <span key={t.type} style={{ color: "var(--text-secondary)" }}>· {t.label}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Run settings row */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              <div
                onClick={() => { setModuleEnabled(!moduleEnabled); }}
                style={{
                  width: "40px",
                  height: "22px",
                  borderRadius: "11px",
                  background: moduleEnabled ? "var(--color-primary)" : "var(--text-muted)",
                  position: "relative",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
              >
                <div style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  background: "white",
                  position: "absolute",
                  top: "2px",
                  left: moduleEnabled ? "20px" : "2px",
                  transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-main)" }}>
                {moduleEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            <div style={{ width: "1px", height: "20px", background: "var(--border-light)" }} />

            <Clock style={{ width: "14px", height: "14px", color: "var(--text-muted)", flexShrink: 0 }} />
            <select
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-app)",
                color: "var(--text-main)",
                fontSize: "0.8125rem",
                outline: "none",
                cursor: "pointer",
              }}
            >
              {scheduleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {module.next_run && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "auto" }}>
                Next: {new Date(module.next_run).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}

            <button
              onClick={saveRuntimeSettings}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius-md)",
                background: "var(--color-primary)",
                color: "white",
                fontSize: "0.75rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Save
            </button>
          </div>

          {/* Active subscriptions card */}
          <Card title={`Subscribed (${subDetails?.subscriptions?.filter(s => s.is_active !== false).length || 0})`} icon={<Calendar style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

              {/* Add subscription button */}
              {!showAddForm && subConfig.types.length > 0 && (
                <button
                  onClick={() => {
                    if (!selectedType && subConfig.types.length > 0) {
                      setSelectedType(subConfig.types[0].type);
                    }
                    setShowAddForm(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "12px 16px",
                    borderRadius: "var(--radius-md)",
                    border: "1px dashed var(--border-light)",
                    background: "var(--bg-hover)",
                    color: "var(--text-secondary)",
                    fontSize: "0.875rem",
                    cursor: "pointer",
                    width: "100%",
                  }}
                >
                  <Plus style={{ width: "16px", height: "16px" }} />
                  Add subscription
                </button>
              )}

              {/* Add subscription form */}
              {showAddForm && (
                <div style={{
                  padding: "16px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border-light)",
                }}>
                  {/* Type selection */}
                  {subConfig.types.length > 1 && (
                    <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                      {subConfig.types.map((t) => (
                        <button
                          key={t.type}
                          onClick={() => { setSelectedType(t.type); setInputValue(""); }}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "var(--radius-md)",
                            border: "1px solid var(--border-light)",
                            background: selectedType === t.type ? "var(--color-primary)" : "var(--bg-app)",
                            color: selectedType === t.type ? "white" : "var(--text-main)",
                            fontSize: "0.8125rem",
                            cursor: "pointer",
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Input field */}
                  <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder={currentTypeConfig?.placeholder || "Enter..."}
                      style={{
                        flex: 1,
                        padding: "10px 14px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-app)",
                        color: "var(--text-main)",
                        fontSize: "0.875rem",
                        outline: "none",
                      }}
                      onKeyDown={(e) => {
                        if (isActionEnterKey(e)) {
                          e.preventDefault();
                          addSubscription();
                        }
                      }}
                    />
                    <button
                      onClick={addSubscription}
                      style={{
                        padding: "10px 20px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--color-primary)",
                        color: "white",
                        fontSize: "0.875rem",
                        fontWeight: 600,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setShowAddForm(false); setInputValue(""); }}
                      style={{
                        padding: "10px",
                        borderRadius: "var(--radius-md)",
                        background: "transparent",
                        color: "var(--text-muted)",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <X style={{ width: "18px", height: "18px" }} />
                    </button>
                  </div>

                  {/* Example hint */}
                  {currentTypeConfig?.example && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-md)",
                      background: "rgba(248, 181, 0, 0.1)",
                      border: "1px dashed rgba(248, 181, 0, 0.3)",
                    }}>
                      <HelpCircle style={{ width: "14px", height: "14px", color: "#F8B500" }} />
                      <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                        Example: <code style={{ background: "rgba(248,181,0,0.15)", padding: "2px 6px", borderRadius: "4px", color: "#B8860B" }}>{currentTypeConfig.example}</code>
                      </span>
                    </div>
                  )}

                  {/* Quick restore of past subscriptions */}
                  {subDetails && subDetails.subscriptions.filter(s => s.is_active === false).length > 0 && (
                    <div style={{ marginTop: "12px" }}>
                      <div style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        marginBottom: "8px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                      }}>
                        <History style={{ width: "12px", height: "12px" }} />
                        Click to restore past subscriptions
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {subDetails.subscriptions
                          .filter(s => s.is_active === false)
                          .slice(0, 5)
                          .map((sub, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                setSelectedType(sub.type);
                                setInputValue(sub.value);
                              }}
                              style={{
                                padding: "4px 10px",
                                borderRadius: "9999px",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-app)",
                                color: "var(--text-muted)",
                                fontSize: "0.75rem",
                                cursor: "pointer",
                                textDecoration: "line-through",
                              }}
                            >
                              {sub.value}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Subscription list */}
              {loadingDetails ? (
                <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  Loading...
                </div>
              ) : !subDetails || subDetails.subscriptions.filter(s => s.is_active !== false).length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  No subscriptions yet — add one above
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {subDetails.subscriptions
                    .filter(s => s.is_active !== false)
                    .map((sub, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 12px",
                          borderRadius: "var(--radius-md)",
                          background: "var(--bg-hover)",
                          border: "1px solid var(--border-light)",
                        }}
                      >
                        {/* Toggle button */}
                        <div
                          onClick={() => toggleSubscription(sub.type, sub.value, true)}
                          style={{
                            width: "36px",
                            height: "20px",
                            borderRadius: "10px",
                            background: "#10B981",
                            position: "relative",
                            cursor: "pointer",
                            transition: "background 0.2s",
                            flexShrink: 0,
                          }}
                        >
                          <div style={{
                            width: "16px",
                            height: "16px",
                            borderRadius: "50%",
                            background: "white",
                            position: "absolute",
                            top: "2px",
                            left: "18px",
                            transition: "left 0.2s",
                          }} />
                        </div>

                        <span style={{
                          fontSize: "0.65rem",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: TYPE_COLORS[sub.type] || "var(--color-primary)",
                          color: "white",
                          fontWeight: 600,
                          flexShrink: 0,
                        }}>
                          {TYPE_LABELS[sub.type] || sub.type}
                        </span>
                        <span style={{
                          flex: 1,
                          fontSize: "0.875rem",
                          color: "var(--text-main)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {sub.value}
                        </span>
                        <span style={{
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}>
                          <User style={{ width: "10px", height: "10px" }} />
                          {sub.added_by}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {formatDateTime(sub.added_at)}
                        </span>
                        <button
                          onClick={() => removeSubscription(sub.type, sub.value)}
                          style={{
                            padding: "4px",
                            borderRadius: "4px",
                            background: "transparent",
                            color: "var(--text-muted)",
                            border: "none",
                            cursor: "pointer",
                            opacity: 0.6,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                        >
                          <Trash2 style={{ width: "14px", height: "14px" }} />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </Card>

          {/* Collapsed past subscriptions */}
          {subDetails && subDetails.subscriptions.filter(s => s.is_active === false).length > 0 && (
            <Card>
              <div
                onClick={() => setShowHistory(!showHistory)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  color: "var(--text-secondary)",
                }}
              >
                <History style={{ width: "16px", height: "16px" }} />
                <span>Removed subscriptions ({subDetails.subscriptions.filter(s => s.is_active === false).length})</span>
                <span style={{ marginLeft: "auto", transform: showHistory ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▼</span>
              </div>

              {showHistory && (
                <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {subDetails.subscriptions
                    .filter(s => s.is_active === false)
                    .map((sub, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 12px",
                          borderRadius: "var(--radius-md)",
                          background: "var(--bg-hover)",
                          opacity: 0.7,
                        }}
                      >
                        {/* Toggle button - restorable */}
                        <div
                          onClick={() => toggleSubscription(sub.type, sub.value, false)}
                          style={{
                            width: "36px",
                            height: "20px",
                            borderRadius: "10px",
                            background: "var(--text-muted)",
                            position: "relative",
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          <div style={{
                            width: "16px",
                            height: "16px",
                            borderRadius: "50%",
                            background: "white",
                            position: "absolute",
                            top: "2px",
                            left: "2px",
                          }} />
                        </div>

                        <span style={{
                          fontSize: "0.65rem",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: "var(--text-muted)",
                          color: "white",
                          fontWeight: 600,
                        }}>
                          {TYPE_LABELS[sub.type] || sub.type}
                        </span>
                        <span style={{ flex: 1, fontSize: "0.875rem", color: "var(--text-main)", textDecoration: "line-through" }}>
                          {sub.value}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {formatDateTime(sub.added_at)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </Card>
          )}

          {/* Module-specific config */}
          {module.id === "bilibili-tracker" && (
            <Card title="Bilibili Login" icon={<User style={{ width: "18px", height: "18px", color: "var(--color-secondary)" }} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                    SESSDATA
                  </label>
                  <input
                    type="password"
                    value={moduleConfig.sessdata || ""}
                    onChange={(e) => setModuleConfig({ ...moduleConfig, sessdata: e.target.value })}
                    placeholder="Copy the SESSDATA value from Cookie-Editor"
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-app)",
                      color: "var(--text-main)",
                      fontSize: "0.875rem",
                      outline: "none",
                      fontFamily: "monospace",
                    }}
                  />
                </div>
                <CookieGuide platform="bilibili" cookieName="SESSDATA" />
                <button
                  onClick={async () => {
                    await saveModuleConfig({
                      sessdata: moduleConfig.sessdata || "",
                    }, "Cookie saved");
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save cookie
                </button>
              </div>
            </Card>
          )}

          {module.id === "bilibili-tracker" && (
            <Card title="Automatic Crawl Strategy" icon={<span style={{ fontSize: "16px" }}>🕸️</span>}>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border-light)",
                }}>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>
                    Reuses the manual tool's real monitor definitions
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    Instead of maintaining a separate simplified keyword set, this directly edits the Bilibili monitor definitions the daily intel actually uses — persistent keyword monitors, pinned creators, original groups, and smart-group filters.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    <span>Keyword monitors: {(moduleConfig.daily_dynamic_monitors || []).length}</span>
                    <span>Pinned creators: {(moduleConfig.up_uids || []).length}</span>
                    <span>Smart groups enabled: {bilibiliActiveGroupCount}</span>
                  </div>
                </div>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "12px",
                }}>
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    padding: "12px 14px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border-light)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
                        <span style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>
                          Auto-crawl follow feed
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                          Periodically fetches your follow feed, then filters it with the keyword monitors, pinned creators, and group definitions below.
                        </span>
                      </div>
                      <div
                        onClick={() => setModuleConfig({ ...moduleConfig, follow_feed: !(moduleConfig.follow_feed ?? false) })}
                        style={{
                          width: "40px",
                          height: "22px",
                          borderRadius: "11px",
                          background: (moduleConfig.follow_feed ?? false) ? "var(--color-primary)" : "var(--text-muted)",
                          position: "relative",
                          cursor: "pointer",
                          transition: "background 0.2s",
                          flexShrink: 0,
                        }}
                      >
                        <div style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          background: "white",
                          position: "absolute",
                          top: "2px",
                          left: (moduleConfig.follow_feed ?? false) ? "20px" : "2px",
                          transition: "left 0.2s",
                        }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Candidate pool limit</label>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={moduleConfig.fetch_follow_limit ?? 50}
                        onChange={(e) => setModuleConfig({
                          ...moduleConfig,
                          fetch_follow_limit: normalizeBilibiliPositiveInt(e.target.value, 50, 500),
                        })}
                        style={{
                          width: "90px",
                          padding: "8px 10px",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-app)",
                          color: "var(--text-main)",
                          fontSize: "0.8125rem",
                          outline: "none",
                        }}
                      />
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Only affects the shared candidate pool and the full-feed fallback crawl when no monitors exist
                      </span>
                    </div>
                  </div>

                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    padding: "12px 14px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border-light)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
                        <span style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>
                          Enable keyword filtering
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                          When off, all posts in the selected scope are fetched; when on, only content matching keyword monitor definitions is kept.
                        </span>
                      </div>
                      <div
                        onClick={() => setModuleConfig({ ...moduleConfig, keyword_filter: !(moduleConfig.keyword_filter ?? true) })}
                        style={{
                          width: "40px",
                          height: "22px",
                          borderRadius: "11px",
                          background: (moduleConfig.keyword_filter ?? true) ? "var(--color-primary)" : "var(--text-muted)",
                          position: "relative",
                          cursor: "pointer",
                          transition: "background 0.2s",
                          flexShrink: 0,
                        }}
                      >
                        <div style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          background: "white",
                          position: "absolute",
                          top: "2px",
                          left: (moduleConfig.keyword_filter ?? true) ? "20px" : "2px",
                          transition: "left 0.2s",
                        }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Group filtering</label>
                      <select
                        value={moduleConfig.followed_up_filter_mode || "and"}
                        onChange={(e) => setModuleConfig({
                          ...moduleConfig,
                          followed_up_filter_mode: e.target.value === "smart_only" ? "smart_only" : "and",
                        })}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border-light)",
                          background: "var(--bg-app)",
                          color: "var(--text-main)",
                          fontSize: "0.8125rem",
                          outline: "none",
                        }}
                      >
                        <option value="and">Original groups + smart groups</option>
                        <option value="smart_only">Smart groups only</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                    Post types
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {BILIBILI_DYNAMIC_TYPE_OPTIONS.map((option) => {
                      const active = (moduleConfig.follow_feed_types || [8, 2, 4, 64]).includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => toggleBilibiliDynamicType(option.value)}
                          style={{
                            padding: "7px 12px",
                            borderRadius: "999px",
                            border: `1px solid ${active ? "var(--color-primary)" : "var(--border-light)"}`,
                            background: active ? "rgba(99, 102, 241, 0.12)" : "var(--bg-app)",
                            color: active ? "var(--color-primary)" : "var(--text-secondary)",
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border-light)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>Persistent keyword monitors</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6, marginTop: "4px" }}>
                        Each one reuses the manual tool's `daily_dynamic_monitors` definitions; configure keywords, tag words, day range, item limit, and page scan limit here. Crawling stops at the time window — whatever was fetched is kept.
                      </div>
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Enabled {(moduleConfig.daily_dynamic_monitors || []).filter((item) => item.enabled).length} / {(moduleConfig.daily_dynamic_monitors || []).length}
                    </span>
                  </div>
                  {(moduleConfig.daily_dynamic_monitors || []).length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {(moduleConfig.daily_dynamic_monitors || []).map((monitor) => (
                        <div
                          key={monitor.id}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "10px",
                            padding: "12px 14px",
                            borderRadius: "var(--radius-md)",
                            background: "var(--bg-app)",
                            border: "1px solid var(--border-light)",
                          }}
                        >
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <input
                              type="text"
                              value={monitor.label}
                              onChange={(e) => setBilibiliDailyDynamicMonitors(
                                (moduleConfig.daily_dynamic_monitors || []).map((item) =>
                                  item.id === monitor.id ? normalizeBilibiliDailyDynamicMonitor({ ...item, label: e.target.value }) : item
                                )
                              )}
                              placeholder="Monitor name"
                              style={{
                                flex: 1,
                                minWidth: "180px",
                                padding: "10px 14px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-hover)",
                                color: "var(--text-main)",
                                fontSize: "0.875rem",
                                outline: "none",
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => setBilibiliDailyDynamicMonitors(
                                (moduleConfig.daily_dynamic_monitors || []).map((item) =>
                                  item.id === monitor.id ? { ...item, enabled: !item.enabled } : item
                                )
                              )}
                              style={{
                                padding: "8px 14px",
                                borderRadius: "var(--radius-md)",
                                border: `1px solid ${monitor.enabled ? "var(--color-primary)" : "var(--border-light)"}`,
                                background: monitor.enabled ? "var(--color-primary)" : "var(--bg-app)",
                                color: monitor.enabled ? "white" : "var(--text-secondary)",
                                fontSize: "0.8125rem",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {monitor.enabled ? "On" : "Off"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setBilibiliDailyDynamicMonitors(
                                (moduleConfig.daily_dynamic_monitors || []).filter((item) => item.id !== monitor.id)
                              )}
                              style={{
                                padding: "8px 14px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-app)",
                                color: "var(--text-secondary)",
                                fontSize: "0.8125rem",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                          <input
                            type="text"
                            value={(monitor.keywords || []).join(", ")}
                            onChange={(e) => setBilibiliDailyDynamicMonitors(
                              (moduleConfig.daily_dynamic_monitors || []).map((item) =>
                                item.id === monitor.id ? normalizeBilibiliDailyDynamicMonitor({
                                  ...item,
                                  keywords: parseBilibiliStringListInput(e.target.value),
                                }) : item
                              )
                            )}
                            placeholder="Keywords: research, AI, papers"
                            style={{
                              padding: "10px 14px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-hover)",
                              color: "var(--text-main)",
                              fontSize: "0.875rem",
                              outline: "none",
                            }}
                          />
                          <input
                            type="text"
                            value={(monitor.tag_filters || []).join(", ")}
                            onChange={(e) => setBilibiliDailyDynamicMonitors(
                              (moduleConfig.daily_dynamic_monitors || []).map((item) =>
                                item.id === monitor.id ? normalizeBilibiliDailyDynamicMonitor({
                                  ...item,
                                  tag_filters: parseBilibiliStringListInput(e.target.value),
                                }) : item
                              )
                            )}
                            placeholder="Tag words: robotics, Agent, multimodal"
                            style={{
                              padding: "10px 14px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-hover)",
                              color: "var(--text-main)",
                              fontSize: "0.875rem",
                              outline: "none",
                            }}
                          />
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Day range</label>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={monitor.days_back ?? bilibiliMonitorDefaults.daysBack}
                              onChange={(e) => setBilibiliDailyDynamicMonitors(
                                (moduleConfig.daily_dynamic_monitors || []).map((item) =>
                                  item.id === monitor.id ? normalizeBilibiliDailyDynamicMonitor({
                                    ...item,
                                    days_back: Number(e.target.value || bilibiliMonitorDefaults.daysBack),
                                  }, bilibiliMonitorDefaults) : item
                                )
                              )}
                              style={{
                                width: "88px",
                                padding: "8px 10px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-hover)",
                                color: "var(--text-main)",
                                fontSize: "0.8125rem",
                                outline: "none",
                              }}
                            />
                            <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Item limit</label>
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              value={monitor.limit ?? bilibiliMonitorDefaults.limit}
                              onChange={(e) => setBilibiliDailyDynamicMonitors(
                                (moduleConfig.daily_dynamic_monitors || []).map((item) =>
                                  item.id === monitor.id ? normalizeBilibiliDailyDynamicMonitor({
                                    ...item,
                                    limit: Number(e.target.value || bilibiliMonitorDefaults.limit),
                                  }, bilibiliMonitorDefaults) : item
                                )
                              )}
                              style={{
                                width: "96px",
                                padding: "8px 10px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-hover)",
                                color: "var(--text-main)",
                                fontSize: "0.8125rem",
                                outline: "none",
                              }}
                            />
                            <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Pages to scan</label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={monitor.page_limit ?? bilibiliMonitorDefaults.pageLimit}
                              onChange={(e) => setBilibiliDailyDynamicMonitors(
                                (moduleConfig.daily_dynamic_monitors || []).map((item) =>
                                  item.id === monitor.id ? normalizeBilibiliDailyDynamicMonitor({
                                    ...item,
                                    page_limit: Number(e.target.value || bilibiliMonitorDefaults.pageLimit),
                                  }, bilibiliMonitorDefaults) : item
                                )
                              )}
                              style={{
                                width: "96px",
                                padding: "8px 10px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-hover)",
                                color: "var(--text-main)",
                                fontSize: "0.8125rem",
                                outline: "none",
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                      No keyword monitors yet. Once added, scheduled intel directly reuses this definition's keywords, tag words, time window, item limit, and page scan limit.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setBilibiliDailyDynamicMonitors([
                      ...(moduleConfig.daily_dynamic_monitors || []),
                      normalizeBilibiliDailyDynamicMonitor({
                        label: `Daily monitor ${(moduleConfig.daily_dynamic_monitors || []).length + 1}`,
                      }, bilibiliMonitorDefaults),
                    ])}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "var(--radius-md)",
                      background: "var(--bg-app)",
                      color: "var(--text-main)",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      border: "1px solid var(--border-light)",
                      cursor: "pointer",
                      alignSelf: "flex-start",
                    }}
                  >
                    Add keyword monitor
                  </button>
                </div>

                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border-light)",
                }}>
                  <div>
                    <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>Pinned creators</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6, marginTop: "4px" }}>
                      This maintains the `up_uids` that actually enter daily intel. Scheduled crawls reuse the same post fetching, card preview, and source-link logic as follow monitors; enter UIDs / space links manually or bulk-import from existing smart group results.
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Day range</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={moduleConfig.fixed_up_days_back ?? BILIBILI_FIXED_UP_MONITOR_DEFAULT_DAYS_BACK}
                      onChange={(e) => setModuleConfig({
                        ...moduleConfig,
                        fixed_up_days_back: normalizeBilibiliPositiveInt(
                          e.target.value,
                          moduleConfig.fixed_up_days_back ?? BILIBILI_FIXED_UP_MONITOR_DEFAULT_DAYS_BACK,
                          365,
                        ),
                      })}
                      style={{
                        width: "96px",
                        padding: "8px 10px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-app)",
                        color: "var(--text-main)",
                        fontSize: "0.8125rem",
                        outline: "none",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Pinned creators are crawled up to this time window — it stops at the cutoff and returns whatever was fetched
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      value={bilibiliUpInput}
                      onChange={(e) => setBilibiliUpInput(e.target.value)}
                      placeholder="Enter creator UID or https://space.bilibili.com/xxxx"
                      style={{
                        flex: 1,
                        minWidth: "240px",
                        padding: "10px 14px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-app)",
                        color: "var(--text-main)",
                        fontSize: "0.875rem",
                        outline: "none",
                      }}
                      onKeyDown={(e) => {
                        if (isActionEnterKey(e)) {
                          e.preventDefault();
                          addBilibiliManualUps();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addBilibiliManualUps}
                      style={{
                        padding: "10px 16px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--color-primary)",
                        color: "white",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Pin creator
                    </button>
                  </div>
                  {(moduleConfig.up_uids || []).length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {(moduleConfig.up_uids || []).map((uid) => {
                        const profile = bilibiliTrackedProfileMap.get(uid);
                        const smartGroups = (profile?.smartGroups || []).map((groupValue) => bilibiliSmartGroupLabelLookup[groupValue] || groupValue);
                        const latestTitle = profile?.latestTitle || profile?.sampleTitles?.[0];
                        return (
                          <div
                            key={uid}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: "12px",
                              padding: "12px 14px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-app)",
                              textAlign: "left",
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                              <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>
                                {profile?.author || `UP ${uid}`}
                              </div>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                                {uid}
                              </div>
                              {smartGroups.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                  {smartGroups.map((label) => (
                                    <span
                                      key={`${uid}-${label}`}
                                      style={{
                                        padding: "3px 8px",
                                        borderRadius: "999px",
                                        background: "rgba(99, 102, 241, 0.12)",
                                        color: "var(--color-primary)",
                                        fontSize: "0.6875rem",
                                        fontWeight: 600,
                                      }}
                                    >
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {latestTitle && (
                                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                                  Latest content: {latestTitle}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeBilibiliManualUp(uid)}
                              style={{
                                padding: "6px 10px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-hover)",
                                color: "var(--text-secondary)",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                cursor: "pointer",
                                flexShrink: 0,
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                      No pinned creators yet. Keep only authors worth watching long-term; once saved they join the daily intel crawl directly.
                    </div>
                  )}
                  {bilibiliSmartGroupImportOptions.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                        Import pinned creators from smart groups
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {bilibiliSmartGroupImportOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => importBilibiliSmartGroupMembers(option.value)}
                            disabled={option.importableMembers === 0}
                            title={option.sampleAuthors.length > 0 ? option.sampleAuthors.join(" / ") : option.label}
                            style={{
                              padding: "8px 12px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: option.importableMembers > 0 ? "var(--bg-app)" : "var(--bg-hover)",
                              color: option.importableMembers > 0 ? "var(--text-main)" : "var(--text-muted)",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              cursor: option.importableMembers > 0 ? "pointer" : "not-allowed",
                              opacity: option.importableMembers > 0 ? 1 : 0.7,
                            }}
                          >
                            {option.label} · importable {option.importableMembers} / {option.totalMembers}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border-light)",
                }}>
                  <div>
                    <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>Group push</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6, marginTop: "4px" }}>
                      Smart-group tracking reuses the manual tool's targeted post fetching. Each group can have its own day range, retention limit, and page scan limit.
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                    <span>Original groups: {(moduleConfig.followed_up_original_groups || []).length}</span>
                    <span>Smart groups: {bilibiliActiveGroupCount}</span>
                    <span>Selecting none means no group filtering</span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                      Enable original group push
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {loadingBilibiliGroups ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Reading Bilibili original groups...</span>
                      ) : bilibiliOriginalGroups.length > 0 ? (
                        bilibiliOriginalGroups.map((group) => {
                          const active = (moduleConfig.followed_up_original_groups || []).includes(group.tag_id);
                          return (
                            <button
                              key={group.tag_id}
                              type="button"
                              onClick={() => toggleBilibiliOriginalGroup(group.tag_id)}
                              title={group.tip || group.name}
                              style={{
                                padding: "7px 12px",
                                borderRadius: "999px",
                                border: `1px solid ${active ? "#FB7299" : "var(--border-light)"}`,
                                background: active ? "rgba(251, 114, 153, 0.12)" : "var(--bg-app)",
                                color: active ? "#D64078" : "var(--text-secondary)",
                                fontSize: "0.8125rem",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {group.name} {group.count ? `· ${group.count}` : ""}
                            </button>
                          );
                        })
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          After saving a valid SESSDATA, your original Bilibili follow groups are read automatically.
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                      Enable smart group push
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {bilibiliSmartGroupOptions.map((option) => {
                        const active = (moduleConfig.followed_up_group_monitors || []).some(
                          (item) => item.group_value === option.value && item.enabled
                        );
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => toggleBilibiliGroup(option.value)}
                            style={{
                              padding: "7px 12px",
                              borderRadius: "999px",
                              border: `1px solid ${active ? "var(--color-primary)" : "var(--border-light)"}`,
                              background: active ? "rgba(99, 102, 241, 0.12)" : "var(--bg-app)",
                              color: active ? "var(--color-primary)" : "var(--text-secondary)",
                              fontSize: "0.8125rem",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {(moduleConfig.followed_up_group_monitors || []).length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {(moduleConfig.followed_up_group_monitors || []).map((monitor) => (
                        <div
                          key={monitor.id}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "10px",
                            padding: "12px 14px",
                            borderRadius: "var(--radius-md)",
                            background: "var(--bg-app)",
                            border: "1px solid var(--border-light)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>{monitor.label}</div>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                                Group key: {monitor.group_value}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => setBilibiliGroupMonitors(
                                  (moduleConfig.followed_up_group_monitors || []).map((item) =>
                                    item.id === monitor.id ? normalizeBilibiliFollowedGroupMonitor({
                                      ...item,
                                      enabled: !item.enabled,
                                    }, bilibiliSmartGroupLabelLookup, bilibiliMonitorDefaults) : item
                                  )
                                )}
                                style={{
                                  padding: "8px 14px",
                                  borderRadius: "var(--radius-md)",
                                  border: `1px solid ${monitor.enabled ? "var(--color-primary)" : "var(--border-light)"}`,
                                  background: monitor.enabled ? "var(--color-primary)" : "var(--bg-app)",
                                  color: monitor.enabled ? "white" : "var(--text-secondary)",
                                  fontSize: "0.8125rem",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                {monitor.enabled ? "On" : "Off"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setBilibiliGroupMonitors(
                                  (moduleConfig.followed_up_group_monitors || []).filter((item) => item.id !== monitor.id)
                                )}
                                style={{
                                  padding: "8px 14px",
                                  borderRadius: "var(--radius-md)",
                                  border: "1px solid var(--border-light)",
                                  background: "var(--bg-app)",
                                  color: "var(--text-secondary)",
                                  fontSize: "0.8125rem",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                            <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Day range</label>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={monitor.days_back ?? bilibiliMonitorDefaults.daysBack}
                              onChange={(e) => setBilibiliGroupMonitors(
                                (moduleConfig.followed_up_group_monitors || []).map((item) =>
                                  item.id === monitor.id ? normalizeBilibiliFollowedGroupMonitor({
                                    ...item,
                                    days_back: Number(e.target.value || bilibiliMonitorDefaults.daysBack),
                                  }, bilibiliSmartGroupLabelLookup, bilibiliMonitorDefaults) : item
                                )
                              )}
                              style={{
                                width: "88px",
                                padding: "8px 10px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-hover)",
                                color: "var(--text-main)",
                                fontSize: "0.8125rem",
                                outline: "none",
                              }}
                            />
                            <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Items to keep</label>
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              value={monitor.limit ?? bilibiliMonitorDefaults.limit}
                              onChange={(e) => setBilibiliGroupMonitors(
                                (moduleConfig.followed_up_group_monitors || []).map((item) =>
                                  item.id === monitor.id ? normalizeBilibiliFollowedGroupMonitor({
                                    ...item,
                                    limit: Number(e.target.value || bilibiliMonitorDefaults.limit),
                                  }, bilibiliSmartGroupLabelLookup, bilibiliMonitorDefaults) : item
                                )
                              )}
                              style={{
                                width: "96px",
                                padding: "8px 10px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-hover)",
                                color: "var(--text-main)",
                                fontSize: "0.8125rem",
                                outline: "none",
                              }}
                            />
                            <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Pages to scan</label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={monitor.page_limit ?? bilibiliMonitorDefaults.pageLimit}
                              onChange={(e) => setBilibiliGroupMonitors(
                                (moduleConfig.followed_up_group_monitors || []).map((item) =>
                                  item.id === monitor.id ? normalizeBilibiliFollowedGroupMonitor({
                                    ...item,
                                    page_limit: Number(e.target.value || bilibiliMonitorDefaults.pageLimit),
                                  }, bilibiliSmartGroupLabelLookup, bilibiliMonitorDefaults) : item
                                )
                              )}
                              style={{
                                width: "96px",
                                padding: "8px 10px",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border-light)",
                                background: "var(--bg-hover)",
                                color: "var(--text-main)",
                                fontSize: "0.8125rem",
                                outline: "none",
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                      No smart-group tracking enabled yet. Click a group tag above to generate a monitor that reuses the manual crawl's post cards and save paths.
                    </div>
                  )}
                </div>

                <button
                  onClick={async () => {
                    const normalizedDailyDynamicMonitors = (moduleConfig.daily_dynamic_monitors || [])
                      .map((item) => normalizeBilibiliDailyDynamicMonitor(item, bilibiliMonitorDefaults))
                      .filter((item) => item.keywords.length > 0 || item.tag_filters.length > 0);
                    const normalizedGroupMonitors = (moduleConfig.followed_up_group_monitors || [])
                      .map((item) => normalizeBilibiliFollowedGroupMonitor(item, bilibiliSmartGroupLabelLookup, bilibiliMonitorDefaults))
                      .filter((item) => item.group_value);
                    await saveModuleConfig({
                      sessdata: moduleConfig.sessdata || "",
                      follow_feed: moduleConfig.follow_feed ?? false,
                      follow_feed_types: moduleConfig.follow_feed_types || [8, 2, 4, 64],
                      fetch_follow_limit: moduleConfig.fetch_follow_limit ?? 50,
                      fixed_up_monitor_limit: moduleConfig.fixed_up_monitor_limit ?? moduleConfig.fetch_follow_limit ?? 50,
                      fixed_up_days_back: moduleConfig.fixed_up_days_back ?? BILIBILI_FIXED_UP_MONITOR_DEFAULT_DAYS_BACK,
                      keyword_filter: moduleConfig.keyword_filter ?? true,
                      up_uids: Array.from(new Set((moduleConfig.up_uids || []).map((item) => String(item || "").trim()).filter(Boolean))),
                      daily_dynamic_monitors: normalizedDailyDynamicMonitors,
                      followed_up_group_monitors: normalizedGroupMonitors,
                      followed_up_original_groups: moduleConfig.followed_up_original_groups || [],
                      followed_up_groups: normalizedGroupMonitors.filter((item) => item.enabled).map((item) => item.group_value),
                      followed_up_filter_mode: moduleConfig.followed_up_filter_mode === "smart_only" ? "smart_only" : "and",
                    }, "Bilibili crawl strategy saved");
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save crawl strategy
                </button>
              </div>
            </Card>
          )}

          {/* arXiv keyword config */}
          {module.id === "arxiv-tracker" && (
            <Card title="Keywords" icon={<span style={{ fontSize: "14px" }}>🔤</span>}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <input
                  type="text"
                  value={(moduleConfig.keywords || []).join(", ")}
                  onChange={(e) => setModuleConfig({ ...moduleConfig, keywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="robotics, manipulation, grasp"
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                  Enter English keywords separated by commas. The system will automatically track new papers containing them
                </p>
                <button
                  onClick={async () => {
                    try {
                      await api.post("/api/preferences", { modules: { [module.id]: { keywords: moduleConfig.keywords } } });
                      toast.success("Saved");
                    } catch {
                      toast.error("Save failed");
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save keywords
                </button>
              </div>
            </Card>
          )}

          {/* Semantic Scholar API key config */}
          {module.id === "semantic-scholar-tracker" && (
            <Card title="API Configuration" icon={<span style={{ fontSize: "14px" }}>🔑</span>}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                    Semantic Scholar API Key
                  </label>
                  <input
                    type="password"
                    value={moduleConfig.api_key || ""}
                    onChange={(e) => setModuleConfig({ ...moduleConfig, api_key: e.target.value })}
                    placeholder="Enter your API key (optional)"
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-app)",
                      color: "var(--text-main)",
                      fontSize: "0.875rem",
                      outline: "none",
                    }}
                  />
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                    Leave empty to use the default API key. To use your own key, request one from
                    <a href="https://www.semanticscholar.org/product/api" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary)", textDecoration: "underline" }}>Semantic Scholar</a>
                    here
                  </p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await api.post("/api/config", { semantic_scholar_api_key: moduleConfig.api_key || "" });
                      toast.success("API key saved");
                    } catch {
                      toast.error("Save failed");
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save API key
                </button>
              </div>
            </Card>
          )}

          {/* Xiaohongshu cookie config */}
          {module.id === "xiaohongshu-tracker" && (
            <Card title="Xiaohongshu Login" icon={<span style={{ fontSize: "18px" }}>📕</span>}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                    padding: "12px 14px",
                    borderRadius: "var(--radius-md)",
                    background: moduleConfig.auth_ready ? "rgba(16, 185, 129, 0.1)" : "var(--bg-hover)",
                    border: `1px solid ${moduleConfig.auth_ready ? "rgba(16, 185, 129, 0.28)" : "var(--border-light)"}`,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                      {moduleConfig.auth_ready
                        ? moduleConfig.auth_source === "global"
                          ? "Currently reusing the Xiaohongshu cookie from the manual tool"
                          : "A module-specific Xiaohongshu cookie is saved"
                        : "No reusable Xiaohongshu cookie yet"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                      This reuses the manual tool's cookie acquisition flow; scheduled intel reads the cookie saved here or in the manual tool first.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleFetchXhsCookieFromBrowser}
                    disabled={gettingXhsCookie}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "var(--radius-md)",
                      background: gettingXhsCookie ? "var(--bg-muted)" : "var(--color-primary)",
                      color: "white",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      border: "none",
                      cursor: gettingXhsCookie ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {gettingXhsCookie ? "Getting..." : "One-click reuse browser cookie"}
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                    web_session
                  </label>
                  <input
                    type="password"
                    value={moduleConfig.web_session || ""}
                    onChange={(e) => setModuleConfig({ ...moduleConfig, web_session: e.target.value })}
                    placeholder="Copy the web_session value from Cookie-Editor"
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-app)",
                      color: "var(--text-main)",
                      fontSize: "0.875rem",
                      outline: "none",
                      fontFamily: "monospace",
                    }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                    id_token <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    type="password"
                    value={moduleConfig.id_token || ""}
                    onChange={(e) => setModuleConfig({ ...moduleConfig, id_token: e.target.value })}
                    placeholder="Copy the id_token value from Cookie-Editor"
                    style={{
                      padding: "10px 14px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-app)",
                      color: "var(--text-main)",
                      fontSize: "0.875rem",
                      outline: "none",
                      fontFamily: "monospace",
                    }}
                  />
                </div>
                <CookieGuide platform="xiaohongshu" cookieName="Cookie" />
                <button
                  onClick={async () => {
                    await saveModuleConfig({
                      web_session: moduleConfig.web_session || "",
                      id_token: moduleConfig.id_token || "",
                      auth_ready: Boolean((moduleConfig.web_session || "").trim()),
                      auth_source: (moduleConfig.web_session || "").trim() ? "module" : moduleConfig.auth_source,
                    });
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save cookie
                </button>
              </div>
            </Card>
          )}

          {module.id === "xiaohongshu-tracker" && (
            <Card title="Automatic Crawl Strategy" icon={<span style={{ fontSize: "16px" }}>🕸️</span>}>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border-light)",
                }}>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>
                    Intel push / follow-feed scan / targeted follows
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                    This directly edits the real Xiaohongshu monitor definitions. Comments are not fetched by default; when enabled, the top 20 most-liked comments are fetched.
                  </div>
                </div>

                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border-light)",
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "200px" }}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)" }}>Extension bridge settings</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                      Scheduled intel crawls reuse the manual tool's Xiaohongshu extension bridge parameters.
                    </div>
                  </div>
                  <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Extension port</label>
                  <input
                    type="number"
                    min={1}
                    value={moduleConfig.extension_port ?? 9334}
                    onChange={(e) => setModuleConfig({
                      ...moduleConfig,
                      extension_port: Math.max(1, Number(e.target.value || 9334)),
                    })}
                    style={{
                      width: "96px",
                      padding: "8px 10px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-app)",
                      color: "var(--text-main)",
                      fontSize: "0.8125rem",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setModuleConfig({
                      ...moduleConfig,
                      dedicated_window_mode: !(moduleConfig.dedicated_window_mode ?? true),
                    })}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "var(--radius-md)",
                      border: `1px solid ${(moduleConfig.dedicated_window_mode ?? true) ? "var(--color-primary)" : "var(--border-light)"}`,
                      background: (moduleConfig.dedicated_window_mode ?? true) ? "var(--color-primary)" : "var(--bg-app)",
                      color: (moduleConfig.dedicated_window_mode ?? true) ? "white" : "var(--text-secondary)",
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {(moduleConfig.dedicated_window_mode ?? true) ? "Dedicated window" : "Current window"}
                  </button>
                </div>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                  gap: "16px",
                  alignItems: "start",
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
                    <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>Search keyword push</div>
                    {(moduleConfig.keyword_monitors || []).map((monitor) => (
                      <div
                        key={monitor.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                          padding: "12px 14px",
                          borderRadius: "var(--radius-md)",
                          background: "var(--bg-hover)",
                          border: "1px solid var(--border-light)",
                        }}
                      >
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                          <input
                            type="text"
                            value={monitor.label}
                            onChange={(e) => setModuleConfig({
                              ...moduleConfig,
                              keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                item.id === monitor.id ? { ...item, label: e.target.value } : item
                              ),
                            })}
                            placeholder="Definition name"
                            style={{
                              flex: 1,
                              minWidth: "180px",
                              padding: "10px 14px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-app)",
                              color: "var(--text-main)",
                              fontSize: "0.875rem",
                              outline: "none",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setModuleConfig({
                              ...moduleConfig,
                              keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                item.id === monitor.id ? { ...item, enabled: !item.enabled } : item
                              ),
                            })}
                            style={{
                              padding: "8px 14px",
                              borderRadius: "var(--radius-md)",
                              border: `1px solid ${monitor.enabled ? "var(--color-primary)" : "var(--border-light)"}`,
                              background: monitor.enabled ? "var(--color-primary)" : "var(--bg-app)",
                              color: monitor.enabled ? "white" : "var(--text-secondary)",
                              fontSize: "0.8125rem",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {monitor.enabled ? "On" : "Off"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setModuleConfig({
                              ...moduleConfig,
                              keyword_monitors: (moduleConfig.keyword_monitors || []).filter((item) => item.id !== monitor.id),
                            })}
                            style={{
                              padding: "8px 14px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-app)",
                              color: "var(--text-secondary)",
                              fontSize: "0.8125rem",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                        <input
                          type="text"
                          value={formatKeywordInput(monitor.keywords)}
                          onChange={(e) => setModuleConfig({
                            ...moduleConfig,
                            keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                              item.id === monitor.id ? { ...item, keywords: parseKeywordInput(e.target.value) } : item
                            ),
                          })}
                          placeholder="research tools, paper writing, AI workflows"
                          style={{
                            padding: "10px 14px",
                            borderRadius: "var(--radius-md)",
                            border: "1px solid var(--border-light)",
                            background: "var(--bg-app)",
                            color: "var(--text-main)",
                            fontSize: "0.875rem",
                            outline: "none",
                          }}
                        />
                        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                          <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                            Min likes
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={monitor.min_likes}
                            onChange={(e) => setModuleConfig({
                              ...moduleConfig,
                              keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                item.id === monitor.id ? { ...item, min_likes: Number(e.target.value || 0) } : item
                              ),
                            })}
                            style={{
                              width: "88px",
                              padding: "8px 10px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-app)",
                              color: "var(--text-main)",
                              fontSize: "0.8125rem",
                              outline: "none",
                            }}
                          />
                          <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                            Per-keyword fetch
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={monitor.per_keyword_limit}
                            onChange={(e) => setModuleConfig({
                              ...moduleConfig,
                              keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                item.id === monitor.id ? { ...item, per_keyword_limit: Number(e.target.value || 1) } : item
                              ),
                            })}
                            style={{
                              width: "88px",
                              padding: "8px 10px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-app)",
                              color: "var(--text-main)",
                              fontSize: "0.8125rem",
                              outline: "none",
                            }}
                          />
                          <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                            Day range
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={365}
                            value={monitor.recent_days}
                            onChange={(e) => setModuleConfig({
                              ...moduleConfig,
                              keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                item.id === monitor.id ? createKeywordMonitor({ ...item, recent_days: Number(e.target.value || 1) }) : item
                              ),
                            })}
                            style={{
                              width: "88px",
                              padding: "8px 10px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-app)",
                              color: "var(--text-main)",
                              fontSize: "0.8125rem",
                              outline: "none",
                            }}
                          />
                          <select
                            value={monitor.sort_by}
                            onChange={(e) => setModuleConfig({
                              ...moduleConfig,
                              keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                item.id === monitor.id ? createKeywordMonitor({ ...item, sort_by: e.target.value as "likes" | "time" }) : item
                              ),
                            })}
                            style={{
                              padding: "8px 10px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-app)",
                              color: "var(--text-main)",
                              fontSize: "0.8125rem",
                              outline: "none",
                            }}
                          >
                            <option value="likes">Most liked first</option>
                            <option value="time">Newest first</option>
                          </select>
                          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                            <input
                              type="checkbox"
                              checked={monitor.include_comments}
                              onChange={(e) => setModuleConfig({
                                ...moduleConfig,
                                keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                  item.id === monitor.id ? { ...item, include_comments: e.target.checked } : item
                                ),
                              })}
                            />
                            Fetch comments
                          </label>
                          {monitor.include_comments ? (
                            <>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={monitor.comments_limit}
                                onChange={(e) => setModuleConfig({
                                  ...moduleConfig,
                                  keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                    item.id === monitor.id ? { ...item, comments_limit: Number(e.target.value || 1) } : item
                                  ),
                                })}
                                style={{
                                  width: "72px",
                                  padding: "8px 10px",
                                  borderRadius: "var(--radius-md)",
                                  border: "1px solid var(--border-light)",
                                  background: "var(--bg-app)",
                                  color: "var(--text-main)",
                                  fontSize: "0.8125rem",
                                  outline: "none",
                                }}
                              />
                              <select
                                value={monitor.comments_sort_by}
                                onChange={(e) => setModuleConfig({
                                  ...moduleConfig,
                                  keyword_monitors: (moduleConfig.keyword_monitors || []).map((item) =>
                                    item.id === monitor.id ? { ...item, comments_sort_by: e.target.value as "likes" | "time" } : item
                                  ),
                                })}
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: "var(--radius-md)",
                                  border: "1px solid var(--border-light)",
                                  background: "var(--bg-app)",
                                  color: "var(--text-main)",
                                  fontSize: "0.8125rem",
                                  outline: "none",
                                }}
                              >
                                <option value="likes">Most liked first</option>
                                <option value="time">Newest first</option>
                              </select>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setModuleConfig({
                        ...moduleConfig,
                        keyword_monitors: [
                          ...(moduleConfig.keyword_monitors || []),
                          createKeywordMonitor({ label: `Intel push ${(moduleConfig.keyword_monitors || []).length + 1}` }),
                        ],
                      })}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--bg-app)",
                        color: "var(--text-main)",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        border: "1px solid var(--border-light)",
                        cursor: "pointer",
                        alignSelf: "flex-start",
                      }}
                    >
                      Add search keyword push
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>Follow-feed keyword push</div>
                      <div style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        padding: "12px 14px",
                        borderRadius: "var(--radius-md)",
                        background: "var(--bg-hover)",
                        border: "1px solid var(--border-light)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ fontSize: "0.8125rem", color: "var(--text-main)", fontWeight: 600 }}>
                              Follow-feed keyword definitions
                            </span>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                              Reuses the manual tool's follow-feed search definitions. The real follow feed is fetched first, then filtered by each keyword definition.
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const next = !(moduleConfig.following_scan?.enabled ?? false);
                              const currentMonitors = moduleConfig.following_scan_monitors || [];
                              const nextMonitors = currentMonitors.map((monitor) => ({ ...monitor, enabled: next }));
                              setXhsFollowingScanMonitors(nextMonitors, { enabled: next });
                            }}
                            style={{
                              padding: "8px 14px",
                              borderRadius: "var(--radius-md)",
                              border: `1px solid ${(moduleConfig.following_scan?.enabled ?? false) ? "var(--color-primary)" : "var(--border-light)"}`,
                              background: (moduleConfig.following_scan?.enabled ?? false) ? "var(--color-primary)" : "var(--bg-app)",
                              color: (moduleConfig.following_scan?.enabled ?? false) ? "white" : "var(--text-secondary)",
                              fontSize: "0.8125rem",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {(moduleConfig.following_scan?.enabled ?? false) ? "Master switch on" : "Master switch off"}
                          </button>
                        </div>
                        <div style={{ display: "grid", gap: "10px" }}>
                          {(moduleConfig.following_scan_monitors || []).length > 0 ? (
                            (moduleConfig.following_scan_monitors || []).map((monitor) => (
                              <div
                                key={monitor.id}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "10px",
                                  padding: "12px 14px",
                                  borderRadius: "var(--radius-md)",
                                  background: "var(--bg-app)",
                                  border: "1px solid var(--border-light)",
                                }}
                              >
                                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                  <input
                                    type="text"
                                    value={monitor.label}
                                    onChange={(e) => setXhsFollowingScanMonitors(
                                      (moduleConfig.following_scan_monitors || []).map((item) =>
                                        item.id === monitor.id
                                          ? { ...item, label: e.target.value }
                                          : item
                                      )
                                    )}
                                    placeholder="Definition name"
                                    style={{
                                      flex: 1,
                                      minWidth: "180px",
                                      padding: "10px 14px",
                                      borderRadius: "var(--radius-md)",
                                      border: "1px solid var(--border-light)",
                                      background: "var(--bg-hover)",
                                      color: "var(--text-main)",
                                      fontSize: "0.875rem",
                                      outline: "none",
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextMonitors = (moduleConfig.following_scan_monitors || []).map((item) =>
                                        item.id === monitor.id ? { ...item, enabled: !item.enabled } : item
                                      );
                                      const nextEnabled = nextMonitors.some((item) => item.enabled);
                                      setXhsFollowingScanMonitors(nextMonitors, { enabled: nextEnabled });
                                    }}
                                    style={{
                                      padding: "8px 14px",
                                      borderRadius: "var(--radius-md)",
                                      border: `1px solid ${monitor.enabled ? "var(--color-primary)" : "var(--border-light)"}`,
                                      background: monitor.enabled ? "rgba(99, 102, 241, 0.12)" : "var(--bg-hover)",
                                      color: monitor.enabled ? "var(--color-primary)" : "var(--text-secondary)",
                                      fontSize: "0.8125rem",
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    {monitor.enabled ? "On" : "Off"}
                                  </button>
                                </div>
                                <input
                                  type="text"
                                  value={formatKeywordInput(monitor.keywords || [])}
                                  onChange={(e) => setXhsFollowingScanMonitors(
                                    (moduleConfig.following_scan_monitors || []).map((item) =>
                                      item.id === monitor.id
                                        ? { ...item, keywords: parseKeywordInput(e.target.value) }
                                        : item
                                    )
                                  )}
                                  placeholder="Follow-feed filter keywords"
                                  style={{
                                    padding: "10px 14px",
                                    borderRadius: "var(--radius-md)",
                                    border: "1px solid var(--border-light)",
                                    background: "var(--bg-hover)",
                                    color: "var(--text-main)",
                                    fontSize: "0.875rem",
                                    outline: "none",
                                  }}
                                />
                                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                                  <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Fetch limit</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={200}
                                    value={monitor.fetch_limit}
                                    onChange={(e) => setXhsFollowingScanMonitors(
                                      (moduleConfig.following_scan_monitors || []).map((item) =>
                                        item.id === monitor.id
                                          ? createFollowingScanMonitor({ ...item, fetch_limit: Number(e.target.value || 1) })
                                          : item
                                      )
                                    )}
                                    style={{
                                      width: "88px",
                                      padding: "8px 10px",
                                      borderRadius: "var(--radius-md)",
                                      border: "1px solid var(--border-light)",
                                      background: "var(--bg-hover)",
                                      color: "var(--text-main)",
                                      fontSize: "0.8125rem",
                                      outline: "none",
                                    }}
                                  />
                                  <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Day range</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={monitor.recent_days}
                                    onChange={(e) => setXhsFollowingScanMonitors(
                                      (moduleConfig.following_scan_monitors || []).map((item) =>
                                        item.id === monitor.id
                                          ? createFollowingScanMonitor({ ...item, recent_days: Number(e.target.value || 1) })
                                          : item
                                      )
                                    )}
                                    style={{
                                      width: "88px",
                                      padding: "8px 10px",
                                      borderRadius: "var(--radius-md)",
                                      border: "1px solid var(--border-light)",
                                      background: "var(--bg-hover)",
                                      color: "var(--text-main)",
                                      fontSize: "0.8125rem",
                                      outline: "none",
                                    }}
                                  />
                                  <select
                                    value={monitor.sort_by}
                                    onChange={(e) => setXhsFollowingScanMonitors(
                                      (moduleConfig.following_scan_monitors || []).map((item) =>
                                        item.id === monitor.id
                                          ? createFollowingScanMonitor({ ...item, sort_by: e.target.value as "likes" | "time" })
                                          : item
                                      )
                                    )}
                                    style={{
                                      padding: "8px 10px",
                                      borderRadius: "var(--radius-md)",
                                      border: "1px solid var(--border-light)",
                                      background: "var(--bg-hover)",
                                      color: "var(--text-main)",
                                      fontSize: "0.8125rem",
                                      outline: "none",
                                    }}
                                  >
                                    <option value="time">Newest first</option>
                                    <option value="likes">Most liked first</option>
                                  </select>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                                    <input
                                      type="checkbox"
                                      checked={monitor.keyword_filter}
                                      onChange={(e) => setXhsFollowingScanMonitors(
                                        (moduleConfig.following_scan_monitors || []).map((item) =>
                                          item.id === monitor.id
                                            ? createFollowingScanMonitor({ ...item, keyword_filter: e.target.checked })
                                            : item
                                        )
                                      )}
                                    />
                                    Filter by keyword
                                  </label>
                                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                                    <input
                                      type="checkbox"
                                      checked={monitor.include_comments}
                                      onChange={(e) => setXhsFollowingScanMonitors(
                                        (moduleConfig.following_scan_monitors || []).map((item) =>
                                          item.id === monitor.id
                                            ? createFollowingScanMonitor({ ...item, include_comments: e.target.checked })
                                            : item
                                        )
                                      )}
                                    />
                                    Fetch comments
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextMonitors = (moduleConfig.following_scan_monitors || []).filter((item) => item.id !== monitor.id);
                                      const nextEnabled = nextMonitors.some((item) => item.enabled);
                                      setXhsFollowingScanMonitors(nextMonitors, { enabled: nextEnabled });
                                    }}
                                    style={{
                                      padding: "7px 12px",
                                      borderRadius: "999px",
                                      border: "1px solid var(--border-light)",
                                      background: "var(--bg-hover)",
                                      color: "var(--text-secondary)",
                                      fontSize: "0.8125rem",
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      marginLeft: "auto",
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                                {monitor.include_comments ? (
                                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                                    <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Comment count</label>
                                    <input
                                      type="number"
                                      min={1}
                                      max={100}
                                      value={monitor.comments_limit}
                                      onChange={(e) => setXhsFollowingScanMonitors(
                                        (moduleConfig.following_scan_monitors || []).map((item) =>
                                          item.id === monitor.id
                                            ? createFollowingScanMonitor({ ...item, comments_limit: Number(e.target.value || 1) })
                                            : item
                                        )
                                      )}
                                      style={{
                                        width: "88px",
                                        padding: "8px 10px",
                                        borderRadius: "var(--radius-md)",
                                        border: "1px solid var(--border-light)",
                                        background: "var(--bg-hover)",
                                        color: "var(--text-main)",
                                        fontSize: "0.8125rem",
                                        outline: "none",
                                      }}
                                    />
                                    <select
                                      value={monitor.comments_sort_by}
                                      onChange={(e) => setXhsFollowingScanMonitors(
                                        (moduleConfig.following_scan_monitors || []).map((item) =>
                                          item.id === monitor.id
                                            ? createFollowingScanMonitor({ ...item, comments_sort_by: e.target.value as "likes" | "time" })
                                            : item
                                        )
                                      )}
                                      style={{
                                        padding: "8px 10px",
                                        borderRadius: "var(--radius-md)",
                                        border: "1px solid var(--border-light)",
                                        background: "var(--bg-hover)",
                                        color: "var(--text-main)",
                                        fontSize: "0.8125rem",
                                        outline: "none",
                                      }}
                                    >
                                      <option value="likes">Most liked first</option>
                                      <option value="time">Newest first</option>
                                    </select>
                                  </div>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                              No follow-feed keyword definitions yet. Once added, intel reuses the same follow-feed search flow as the manual tool.
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const nextMonitors = [
                              ...(moduleConfig.following_scan_monitors || []),
                              createFollowingScanMonitor({
                                label: `Follow-feed push ${(moduleConfig.following_scan_monitors || []).length + 1}`,
                                enabled: moduleConfig.following_scan?.enabled ?? false,
                                fetch_limit: moduleConfig.following_scan?.fetch_limit ?? 20,
                                recent_days: moduleConfig.following_scan?.recent_days ?? 7,
                                sort_by: moduleConfig.following_scan?.sort_by ?? "time",
                                keyword_filter: moduleConfig.following_scan?.keyword_filter ?? true,
                                include_comments: moduleConfig.following_scan?.include_comments ?? false,
                                comments_limit: moduleConfig.following_scan?.comments_limit ?? 20,
                                comments_sort_by: moduleConfig.following_scan?.comments_sort_by ?? "likes",
                              }),
                            ];
                            setXhsFollowingScanMonitors(nextMonitors);
                          }}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "var(--radius-md)",
                            background: "var(--bg-app)",
                            color: "var(--text-main)",
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                            border: "1px solid var(--border-light)",
                            cursor: "pointer",
                            alignSelf: "flex-start",
                          }}
                        >
                          Add follow-feed keyword push
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>Blogger latest posts crawl</div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                          flexWrap: "wrap",
                          padding: "12px 14px",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid rgba(245, 158, 11, 0.45)",
                          background: "rgba(245, 158, 11, 0.12)",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#92400e" }}>
                            Off by default — may trigger anti-crawling
                          </span>
                          <span style={{ fontSize: "0.75rem", color: "#92400e", lineHeight: 1.6 }}>
                            This flow visits blogger profile pages to fetch recent posts; high frequency can trigger rate limiting or verification pages. Enable only when needed, and narrow the scope with smart groups first.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={toggleXhsCreatorPush}
                          style={{
                            padding: "8px 14px",
                            borderRadius: "var(--radius-md)",
                            border: `1px solid ${(moduleConfig.creator_push_enabled ?? false) ? "#d97706" : "rgba(146, 64, 14, 0.25)"}`,
                            background: (moduleConfig.creator_push_enabled ?? false) ? "#d97706" : "rgba(255, 255, 255, 0.55)",
                            color: (moduleConfig.creator_push_enabled ?? false) ? "white" : "#92400e",
                            fontSize: "0.8125rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {(moduleConfig.creator_push_enabled ?? false) ? "Crawling enabled" : "Keep off"}
                        </button>
                      </div>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
                        Once you select smart groups below, the system reuses the blogger pool from shared smart groups for daily intel crawling — no need to import each blogger manually. The targeted follow list below is also reused.
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {(moduleConfig.creator_group_options || XHS_CREATOR_GROUP_OPTIONS).map((option) => {
                          const active = (moduleConfig.creator_groups || []).includes(option.value);
                          const profileCount = Object.values(moduleConfig.creator_profiles || {}).filter((profile) =>
                            (profile.smart_groups || []).includes(option.value)
                          ).length;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => toggleXhsCreatorGroup(option.value)}
                              style={{
                                padding: "7px 12px",
                                borderRadius: "999px",
                                border: `1px solid ${active ? "var(--color-primary)" : "var(--border-light)"}`,
                                background: active ? "rgba(99, 102, 241, 0.12)" : "var(--bg-app)",
                                color: active ? "var(--color-primary)" : "var(--text-secondary)",
                                fontSize: "0.8125rem",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              {option.label} {profileCount ? `· ${profileCount}` : ""}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" }}>
                        {(moduleConfig.creator_monitors || []).length > 0 ? (
                          (moduleConfig.creator_monitors || []).map((monitor) => (
                            <div
                              key={monitor.id}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                padding: "12px 14px",
                                borderRadius: "var(--radius-md)",
                                background: "var(--bg-hover)",
                                border: "1px solid var(--border-light)",
                              }}
                            >
                              <input
                                type="text"
                                value={monitor.label}
                                onChange={(e) => setModuleConfig({
                                  ...moduleConfig,
                                  creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                    item.id === monitor.id ? { ...item, label: e.target.value, author: e.target.value || item.author } : item
                                  ),
                                })}
                                placeholder="Display name"
                                style={{
                                  padding: "10px 14px",
                                  borderRadius: "var(--radius-md)",
                                  border: "1px solid var(--border-light)",
                                  background: "var(--bg-app)",
                                  color: "var(--text-main)",
                                  fontSize: "0.875rem",
                                  outline: "none",
                                }}
                              />
                              <input
                                type="text"
                                value={monitor.user_id}
                                onChange={(e) => setModuleConfig({
                                  ...moduleConfig,
                                  creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                    item.id === monitor.id ? createCreatorMonitor({
                                      ...item,
                                      user_id: normalizeXhsProfileUserId(e.target.value),
                                    }) : item
                                  ),
                                })}
                                placeholder="User profile ID or link"
                                style={{
                                  padding: "10px 14px",
                                  borderRadius: "var(--radius-md)",
                                  border: "1px solid var(--border-light)",
                                  background: "var(--bg-app)",
                                  color: "var(--text-main)",
                                  fontSize: "0.875rem",
                                  outline: "none",
                                }}
                              />
                              {getXhsCreatorMonitorGroupLabels(monitor).length > 0 ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                  {getXhsCreatorMonitorGroupLabels(monitor).map((label) => (
                                    <span
                                      key={`${monitor.id}-${label}`}
                                      style={{
                                        padding: "4px 8px",
                                        borderRadius: "999px",
                                        background: "rgba(99, 102, 241, 0.12)",
                                        color: "var(--color-primary)",
                                        fontSize: "0.6875rem",
                                        fontWeight: 600,
                                      }}
                                    >
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  onClick={() => setModuleConfig({
                                    ...moduleConfig,
                                    creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                      item.id === monitor.id ? { ...item, enabled: !item.enabled } : item
                                    ),
                                  })}
                                  style={{
                                    padding: "7px 12px",
                                    borderRadius: "999px",
                                    border: `1px solid ${monitor.enabled ? "var(--color-primary)" : "var(--border-light)"}`,
                                    background: monitor.enabled ? "rgba(99, 102, 241, 0.12)" : "var(--bg-app)",
                                    color: monitor.enabled ? "var(--color-primary)" : "var(--text-secondary)",
                                    fontSize: "0.8125rem",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                  }}
                                >
                                  {monitor.enabled ? "On" : "Off"}
                                </button>
                                <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                                  Per-crawl fetch
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={monitor.per_user_limit}
                                  onChange={(e) => setModuleConfig({
                                    ...moduleConfig,
                                    creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                      item.id === monitor.id ? { ...item, per_user_limit: Number(e.target.value || 1) } : item
                                    ),
                                  })}
                                  style={{
                                    width: "72px",
                                    padding: "8px 10px",
                                    borderRadius: "var(--radius-md)",
                                    border: "1px solid var(--border-light)",
                                    background: "var(--bg-app)",
                                    color: "var(--text-main)",
                                    fontSize: "0.8125rem",
                                    outline: "none",
                                  }}
                                />
                                <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                                  Day range
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={365}
                                  value={monitor.recent_days}
                                  onChange={(e) => setModuleConfig({
                                    ...moduleConfig,
                                    creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                      item.id === monitor.id ? createCreatorMonitor({ ...item, recent_days: Number(e.target.value || 1) }) : item
                                    ),
                                  })}
                                  style={{
                                    width: "72px",
                                    padding: "8px 10px",
                                    borderRadius: "var(--radius-md)",
                                    border: "1px solid var(--border-light)",
                                    background: "var(--bg-app)",
                                    color: "var(--text-main)",
                                    fontSize: "0.8125rem",
                                    outline: "none",
                                  }}
                                />
                                <select
                                  value={monitor.sort_by}
                                  onChange={(e) => setModuleConfig({
                                    ...moduleConfig,
                                    creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                      item.id === monitor.id ? createCreatorMonitor({ ...item, sort_by: e.target.value as "likes" | "time" }) : item
                                    ),
                                  })}
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: "var(--radius-md)",
                                    border: "1px solid var(--border-light)",
                                    background: "var(--bg-app)",
                                    color: "var(--text-main)",
                                    fontSize: "0.8125rem",
                                    outline: "none",
                                  }}
                                >
                                  <option value="time">Newest first</option>
                                  <option value="likes">Most liked first</option>
                                </select>
                                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                                  <input
                                    type="checkbox"
                                    checked={monitor.include_comments}
                                    onChange={(e) => setModuleConfig({
                                      ...moduleConfig,
                                      creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                        item.id === monitor.id ? { ...item, include_comments: e.target.checked } : item
                                      ),
                                    })}
                                  />
                                  Fetch comments
                                </label>
                                <button
                                  type="button"
                                  onClick={() => setModuleConfig({
                                    ...moduleConfig,
                                    creator_monitors: (moduleConfig.creator_monitors || []).filter((item) => item.id !== monitor.id),
                                  })}
                                  style={{
                                    padding: "7px 12px",
                                    borderRadius: "999px",
                                    border: "1px solid var(--border-light)",
                                    background: "var(--bg-app)",
                                    color: "var(--text-secondary)",
                                    fontSize: "0.8125rem",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    marginLeft: "auto",
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                              {monitor.include_comments ? (
                                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                  <label style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Comment count</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={monitor.comments_limit}
                                    onChange={(e) => setModuleConfig({
                                      ...moduleConfig,
                                      creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                        item.id === monitor.id ? createCreatorMonitor({ ...item, comments_limit: Number(e.target.value || 1) }) : item
                                      ),
                                    })}
                                    style={{
                                      width: "88px",
                                      padding: "8px 10px",
                                      borderRadius: "var(--radius-md)",
                                      border: "1px solid var(--border-light)",
                                      background: "var(--bg-app)",
                                      color: "var(--text-main)",
                                      fontSize: "0.8125rem",
                                      outline: "none",
                                    }}
                                  />
                                  <select
                                    value={monitor.comments_sort_by}
                                    onChange={(e) => setModuleConfig({
                                      ...moduleConfig,
                                      creator_monitors: (moduleConfig.creator_monitors || []).map((item) =>
                                        item.id === monitor.id ? createCreatorMonitor({ ...item, comments_sort_by: e.target.value as "likes" | "time" }) : item
                                      ),
                                    })}
                                    style={{
                                      padding: "8px 10px",
                                      borderRadius: "var(--radius-md)",
                                      border: "1px solid var(--border-light)",
                                      background: "var(--bg-app)",
                                      color: "var(--text-main)",
                                      fontSize: "0.8125rem",
                                      outline: "none",
                                    }}
                                  >
                                    <option value="likes">Most liked first</option>
                                    <option value="time">Newest first</option>
                                  </select>
                                </div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            First sync candidate bloggers from the Xiaohongshu tool's "bloggers from bookmarks" feature, or add them manually here.
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setModuleConfig({
                          ...moduleConfig,
                          creator_monitors: [
                            ...(moduleConfig.creator_monitors || []),
                            createCreatorMonitor({ label: `Manually added ${(moduleConfig.creator_monitors || []).length + 1}` }),
                          ],
                        })}
                        style={{
                          padding: "8px 16px",
                          borderRadius: "var(--radius-md)",
                          background: "var(--bg-app)",
                          color: "var(--text-main)",
                          fontSize: "0.8125rem",
                          fontWeight: 600,
                          border: "1px solid var(--border-light)",
                          cursor: "pointer",
                          alignSelf: "flex-start",
                        }}
                      >
                        Add targeted follow
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={async () => {
                    const normalizedKeywordMonitors = (moduleConfig.keyword_monitors || [])
                      .map((monitor) => createKeywordMonitor(monitor))
                      .filter((monitor) => monitor.keywords.length > 0);
                    const normalizedFollowingScanMonitors = (moduleConfig.following_scan_monitors || [])
                      .map((monitor) => createFollowingScanMonitor(monitor))
                      .filter((monitor) => monitor.keywords.length > 0 || !monitor.keyword_filter);
                    const normalizedFollowingScan = buildNextXhsFollowingScan(
                      normalizedFollowingScanMonitors,
                      moduleConfig.following_scan || createFollowingScan(),
                    );
                    const normalizedCreatorMonitors = (moduleConfig.creator_monitors || [])
                      .map((monitor) => createCreatorMonitor({
                        ...monitor,
                        user_id: normalizeXhsProfileUserId(monitor.user_id),
                      }))
                      .filter((monitor) => monitor.user_id || monitor.author || monitor.label);
                    await saveModuleConfig({
                      keyword_monitors: normalizedKeywordMonitors,
                      following_scan: normalizedFollowingScan,
                      following_scan_monitors: normalizedFollowingScanMonitors,
                      creator_monitors: normalizedCreatorMonitors,
                      creator_groups: moduleConfig.creator_groups || [],
                      creator_push_enabled: moduleConfig.creator_push_enabled ?? false,
                      extension_port: moduleConfig.extension_port ?? 9334,
                      dedicated_window_mode: moduleConfig.dedicated_window_mode ?? true,
                    }, "Crawl strategy saved");
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save crawl strategy
                </button>
              </div>
            </Card>
          )}

          {/* Zhihu cookie config */}
          {module.id === "zhihu-tracker" && (
            <Card title="Zhihu Login" icon={<span style={{ fontSize: "18px" }}>❓</span>}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <input
                  type="password"
                  value={moduleConfig.cookie || ""}
                  onChange={(e) => setModuleConfig({ ...moduleConfig, cookie: e.target.value })}
                  placeholder="Paste Zhihu cookie..."
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
                <CookieGuide platform="zhihu" cookieName="Cookie" />
                <button
                  onClick={async () => {
                    try {
                      await api.post("/api/preferences", { modules: { [module.id]: { cookie: moduleConfig.cookie } } });
                      toast.success("Saved");
                    } catch {
                      toast.error("Save failed");
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save cookie
                </button>
              </div>
            </Card>
          )}

          {/* Semantic Scholar keyword config */}
          {module.id === "semantic-scholar-tracker" && (
            <Card title="Keywords" icon={<span style={{ fontSize: "14px" }}>🔤</span>}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <input
                  type="text"
                  value={(moduleConfig.keywords || []).join(", ")}
                  onChange={(e) => setModuleConfig({ ...moduleConfig, keywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                  placeholder="machine learning, NLP"
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                  Enter English keywords separated by commas
                </p>
                <button
                  onClick={async () => {
                    try {
                      await api.post("/api/preferences", { modules: { [module.id]: { keywords: moduleConfig.keywords } } });
                      toast.success("Saved");
                    } catch {
                      toast.error("Save failed");
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save keywords
                </button>
              </div>
            </Card>
          )}

          {module.id === "folder-monitor" && (
            <Card title="Folder Path" icon={<Calendar style={{ width: "18px", height: "18px", color: "var(--color-secondary)" }} />}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <input
                  type="text"
                  value={moduleConfig.folder_path || ""}
                  onChange={(e) => setModuleConfig({ ...moduleConfig, folder_path: e.target.value })}
                  placeholder="/Users/xxx/Downloads/Papers"
                  style={{
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                    outline: "none",
                  }}
                />
                <button
                  onClick={async () => {
                    try {
                      await api.post("/api/preferences", { modules: { [module.id]: { folder_path: moduleConfig.folder_path } } });
                      toast.success("Saved");
                    } catch {
                      toast.error("Save failed");
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-primary)",
                    color: "white",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    alignSelf: "flex-start",
                  }}
                >
                  Save path
                </button>
              </div>
            </Card>
          )}

        </div>
      </PageContent>
    </PageContainer>
  );
}
