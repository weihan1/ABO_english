import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Inbox, Sparkles, Wifi, WifiOff, Layers, GitBranch, Filter, ChevronDown, ChevronRight, Search, Keyboard, X } from "lucide-react";
import { bilibiliSaveSelectedDynamics } from "../../api/bilibili";
import { xiaohongshuSavePreviews } from "../../api/xiaohongshu";
import { api } from "../../core/api";
import { withLocationSuffix } from "../../core/pathDisplay";
import { useStore, FeedCard } from "../../core/store";
import CardView from "./CardView";
import { useToast } from "../../components/Toast";
import {
  buildFeedContext,
  decorateFeedCard,
  DEFAULT_FEED_PREFERENCES,
  getCardPlatform,
  getCardSourceDescriptor,
  getModuleLabel,
  getPaperDetailDescriptor,
  getPaperTrackingType,
  groupFeedCards,
  isLegacySemanticScholarTrackerCard,
  isPaperTrackingCard,
  normalizeFeedPreferences,
  type FeedContext,
  type FeedPreferences,
  type IntelligenceGroupSection,
  type IntelligenceScope,
} from "./intelligence";

const FEED_SYNC_LIMIT = 200;

const EMPTY_FEED_CONTEXT: FeedContext = {
  xhsCreatorProfiles: {},
  xhsGroupOptions: [],
  bilibiliCreatorProfiles: {},
  bilibiliGroupOptions: [],
};

const DEFAULT_EXPANDED_TREE_SECTIONS: Record<string, boolean> = {
  social: false,
  "social:xhs": false,
  "social:xhs:keyword": false,
  "social:xhs:following": false,
  "social:xhs:creator": false,
  "social:bilibili": false,
  "social:bilibili:keyword": false,
  "social:bilibili:fixed-up": false,
  "social:shared": false,
  papers: false,
  "paper:keyword": false,
  "paper:followup": false,
  other: false,
};

const FEED_SHORTCUT_HINTS = [
  "Q Previous",
  "E Next",
  "T Back to top",
  "Scroll follows focus",
  "D Dislike",
  "S Save to library only",
  "W More important: write to Wiki + save to library",
  "X Skip and mark handled",
];

function isEditableEventTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: "999px",
        border: `1px solid ${active ? "var(--color-primary)" : "var(--border-light)"}`,
        background: active ? "rgba(188, 164, 227, 0.12)" : "var(--bg-app)",
        color: active ? "var(--color-primary)" : "var(--text-secondary)",
        fontSize: "0.75rem",
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {typeof count === "number" ? ` (${count})` : ""}
    </button>
  );
}

function cardMetadataString(card: FeedCard, key: string): string {
  const value = card.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function cardMetadataStringList(card: FeedCard, key: string): string[] {
  const value = card.metadata?.[key];
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const normalized = typeof item === "string" ? item.trim() : "";
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}

function getSocialSmartGroupLabels(card: FeedCard): string[] {
  return cardMetadataStringList(card, "intelligence_smart_group_labels");
}

function getXhsKeywordLabels(card: FeedCard): string[] {
  const matched = cardMetadataStringList(card, "matched_keywords");
  if (matched.length > 0) return matched;
  const crawlSource = cardMetadataString(card, "crawl_source");
  if (!crawlSource.startsWith("keyword:")) return [];
  const keyword = crawlSource.slice("keyword:".length).trim();
  return keyword ? [keyword] : [];
}

function getBilibiliMonitorLabel(card: FeedCard): string {
  return cardMetadataString(card, "monitor_label")
    || cardMetadataString(card, "monitor_source_label")
    || "Unnamed monitor";
}

function isBilibiliKeywordMonitorCard(card: FeedCard): boolean {
  if (getCardPlatform(card).id !== "bilibili") return false;
  if (isBilibiliFixedUpCard(card)) return false;
  const monitorSource = cardMetadataString(card, "monitor_source");
  const explicitMonitorLabel = cardMetadataString(card, "monitor_label");
  return monitorSource === "daily-monitor" || (!monitorSource && Boolean(explicitMonitorLabel));
}

function isBilibiliFixedUpCard(card: FeedCard): boolean {
  if (getCardPlatform(card).id !== "bilibili") return false;
  const monitorSource = cardMetadataString(card, "monitor_source");
  const monitorLabel = getBilibiliMonitorLabel(card).replace(/\s+/g, "");
  return monitorSource === "manual-up" || monitorLabel === "固定UP监督";
}

function getFeedCardAuthorLabel(card: FeedCard): string {
  return cardMetadataString(card, "intelligence_author_label")
    || cardMetadataString(card, "author")
    || cardMetadataString(card, "up_name")
    || "Unnamed author";
}

function getTrackedCardSubfolder(card: FeedCard, rootFolder: "xhs" | "bilibili"): string {
  const normalizedPath = String(card.obsidian_path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const relativePath = normalizedPath.startsWith(`${rootFolder}/`)
    ? normalizedPath.slice(rootFolder.length + 1)
    : normalizedPath;
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  parts.pop();
  return parts.join("/");
}

function getTrackedXhsSaveSubfolder(card: FeedCard): string {
  const baseSubfolder = getTrackedCardSubfolder(card, "xhs");
  const crawlSource = cardMetadataString(card, "crawl_source");
  const authorId = cardMetadataString(card, "author_id") || cardMetadataString(card, "user_id");
  const authorLabel = getFeedCardAuthorLabel(card).trim().replace(/[\\/]+/g, "-");
  if (!authorLabel || !["user_id", "creator-recent"].includes(crawlSource)) {
    return baseSubfolder;
  }
  if (!authorId || authorLabel === authorId) {
    return baseSubfolder;
  }

  const parts = baseSubfolder.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 2] === "指定用户扫描") {
    parts[parts.length - 1] = authorLabel;
    return parts.join("/");
  }
  if (parts.includes("指定用户扫描")) {
    const creatorIndex = parts.lastIndexOf("指定用户扫描");
    return [...parts.slice(0, creatorIndex + 1), authorLabel].join("/");
  }
  return ["主动保存", "指定用户扫描", authorLabel].join("/");
}

function canSaveFeedCard(card: FeedCard): boolean {
  const platform = getCardPlatform(card);
  return isPaperTrackingCard(card) || platform.id === "xiaohongshu" || platform.id === "bilibili";
}

function matchesSocialBranch(card: FeedCard, branch: string): boolean {
  if (branch === "all") return true;
  const platform = getCardPlatform(card).id;
  const sourceKey = cardMetadataString(card, "intelligence_source_key");
  const smartGroupLabels = getSocialSmartGroupLabels(card);

  switch (branch) {
    case "social-platform:xhs":
      return platform === "xiaohongshu";
    case "social-platform:bilibili":
      return platform === "bilibili";
    case "xhs-keyword":
      return platform === "xiaohongshu" && sourceKey === "xhs-keyword";
    case "xhs-following":
      return platform === "xiaohongshu" && sourceKey === "xhs-following";
    case "xhs-creator":
      return platform === "xiaohongshu" && sourceKey !== "xhs-keyword" && sourceKey !== "xhs-following";
    case "bili-keyword":
      return isBilibiliKeywordMonitorCard(card);
    case "bili-fixed-up":
      return isBilibiliFixedUpCard(card);
    case "social-shared-smart-groups":
      return (platform === "xiaohongshu" || platform === "bilibili") && smartGroupLabels.length > 0;
    default:
      return true;
  }
}

function matchesSocialDetail(card: FeedCard, detailKey: string): boolean {
  if (detailKey === "all") return true;
  const smartGroupLabels = getSocialSmartGroupLabels(card);

  if (detailKey.startsWith("xhs-keyword:") || detailKey.startsWith("xhs-following:")) {
    const label = detailKey.split(":").slice(1).join(":");
    return getXhsKeywordLabels(card).includes(label);
  }
  if (detailKey.startsWith("xhs-creator:group:")) {
    return smartGroupLabels.includes(detailKey.slice("xhs-creator:group:".length));
  }
  if (detailKey.startsWith("xhs-creator:author:")) {
    return getFeedCardAuthorLabel(card) === detailKey.slice("xhs-creator:author:".length);
  }
  if (detailKey.startsWith("bili-keyword:")) {
    return getBilibiliMonitorLabel(card) === detailKey.slice("bili-keyword:".length);
  }
  if (detailKey.startsWith("bili-fixed-up:author:")) {
    return getFeedCardAuthorLabel(card) === detailKey.slice("bili-fixed-up:author:".length);
  }
  if (detailKey.startsWith("shared-smart:")) {
    return smartGroupLabels.includes(detailKey.slice("shared-smart:".length));
  }
  return true;
}

function TreeFilterButton({
  active,
  label,
  count,
  depth = 0,
  onClick,
  leading,
  trailing,
}: {
  active: boolean;
  label: string;
  count: number;
  depth?: number;
  onClick: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        width: "100%",
        padding: "8px 10px",
        paddingLeft: `${10 + depth * 18}px`,
        borderRadius: "10px",
        border: `1px solid ${active ? "rgba(188, 164, 227, 0.35)" : "transparent"}`,
        background: active ? "rgba(188, 164, 227, 0.12)" : "transparent",
        color: active ? "var(--color-primary)" : "var(--text-secondary)",
        fontSize: depth === 0 ? "0.875rem" : "0.8125rem",
        fontWeight: depth === 0 ? 700 : active ? 600 : 500,
        cursor: "pointer",
        transition: "all 0.2s ease",
        textAlign: "left",
      }}
    >
      <span style={{ width: "14px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
        {leading}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ fontSize: "0.75rem", color: active ? "var(--color-primary)" : "var(--text-muted)", flexShrink: 0 }}>
        {count}
      </span>
      {trailing ? <span style={{ width: "14px", display: "flex", justifyContent: "center", flexShrink: 0 }}>{trailing}</span> : null}
    </button>
  );
}

export default function Feed() {
  const {
    feedCards, setFeedCards,
    setUnreadCounts, config, feedRealtimeStatus,
  } = useStore();
  const toast = useToast();
  const [focusIdx, setFocusIdx] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [showShortcutOverlay, setShowShortcutOverlay] = useState(false);
  const [isBatchSkipping, setIsBatchSkipping] = useState(false);
  const [cardRatings, setCardRatings] = useState<Record<string, "like" | "neutral" | "dislike">>({});
  const [feedContext, setFeedContext] = useState<FeedContext>(EMPTY_FEED_CONTEXT);
  const [scopeFilter, setScopeFilter] = useState<IntelligenceScope>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [socialBranchFilter, setSocialBranchFilter] = useState("all");
  const [socialDetailFilter, setSocialDetailFilter] = useState("all");
  const [paperTypeFilter, setPaperTypeFilter] = useState<"all" | "keyword" | "followup">("all");
  const [paperDetailFilter, setPaperDetailFilter] = useState("all");
  const [expandedTreeSections, setExpandedTreeSections] = useState<Record<string, boolean>>(DEFAULT_EXPANDED_TREE_SECTIONS);
  const feedPreferences = useMemo(
    () => normalizeFeedPreferences(config?.feed_preferences || DEFAULT_FEED_PREFERENCES),
    [config?.feed_preferences],
  );
  const [groupMode, setGroupMode] = useState<FeedPreferences["group_mode"]>(feedPreferences.group_mode);
  const realtimeBadge = useMemo(() => {
    if (feedRealtimeStatus === "connected") {
      return {
        background: "rgba(168, 230, 207, 0.2)",
        border: "rgba(168, 230, 207, 0.4)",
        color: "#5BA88C",
        icon: <Wifi style={{ width: "16px", height: "16px", color: "#5BA88C" }} />,
        label: "Live connection OK",
      };
    }
    if (feedRealtimeStatus === "reconnecting" || feedRealtimeStatus === "connecting") {
      return {
        background: "rgba(255, 214, 165, 0.18)",
        border: "rgba(255, 214, 165, 0.45)",
        color: "#C9882B",
        icon: <Wifi style={{ width: "16px", height: "16px", color: "#C9882B" }} />,
        label: "Live connection reconnecting",
      };
    }
    return {
      background: "rgba(255, 183, 178, 0.2)",
      border: "rgba(255, 183, 178, 0.4)",
      color: "#D48984",
      icon: <WifiOff style={{ width: "16px", height: "16px", color: "#D48984" }} />,
      label: "Connection lost",
    };
  }, [feedRealtimeStatus]);
  const containerRef = useRef<HTMLDivElement>(null);
  const focusIdxRef = useRef(0);
  const focusIntentRef = useRef<"sync" | "keyboard" | "scroll" | "pointer">("sync");
  const pendingKeyboardEntryRef = useRef(false);
  const lastNavigationContextRef = useRef<string | null>(null);
  const hiddenModuleKey = feedPreferences.hidden_module_ids.join("|");
  const hiddenModuleIds = useMemo(
    () => new Set(feedPreferences.hidden_module_ids),
    [hiddenModuleKey],
  );

  function updateFocusIdx(
    next: number | ((current: number) => number),
    reason: "sync" | "keyboard" | "scroll" | "pointer" = "sync",
  ) {
    focusIntentRef.current = reason;
    if (reason !== "sync") {
      pendingKeyboardEntryRef.current = false;
    }
    setFocusIdx((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      if (orderedCards.length <= 0) return 0;
      return Math.max(0, Math.min(resolved, orderedCards.length - 1));
    });
  }

  // Check mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (!showShortcutOverlay) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowShortcutOverlay(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showShortcutOverlay]);

  // Initial load
  useEffect(() => {
    void loadCards();
    void loadIntelligenceContext();
  }, [setFeedCards, setUnreadCounts]);

  useEffect(() => {
    setGroupMode(feedPreferences.group_mode);
  }, [feedPreferences.group_mode]);

  function resetHierarchyFilters() {
    setScopeFilter("all");
    setSourceFilter("all");
    setSocialBranchFilter("all");
    setSocialDetailFilter("all");
    setPaperTypeFilter("all");
    setPaperDetailFilter("all");
    setExpandedTreeSections(DEFAULT_EXPANDED_TREE_SECTIONS);
  }

  async function loadIntelligenceContext() {
    const [xhsConfig, bilibiliConfig] = await Promise.allSettled([
      api.get<Record<string, unknown>>("/api/modules/xiaohongshu-tracker/config"),
      api.get<Record<string, unknown>>("/api/modules/bilibili-tracker/config"),
    ]);

    setFeedContext(
      buildFeedContext(
        xhsConfig.status === "fulfilled" ? xhsConfig.value : {},
        bilibiliConfig.status === "fulfilled" ? bilibiliConfig.value : {},
      ),
    );
  }

  async function loadCards() {
    try {
      const r = await api.get<{ cards: FeedCard[] }>(`/api/cards?unread_only=true&limit=${FEED_SYNC_LIMIT}`);
      const cards = (r.cards || []).filter((card) => !isLegacySemanticScholarTrackerCard(card));

      setFeedCards(cards);
      updateFocusIdx(0);
    } catch (e) {
      setFeedCards([]);
      updateFocusIdx(0);
    }

    // Load unread counts
    api.get<Record<string, number>>("/api/cards/unread-counts")
      .then(setUnreadCounts)
      .catch(() => {});
  }

  async function refreshUnreadCounts() {
    await api.get<Record<string, number>>("/api/cards/unread-counts")
      .then(setUnreadCounts)
      .catch(() => {});
  }

  const decoratedCards = useMemo(
    () => feedCards
      .filter((card) => !hiddenModuleIds.has(card.module_id))
      .filter((card) => !isLegacySemanticScholarTrackerCard(card))
      .map((card) => decorateFeedCard(card, feedContext)),
    [feedCards, hiddenModuleIds, feedContext],
  );

  const scopedCards = useMemo(() => decoratedCards, [decoratedCards]);

  const scopeCounts = useMemo(
    () => ({
      social: scopedCards.filter((card) => getCardPlatform(card).scope === "social").length,
      papers: scopedCards.filter((card) => getCardPlatform(card).scope === "papers").length,
      other: scopedCards.filter((card) => getCardPlatform(card).scope === "other").length,
    }),
    [scopedCards],
  );

  const sharedSmartGroupCount = useMemo(() => {
    const labels = new Set<string>();
    for (const card of scopedCards) {
      if (getCardPlatform(card).scope !== "social") continue;
      for (const label of getSocialSmartGroupLabels(card)) {
        labels.add(label);
      }
    }
    return labels.size;
  }, [scopedCards]);

  const socialHierarchy = useMemo(() => {
    const createCounter = () => new Map<string, { label: string; count: number }>();
    const xhsKeyword = createCounter();
    const xhsFollowing = createCounter();
    const xhsCreatorGroups = createCounter();
    const xhsCreator = createCounter();
    const biliKeyword = createCounter();
    const biliFixedUp = createCounter();
    const sharedSmart = createCounter();
    let xhsTotal = 0;
    let xhsKeywordTotal = 0;
    let xhsFollowingTotal = 0;
    let xhsCreatorGroupTotal = 0;
    let xhsCreatorTotal = 0;
    let biliTotal = 0;
    let biliKeywordTotal = 0;
    let biliFixedUpTotal = 0;
    let sharedSmartCardTotal = 0;

    const addCount = (map: Map<string, { label: string; count: number }>, key: string, label: string) => {
      const existing = map.get(key);
      map.set(key, { label, count: (existing?.count || 0) + 1 });
    };

    const toOptions = (map: Map<string, { label: string; count: number }>) =>
      Array.from(map.entries())
        .map(([key, value]) => ({ key, label: value.label, count: value.count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    for (const card of scopedCards) {
      if (getCardPlatform(card).scope !== "social") continue;
      const platform = getCardPlatform(card).id;
      const sourceKey = cardMetadataString(card, "intelligence_source_key");
      const smartGroupLabels = getSocialSmartGroupLabels(card);

      if (smartGroupLabels.length > 0) {
        sharedSmartCardTotal += 1;
        smartGroupLabels.forEach((label) => addCount(sharedSmart, `shared-smart:${label}`, label));
      }

      if (platform === "xiaohongshu") {
        xhsTotal += 1;
        if (sourceKey === "xhs-keyword") {
          xhsKeywordTotal += 1;
          const labels = getXhsKeywordLabels(card);
          if (labels.length === 0) {
            addCount(xhsKeyword, "xhs-keyword:unnamed-keyword", "Unnamed keyword");
          } else {
            labels.forEach((label) => addCount(xhsKeyword, `xhs-keyword:${label}`, label));
          }
          continue;
        }
        if (sourceKey === "xhs-following") {
          xhsFollowingTotal += 1;
          const labels = getXhsKeywordLabels(card);
          if (labels.length === 0) {
            addCount(xhsFollowing, "xhs-following:unnamed-keyword", "Unnamed keyword");
          } else {
            labels.forEach((label) => addCount(xhsFollowing, `xhs-following:${label}`, label));
          }
          continue;
        }
        xhsCreatorTotal += 1;
        if (smartGroupLabels.length > 0) {
          xhsCreatorGroupTotal += 1;
          smartGroupLabels.forEach((label) => addCount(xhsCreatorGroups, `xhs-creator:group:${label}`, label));
        }
        const authorLabel = getFeedCardAuthorLabel(card);
        addCount(xhsCreator, `xhs-creator:author:${authorLabel}`, authorLabel);
        continue;
      }

      if (platform === "bilibili") {
        biliTotal += 1;
        if (isBilibiliKeywordMonitorCard(card)) {
          biliKeywordTotal += 1;
          const monitorLabel = getBilibiliMonitorLabel(card);
          addCount(biliKeyword, `bili-keyword:${monitorLabel}`, monitorLabel);
        }
        if (isBilibiliFixedUpCard(card)) {
          biliFixedUpTotal += 1;
          const authorLabel = getFeedCardAuthorLabel(card);
          addCount(biliFixedUp, `bili-fixed-up:author:${authorLabel}`, authorLabel);
        }
      }
    }

    return {
      xhs: {
        total: xhsTotal,
        keywordTotal: xhsKeywordTotal,
        keywordOptions: toOptions(xhsKeyword),
        followingTotal: xhsFollowingTotal,
        followingOptions: toOptions(xhsFollowing),
        creatorGroupTotal: xhsCreatorGroupTotal,
        creatorGroupOptions: toOptions(xhsCreatorGroups),
        creatorTotal: xhsCreatorTotal,
        creatorOptions: toOptions(xhsCreator),
      },
      bilibili: {
        total: biliTotal,
        keywordTotal: biliKeywordTotal,
        keywordOptions: toOptions(biliKeyword),
        fixedUpTotal: biliFixedUpTotal,
        fixedUpOptions: toOptions(biliFixedUp),
      },
      shared: {
        total: sharedSmartCardTotal,
        options: toOptions(sharedSmart),
      },
    };
  }, [scopedCards]);

  const paperHierarchy = useMemo(() => {
    const keywordCounts = new Map<string, { label: string; count: number }>();
    const followupCounts = new Map<string, { label: string; count: number }>();

    for (const card of scopedCards) {
      if (getCardPlatform(card).scope !== "papers") continue;
      const detail = getPaperDetailDescriptor(card);
      const type = getPaperTrackingType(card);
      if (!detail || !type) continue;

      const target = type === "keyword" ? keywordCounts : followupCounts;
      const existing = target.get(detail.key);
      target.set(detail.key, {
        label: detail.label,
        count: (existing?.count || 0) + 1,
      });
    }

    const toOptions = (counts: Map<string, { label: string; count: number }>) =>
      Array.from(counts.entries())
        .map(([key, value]) => ({ key, label: value.label, count: value.count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return {
      keyword: toOptions(keywordCounts),
      followup: toOptions(followupCounts),
    };
  }, [scopedCards]);

  const otherHierarchyOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const card of scopedCards) {
      if (getCardPlatform(card).scope !== "other") continue;
      const source = getCardSourceDescriptor(card, feedContext);
      const existing = counts.get(source.key);
      counts.set(source.key, {
        label: source.label,
        count: (existing?.count || 0) + 1,
      });
    }
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [scopedCards, feedContext]);

  const paperCards = useMemo(
    () => scopedCards.filter((card) => getCardPlatform(card).scope === "papers"),
    [scopedCards],
  );

  const cardsByScope = useMemo(
    () => scopeFilter === "all"
      ? scopedCards
      : scopedCards.filter((card) => getCardPlatform(card).scope === scopeFilter),
    [scopedCards, scopeFilter],
  );

  const usesPaperFilters = scopeFilter === "papers";

  const sourceOptions = useMemo(() => {
    if (scopeFilter !== "other") return [];
    const counts = new Map<string, { label: string; count: number }>();
    for (const card of cardsByScope) {
      const source = getCardSourceDescriptor(card, feedContext);
      const existing = counts.get(source.key);
      counts.set(source.key, {
        label: source.label,
        count: (existing?.count || 0) + 1,
      });
    }
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [cardsByScope, feedContext, scopeFilter]);

  const cardsBySource = useMemo(
    () => scopeFilter !== "other" || sourceFilter === "all"
      ? cardsByScope
      : cardsByScope.filter((card) => String(card.metadata.intelligence_source_key || "") === sourceFilter),
    [cardsByScope, scopeFilter, sourceFilter],
  );

  const cardsBySocialBranch = useMemo(
    () => scopeFilter !== "social" || socialBranchFilter === "all"
      ? cardsByScope
      : cardsByScope.filter((card) => matchesSocialBranch(card, socialBranchFilter)),
    [cardsByScope, scopeFilter, socialBranchFilter],
  );

  const cardsBySocialDetail = useMemo(
    () => scopeFilter !== "social" || socialDetailFilter === "all"
      ? cardsBySocialBranch
      : cardsBySocialBranch.filter((card) => matchesSocialDetail(card, socialDetailFilter)),
    [cardsBySocialBranch, scopeFilter, socialDetailFilter],
  );

  const paperTypeCounts = useMemo(
    () => ({
      keyword: paperCards.filter((card) => getPaperTrackingType(card) === "keyword").length,
      followup: paperCards.filter((card) => getPaperTrackingType(card) === "followup").length,
    }),
    [paperCards],
  );

  const cardsByPaperType = useMemo(
    () => !usesPaperFilters || paperTypeFilter === "all"
      ? paperCards
      : paperCards.filter((card) => getPaperTrackingType(card) === paperTypeFilter),
    [paperCards, paperTypeFilter, usesPaperFilters],
  );

  const paperDetailOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const card of cardsByPaperType) {
      const detail = getPaperDetailDescriptor(card);
      if (!detail) continue;
      const displayLabel = paperTypeFilter === "all"
        ? `${detail.type === "keyword" ? "Keyword" : "Source paper"} · ${detail.label}`
        : detail.label;
      const existing = counts.get(detail.key);
      counts.set(detail.key, {
        label: displayLabel,
        count: (existing?.count || 0) + 1,
      });
    }
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [cardsByPaperType, paperTypeFilter]);

  const filteredCards = useMemo(
    () => {
      if (scopeFilter === "social") {
        return cardsBySocialDetail;
      }
      if (scopeFilter === "other") {
        return cardsBySource;
      }
      if (!usesPaperFilters || paperDetailFilter === "all") {
        return usesPaperFilters ? cardsByPaperType : cardsByScope;
      }
      return cardsByPaperType.filter((card) => getPaperDetailDescriptor(card)?.key === paperDetailFilter);
    },
    [cardsByPaperType, cardsByScope, cardsBySocialDetail, cardsBySource, paperDetailFilter, scopeFilter, usesPaperFilters],
  );

  const groupedSections = useMemo<IntelligenceGroupSection[]>(
    () => groupFeedCards(
      filteredCards,
      feedContext,
      feedPreferences.show_recommendations,
    ),
    [filteredCards, feedContext, feedPreferences.show_recommendations],
  );

  const orderedCards = useMemo(
    () => groupMode === "smart"
      ? groupedSections.flatMap((section) => section.cards)
      : filteredCards,
    [groupMode, groupedSections, filteredCards],
  );

  const orderedCardIndex = useMemo(
    () => new Map(orderedCards.map((card, index) => [card.id, index])),
    [orderedCards],
  );

  const navigationContextKey = `${groupMode}|${scopeFilter}|${sourceFilter}|${socialBranchFilter}|${socialDetailFilter}|${paperTypeFilter}|${paperDetailFilter}`;

  useEffect(() => {
    if (scopeFilter === "other" && sourceFilter !== "all" && !sourceOptions.some((option) => option.key === sourceFilter)) {
      setSourceFilter("all");
    }
  }, [scopeFilter, sourceFilter, sourceOptions]);

  useEffect(() => {
    if (scopeFilter !== "social" || socialDetailFilter === "all") return;
    if (!cardsBySocialBranch.some((card) => matchesSocialDetail(card, socialDetailFilter))) {
      setSocialDetailFilter("all");
    }
  }, [cardsBySocialBranch, scopeFilter, socialDetailFilter]);

  useEffect(() => {
    if (!usesPaperFilters) return;
    if (paperTypeFilter === "keyword" && paperTypeCounts.keyword === 0) {
      setPaperTypeFilter("all");
      return;
    }
    if (paperTypeFilter === "followup" && paperTypeCounts.followup === 0) {
      setPaperTypeFilter("all");
    }
  }, [paperTypeCounts.followup, paperTypeCounts.keyword, paperTypeFilter, usesPaperFilters]);

  useEffect(() => {
    if (!usesPaperFilters) return;
    if (paperDetailFilter !== "all" && !paperDetailOptions.some((option) => option.key === paperDetailFilter)) {
      setPaperDetailFilter("all");
    }
  }, [paperDetailFilter, paperDetailOptions, usesPaperFilters]);

  useEffect(() => {
    if (lastNavigationContextRef.current === null) {
      lastNavigationContextRef.current = navigationContextKey;
      return;
    }
    if (lastNavigationContextRef.current === navigationContextKey) {
      return;
    }
    lastNavigationContextRef.current = navigationContextKey;
    pendingKeyboardEntryRef.current = true;
    updateFocusIdx(0, "sync");
  }, [navigationContextKey]);

  useEffect(() => {
    updateFocusIdx((index) => Math.max(0, Math.min(index, orderedCards.length - 1)));
  }, [orderedCards.length]);

  useEffect(() => {
    focusIdxRef.current = focusIdx;
  }, [focusIdx]);

  async function syncPaperCardToWiki(
    card: FeedCard,
    overrides?: {
      obsidianPath?: string;
      literaturePath?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const literaturePath = overrides?.literaturePath
      || (typeof card.metadata.literature_path === "string" ? card.metadata.literature_path : "")
      || overrides?.obsidianPath
      || card.obsidian_path
      || "";
    const obsidianPath = overrides?.obsidianPath || literaturePath || card.obsidian_path || "";
    const metadata = overrides?.metadata || card.metadata;

    try {
      await api.post("/api/wiki/lit/ingest", {
        source_type: "paper",
        source_id: card.id,
        source_content: JSON.stringify({
          id: card.id,
          title: card.title,
          summary: card.summary,
          tags: card.tags,
          source_url: card.source_url,
          obsidian_path: obsidianPath,
          literature_path: literaturePath,
          path: literaturePath || obsidianPath,
          metadata,
        }),
      });
      return true;
    } catch (error) {
      console.error("Failed to sync paper into wiki:", error);
      toast.error("Write failed", error instanceof Error ? error.message : "Please try again later");
      return false;
    }
  }

  async function syncIntelCardToWiki(
    card: FeedCard,
    overrides?: {
      obsidianPath?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const obsidianPath = overrides?.obsidianPath || card.obsidian_path || "";
    const metadata = overrides?.metadata || card.metadata;
    try {
      await api.post("/api/wiki/intel/ingest", {
        source_type: "card",
        source_id: card.id,
        source_content: JSON.stringify({
          id: card.id,
          title: card.title,
          summary: card.summary,
          tags: card.tags,
          source_url: card.source_url,
          obsidian_path: obsidianPath,
          path: obsidianPath,
          metadata,
        }),
      });
      return true;
    } catch (error) {
      toast.error("Write failed", error instanceof Error ? error.message : "Please try again later");
      return false;
    }
  }

  async function markCardProcessed(cardId: string) {
    setCardRatings((prev) => ({ ...prev, [cardId]: "like" }));
    const result = await api.post<{ affected_card_ids?: string[] }>(`/api/cards/${cardId}/feedback`, { action: "like" }).catch(() => null);
    const affectedIds = new Set(result?.affected_card_ids || [cardId]);
    const currentFeedCards = useStore.getState().feedCards;
    setFeedCards(currentFeedCards.filter((c) => !affectedIds.has(c.id)));
    await refreshUnreadCounts();
  }

  function jumpToTop() {
    updateFocusIdx(0, "keyboard");
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isEditableEventTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const card = orderedCards[focusIdx];
      switch (key) {
        case "e":
          if (orderedCards.length > 0) {
            e.preventDefault();
            if (pendingKeyboardEntryRef.current) {
              updateFocusIdx(0, "keyboard");
            } else {
              updateFocusIdx((i) => i + 1, "keyboard");
            }
          }
          break;
        case "q":
          if (orderedCards.length > 0) {
            e.preventDefault();
            if (pendingKeyboardEntryRef.current) {
              updateFocusIdx(0, "keyboard");
            } else {
              updateFocusIdx((i) => i - 1, "keyboard");
            }
          }
          break;
        case "t": e.preventDefault(); jumpToTop(); break;
        case "d":
          if (card) {
            e.preventDefault();
            pendingKeyboardEntryRef.current = false;
            handleRating(card.id, "dislike");
          }
          break;
        case "s":
          if (card && canSaveFeedCard(card)) {
            e.preventDefault();
            pendingKeyboardEntryRef.current = false;
            handleFeedback(card.id, "save");
          }
          break;
        case "x":
          if (card) {
            e.preventDefault();
            pendingKeyboardEntryRef.current = false;
            handleFeedback(card.id, "skip");
          }
          break;
        case "w":
          if (card) {
            e.preventDefault();
            pendingKeyboardEntryRef.current = false;
            handleFeedback(card.id, "wiki");
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusIdx, orderedCards, cardRatings]);

  // Auto-scroll
  useEffect(() => {
    const shouldAutoScroll = focusIntentRef.current === "keyboard";
    focusIntentRef.current = "sync";
    if (!shouldAutoScroll) {
      return;
    }
    if (containerRef.current) {
      const cards = containerRef.current.querySelectorAll<HTMLElement>("[data-feed-card='true']");
      const focusedElement = cards[focusIdx];
      if (focusedElement) {
        focusedElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [focusIdx]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frameId = 0;
    const syncFocusedCardFromScroll = () => {
      frameId = 0;
      const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-feed-card='true']"));
      if (!cards.length) return;

      const containerRect = container.getBoundingClientRect();
      const anchorY = containerRect.top + Math.min(
        Math.max(containerRect.height * 0.28, 120),
        Math.max(containerRect.height - 40, 120),
      );
      let bestIndex = focusIdxRef.current;
      let bestDistance = Number.POSITIVE_INFINITY;

      cards.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        const isVisible = rect.bottom > containerRect.top + 24 && rect.top < containerRect.bottom - 24;
        if (!isVisible) return;

        const cardAnchor = rect.top + Math.min(rect.height * 0.35, 140);
        const distance = Math.abs(cardAnchor - anchorY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });

      if (bestDistance !== Number.POSITIVE_INFINITY && bestIndex !== focusIdxRef.current) {
        updateFocusIdx(bestIndex, "scroll");
      }
    };

    const handleScroll = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(syncFocusedCardFromScroll);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [orderedCards]);

  async function savePaperCard(
    card: FeedCard,
    options?: {
      syncWiki?: boolean;
    },
  ): Promise<boolean> {
    const trackingType = getPaperTrackingType(card);
    const saveMode = trackingType === "keyword" || card.module_id === "arxiv-tracker"
      ? "keyword"
      : trackingType === "followup" || (card.module_id === "semantic-scholar-tracker" && !isLegacySemanticScholarTrackerCard(card))
        ? "followup"
        : null;
    if (!saveMode) {
      return true;
    }

    const shouldSyncWiki = options?.syncWiki ?? false;
    const existingLiteraturePath = typeof card.metadata.literature_path === "string"
      ? card.metadata.literature_path
      : "";
    const existingObsidianPath = card.obsidian_path || existingLiteraturePath;
    const alreadySaved = Boolean(card.metadata.saved_to_literature || existingLiteraturePath);
    if (alreadySaved) {
      if (!shouldSyncWiki) {
        toast.success(
          "Saved to Literature Library",
          withLocationSuffix("This paper is already in the Literature Library", existingObsidianPath || existingLiteraturePath, "literature", config),
        );
        return true;
      }

      const wikiSynced = await syncPaperCardToWiki(card, {
        obsidianPath: existingObsidianPath,
        literaturePath: existingLiteraturePath,
        metadata: card.metadata,
      });
      if (!wikiSynced) {
        return false;
      }

      toast.success(
        "Written to Literature Wiki",
        withLocationSuffix("Paper synced into the Literature Wiki", existingObsidianPath || existingLiteraturePath, "literature", config),
      );
      return true;
    }

    const payload = {
      paper: {
        id: card.id,
        title: card.title,
        summary: card.summary,
        score: card.score,
        tags: card.tags,
        source_url: card.source_url,
        metadata: card.metadata,
      },
      save_pdf: true,
      max_figures: 5,
    };

    try {
      const result = saveMode === "keyword"
        ? await api.post<{
          path?: string;
          figures?: Array<Record<string, unknown>>;
          pdf?: string | null;
          introduction?: string;
          formatted_digest?: string;
          source_paper_path?: string;
          source_paper_pdf_path?: string;
        }>("/api/modules/arxiv-tracker/save-to-literature", payload)
        : await api.post<{
          path?: string;
          figures?: Array<Record<string, unknown>>;
          pdf?: string | null;
          introduction?: string;
          formatted_digest?: string;
          source_paper_path?: string;
          source_paper_pdf_path?: string;
        }>("/api/modules/semantic-scholar/save-to-literature", payload);

      const savedCardMetadata = {
        ...card.metadata,
        saved_to_literature: true,
        ...(result.path ? { literature_path: result.path } : {}),
        ...(result.figures?.length ? { local_figures: result.figures, figures: result.figures } : {}),
        ...(result.pdf ? { pdf_path: result.pdf } : {}),
        ...(result.introduction ? { introduction: result.introduction } : {}),
        ...(result.formatted_digest ? { "formatted-digest": result.formatted_digest } : {}),
        ...(result.source_paper_path ? { source_paper_path: result.source_paper_path } : {}),
        ...(result.source_paper_pdf_path ? { source_paper_pdf_path: result.source_paper_pdf_path } : {}),
      };

      const currentFeedCards = useStore.getState().feedCards;
      setFeedCards(currentFeedCards.map((item) => (
        item.id === card.id
          ? {
            ...item,
            obsidian_path: result.path || item.obsidian_path,
            metadata: savedCardMetadata,
          }
          : item
      )));

      if (shouldSyncWiki) {
        const wikiSynced = await syncPaperCardToWiki(card, {
          obsidianPath: result.path || card.obsidian_path,
          literaturePath: result.path || card.obsidian_path,
          metadata: savedCardMetadata,
        });
        if (!wikiSynced) {
          return false;
        }

        toast.success(
          "Saved to Literature Library and written to Literature Wiki",
          withLocationSuffix("Paper saved to the library and synced into the Literature Wiki", result.path, "literature", config),
        );
      } else {
        toast.success(
          "Saved to Literature Library",
          withLocationSuffix(
            saveMode === "keyword"
              ? "Keyword-tracked paper saved"
              : "Follow Up paper saved",
            result.path,
            "literature",
            config,
          ),
        );
      }
      return true;
    } catch (error) {
      toast.error("Save failed", error instanceof Error ? error.message : "Please check the Literature Library path");
      return false;
    }
  }

  async function saveIntelCard(
    card: FeedCard,
    options?: {
      syncWiki?: boolean;
    },
  ): Promise<boolean> {
    const platform = getCardPlatform(card).id;
    const shouldSyncWiki = options?.syncWiki ?? false;

    try {
      if (platform === "xiaohongshu") {
        const subfolder = getTrackedXhsSaveSubfolder(card);
        const result = await xiaohongshuSavePreviews({
          notes: [
            {
              id: cardMetadataString(card, "note_id") || card.id,
              title: card.title,
              content: cardMetadataString(card, "content") || card.summary,
              author: cardMetadataString(card, "author") || getFeedCardAuthorLabel(card),
              author_id: cardMetadataString(card, "author_id") || cardMetadataString(card, "user_id"),
              likes: Number(card.metadata.likes || 0),
              collects: Number(card.metadata.collects || 0),
              comments_count: Number(card.metadata.comments_count || 0),
              url: card.source_url,
              published_at: cardMetadataString(card, "published_at") || cardMetadataString(card, "published") || null,
              cover_image: cardMetadataString(card, "cover_image") || undefined,
              note_type: cardMetadataString(card, "note_type") || undefined,
              images: cardMetadataStringList(card, "images"),
              video_url: cardMetadataString(card, "video_url") || undefined,
              xsec_token: cardMetadataString(card, "xsec_token") || undefined,
              xsec_source: cardMetadataString(card, "xsec_source") || undefined,
            },
          ],
          subfolder,
          save_strategy: "detail",
          include_comments: false,
          comments_limit: 20,
          comments_sort_by: "likes",
        });
        const savedPath = result.results.find((item) => item.success && item.markdown_path)?.markdown_path
          || result.xhs_dir
          || card.obsidian_path;
        const nextMetadata = {
          ...card.metadata,
          saved_to_vault: true,
          saved_path: savedPath,
        };

        if (shouldSyncWiki) {
          const wikiSynced = await syncIntelCardToWiki(card, {
            obsidianPath: savedPath,
            metadata: nextMetadata,
          });
          if (!wikiSynced) return false;
          toast.success(
            "Saved to Intel Library and written to Internet Wiki",
            withLocationSuffix("Xiaohongshu intel saved under its monitor directory and synced to the Wiki", savedPath, "vault", config),
          );
        } else {
          toast.success(
            "Saved to Intel Library",
            withLocationSuffix("Xiaohongshu intel saved under its monitor directory", savedPath, "vault", config),
          );
        }
        return true;
      }

      if (platform === "bilibili") {
        const result = await bilibiliSaveSelectedDynamics({
          dynamics: [
            {
              id: card.id,
              dynamic_id: cardMetadataString(card, "dynamic_id") || card.id,
              title: card.title,
              content: cardMetadataString(card, "description") || card.summary,
              author: cardMetadataString(card, "up_name") || getFeedCardAuthorLabel(card),
              author_id: cardMetadataString(card, "up_uid"),
              url: card.source_url,
              published_at: cardMetadataString(card, "published") || null,
              dynamic_type: (cardMetadataString(card, "dynamic_type") || "text") as "video" | "image" | "text" | "article",
              pic: cardMetadataString(card, "thumbnail"),
              images: cardMetadataStringList(card, "images"),
              bvid: cardMetadataString(card, "bvid"),
              tags: cardMetadataStringList(card, "tags"),
              matched_keywords: cardMetadataStringList(card, "matched_keywords"),
              matched_tags: cardMetadataStringList(card, "matched_tags"),
              monitor_label: cardMetadataString(card, "monitor_label") || undefined,
              monitor_subfolder: cardMetadataString(card, "monitor_subfolder") || getTrackedCardSubfolder(card, "bilibili") || undefined,
              crawl_source: cardMetadataString(card, "monitor_source") || undefined,
              crawl_source_label: cardMetadataString(card, "monitor_source_label") || cardMetadataString(card, "monitor_label") || undefined,
            },
          ],
        });
        const savedPath = (result.written_files || []).find((path) => path.includes("/dynamic/") && !path.endsWith("Bilibili 爬取汇总.md"))
          || result.output_dir
          || card.obsidian_path;
        const nextMetadata = {
          ...card.metadata,
          saved_to_vault: true,
          saved_path: savedPath,
        };

        if (shouldSyncWiki) {
          const wikiSynced = await syncIntelCardToWiki(card, {
            obsidianPath: savedPath,
            metadata: nextMetadata,
          });
          if (!wikiSynced) return false;
          toast.success(
            "Saved to Intel Library and written to Internet Wiki",
            withLocationSuffix("Bilibili intel saved under its monitor directory and synced to the Wiki", savedPath, "vault", config),
          );
        } else {
          toast.success(
            "Saved to Intel Library",
            withLocationSuffix("Bilibili intel saved under its monitor directory", savedPath, "vault", config),
          );
        }
        return true;
      }
    } catch (error) {
      toast.error("Save failed", error instanceof Error ? error.message : "Please check the Intel Library path");
      return false;
    }

    return true;
  }

  async function handleFeedback(cardId: string, action: string) {
    const card = feedCards.find((c) => c.id === cardId);
    if (action === "wiki") {
      if (card) {
        const wikiDone = isPaperTrackingCard(card)
          ? await savePaperCard(card, { syncWiki: true })
          : canSaveFeedCard(card)
            ? await saveIntelCard(card, { syncWiki: true })
            : await syncIntelCardToWiki(card);
        if (!wikiDone) {
          return;
        }

        if (!isPaperTrackingCard(card) && !canSaveFeedCard(card)) {
          toast.success("Written to Internet Wiki", "This intel has been added to your Internet Wiki overview");
        }
        await markCardProcessed(cardId);
      }
      return;
    }

    if (action === "save" && card) {
      const saved = isPaperTrackingCard(card)
        ? await savePaperCard(card, { syncWiki: false })
        : await saveIntelCard(card, { syncWiki: false });
      if (!saved) {
        return;
      }
      await markCardProcessed(cardId);
      return;
    }

    const result = await api.post<{ affected_card_ids?: string[] }>(`/api/cards/${cardId}/feedback`, { action }).catch(() => null);
    if (action === "skip") {
      const affectedIds = new Set(result?.affected_card_ids || [cardId]);
      const currentFeedCards = useStore.getState().feedCards;
      setFeedCards(currentFeedCards.filter((c) => !affectedIds.has(c.id)));
      await refreshUnreadCounts();
    }
  }

  async function handleSkipVisibleCards() {
    const visibleCardIds = Array.from(new Set(orderedCards.map((card) => card.id)));
    if (visibleCardIds.length === 0 || isBatchSkipping) {
      return;
    }

    setIsBatchSkipping(true);
    try {
      const result = await api.post<{
        ok: boolean;
        hidden_card_ids: string[];
      }>("/api/cards/hide-temporary", {
        card_ids: visibleCardIds,
      });
      const skippedIds = new Set(result.hidden_card_ids || []);
      if (skippedIds.size > 0) {
        const currentFeedCards = useStore.getState().feedCards;
        setFeedCards(currentFeedCards.filter((card) => !skippedIds.has(card.id)));
      }
      await refreshUnreadCounts();

      if (skippedIds.size > 0) {
        toast.success(
          "Current filter results cleared",
          `Temporarily removed ${skippedIds.size} items from the current Feed; this is not written to skip history, so they will reappear on the next crawl.`,
        );
      } else {
        toast.success("Nothing to clear", "No items in the current filter can be temporarily removed");
      }
    } catch (error) {
      toast.error("Clear failed", error instanceof Error ? error.message : "Please try again later");
    } finally {
      setIsBatchSkipping(false);
    }
  }

  async function handleRating(cardId: string, rating: "like" | "neutral" | "dislike") {
    // Update local state
    setCardRatings(prev => ({ ...prev, [cardId]: rating }));
    // Send to backend
    const result = await api.post<{ affected_card_ids?: string[] }>(`/api/cards/${cardId}/feedback`, { action: rating }).catch(() => null);
    if (rating === "dislike") {
      const affectedIds = new Set(result?.affected_card_ids || [cardId]);
      const currentFeedCards = useStore.getState().feedCards;
      setFeedCards(currentFeedCards.filter((card) => !affectedIds.has(card.id)));
      await refreshUnreadCounts();
    }
  }

  const hasVisibleFeed = decoratedCards.length > 0;

  // Empty State - only when there are no visible cards at all
  if (!hasVisibleFeed) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "clamp(20px, 4vw, 32px)",
          color: "var(--text-muted)",
          padding: "clamp(24px, 5vw, 48px)",
          background: "linear-gradient(135deg, var(--bg-app) 0%, rgba(188, 164, 227, 0.05) 100%)",
        }}
      >
        <div style={{ position: "relative" }}>
          <div
            style={{
              width: "clamp(80px, 12vw, 100px)",
              height: "clamp(80px, 12vw, 100px)",
              borderRadius: "50%",
              background: "linear-gradient(135deg, rgba(188, 164, 227, 0.25), rgba(255, 183, 178, 0.2))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(12px)",
              border: "2px solid var(--border-light)",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            <Inbox style={{ width: "clamp(36px, 5vw, 44px)", height: "clamp(36px, 5vw, 44px)", opacity: 0.6, color: "var(--color-primary)" }} aria-hidden />
          </div>
          <div style={{ position: "absolute", top: "-12px", right: "-12px", animation: "float 3s ease-in-out infinite" }}>
            <Sparkles style={{ width: "28px", height: "28px", color: "var(--color-secondary)" }} aria-hidden />
          </div>
        </div>

        <div style={{ textAlign: "center", maxWidth: "400px" }}>
          <h2 style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif", fontSize: "clamp(1.25rem, 3vw, 1.5rem)", fontWeight: 700, color: "var(--text-main)", marginBottom: "12px" }}>
            {feedCards.length === 0 ? "Today's Feed is clear" : "Current sources are hidden"}
          </h2>
          <p style={{ fontSize: "clamp(0.9375rem, 2vw, 1rem)", color: "var(--text-muted)", lineHeight: 1.6 }}>
            {feedCards.length === 0
              ? "All intel has been handled — take a break ✨"
              : "Remaining unread intel comes from sources you hid in Settings. You can re-enable them there."}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 20px", borderRadius: "var(--radius-full)", background: realtimeBadge.background, border: `1px solid ${realtimeBadge.border}` }}>
          {realtimeBadge.icon}
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: realtimeBadge.color }}>
            {realtimeBadge.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ height: "100%", overflowY: "auto", background: "var(--bg-app)" }}>
      <div style={{ maxWidth: "min(1100px, 95vw)", margin: "0 auto", padding: "clamp(20px, 3vw, 32px) clamp(16px, 3vw, 32px)" }}>
        <div style={{ position: "sticky", top: "16px", zIndex: 20, display: "flex", justifyContent: "flex-end", pointerEvents: "none", marginBottom: "8px" }}>
          <div
            style={{ pointerEvents: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}
            onMouseEnter={() => {
              if (!isMobile) {
                setShowShortcutOverlay(true);
              }
            }}
            onMouseLeave={() => {
              if (!isMobile) {
                setShowShortcutOverlay(false);
              }
            }}
          >
            <div style={{ position: "relative", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  if (isMobile) {
                    setShowShortcutOverlay((value) => !value);
                  }
                }}
                aria-expanded={showShortcutOverlay}
                aria-label="View Feed keyboard shortcuts"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 12px",
                  borderRadius: "999px",
                  border: "1px solid var(--border-light)",
                  background: "rgba(255, 255, 255, 0.9)",
                  backdropFilter: "blur(12px)",
                  boxShadow: "var(--shadow-soft)",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <Keyboard style={{ width: "14px", height: "14px" }} />
                Shortcuts
                {showShortcutOverlay ? <X style={{ width: "14px", height: "14px" }} /> : null}
              </button>

              {showShortcutOverlay && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    zIndex: 30,
                    width: "min(320px, calc(100vw - 32px))",
                    padding: "14px",
                    borderRadius: "14px",
                    border: "1px solid var(--border-light)",
                    background: "rgba(255, 255, 255, 0.94)",
                    backdropFilter: "blur(14px)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                    {FEED_SHORTCUT_HINTS.map((hint) => (
                      <span
                        key={hint}
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-secondary)",
                          fontFamily: "monospace",
                          padding: "6px 8px",
                          borderRadius: "8px",
                          background: "var(--bg-hover)",
                        }}
                      >
                        {hint}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "clamp(16px, 2vw, 24px)" }}>
          {/* Header Section */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "var(--radius-md)",
                  background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 16px rgba(188, 164, 227, 0.35)",
                  flexShrink: 0,
                }}
              >
                <Layers style={{ width: "24px", height: "24px", color: "white" }} />
              </div>
              <div>
                <h1 style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif", fontSize: "clamp(1.25rem, 2.5vw, 1.5rem)", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
                  Intel Feed
                </h1>
                <p style={{ fontSize: "0.9375rem", color: "var(--text-muted)" }}>
                  {orderedCards.length} pending · Social {scopeCounts.social} · Papers {scopeCounts.papers} · Shared smart groups {sharedSmartGroupCount}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { void handleSkipVisibleCards(); }}
                disabled={orderedCards.length === 0 || isBatchSkipping}
                style={{
                  padding: "6px 12px",
                  borderRadius: "999px",
                  border: `1px solid ${orderedCards.length === 0 || isBatchSkipping ? "var(--border-light)" : "rgba(212, 137, 132, 0.4)"}`,
                  background: orderedCards.length === 0 || isBatchSkipping ? "var(--bg-app)" : "rgba(212, 137, 132, 0.1)",
                  color: orderedCards.length === 0 || isBatchSkipping ? "var(--text-muted)" : "#B55E58",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  cursor: orderedCards.length === 0 || isBatchSkipping ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {isBatchSkipping ? "Batch skipping..." : `Skip all in current filter (${orderedCards.length})`}
              </button>
              <FilterChip active={groupMode === "smart"} label="Smart groups" onClick={() => setGroupMode("smart")} />
              <FilterChip active={groupMode === "timeline"} label="Timeline" onClick={() => setGroupMode("timeline")} />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              padding: "16px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              background: "var(--bg-card)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-main)" }}>
              <Filter style={{ width: "16px", height: "16px" }} />
              <span style={{ fontSize: "0.875rem", fontWeight: 700 }}>Categories & filters</span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "8px",
                borderRadius: "12px",
                background: "var(--bg-app)",
                border: "1px solid var(--border-light)",
              }}
            >
              <TreeFilterButton
                active={
                  scopeFilter === "all"
                  && sourceFilter === "all"
                  && socialBranchFilter === "all"
                  && socialDetailFilter === "all"
                  && paperTypeFilter === "all"
                  && paperDetailFilter === "all"
                }
                label="All intel"
                count={scopedCards.length}
                onClick={resetHierarchyFilters}
                leading={<Layers style={{ width: "14px", height: "14px" }} />}
              />

              <TreeFilterButton
                active={scopeFilter === "papers"}
                label="Paper tracking"
                count={scopeCounts.papers}
                onClick={() => {
                  const nextExpanded = scopeFilter === "papers" ? !expandedTreeSections.papers : true;
                  setScopeFilter("papers");
                  setSourceFilter("all");
                  setSocialBranchFilter("all");
                  setSocialDetailFilter("all");
                  setPaperTypeFilter("all");
                  setPaperDetailFilter("all");
                  setExpandedTreeSections((current) => ({
                    ...current,
                    papers: nextExpanded,
                  }));
                }}
                leading={<GitBranch style={{ width: "14px", height: "14px" }} />}
                trailing={
                  scopeCounts.papers > 0
                    ? (expandedTreeSections.papers
                        ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                        : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                    : null
                }
              />

              {scopeCounts.papers > 0 && expandedTreeSections.papers && (
                <>
                  <TreeFilterButton
                    active={scopeFilter === "papers" && paperTypeFilter === "keyword"}
                    label="arXiv keyword monitors"
                    count={paperTypeCounts.keyword}
                    depth={1}
                    onClick={() => {
                      const nextExpanded = scopeFilter === "papers" && paperTypeFilter === "keyword"
                        ? !expandedTreeSections["paper:keyword"]
                        : true;
                      setScopeFilter("papers");
                      setSourceFilter("all");
                      setSocialBranchFilter("all");
                      setSocialDetailFilter("all");
                      setPaperTypeFilter("keyword");
                      setPaperDetailFilter("all");
                      setExpandedTreeSections((current) => ({
                        ...current,
                        papers: true,
                        "paper:keyword": nextExpanded,
                      }));
                    }}
                    leading={<Search style={{ width: "14px", height: "14px" }} />}
                    trailing={
                      paperHierarchy.keyword.length > 0
                        ? (expandedTreeSections["paper:keyword"]
                            ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                            : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                        : null
                    }
                  />
                  {expandedTreeSections["paper:keyword"] && paperHierarchy.keyword.map((option) => (
                    <TreeFilterButton
                      key={option.key}
                      active={scopeFilter === "papers" && paperTypeFilter === "keyword" && paperDetailFilter === option.key}
                      label={option.label}
                      count={option.count}
                      depth={2}
                      onClick={() => {
                        setScopeFilter("papers");
                        setSourceFilter("all");
                        setSocialBranchFilter("all");
                        setSocialDetailFilter("all");
                        setPaperTypeFilter("keyword");
                        setPaperDetailFilter(option.key);
                        setExpandedTreeSections((current) => ({
                          ...current,
                          papers: true,
                          "paper:keyword": true,
                        }));
                      }}
                    />
                  ))}

                  <TreeFilterButton
                    active={scopeFilter === "papers" && paperTypeFilter === "followup"}
                    label="Follow Up chain"
                    count={paperTypeCounts.followup}
                    depth={1}
                    onClick={() => {
                      const nextExpanded = scopeFilter === "papers" && paperTypeFilter === "followup"
                        ? !expandedTreeSections["paper:followup"]
                        : true;
                      setScopeFilter("papers");
                      setSourceFilter("all");
                      setSocialBranchFilter("all");
                      setSocialDetailFilter("all");
                      setPaperTypeFilter("followup");
                      setPaperDetailFilter("all");
                      setExpandedTreeSections((current) => ({
                        ...current,
                        papers: true,
                        "paper:followup": nextExpanded,
                      }));
                    }}
                    leading={<GitBranch style={{ width: "14px", height: "14px" }} />}
                    trailing={
                      paperHierarchy.followup.length > 0
                        ? (expandedTreeSections["paper:followup"]
                            ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                            : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                        : null
                    }
                  />
                  {expandedTreeSections["paper:followup"] && paperHierarchy.followup.map((option) => (
                    <TreeFilterButton
                      key={option.key}
                      active={scopeFilter === "papers" && paperTypeFilter === "followup" && paperDetailFilter === option.key}
                      label={option.label}
                      count={option.count}
                      depth={2}
                      onClick={() => {
                        setScopeFilter("papers");
                        setSourceFilter("all");
                        setSocialBranchFilter("all");
                        setSocialDetailFilter("all");
                        setPaperTypeFilter("followup");
                        setPaperDetailFilter(option.key);
                        setExpandedTreeSections((current) => ({
                          ...current,
                          papers: true,
                          "paper:followup": true,
                        }));
                      }}
                    />
                  ))}
                </>
              )}

              <TreeFilterButton
                active={scopeFilter === "social"}
                label="Social follows"
                count={scopeCounts.social}
                onClick={() => {
                  const nextExpanded = scopeFilter === "social" ? !expandedTreeSections.social : true;
                  setScopeFilter("social");
                  setSourceFilter("all");
                  setSocialBranchFilter("all");
                  setSocialDetailFilter("all");
                  setPaperTypeFilter("all");
                  setPaperDetailFilter("all");
                  setExpandedTreeSections((current) => ({
                    ...current,
                    social: nextExpanded,
                  }));
                }}
                leading={<Sparkles style={{ width: "14px", height: "14px" }} />}
                trailing={
                  scopeCounts.social > 0
                    ? (expandedTreeSections.social
                        ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                        : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                    : null
                }
              />

              {scopeCounts.social > 0 && expandedTreeSections.social && (
                <>
                  <TreeFilterButton
                    active={scopeFilter === "social" && socialBranchFilter === "social-platform:xhs" && socialDetailFilter === "all"}
                    label="Xiaohongshu"
                    count={socialHierarchy.xhs.total}
                    depth={1}
                    onClick={() => {
                      const nextExpanded = socialBranchFilter === "social-platform:xhs" ? !expandedTreeSections["social:xhs"] : true;
                      setScopeFilter("social");
                      setSourceFilter("all");
                      setSocialBranchFilter("social-platform:xhs");
                      setSocialDetailFilter("all");
                      setPaperTypeFilter("all");
                      setPaperDetailFilter("all");
                      setExpandedTreeSections((current) => ({
                        ...current,
                        social: true,
                        "social:xhs": nextExpanded,
                      }));
                    }}
                    leading={<Search style={{ width: "14px", height: "14px" }} />}
                    trailing={
                      socialHierarchy.xhs.total > 0
                        ? (expandedTreeSections["social:xhs"]
                            ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                            : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                        : null
                    }
                  />

                  {socialHierarchy.xhs.total > 0 && expandedTreeSections["social:xhs"] && (
                    <>
                      <TreeFilterButton
                        active={scopeFilter === "social" && socialBranchFilter === "xhs-keyword" && socialDetailFilter === "all"}
                        label="Keyword monitors"
                        count={socialHierarchy.xhs.keywordTotal}
                        depth={2}
                        onClick={() => {
                          const nextExpanded = socialBranchFilter === "xhs-keyword" ? !expandedTreeSections["social:xhs:keyword"] : true;
                          setScopeFilter("social");
                          setSourceFilter("all");
                          setSocialBranchFilter("xhs-keyword");
                          setSocialDetailFilter("all");
                          setExpandedTreeSections((current) => ({
                            ...current,
                            social: true,
                            "social:xhs": true,
                            "social:xhs:keyword": nextExpanded,
                          }));
                        }}
                        trailing={
                          socialHierarchy.xhs.keywordOptions.length > 0
                            ? (expandedTreeSections["social:xhs:keyword"]
                                ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                                : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                            : null
                        }
                      />
                      {expandedTreeSections["social:xhs:keyword"] && socialHierarchy.xhs.keywordOptions.map((option) => (
                        <TreeFilterButton
                          key={option.key}
                          active={scopeFilter === "social" && socialBranchFilter === "xhs-keyword" && socialDetailFilter === option.key}
                          label={option.label}
                          count={option.count}
                          depth={3}
                          onClick={() => {
                            setScopeFilter("social");
                            setSourceFilter("all");
                            setSocialBranchFilter("xhs-keyword");
                            setSocialDetailFilter(option.key);
                            setExpandedTreeSections((current) => ({
                              ...current,
                              social: true,
                              "social:xhs": true,
                              "social:xhs:keyword": true,
                            }));
                          }}
                        />
                      ))}

                      <TreeFilterButton
                        active={scopeFilter === "social" && socialBranchFilter === "xhs-following" && socialDetailFilter === "all"}
                        label="Followed keyword monitors"
                        count={socialHierarchy.xhs.followingTotal}
                        depth={2}
                        onClick={() => {
                          const nextExpanded = socialBranchFilter === "xhs-following" ? !expandedTreeSections["social:xhs:following"] : true;
                          setScopeFilter("social");
                          setSourceFilter("all");
                          setSocialBranchFilter("xhs-following");
                          setSocialDetailFilter("all");
                          setExpandedTreeSections((current) => ({
                            ...current,
                            social: true,
                            "social:xhs": true,
                            "social:xhs:following": nextExpanded,
                          }));
                        }}
                        trailing={
                          socialHierarchy.xhs.followingOptions.length > 0
                            ? (expandedTreeSections["social:xhs:following"]
                                ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                                : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                            : null
                        }
                      />
                      {expandedTreeSections["social:xhs:following"] && socialHierarchy.xhs.followingOptions.map((option) => (
                        <TreeFilterButton
                          key={option.key}
                          active={scopeFilter === "social" && socialBranchFilter === "xhs-following" && socialDetailFilter === option.key}
                          label={option.label}
                          count={option.count}
                          depth={3}
                          onClick={() => {
                            setScopeFilter("social");
                            setSourceFilter("all");
                            setSocialBranchFilter("xhs-following");
                            setSocialDetailFilter(option.key);
                            setExpandedTreeSections((current) => ({
                              ...current,
                              social: true,
                              "social:xhs": true,
                              "social:xhs:following": true,
                            }));
                          }}
                        />
                      ))}

                      <TreeFilterButton
                        active={scopeFilter === "social" && socialBranchFilter === "xhs-creator" && socialDetailFilter === "all"}
                        label="Pinned bloggers"
                        count={socialHierarchy.xhs.creatorTotal}
                        depth={2}
                        onClick={() => {
                          const nextExpanded = socialBranchFilter === "xhs-creator" ? !expandedTreeSections["social:xhs:creator"] : true;
                          setScopeFilter("social");
                          setSourceFilter("all");
                          setSocialBranchFilter("xhs-creator");
                          setSocialDetailFilter("all");
                          setExpandedTreeSections((current) => ({
                            ...current,
                            social: true,
                            "social:xhs": true,
                            "social:xhs:creator": nextExpanded,
                          }));
                        }}
                        trailing={
                          socialHierarchy.xhs.creatorOptions.length > 0
                            ? (expandedTreeSections["social:xhs:creator"]
                                ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                                : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                            : null
                        }
                      />
                      {expandedTreeSections["social:xhs:creator"] && socialHierarchy.xhs.creatorGroupOptions.map((option) => (
                        <TreeFilterButton
                          key={option.key}
                          active={scopeFilter === "social" && socialBranchFilter === "xhs-creator" && socialDetailFilter === option.key}
                          label={`Group · ${option.label}`}
                          count={option.count}
                          depth={3}
                          onClick={() => {
                            setScopeFilter("social");
                            setSourceFilter("all");
                            setSocialBranchFilter("xhs-creator");
                            setSocialDetailFilter(option.key);
                            setExpandedTreeSections((current) => ({
                              ...current,
                              social: true,
                              "social:xhs": true,
                              "social:xhs:creator": true,
                            }));
                          }}
                        />
                      ))}
                      {expandedTreeSections["social:xhs:creator"] && socialHierarchy.xhs.creatorOptions.map((option) => (
                        <TreeFilterButton
                          key={option.key}
                          active={scopeFilter === "social" && socialBranchFilter === "xhs-creator" && socialDetailFilter === option.key}
                          label={option.label}
                          count={option.count}
                          depth={3}
                          onClick={() => {
                            setScopeFilter("social");
                            setSourceFilter("all");
                            setSocialBranchFilter("xhs-creator");
                            setSocialDetailFilter(option.key);
                            setExpandedTreeSections((current) => ({
                              ...current,
                              social: true,
                              "social:xhs": true,
                              "social:xhs:creator": true,
                            }));
                          }}
                        />
                      ))}
                    </>
                  )}

                  <TreeFilterButton
                    active={scopeFilter === "social" && socialBranchFilter === "social-platform:bilibili" && socialDetailFilter === "all"}
                    label="Bilibili"
                    count={socialHierarchy.bilibili.total}
                    depth={1}
                    onClick={() => {
                      const nextExpanded = socialBranchFilter === "social-platform:bilibili" ? !expandedTreeSections["social:bilibili"] : true;
                      setScopeFilter("social");
                      setSourceFilter("all");
                      setSocialBranchFilter("social-platform:bilibili");
                      setSocialDetailFilter("all");
                      setPaperTypeFilter("all");
                      setPaperDetailFilter("all");
                      setExpandedTreeSections((current) => ({
                        ...current,
                        social: true,
                        "social:bilibili": nextExpanded,
                      }));
                    }}
                    leading={<Search style={{ width: "14px", height: "14px" }} />}
                    trailing={
                      socialHierarchy.bilibili.total > 0
                        ? (expandedTreeSections["social:bilibili"]
                            ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                            : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                        : null
                    }
                  />

                  {socialHierarchy.bilibili.total > 0 && expandedTreeSections["social:bilibili"] && (
                    <>
                      <TreeFilterButton
                        active={scopeFilter === "social" && socialBranchFilter === "bili-keyword" && socialDetailFilter === "all"}
                        label="Follow keyword monitors"
                        count={socialHierarchy.bilibili.keywordTotal}
                        depth={2}
                        onClick={() => {
                          const nextExpanded = socialBranchFilter === "bili-keyword" ? !expandedTreeSections["social:bilibili:keyword"] : true;
                          setScopeFilter("social");
                          setSourceFilter("all");
                          setSocialBranchFilter("bili-keyword");
                          setSocialDetailFilter("all");
                          setExpandedTreeSections((current) => ({
                            ...current,
                            social: true,
                            "social:bilibili": true,
                            "social:bilibili:keyword": nextExpanded,
                          }));
                        }}
                        trailing={
                          socialHierarchy.bilibili.keywordOptions.length > 0
                            ? (expandedTreeSections["social:bilibili:keyword"]
                                ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                                : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                            : null
                        }
                      />
                      {expandedTreeSections["social:bilibili:keyword"] && socialHierarchy.bilibili.keywordOptions.map((option) => (
                        <TreeFilterButton
                          key={option.key}
                          active={scopeFilter === "social" && socialBranchFilter === "bili-keyword" && socialDetailFilter === option.key}
                          label={option.label}
                          count={option.count}
                          depth={3}
                          onClick={() => {
                            setScopeFilter("social");
                            setSourceFilter("all");
                            setSocialBranchFilter("bili-keyword");
                            setSocialDetailFilter(option.key);
                            setExpandedTreeSections((current) => ({
                              ...current,
                              social: true,
                              "social:bilibili": true,
                              "social:bilibili:keyword": true,
                            }));
                          }}
                        />
                      ))}

                      <TreeFilterButton
                        active={scopeFilter === "social" && socialBranchFilter === "bili-fixed-up" && socialDetailFilter === "all"}
                        label="Pinned creators"
                        count={socialHierarchy.bilibili.fixedUpTotal}
                        depth={2}
                        onClick={() => {
                          const nextExpanded = socialBranchFilter === "bili-fixed-up" ? !expandedTreeSections["social:bilibili:fixed-up"] : true;
                          setScopeFilter("social");
                          setSourceFilter("all");
                          setSocialBranchFilter("bili-fixed-up");
                          setSocialDetailFilter("all");
                          setExpandedTreeSections((current) => ({
                            ...current,
                            social: true,
                            "social:bilibili": true,
                            "social:bilibili:fixed-up": nextExpanded,
                          }));
                        }}
                        trailing={
                          socialHierarchy.bilibili.fixedUpOptions.length > 0
                            ? (expandedTreeSections["social:bilibili:fixed-up"]
                                ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                                : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                            : null
                        }
                      />
                      {expandedTreeSections["social:bilibili:fixed-up"] && socialHierarchy.bilibili.fixedUpOptions.map((option) => (
                        <TreeFilterButton
                          key={option.key}
                          active={scopeFilter === "social" && socialBranchFilter === "bili-fixed-up" && socialDetailFilter === option.key}
                          label={option.label}
                          count={option.count}
                          depth={3}
                          onClick={() => {
                            setScopeFilter("social");
                            setSourceFilter("all");
                            setSocialBranchFilter("bili-fixed-up");
                            setSocialDetailFilter(option.key);
                            setExpandedTreeSections((current) => ({
                              ...current,
                              social: true,
                              "social:bilibili": true,
                              "social:bilibili:fixed-up": true,
                            }));
                          }}
                        />
                      ))}

                    </>
                  )}

                  <TreeFilterButton
                    active={scopeFilter === "social" && socialBranchFilter === "social-shared-smart-groups" && socialDetailFilter === "all"}
                    label="Cross-platform smart groups"
                    count={socialHierarchy.shared.total}
                    depth={1}
                    onClick={() => {
                      const nextExpanded = socialBranchFilter === "social-shared-smart-groups" ? !expandedTreeSections["social:shared"] : true;
                      setScopeFilter("social");
                      setSourceFilter("all");
                      setSocialBranchFilter("social-shared-smart-groups");
                      setSocialDetailFilter("all");
                      setExpandedTreeSections((current) => ({
                        ...current,
                        social: true,
                        "social:shared": nextExpanded,
                      }));
                    }}
                    leading={<Sparkles style={{ width: "14px", height: "14px" }} />}
                    trailing={
                      socialHierarchy.shared.options.length > 0
                        ? (expandedTreeSections["social:shared"]
                            ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                            : <ChevronRight style={{ width: "14px", height: "14px" }} />)
                        : null
                    }
                  />
                  {expandedTreeSections["social:shared"] && socialHierarchy.shared.options.map((option) => (
                    <TreeFilterButton
                      key={option.key}
                      active={scopeFilter === "social" && socialBranchFilter === "social-shared-smart-groups" && socialDetailFilter === option.key}
                      label={option.label}
                      count={option.count}
                      depth={2}
                      onClick={() => {
                        setScopeFilter("social");
                        setSourceFilter("all");
                        setSocialBranchFilter("social-shared-smart-groups");
                        setSocialDetailFilter(option.key);
                        setExpandedTreeSections((current) => ({
                          ...current,
                          social: true,
                          "social:shared": true,
                        }));
                      }}
                    />
                  ))}
                </>
              )}

              {scopeCounts.other > 0 && (
                <>
                  <TreeFilterButton
                    active={scopeFilter === "other"}
                    label="Other sources"
                    count={scopeCounts.other}
                    onClick={() => {
                      const nextExpanded = scopeFilter === "other" ? !expandedTreeSections.other : true;
                      setScopeFilter("other");
                      setSourceFilter("all");
                      setSocialBranchFilter("all");
                      setSocialDetailFilter("all");
                      setPaperTypeFilter("all");
                      setPaperDetailFilter("all");
                      setExpandedTreeSections((current) => ({
                        ...current,
                        other: nextExpanded,
                      }));
                    }}
                    leading={<Filter style={{ width: "14px", height: "14px" }} />}
                    trailing={
                      expandedTreeSections.other
                        ? <ChevronDown style={{ width: "14px", height: "14px" }} />
                        : <ChevronRight style={{ width: "14px", height: "14px" }} />
                    }
                  />
                  {expandedTreeSections.other && otherHierarchyOptions.map((option) => (
                    <TreeFilterButton
                      key={option.key}
                      active={scopeFilter === "other" && sourceFilter === option.key}
                      label={option.label}
                      count={option.count}
                      depth={1}
                      onClick={() => {
                        setScopeFilter("other");
                        setSourceFilter(option.key);
                        setSocialBranchFilter("all");
                        setSocialDetailFilter("all");
                        setPaperTypeFilter("all");
                        setPaperDetailFilter("all");
                        setExpandedTreeSections((current) => ({
                          ...current,
                          other: true,
                        }));
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              background: "var(--bg-card)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <GitBranch style={{ width: "16px", height: "16px", color: "var(--color-primary)" }} />
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                Today's highlights
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Xiaohongshu and Bilibili are unified under one set of smart tags, so authors and creators in the same group are viewed together; papers can be filtered by keyword monitors / Follow Up first, then refined by specific keyword or source paper.
              Hidden sources: {feedPreferences.hidden_module_ids.length > 0
                ? feedPreferences.hidden_module_ids.map(getModuleLabel).join("、")
                : "none"}.
            </p>
          </div>

          {/* Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(12px, 1.5vw, 16px)" }}>
            {orderedCards.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
                <p style={{ fontSize: "1rem", marginBottom: "8px" }}>
                  No intel under the current filter
                </p>
                <p style={{ fontSize: "0.875rem", opacity: 0.7, marginBottom: "16px" }}>
                  Try switching shared smart groups, paper keywords / source papers, or re-enabling hidden sources.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setScopeFilter("all");
                    setSourceFilter("all");
                    setSocialBranchFilter("all");
                    setSocialDetailFilter("all");
                    setPaperTypeFilter("all");
                    setPaperDetailFilter("all");
                    setExpandedTreeSections(DEFAULT_EXPANDED_TREE_SECTIONS);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : groupMode === "smart" ? (
              groupedSections.map((section) => (
                <div key={section.key} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: "var(--radius-md)",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-light)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
                      <span style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>
                        {section.label}
                      </span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          padding: "4px 10px",
                          borderRadius: "999px",
                          background: "rgba(188, 164, 227, 0.12)",
                          color: "var(--color-primary)",
                        }}
                      >
                        {section.cards.length} items
                      </span>
                      {section.platforms.map((platform) => (
                        <span
                          key={`${section.key}-${platform}`}
                          style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
                        >
                          {platform}
                        </span>
                      ))}
                    </div>

                    {section.sourceLabels.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: section.suggestions.length > 0 || section.sampleTags.length > 0 ? "8px" : 0 }}>
                        {section.sourceLabels.map((label) => (
                          <span
                            key={`${section.key}-source-${label}`}
                            style={{
                              fontSize: "0.75rem",
                              padding: "4px 8px",
                              borderRadius: "999px",
                              background: "var(--bg-hover)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {label}
                          </span>
                        ))}
                        {section.sampleTags.slice(0, 4).map((tag) => (
                          <span
                            key={`${section.key}-tag-${tag}`}
                            style={{
                              fontSize: "0.75rem",
                              padding: "4px 8px",
                              borderRadius: "999px",
                              background: "rgba(123, 200, 240, 0.14)",
                              color: "#2C7FB8",
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {section.suggestions.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)" }}>
                          Worth following
                        </span>
                        {section.suggestions.map((name) => (
                          <span
                            key={`${section.key}-suggestion-${name}`}
                            style={{
                              fontSize: "0.75rem",
                              padding: "4px 8px",
                              borderRadius: "999px",
                              background: "rgba(255, 183, 178, 0.14)",
                              color: "#C86D67",
                            }}
                          >
                            @{name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {section.cards.map((card) => {
                    const index = orderedCardIndex.get(card.id) ?? 0;
                    return (
                      <CardView
                        key={card.id}
                        card={card}
                        focused={index === focusIdx}
                        onClick={() => updateFocusIdx(index, "pointer")}
                        onFeedback={(action) => handleFeedback(card.id, action)}
                        onRating={(rating) => handleRating(card.id, rating)}
                        userRating={cardRatings[card.id]}
                      />
                    );
                  })}
                </div>
              ))
            ) : (
              orderedCards.map((card, i) => (
                <CardView
                  key={card.id}
                  card={card}
                  focused={i === focusIdx}
                  onClick={() => updateFocusIdx(i, "pointer")}
                  onFeedback={(action) => handleFeedback(card.id, action)}
                  onRating={(rating) => handleRating(card.id, rating)}
                  userRating={cardRatings[card.id]}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
