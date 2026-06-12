import type { FeedCard } from "../../core/store";

export type FeedGroupMode = "timeline" | "smart";
export type IntelligenceScope = "all" | "social" | "papers" | "other";
export type IntelligenceMetricFilter = "all" | "high-score" | "fresh" | "engaged" | "cited";

export interface FeedPreferences {
  hidden_module_ids: string[];
  group_mode: FeedGroupMode;
  show_recommendations: boolean;
}

export interface SmartGroupOption {
  value: string;
  label: string;
  count?: number;
  sample_authors?: string[];
  sample_tags?: string[];
}

export interface CreatorProfile {
  author?: string;
  author_id?: string;
  matched_author?: string;
  manual_override?: boolean;
  smart_groups?: string[];
  smart_group_labels?: string[];
  sample_tags?: string[];
  sample_folders?: string[];
  source_summary?: string;
}

export interface FeedContext {
  xhsCreatorProfiles: Record<string, CreatorProfile>;
  xhsGroupOptions: SmartGroupOption[];
  bilibiliCreatorProfiles: Record<string, CreatorProfile>;
  bilibiliGroupOptions: SmartGroupOption[];
}

export interface IntelligenceGroupSection {
  key: string;
  label: string;
  type: "smart" | "paper" | "source";
  cards: FeedCard[];
  platforms: string[];
  sourceLabels: string[];
  suggestions: string[];
  sampleTags: string[];
}

interface MetricBadge {
  key: Exclude<IntelligenceMetricFilter, "all">;
  label: string;
}

interface PaperDetailDescriptor {
  key: string;
  label: string;
  type: "keyword" | "followup";
}

const DEFAULT_HIDDEN_MODULE_IDS = [
  "xiaoyuzhou-tracker",
  "zhihu-tracker",
  "folder-monitor",
];

const SOCIAL_SMART_GROUP_OPTIONS: SmartGroupOption[] = [
  { value: "research", label: "Research & Study" },
  { value: "writing", label: "Paper Writing" },
  { value: "ai-tech", label: "AI / Tech" },
  { value: "productivity", label: "Productivity & PKM" },
  { value: "study-abroad", label: "Study Abroad & PhD" },
  { value: "digital", label: "Digital & AV" },
  { value: "creative", label: "Design & Creation" },
  { value: "finance", label: "Finance & Business" },
  { value: "game", label: "Gaming" },
  { value: "lifestyle", label: "Lifestyle & Entertainment" },
  { value: "other", label: "Other" },
];

const DEFAULT_XHS_GROUP_OPTIONS: SmartGroupOption[] = [
  { value: "research", label: "Research & Study" },
  { value: "writing", label: "Paper Writing" },
  { value: "ai", label: "AI Tools" },
  { value: "productivity", label: "Productivity & PKM" },
  { value: "study_abroad", label: "Study Abroad & PhD" },
  { value: "lifestyle", label: "Daily Life" },
  { value: "other", label: "Other" },
];

const DEFAULT_BILIBILI_GROUP_OPTIONS: SmartGroupOption[] = [
  { value: "ai-tech", label: "AI & Tech" },
  { value: "study", label: "Learning" },
  { value: "digital", label: "Digital & AV" },
  { value: "game", label: "Gaming" },
  { value: "finance", label: "Finance & Business" },
  { value: "creative", label: "Design & Creation" },
  { value: "entertainment", label: "Lifestyle & Entertainment" },
  { value: "other", label: "Other" },
];

const SOCIAL_SMART_GROUP_LABEL_MAP = new Map(
  SOCIAL_SMART_GROUP_OPTIONS.map((option) => [option.value, option.label]),
);

const SOCIAL_SMART_GROUP_ALIASES: Record<string, string> = {
  research: "research",
  "科研学习": "research",
  study: "research",
  "学习知识": "research",
  writing: "writing",
  "论文写作": "writing",
  ai: "ai-tech",
  "ai-tech": "ai-tech",
  "ai科技": "ai-tech",
  "ai工具": "ai-tech",
  productivity: "productivity",
  "效率知识库": "productivity",
  "study-abroad": "study-abroad",
  study_abroad: "study-abroad",
  "留学读博": "study-abroad",
  digital: "digital",
  "数码影音": "digital",
  creative: "creative",
  "设计创作": "creative",
  finance: "finance",
  "财经商业": "finance",
  game: "game",
  "游戏": "game",
  lifestyle: "lifestyle",
  "日常生活": "lifestyle",
  entertainment: "lifestyle",
  "生活娱乐": "lifestyle",
  other: "other",
  "其他": "other",
};

const MODULE_LABELS: Record<string, string> = {
  "arxiv-tracker": "Paper keywords",
  "semantic-scholar-tracker": "Follow Up",
  "xiaohongshu-tracker": "Xiaohongshu",
  "bilibili-tracker": "Bilibili",
  "xiaoyuzhou-tracker": "Xiaoyuzhou",
  "zhihu-tracker": "Zhihu",
  "folder-monitor": "Folder monitor",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function metadataString(card: FeedCard, key: string): string {
  const value = card.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function metadataStringList(card: FeedCard, key: string): string[] {
  const value = card.metadata?.[key];
  return Array.isArray(value)
    ? uniqueStrings(value.filter((item): item is string => typeof item === "string"))
    : [];
}

function metadataRecord(card: FeedCard, key: string): Record<string, unknown> {
  const value = card.metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataNumber(card: FeedCard, key: string): number {
  const value = card.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toSmartGroupOptions(value: unknown, fallback: SmartGroupOption[]): SmartGroupOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    return fallback;
  }

  const options: SmartGroupOption[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const rawValue = typeof item.value === "string" ? item.value.trim() : "";
    const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
    if (!rawValue || !rawLabel) continue;
    options.push({
      value: rawValue,
      label: rawLabel,
      count: typeof item.count === "number" ? item.count : undefined,
      sample_authors: Array.isArray(item.sample_authors)
        ? uniqueStrings(item.sample_authors.filter((author): author is string => typeof author === "string"))
        : [],
      sample_tags: Array.isArray(item.sample_tags)
        ? uniqueStrings(item.sample_tags.filter((tag): tag is string => typeof tag === "string"))
        : [],
    });
  }

  return options.length > 0 ? options : fallback;
}

function toCreatorProfiles(value: unknown): Record<string, CreatorProfile> {
  if (!isRecord(value)) return {};

  const profiles: Record<string, CreatorProfile> = {};
  for (const [key, rawProfile] of Object.entries(value)) {
    if (!isRecord(rawProfile)) continue;
    profiles[key] = {
      author: typeof rawProfile.author === "string" ? rawProfile.author : undefined,
      author_id: typeof rawProfile.author_id === "string" ? rawProfile.author_id : undefined,
      matched_author: typeof rawProfile.matched_author === "string" ? rawProfile.matched_author : undefined,
      manual_override: Boolean(rawProfile.manual_override),
      smart_groups: Array.isArray(rawProfile.smart_groups)
        ? uniqueStrings(rawProfile.smart_groups.filter((item): item is string => typeof item === "string"))
        : [],
      smart_group_labels: Array.isArray(rawProfile.smart_group_labels)
        ? uniqueStrings(rawProfile.smart_group_labels.filter((item): item is string => typeof item === "string"))
        : [],
      sample_tags: Array.isArray(rawProfile.sample_tags)
        ? uniqueStrings(rawProfile.sample_tags.filter((item): item is string => typeof item === "string"))
        : [],
      sample_folders: Array.isArray(rawProfile.sample_folders)
        ? uniqueStrings(rawProfile.sample_folders.filter((item): item is string => typeof item === "string"))
        : [],
      source_summary: typeof rawProfile.source_summary === "string" ? rawProfile.source_summary : undefined,
    };
  }
  return profiles;
}

function getGroupLabelMap(options: SmartGroupOption[]): Map<string, string> {
  return new Map(options.map((option) => [option.value, option.label]));
}

function normalizeAliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_/]+/g, "-");
}

function isOpaqueSmartGroupToken(value: string): boolean {
  return value.trim().toLowerCase().startsWith("smart-");
}

function getCanonicalAliasValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = SOCIAL_SMART_GROUP_ALIASES[normalizeAliasKey(trimmed)];
  return normalized || trimmed;
}

function getOptionValueByLabelMap(options: SmartGroupOption[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const option of options) {
    const label = String(option.label || "").trim();
    const value = String(option.value || "").trim();
    if (!label || !value || map.has(label)) continue;
    map.set(label, value);
  }
  return map;
}

function resolveSmartGroupIdentity(
  raw: string,
  optionLabelMap: Map<string, string>,
  optionValueByLabel: Map<string, string>,
): { value: string; label: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const optionLabel = optionLabelMap.get(trimmed) || "";
  if (optionLabel) {
    const canonicalValue = getCanonicalAliasValue(optionLabel) || getCanonicalAliasValue(trimmed) || optionLabel || trimmed;
    return {
      value: canonicalValue,
      label: SOCIAL_SMART_GROUP_LABEL_MAP.get(canonicalValue) || optionLabel || trimmed,
    };
  }

  const optionValue = optionValueByLabel.get(trimmed) || "";
  if (optionValue) {
    const canonicalValue = getCanonicalAliasValue(trimmed) || getCanonicalAliasValue(optionValue) || trimmed;
    return {
      value: canonicalValue,
      label: SOCIAL_SMART_GROUP_LABEL_MAP.get(canonicalValue) || trimmed,
    };
  }

  if (isOpaqueSmartGroupToken(trimmed)) {
    return null;
  }

  const canonicalValue = getCanonicalAliasValue(trimmed) || trimmed;
  return {
    value: canonicalValue,
    label: SOCIAL_SMART_GROUP_LABEL_MAP.get(canonicalValue) || trimmed,
  };
}

function normalizeSmartGroupOptions(options: SmartGroupOption[]): SmartGroupOption[] {
  const merged = new Map<string, SmartGroupOption>();

  for (const option of options) {
    const rawValue = String(option.value || "").trim();
    const rawLabel = String(option.label || "").trim();
    if (!rawValue || !rawLabel) continue;
    const canonicalValue = getCanonicalAliasValue(rawLabel) || getCanonicalAliasValue(rawValue) || rawLabel || rawValue;
    const canonicalLabel = SOCIAL_SMART_GROUP_LABEL_MAP.get(canonicalValue) || rawLabel || rawValue;
    const existing = merged.get(canonicalValue);
    merged.set(canonicalValue, {
      value: canonicalValue,
      label: canonicalLabel,
      count: (existing?.count || 0) + (option.count || 0) || undefined,
      sample_authors: uniqueStrings([...(existing?.sample_authors || []), ...(option.sample_authors || [])]),
      sample_tags: uniqueStrings([...(existing?.sample_tags || []), ...(option.sample_tags || [])]),
    });
  }

  if (merged.size === 0) {
    return SOCIAL_SMART_GROUP_OPTIONS;
  }

  const order = new Map(SOCIAL_SMART_GROUP_OPTIONS.map((option, index) => [option.value, index]));
  return Array.from(merged.values()).sort((a, b) => {
    const left = order.get(a.value) ?? Number.MAX_SAFE_INTEGER;
    const right = order.get(b.value) ?? Number.MAX_SAFE_INTEGER;
    return left - right || a.label.localeCompare(b.label);
  });
}

function normalizeSmartGroups(
  values: string[],
  labels: string[],
  options: SmartGroupOption[],
): { values: string[]; labels: string[] } {
  const optionLabelMap = getGroupLabelMap(options);
  const optionValueByLabel = getOptionValueByLabelMap(options);
  const normalizedValues: string[] = [];
  const normalizedLabels: string[] = [];
  const seen = new Set<string>();

  for (const raw of uniqueStrings([
    ...values,
    ...labels,
    ...values.map((value) => optionLabelMap.get(value) || ""),
  ])) {
    const identity = resolveSmartGroupIdentity(raw, optionLabelMap, optionValueByLabel);
    if (!identity || seen.has(identity.value)) continue;
    seen.add(identity.value);
    normalizedValues.push(identity.value);
    normalizedLabels.push(identity.label);
  }

  return { values: normalizedValues, labels: normalizedLabels };
}

function normalizeCreatorProfiles(
  profiles: Record<string, CreatorProfile>,
  options: SmartGroupOption[],
): Record<string, CreatorProfile> {
  const normalizedProfiles: Record<string, CreatorProfile> = {};
  for (const [key, profile] of Object.entries(profiles)) {
    const normalizedGroups = normalizeSmartGroups(
      profile.smart_groups || [],
      profile.smart_group_labels || [],
      options,
    );
    normalizedProfiles[key] = {
      ...profile,
      smart_groups: normalizedGroups.values,
      smart_group_labels: normalizedGroups.labels,
    };
  }
  return normalizedProfiles;
}

function parseTimestamp(value: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getReferenceTime(card: FeedCard): number {
  const published = parseTimestamp(metadataString(card, "published"));
  if (published !== null) return published;
  return card.created_at * 1000;
}

export const DEFAULT_FEED_PREFERENCES: FeedPreferences = {
  hidden_module_ids: DEFAULT_HIDDEN_MODULE_IDS,
  group_mode: "smart",
  show_recommendations: true,
};

export function normalizeFeedPreferences(raw: unknown): FeedPreferences {
  if (!isRecord(raw)) {
    return { ...DEFAULT_FEED_PREFERENCES };
  }

  const groupMode = raw.group_mode === "timeline" ? "timeline" : "smart";
  return {
    hidden_module_ids: uniqueStrings(
      Array.isArray(raw.hidden_module_ids)
        ? raw.hidden_module_ids.filter((item): item is string => typeof item === "string")
        : DEFAULT_FEED_PREFERENCES.hidden_module_ids
    ),
    group_mode: groupMode,
    show_recommendations:
      typeof raw.show_recommendations === "boolean"
        ? raw.show_recommendations
        : DEFAULT_FEED_PREFERENCES.show_recommendations,
  };
}

export function buildFeedContext(
  xhsConfig: unknown,
  bilibiliConfig: unknown,
): FeedContext {
  const xhsRecord = isRecord(xhsConfig) ? xhsConfig : {};
  const bilibiliRecord = isRecord(bilibiliConfig) ? bilibiliConfig : {};
  const rawXhsGroupOptions = toSmartGroupOptions(
    xhsRecord.creator_group_options,
    DEFAULT_XHS_GROUP_OPTIONS,
  );
  const rawBilibiliGroupOptions = toSmartGroupOptions(
    bilibiliRecord.creator_group_options || bilibiliRecord.followed_up_group_options,
    DEFAULT_BILIBILI_GROUP_OPTIONS,
  );
  const xhsCreatorProfiles = toCreatorProfiles(xhsRecord.creator_profiles);
  const bilibiliCreatorProfiles = toCreatorProfiles(bilibiliRecord.creator_profiles);

  return {
    xhsCreatorProfiles: normalizeCreatorProfiles(
      xhsCreatorProfiles,
      rawXhsGroupOptions,
    ),
    xhsGroupOptions: normalizeSmartGroupOptions(rawXhsGroupOptions),
    bilibiliCreatorProfiles: normalizeCreatorProfiles(
      bilibiliCreatorProfiles,
      rawBilibiliGroupOptions,
    ),
    bilibiliGroupOptions: normalizeSmartGroupOptions(rawBilibiliGroupOptions),
  };
}

export function getModuleLabel(moduleId: string): string {
  return MODULE_LABELS[moduleId] || moduleId;
}

function hasSemanticScholarTrackingIdentity(card: FeedCard): boolean {
  return card.id.startsWith("followup-monitor:") || card.id.startsWith("source-paper:");
}

export function isLegacySemanticScholarTrackerCard(card: FeedCard): boolean {
  if (card.module_id !== "semantic-scholar-tracker") return false;

  const trackingType = metadataString(card, "paper_tracking_type");
  const trackingRole = metadataString(card, "paper_tracking_role");
  const trackingLabel = metadataString(card, "paper_tracking_label");
  const sourcePaperTitle = metadataString(card, "source_paper_title");
  const trackingLabels = metadataStringList(card, "paper_tracking_labels");

  return (
    !trackingType
    && !trackingRole
    && !trackingLabel
    && !sourcePaperTitle
    && trackingLabels.length === 0
    && !hasSemanticScholarTrackingIdentity(card)
  );
}

export function isPaperTrackingCard(card: FeedCard): boolean {
  const trackingType = metadataString(card, "paper_tracking_type");
  const trackingRole = metadataString(card, "paper_tracking_role");
  if (trackingType === "keyword" || trackingType === "followup" || trackingType === "source") {
    return true;
  }
  if (trackingRole === "source") {
    return true;
  }
  if (card.module_id === "arxiv-tracker") {
    return true;
  }
  if (card.module_id === "semantic-scholar-tracker") {
    return !isLegacySemanticScholarTrackerCard(card);
  }
  return false;
}

export function getPaperTrackingType(card: FeedCard): "keyword" | "followup" | null {
  const value = metadataString(card, "paper_tracking_type");
  if (value === "keyword" || value === "followup") {
    return value;
  }
  if (value === "source") {
    return null;
  }
  if (card.module_id === "arxiv-tracker") return "keyword";
  if (card.module_id === "semantic-scholar-tracker") {
    if (isLegacySemanticScholarTrackerCard(card)) {
      return null;
    }
    const role = metadataString(card, "paper_tracking_role");
    return role === "source" ? null : "followup";
  }
  return null;
}

export function getPaperTrackingLabels(card: FeedCard): string[] {
  const labels = metadataStringList(card, "paper_tracking_labels");
  if (labels.length > 0) return labels;

  const single = metadataString(card, "paper_tracking_label");
  if (single) return [single];

  const sourceTitle = metadataString(card, "source_paper_title");
  return sourceTitle ? [sourceTitle] : [];
}

export function getPaperDetailDescriptor(card: FeedCard): PaperDetailDescriptor | null {
  const trackingType = getPaperTrackingType(card);
  if (!trackingType) return null;

  if (trackingType === "keyword") {
    const labels = getPaperTrackingLabels(card);
    const label = labels[0] || metadataString(card, "paper_tracking_label") || "Unnamed keyword";
    return {
      key: `keyword:${label}`,
      label,
      type: "keyword",
    };
  }

  const sourceTitle = metadataString(card, "source_paper_title");
  const sourcePaper = metadataRecord(card, "source_paper");
  const sourcePaperLabel = typeof sourcePaper.title === "string" ? sourcePaper.title.trim() : "";
  const labels = getPaperTrackingLabels(card);
  const explicitLabel = metadataString(card, "paper_tracking_label");
  const label = sourceTitle || sourcePaperLabel || explicitLabel || labels[0] || "Unnamed source paper";
  return {
    key: `followup:${label}`,
    label,
    type: "followup",
  };
}

export function getCardPlatform(card: FeedCard): {
  id: "xiaohongshu" | "bilibili" | "papers" | "other";
  label: string;
  scope: Exclude<IntelligenceScope, "all">;
} {
  const platform = metadataString(card, "platform");
  if (platform === "xiaohongshu" || card.module_id === "xiaohongshu-tracker") {
    return { id: "xiaohongshu", label: "Xiaohongshu", scope: "social" };
  }
  if (platform === "bilibili" || card.module_id === "bilibili-tracker") {
    return { id: "bilibili", label: "Bilibili", scope: "social" };
  }
  if (
    isPaperTrackingCard(card)
    || Boolean(getPaperTrackingType(card))
  ) {
    return { id: "papers", label: "Papers", scope: "papers" };
  }
  return { id: "other", label: getModuleLabel(card.module_id), scope: "other" };
}

export function getCardAuthorLabel(card: FeedCard): string {
  const platform = getCardPlatform(card);
  if (platform.id === "xiaohongshu") {
    return metadataString(card, "author");
  }
  if (platform.id === "bilibili") {
    return metadataString(card, "up_name");
  }
  return "";
}

export function getCardSmartGroups(
  card: FeedCard,
  context: FeedContext,
): { values: string[]; labels: string[] } {
  const platform = getCardPlatform(card);
  const options = platform.id === "xiaohongshu"
    ? context.xhsGroupOptions
    : platform.id === "bilibili"
      ? context.bilibiliGroupOptions
      : [];
  const explicitValues = metadataStringList(card, "creator_smart_groups");
  const explicitLabels = metadataStringList(card, "creator_smart_group_labels");
  if (explicitValues.length > 0 || explicitLabels.length > 0) {
    return normalizeSmartGroups(explicitValues, explicitLabels, options);
  }

  if (platform.id === "xiaohongshu") {
    const userId = metadataString(card, "user_id");
    const profile = context.xhsCreatorProfiles[userId];
    if (!profile) return { values: [], labels: [] };
    return normalizeSmartGroups(
      profile.smart_groups || [],
      profile.smart_group_labels || [],
      context.xhsGroupOptions,
    );
  }

  if (platform.id === "bilibili") {
    const upUid = metadataString(card, "up_uid");
    const profile = context.bilibiliCreatorProfiles[upUid];
    if (!profile) return { values: [], labels: [] };
    return normalizeSmartGroups(
      profile.smart_groups || [],
      profile.smart_group_labels || [],
      context.bilibiliGroupOptions,
    );
  }

  return { values: [], labels: [] };
}

export function getCardSourceDescriptor(
  card: FeedCard,
  context: FeedContext,
): { key: string; label: string } {
  const paperTrackingType = getPaperTrackingType(card);
  if (paperTrackingType === "followup") {
    return { key: "paper-followup", label: "Follow Up" };
  }
  if (paperTrackingType === "keyword") {
    return { key: "paper-keyword", label: "Keyword monitor" };
  }

  const platform = getCardPlatform(card);
  const smartGroupLabels = getCardSmartGroups(card, context).labels;
  if (platform.id === "xiaohongshu") {
    const crawlSource = metadataString(card, "crawl_source");
    if (crawlSource === "following") {
      return { key: "xhs-following", label: "Follow feed" };
    }
    if (crawlSource.startsWith("keyword:")) {
      return { key: "xhs-keyword", label: "Keyword search" };
    }
    if (smartGroupLabels.length > 0) {
      return { key: "xhs-smart-group", label: "Smart-grouped bloggers" };
    }
    return { key: "xhs-creator", label: "Followed bloggers" };
  }

  if (platform.id === "bilibili") {
    const monitorSource = metadataString(card, "monitor_source");
    const monitorSourceLabel = metadataString(card, "monitor_source_label");
    if (monitorSourceLabel) {
      return { key: `bili-${monitorSource || "source"}`, label: monitorSourceLabel };
    }
    if (smartGroupLabels.length > 0) {
      return { key: "bili-smart-group", label: "Smart-grouped creators" };
    }
    if (metadataString(card, "dynamic_id")) {
      return { key: "bili-follow", label: "Follow feed" };
    }
    if (metadataString(card, "bvid")) {
      return { key: "bili-targeted", label: "Targeted creators" };
    }
    return { key: "bili-source", label: "Bilibili source" };
  }

  return {
    key: `${platform.id}-${card.module_id}`,
    label: getModuleLabel(card.module_id),
  };
}

export function getCardMetricBadges(card: FeedCard): MetricBadge[] {
  const badges: MetricBadge[] = [];

  if (card.score >= 0.82) {
    badges.push({ key: "high-score", label: "High score" });
  }

  if (Date.now() - getReferenceTime(card) <= 48 * 60 * 60 * 1000) {
    badges.push({ key: "fresh", label: "Last 48h" });
  }

  const likes = metadataNumber(card, "likes");
  const collects = metadataNumber(card, "collects");
  const comments = metadataNumber(card, "comments_count");
  const engagementScore = likes + collects * 2 + comments * 8;
  if (engagementScore >= 1800 || likes >= 1200 || collects >= 300) {
    badges.push({ key: "engaged", label: "Trending" });
  }

  const citationCount = metadataNumber(card, "citation_count");
  if (citationCount >= 20) {
    badges.push({ key: "cited", label: `Highly cited ${citationCount}` });
  }

  return badges;
}

export function decorateFeedCard(card: FeedCard, context: FeedContext): FeedCard {
  const platform = getCardPlatform(card);
  const source = getCardSourceDescriptor(card, context);
  const smartGroups = getCardSmartGroups(card, context);
  const metrics = getCardMetricBadges(card);
  const paperLabels = getPaperTrackingLabels(card);
  const authorLabel = getCardAuthorLabel(card);
  const paperDetail = getPaperDetailDescriptor(card);

  return {
    ...card,
    metadata: {
      ...card.metadata,
      intelligence_platform: platform.id,
      intelligence_platform_label: platform.label,
      intelligence_scope: platform.scope,
      intelligence_source_key: source.key,
      intelligence_source_label: source.label,
      intelligence_smart_groups: smartGroups.values,
      intelligence_smart_group_labels: smartGroups.labels,
      intelligence_metric_keys: metrics.map((metric) => metric.key),
      intelligence_metric_labels: metrics.map((metric) => metric.label),
      intelligence_author_label: authorLabel,
      intelligence_tracking_labels: paperLabels,
      intelligence_paper_detail_key: paperDetail?.key || "",
      intelligence_paper_detail_label: paperDetail?.label || "",
    },
  };
}

function sectionSortValue(section: IntelligenceGroupSection): number {
  return section.cards.reduce((maxValue, card) => Math.max(maxValue, getReferenceTime(card)), 0);
}

function getSectionSuggestions(
  type: IntelligenceGroupSection["type"],
  groupValues: string[],
  cards: FeedCard[],
  context: FeedContext,
): { suggestions: string[]; sampleTags: string[] } {
  if (type !== "smart" || groupValues.length === 0) {
    return { suggestions: [], sampleTags: [] };
  }

  const activeAuthors = new Set(
    cards
      .map((card) => getCardAuthorLabel(card))
      .filter((value) => value.trim().length > 0)
  );

  const suggestions = new Set<string>();
  const sampleTags = new Set<string>();

  const pickFromProfiles = (
    profiles: Record<string, CreatorProfile>,
    options: SmartGroupOption[],
  ) => {
    const optionMap = new Map(options.map((option) => [option.value, option]));
    for (const groupValue of groupValues) {
      const option = optionMap.get(groupValue);
      for (const author of option?.sample_authors || []) {
        if (!activeAuthors.has(author) && suggestions.size < 8) {
          suggestions.add(author);
        }
      }
      for (const tag of option?.sample_tags || []) {
        if (sampleTags.size < 6) {
          sampleTags.add(tag);
        }
      }
    }

    for (const profile of Object.values(profiles)) {
      const groups = normalizeSmartGroups(
        profile.smart_groups || [],
        profile.smart_group_labels || [],
        options,
      ).values;
      if (!groups.some((group) => groupValues.includes(group))) continue;
      const author = profile.author || profile.matched_author || "";
      if (author && !activeAuthors.has(author) && suggestions.size < 8) {
        suggestions.add(author);
      }
      for (const tag of profile.sample_tags || []) {
        if (sampleTags.size < 6) {
          sampleTags.add(tag);
        }
      }
    }
  };

  pickFromProfiles(context.xhsCreatorProfiles, context.xhsGroupOptions);
  pickFromProfiles(context.bilibiliCreatorProfiles, context.bilibiliGroupOptions);

  return {
    suggestions: Array.from(suggestions).slice(0, 8),
    sampleTags: Array.from(sampleTags).slice(0, 6),
  };
}

export function groupFeedCards(
  cards: FeedCard[],
  context: FeedContext,
  showRecommendations: boolean,
): IntelligenceGroupSection[] {
  const sectionMap = new Map<string, IntelligenceGroupSection & { groupValues: Set<string> }>();

  for (const card of cards) {
    const smartGroups = getCardSmartGroups(card, context);
    const paperDetail = getPaperDetailDescriptor(card);
    const platform = getCardPlatform(card);
    const source = getCardSourceDescriptor(card, context);
    const authorLabel = getCardAuthorLabel(card);
    const paperType = getPaperTrackingType(card);

    let key = "";
    let label = "";
    let type: IntelligenceGroupSection["type"] = "source";
    let groupValues: string[] = [];

    if (platform.scope === "social" && smartGroups.labels.length > 0) {
      key = `smart:${smartGroups.labels[0]}`;
      label = smartGroups.labels[0];
      type = "smart";
      groupValues = smartGroups.values;
    } else if (paperDetail) {
      key = `paper:${paperDetail.key}`;
      label = `${paperType === "followup" ? "Follow Up" : "Keyword"} · ${paperDetail.label}`;
      type = "paper";
    } else if (platform.scope === "social" && authorLabel) {
      key = `source:${platform.id}:${authorLabel}`;
      label = `${platform.label} · ${authorLabel}`;
    } else {
      key = `source:${source.key}`;
      label = `${platform.label} · ${source.label}`;
    }

    const existing = sectionMap.get(key);
    if (existing) {
      existing.cards.push(card);
      for (const value of groupValues) existing.groupValues.add(value);
      if (!existing.platforms.includes(platform.label)) existing.platforms.push(platform.label);
      if (!existing.sourceLabels.includes(source.label)) existing.sourceLabels.push(source.label);
      continue;
    }

    sectionMap.set(key, {
      key,
      label,
      type,
      cards: [card],
      platforms: [platform.label],
      sourceLabels: [source.label],
      suggestions: [],
      sampleTags: [],
      groupValues: new Set(groupValues),
    });
  }

  const sections = Array.from(sectionMap.values()).map((section) => {
    section.cards.sort((a, b) => getReferenceTime(b) - getReferenceTime(a));
    if (showRecommendations) {
      const extra = getSectionSuggestions(
        section.type,
        Array.from(section.groupValues),
        section.cards,
        context,
      );
      section.suggestions = extra.suggestions;
      section.sampleTags = extra.sampleTags;
    }
    const { groupValues, ...result } = section;
    return result;
  });

  sections.sort((a, b) => {
    if (b.cards.length !== a.cards.length) return b.cards.length - a.cards.length;
    return sectionSortValue(b) - sectionSortValue(a);
  });
  return sections;
}
