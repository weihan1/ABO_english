import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Calendar,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  BookHeart,
  Image as ImageIcon,
  RefreshCw,
  Save,
  Star,
  User,
} from "lucide-react";
import { xiaohongshuSyncAuthorsToTracker } from "../../api/xiaohongshu";
import { useToast } from "../../components/Toast";
import { api, API_BASE_URL, buildImageProxyUrl } from "../../core/api";
import { useStore, type FeedCard } from "../../core/store";
import SharedPaperTrackingCard, { type PaperTrackingCardPaper } from "../arxiv/PaperTrackingCard";
import BilibiliDynamicCard, { type BilibiliCardDynamic } from "../bilibili/BilibiliDynamicCard";
import XiaohongshuNoteCard, {
  type XiaohongshuCardNote,
  type XiaohongshuCommentPreview,
} from "../xiaohongshu/XiaohongshuNoteCard";
import { isPaperTrackingCard } from "./intelligence";

interface Props {
  card: FeedCard;
  focused: boolean;
  onClick: () => void;
  onFeedback: (action: string) => void | Promise<void>;
  onRating?: (rating: "like" | "neutral" | "dislike") => void;
  userRating?: "like" | "neutral" | "dislike" | null;
}

// Source icons mapping for all crawler types
const SOURCE_ICONS: Record<string, string> = {
  arxiv: "📄",
  "semantic-scholar": "🔬",
  "semantic_scholar": "🔬",
  "semantic_scholar_tracker": "🔬",
  bilibili: "📺",
  xiaohongshu: "📕",
  xiaoyuzhou: "🎧",
  zhihu: "❓",
  rss: "📰",
  "rss-aggregator": "📰",
  podcast: "🎙️",
  folder_monitor: "📁",
  "folder-monitor": "📁",
  folder: "📁",
};

// One-hand feedback actions
const RATING_ACTIONS = [
  {
    key: "dislike",
    label: "Dislike",
    emoji: "👎",
    shortcut: "D",
    gradient: "linear-gradient(135deg, #FFB7B2, #FF9E9A)",
    shadow: "rgba(255, 183, 178, 0.4)",
    color: "#D48984",
  },
];

// Extended actions
const EXT_ACTIONS = [
  {
    key: "skip",
    label: "Skip",
    shortcut: "X",
    Icon: ChevronDown,
    gradient: "linear-gradient(135deg, #E8E8E8, #D0D0D0)",
    shadow: "rgba(200, 200, 200, 0.3)",
  },
  {
    key: "wiki",
    label: "Excerpt to Wiki",
    shortcut: "W",
    Icon: BookHeart,
    gradient: "linear-gradient(135deg, #C4B5FD, #A78BFA)",
    shadow: "rgba(196, 181, 253, 0.4)",
  },
];

const SOCIAL_EXT_ACTIONS = [
  {
    key: "save",
    label: "Save to Intel Library",
    shortcut: "S",
    Icon: Save,
    gradient: "linear-gradient(135deg, #A8E6CF, #7DD3C0)",
    shadow: "rgba(125, 211, 192, 0.35)",
  },
  ...EXT_ACTIONS,
];

function metadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function metadataRecord(metadata: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = metadata[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataArray(metadata: Record<string, unknown>, key: string): unknown[] {
  const value = metadata[key];
  return Array.isArray(value) ? value : [];
}

function metadataStringList(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item === "string" && item.trim()) return [item.trim()];
        if (item && typeof item === "object" && "name" in item) {
          const name = (item as { name?: unknown }).name;
          return typeof name === "string" && name.trim() ? [name.trim()] : [];
        }
        return [];
      })
    : [];
}

function proxiedImage(url: string): string {
  if (!url) return "";
  return buildImageProxyUrl(url);
}

async function openExternalUrl(url: string) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) return;
  try {
    await openUrl(cleanUrl);
  } catch {
    window.open(cleanUrl, "_blank", "noopener,noreferrer");
  }
}

function normalizeXiaohongshuCommentPreviews(value: unknown): XiaohongshuCommentPreview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const author = typeof record.author === "string" ? record.author : "";
    const content = typeof record.content === "string" ? record.content : "";
    const likes = typeof record.likes === "number"
      ? record.likes
      : typeof record.likes === "string"
        ? Number(record.likes) || 0
        : 0;
    return [{
      id,
      author,
      content,
      likes,
      is_top: Boolean(record.is_top),
    }];
  });
}

function normalizePlainStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

type PaperFigureAsset = {
  url?: string;
  caption: string;
  is_method?: boolean;
  local_path?: string;
  original_url?: string;
  filename?: string;
};

const API_BASE = API_BASE_URL;

function normalizePaperFigures(figures: unknown): PaperFigureAsset[] {
  if (!Array.isArray(figures) || !figures.length) return [];

  const seen = new Set<string>();
  return figures.flatMap((figure, index) => {
    if (!figure || typeof figure !== "object") return [];
    const item = figure as Record<string, unknown>;
    const normalized: PaperFigureAsset = {
      url: typeof item.url === "string" ? item.url : undefined,
      caption: typeof item.caption === "string" && item.caption.trim() ? item.caption : `Figure ${index + 1}`,
      is_method: typeof item.is_method === "boolean" ? item.is_method : undefined,
      local_path: typeof item.local_path === "string" ? item.local_path : undefined,
      original_url: typeof item.original_url === "string" ? item.original_url : undefined,
      filename: typeof item.filename === "string" ? item.filename : undefined,
    };
    const key = normalized.local_path || normalized.url || normalized.original_url || normalized.filename || `figure-${index}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function normalizeArxivFigureUrl(url: string): string {
  if (!url.startsWith("http")) return url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "arxiv.org") return url;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "html" || parts.length < 3) return url;

    const docId = parts[1];
    const nested = parts[2];
    if (nested === docId || nested.startsWith(`${docId}v`)) {
      parsed.pathname = `/html/${parts.slice(2).join("/")}`;
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}

function getPaperFigureRemoteUrl(figure: PaperFigureAsset): string {
  const remoteUrl = figure.original_url || figure.url || "";
  return normalizeArxivFigureUrl(remoteUrl);
}

function getPaperFigureImageUrl(figure: PaperFigureAsset): string {
  if (figure.local_path) {
    return `${API_BASE}/api/literature/file?path=${encodeURIComponent(figure.local_path)}`;
  }

  const remoteUrl = getPaperFigureRemoteUrl(figure);
  if (!remoteUrl) return "";
  if (remoteUrl.startsWith("data:image/")) return remoteUrl;
  if (remoteUrl.startsWith(`${API_BASE}/api/proxy/image?url=`)) return remoteUrl;
  return `${API_BASE}/api/proxy/image?url=${encodeURIComponent(remoteUrl)}`;
}

function getPaperFigureTargetUrl(figure: PaperFigureAsset, fallbackUrl: string): string {
  const remoteUrl = getPaperFigureRemoteUrl(figure);
  if (remoteUrl.startsWith("data:image/")) return fallbackUrl;
  return remoteUrl || getPaperFigureImageUrl(figure) || fallbackUrl;
}

function extractArxivIdFromValue(value: unknown): string {
  const match = String(value || "").match(/([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match?.[1] || "";
}

function getTrackedPaperArxivId(card: FeedCard): string {
  return (
    metadataString(card.metadata, "arxiv_id")
    || metadataString(card.metadata, "arxiv-id")
    || extractArxivIdFromValue(card.id)
    || extractArxivIdFromValue(card.source_url)
  );
}

function getTrackedPaperPdfUrl(card: FeedCard): string {
  return metadataString(card.metadata, "pdf-url") || metadataString(card.metadata, "pdf_url") || "";
}

function getTrackedPaperArxivUrl(card: FeedCard): string {
  const metadataUrl = metadataString(card.metadata, "arxiv_url");
  if (metadataUrl) return metadataUrl;
  const arxivId = getTrackedPaperArxivId(card);
  return card.source_url || (arxivId ? `https://arxiv.org/abs/${arxivId}` : "");
}

function getTrackedPaperArchiveUrl(card: FeedCard): string {
  return getTrackedPaperArxivUrl(card);
}

function getTrackedPaperDisplayId(card: FeedCard): string {
  return (
    getTrackedPaperArxivId(card)
    || metadataString(card.metadata, "paper_id")
    || card.id.replace(/^followup-monitor:/, "").replace(/^source-paper:/, "").replace(/^arxiv-monitor:/, "")
  );
}

function formatPaperDate(dateStr: string) {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function PaperFigureStrip({
  figures,
  fallbackUrl,
}: {
  figures: PaperFigureAsset[];
  fallbackUrl: string;
}) {
  if (!figures.length) return null;

  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          display: "flex",
          gap: "16px",
          overflowX: "auto",
          paddingBottom: "12px",
          scrollbarWidth: "thin",
        }}
      >
        {figures.map((figure, index) => {
          const imageUrl = getPaperFigureImageUrl(figure);
          const targetUrl = getPaperFigureTargetUrl(figure, fallbackUrl);
          return (
            <div
              key={`${targetUrl}-${index}`}
              style={{
                flexShrink: 0,
                width: "min(480px, 88vw)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
              }}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={figure.caption}
                  style={{
                    width: "100%",
                    height: "280px",
                    objectFit: "contain",
                    background: "var(--bg-hover)",
                    cursor: "pointer",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openExternalUrl(targetUrl);
                  }}
                  loading="lazy"
                />
              ) : (
                <a
                  href={fallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "280px",
                    background: "var(--bg-hover)",
                    color: "var(--text-muted)",
                    textDecoration: "none",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                  }}
                >
                  View paper figures
                </a>
              )}
              <div
                style={{
                  padding: "10px 12px",
                  fontSize: "0.8125rem",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  background: "var(--bg-card)",
                }}
              >
                {figure.caption}
                {figure.is_method && (
                  <span
                    style={{
                      marginLeft: "8px",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      background: "var(--color-primary)",
                      color: "white",
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                    }}
                  >
                    Architecture diagram
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FeedPaperCard({
  card,
  focused,
  onClick,
  onFeedback,
  onRating,
  userRating,
}: Props) {
  const showcaseMode = useStore((s) => s.showcaseMode);
  const hasLiteraturePath = useStore((s) => Boolean(s.config?.literature_path || s.config?.vault_path));
  const setFeedCards = useStore((s) => s.setFeedCards);
  const [pendingAction, setPendingAction] = useState<null | "save" | "wiki">(null);
  const focusedShadow = showcaseMode
    ? "0 8px 40px rgba(188, 164, 227, 0.35), 0 0 0 4px rgba(188, 164, 227, 0.15), 0 0 60px rgba(188, 164, 227, 0.08)"
    : "0 8px 32px rgba(188, 164, 227, 0.25), 0 0 0 4px rgba(188, 164, 227, 0.1)";

  const extActions = EXT_ACTIONS.filter((action) => action.key !== "wiki");
  const effectiveSaved = Boolean(card.metadata.saved_to_literature || card.metadata.literature_path);

  const handleUpdatePaper = (updatedPaper: PaperTrackingCardPaper) => {
    const currentFeedCards = useStore.getState().feedCards;
    setFeedCards(currentFeedCards.map((entry) => (
      entry.id === card.id
        ? {
            ...entry,
            title: updatedPaper.title,
            summary: updatedPaper.summary,
            score: updatedPaper.score,
            tags: updatedPaper.tags,
            source_url: updatedPaper.source_url,
            metadata: updatedPaper.metadata,
          }
        : entry
    )));
  };

  const footerContent = (
    <>
      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", gap: "10px" }}>
          {RATING_ACTIONS.map(({ key, label, emoji, shortcut, gradient, shadow, color }) => {
            const isActive = userRating === key;
            return (
              <button
                key={key}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRating?.(key as "like" | "neutral" | "dislike");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-full)",
                  background: isActive ? gradient : "var(--bg-hover)",
                  border: isActive ? "1px solid transparent" : "1px solid var(--border-light)",
                  color: isActive ? "white" : color,
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  flex: 1,
                  justifyContent: "center",
                  boxShadow: isActive ? `0 4px 16px ${shadow}` : "none",
                }}
              >
                <span style={{ fontSize: "1rem" }}>{emoji}</span>
                <span>{label}</span>
                <span style={{ fontSize: "0.6875rem", opacity: 0.7, marginLeft: "2px" }}>
                  {shortcut}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        {extActions.map(({ key, label, shortcut, Icon, gradient, shadow }) => (
          <button
            key={key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void onFeedback(key);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "var(--radius-full)",
              background: "var(--bg-card)",
              border: "1px solid var(--border-light)",
              color: "var(--text-muted)",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
              flex: 1,
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = gradient;
              e.currentTarget.style.color = "white";
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.boxShadow = `0 4px 16px ${shadow}`;
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-card)";
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "var(--border-light)";
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <Icon style={{ width: "14px", height: "14px" }} aria-hidden />
            <span>{label}</span>
            <span style={{ fontSize: "0.625rem", opacity: 0.7, marginLeft: "2px" }}>
              {shortcut}
            </span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <article
      data-feed-card="true"
      onClick={onClick}
      style={{
        position: "relative",
        borderRadius: "var(--radius-md)",
      }}
    >
      <SharedPaperTrackingCard
        paper={card}
        isSaved={effectiveSaved}
        isSaving={pendingAction === "save"}
        isSavingToWiki={pendingAction === "wiki"}
        onSave={async () => {
          setPendingAction("save");
          try {
            await onFeedback("save");
          } finally {
            setPendingAction(null);
          }
        }}
        onSaveAndWiki={async () => {
          setPendingAction("wiki");
          try {
            await onFeedback("wiki");
          } finally {
            setPendingAction(null);
          }
        }}
        hasLiteraturePath={hasLiteraturePath}
        onUpdatePaper={handleUpdatePaper}
        cardStyle={focused ? {
          border: showcaseMode ? "2px solid var(--color-primary-light)" : "2px solid var(--color-primary)",
          boxShadow: focusedShadow,
        } : undefined}
        footerContent={footerContent}
      />
    </article>
  );
}

function buildXiaohongshuNote(card: FeedCard): XiaohongshuCardNote {
  return {
    id: metadataString(card.metadata, "note_id") || card.id,
    title: card.title,
    content: metadataString(card.metadata, "content") || card.summary,
    author: metadataString(card.metadata, "author") || metadataString(card.metadata, "intelligence_author_label") || "Unknown author",
    author_id: metadataString(card.metadata, "author_id") || metadataString(card.metadata, "user_id"),
    likes: metadataNumber(card.metadata, "likes"),
    collects: metadataNumber(card.metadata, "collects"),
    comments_count: metadataNumber(card.metadata, "comments_count"),
    url: card.source_url || metadataString(card.metadata, "url"),
    published_at: metadataString(card.metadata, "published_at") || metadataString(card.metadata, "published") || null,
    cover_image: metadataString(card.metadata, "cover_image") || null,
    note_type: metadataString(card.metadata, "note_type") || undefined,
    images: normalizePlainStringList(metadataArray(card.metadata, "images")),
    video_url: metadataString(card.metadata, "video_url") || null,
    comments_preview: normalizeXiaohongshuCommentPreviews(metadataArray(card.metadata, "comments_preview")),
    matched_keywords: metadataStringList(card.metadata, "matched_keywords"),
  };
}

function buildBilibiliDynamic(card: FeedCard): BilibiliCardDynamic {
  return {
    id: card.id,
    dynamic_id: metadataString(card.metadata, "dynamic_id") || card.id,
    title: card.title,
    content: metadataString(card.metadata, "description") || card.summary,
    author: metadataString(card.metadata, "up_name") || metadataString(card.metadata, "intelligence_author_label") || "Creator",
    author_id: metadataString(card.metadata, "up_uid"),
    url: card.source_url,
    published_at: metadataString(card.metadata, "published") || null,
    dynamic_type: (metadataString(card.metadata, "dynamic_type") || "text") as BilibiliCardDynamic["dynamic_type"],
    pic: metadataString(card.metadata, "thumbnail"),
    images: normalizePlainStringList(metadataArray(card.metadata, "images")),
    bvid: metadataString(card.metadata, "bvid"),
    tags: metadataStringList(card.metadata, "tags"),
    matched_keywords: metadataStringList(card.metadata, "matched_keywords"),
    matched_tags: metadataStringList(card.metadata, "matched_tags"),
    monitor_label: metadataString(card.metadata, "monitor_label") || metadataString(card.metadata, "monitor_source_label") || undefined,
    monitor_subfolder: metadataString(card.metadata, "monitor_subfolder") || undefined,
  };
}

function SocialFeedbackFooter({
  onFeedback,
  onRating,
  userRating,
}: {
  onFeedback: (action: string) => void | Promise<void>;
  onRating?: (rating: "like" | "neutral" | "dislike") => void;
  userRating?: "like" | "neutral" | "dislike" | null;
}) {
  return (
    <>
      <div style={{ marginTop: "4px", marginBottom: "12px" }}>
        <div style={{ display: "flex", gap: "10px" }}>
          {RATING_ACTIONS.map(({ key, label, emoji, shortcut, gradient, shadow, color }) => {
            const isActive = userRating === key;
            return (
              <button
                key={key}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRating?.(key as "like" | "neutral" | "dislike");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-full)",
                  background: isActive ? gradient : "var(--bg-hover)",
                  border: isActive ? "1px solid transparent" : "1px solid var(--border-light)",
                  color: isActive ? "white" : color,
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  flex: 1,
                  justifyContent: "center",
                  boxShadow: isActive ? `0 4px 16px ${shadow}` : "none",
                }}
              >
                <span style={{ fontSize: "1rem" }}>{emoji}</span>
                <span>{label}</span>
                <span style={{ fontSize: "0.6875rem", opacity: 0.7, marginLeft: "2px" }}>{shortcut}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {SOCIAL_EXT_ACTIONS.map(({ key, label, shortcut, Icon, gradient, shadow }) => {
          const displayLabel = key === "wiki" ? "Write to Internet Wiki" : label;
          return (
            <button
              key={key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void onFeedback(key);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-card)",
                border: "1px solid var(--border-light)",
                color: "var(--text-muted)",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                flex: 1,
                justifyContent: "center",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = gradient;
                e.currentTarget.style.color = "white";
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.boxShadow = `0 4px 16px ${shadow}`;
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-card)";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border-light)";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <Icon style={{ width: "14px", height: "14px" }} aria-hidden />
              <span>{displayLabel}</span>
              <span style={{ fontSize: "0.625rem", opacity: 0.7, marginLeft: "2px" }}>{shortcut}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function FeedXiaohongshuCard({
  card,
  focused,
  onClick,
  onFeedback,
  onRating,
  userRating,
}: Props) {
  const toast = useToast();
  const showcaseMode = useStore((s) => s.showcaseMode);
  const [addingMonitor, setAddingMonitor] = useState(false);
  const [addedMonitor, setAddedMonitor] = useState(false);
  const note = useMemo(() => buildXiaohongshuNote(card), [card]);
  const matchedKeywords = note.matched_keywords ?? [];
  const focusedShadow = showcaseMode
    ? "0 8px 40px rgba(188, 164, 227, 0.35), 0 0 0 4px rgba(188, 164, 227, 0.15), 0 0 60px rgba(188, 164, 227, 0.08)"
    : "0 8px 32px rgba(188, 164, 227, 0.25), 0 0 0 4px rgba(188, 164, 227, 0.1)";
  const crawlSource = metadataString(card.metadata, "crawl_source");

  async function handleAddToMonitor() {
    if (!note.author_id || addingMonitor) return;
    setAddingMonitor(true);
    try {
      const sourceSummary = crawlSource === "following"
        ? (matchedKeywords.length ? `From follow-feed search: ${matchedKeywords.join(", ")}` : "From follow-feed search")
        : crawlSource.startsWith("keyword:")
          ? `From keyword search: ${matchedKeywords.join(", ") || crawlSource.slice("keyword:".length).trim() || "keyword"}`
          : "From scheduled Xiaohongshu intel";
      const result = await xiaohongshuSyncAuthorsToTracker([
        {
          author: note.author,
          author_id: note.author_id,
          latest_title: note.title,
          sample_titles: note.title ? [note.title] : [],
          sample_albums: [],
          sample_tags: matchedKeywords.length ? matchedKeywords : card.tags.filter((tag) => tag !== "小红书"),
          source_summary: sourceSummary,
        },
      ]);
      setAddedMonitor(true);
      if (result.added_count > 0) {
        toast.success("Added to targeted follow crawl", `Added ${result.added_count} creators, ${result.total_user_ids} total`);
      } else {
        toast.info("This creator is already in targeted follows");
      }
    } catch (error) {
      toast.error("Failed to add", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setAddingMonitor(false);
    }
  }

  return (
    <article
      data-feed-card="true"
      onClick={onClick}
      style={{
        position: "relative",
        borderRadius: "var(--radius-md)",
      }}
    >
      <XiaohongshuNoteCard
        note={note}
        showMatchedKeywords={matchedKeywords.length > 0}
        addToMonitorAction={{
          onClick: handleAddToMonitor,
          disabled: !note.author_id || addedMonitor,
          pending: addingMonitor,
          label: addedMonitor ? "Already followed" : "Add targeted follow",
          pendingLabel: "Adding...",
        }}
        footer={(
          <SocialFeedbackFooter
            onFeedback={onFeedback}
            onRating={onRating}
            userRating={userRating}
          />
        )}
        cardStyle={focused ? {
          border: showcaseMode ? "2px solid var(--color-primary-light)" : "2px solid var(--color-primary)",
          boxShadow: focusedShadow,
        } : undefined}
      />
    </article>
  );
}

function FeedBilibiliCard({
  card,
  focused,
  onClick,
  onFeedback,
  onRating,
  userRating,
}: Props) {
  const showcaseMode = useStore((s) => s.showcaseMode);
  const dynamic = useMemo(() => buildBilibiliDynamic(card), [card]);
  const smartGroupLabel = metadataStringList(card.metadata, "intelligence_smart_group_labels")[0] || "";
  const focusedShadow = showcaseMode
    ? "0 8px 40px rgba(188, 164, 227, 0.35), 0 0 0 4px rgba(188, 164, 227, 0.15), 0 0 60px rgba(188, 164, 227, 0.08)"
    : "0 8px 32px rgba(188, 164, 227, 0.25), 0 0 0 4px rgba(188, 164, 227, 0.1)";

  return (
    <article
      data-feed-card="true"
      onClick={onClick}
      style={{
        position: "relative",
        borderRadius: "var(--radius-md)",
      }}
    >
      <BilibiliDynamicCard
        dynamic={dynamic}
        onOpenSource={() => {
          if (!dynamic.url) return;
          void openExternalUrl(dynamic.url);
        }}
        sourceDisabled={!dynamic.url}
        authorGroupLabel={smartGroupLabel || undefined}
        footer={(
          <SocialFeedbackFooter
            onFeedback={onFeedback}
            onRating={onRating}
            userRating={userRating}
          />
        )}
        cardStyle={focused ? {
          border: showcaseMode ? "2px solid var(--color-primary-light)" : "2px solid var(--color-primary)",
          boxShadow: focusedShadow,
        } : undefined}
      />
    </article>
  );
}

export default function CardView({ card, focused, onClick, onFeedback, onRating, userRating }: Props) {
  const scorePercent = Math.round(card.score * 100);
  const showcaseMode = useStore((s) => s.showcaseMode);
  const isBilibiliCard = card.module_id === "bilibili-tracker";
  const isXiaohongshuCard = card.module_id === "xiaohongshu-tracker";
  const upName = metadataString(card.metadata, "up_name");
  const dynamicType = metadataString(card.metadata, "dynamic_type");
  const published = metadataString(card.metadata, "published");
  const thumbnail = metadataString(card.metadata, "thumbnail");
  const thumbnailUrl = thumbnail ? proxiedImage(thumbnail) : "";
  const paperTrackingType = metadataString(card.metadata, "paper_tracking_type");
  const paperTrackingRole = metadataString(card.metadata, "paper_tracking_role");
  const paperTrackingLabels = metadataStringList(card.metadata, "paper_tracking_labels");
  const paperTrackingLabel = paperTrackingLabels[0] || metadataString(card.metadata, "paper_tracking_label");
  const sourcePaperTitle = metadataString(card.metadata, "source_paper_title");
  const intelligenceSourceLabel = metadataString(card.metadata, "intelligence_source_label");
  const intelligenceSmartGroupLabels = metadataStringList(card.metadata, "intelligence_smart_group_labels");
  const intelligenceMetricLabels = metadataStringList(card.metadata, "intelligence_metric_labels");
  const intelligenceAuthorLabel = metadataString(card.metadata, "intelligence_author_label");
  const isPaperCard = isPaperTrackingCard(card);

  if (isPaperCard) {
    return (
      <FeedPaperCard
        card={card}
        focused={focused}
        onClick={onClick}
        onFeedback={onFeedback}
        onRating={onRating}
        userRating={userRating}
      />
    );
  }

  if (isBilibiliCard) {
    return (
      <FeedBilibiliCard
        card={card}
        focused={focused}
        onClick={onClick}
        onFeedback={onFeedback}
        onRating={onRating}
        userRating={userRating}
      />
    );
  }

  if (isXiaohongshuCard) {
    return (
      <FeedXiaohongshuCard
        card={card}
        focused={focused}
        onClick={onClick}
        onFeedback={onFeedback}
        onRating={onRating}
        userRating={userRating}
      />
    );
  }

  const extActions = EXT_ACTIONS
    .filter((action) => !(isPaperCard && action.key === "wiki"))
    .map((action) => {
      if (action.key === "wiki") {
        return { ...action, label: "Write to Internet Wiki" };
      }
      return action;
    });
  const bilibiliTypeLabel =
    dynamicType === "video"
      ? "Video"
      : dynamicType === "article"
      ? "Article"
      : dynamicType === "image"
      ? "Image post"
      : dynamicType === "text"
      ? "Post"
      : "";
  const paperAuthors = metadataStringList(card.metadata, "authors");
  const paperPublished = metadataString(card.metadata, "published") || (
    metadataNumber(card.metadata, "year") > 0 ? String(metadataNumber(card.metadata, "year")) : ""
  );
  const paperCitationCount = metadataNumber(card.metadata, "citation_count");
  const displayId = getTrackedPaperDisplayId(card);
  const arxivId = getTrackedPaperArxivId(card);
  const pdfUrl = getTrackedPaperPdfUrl(card);
  const archiveUrl = getTrackedPaperArchiveUrl(card);
  const literaturePath = metadataString(card.metadata, "literature_path");
  const effectiveSaved = Boolean(card.metadata.saved_to_literature || literaturePath);
  const relationshipLabel = metadataString(card.metadata, "relationship_label")
    || (paperTrackingRole === "source"
      ? "Source paper"
      : paperTrackingType === "followup"
        ? "Follow Up"
        : paperTrackingType === "keyword"
          ? "Keyword tracking"
          : "Paper");
  const initialFigures = useMemo(() => {
    const localFigures = normalizePaperFigures(card.metadata.local_figures);
    return localFigures.length ? localFigures : normalizePaperFigures(card.metadata.figures);
  }, [card.metadata.figures, card.metadata.local_figures]);
  const [paperFigures, setPaperFigures] = useState<PaperFigureAsset[]>(initialFigures);
  const [loadingFigures, setLoadingFigures] = useState(false);
  const figureCount = paperFigures.length;
  const hasPaperFigures = figureCount > 0;
  const canLoadFigures = Boolean(arxivId);
  const sourcePaperMeta = metadataRecord(card.metadata, "source_paper");
  const sourcePaperMetaTitle = typeof sourcePaperMeta.title === "string" ? sourcePaperMeta.title : "";
  const resolvedSourcePaperTitle = sourcePaperTitle || sourcePaperMetaTitle;
  const focusedShadow = showcaseMode
    ? "0 8px 40px rgba(188, 164, 227, 0.35), 0 0 0 4px rgba(188, 164, 227, 0.15), 0 0 60px rgba(188, 164, 227, 0.08)"
    : "0 8px 32px rgba(188, 164, 227, 0.25), 0 0 0 4px rgba(188, 164, 227, 0.1)";
  const normalShadow = showcaseMode ? "var(--shadow-medium)" : "var(--shadow-soft)";
  const hoverShadow = showcaseMode ? "var(--shadow-float)" : "var(--shadow-medium)";

  useEffect(() => {
    setPaperFigures(initialFigures);
  }, [card.id, initialFigures]);

  async function loadPaperFigures() {
    if (!arxivId || loadingFigures) return;

    setLoadingFigures(true);
    try {
      const result = await api.post<{ figures: PaperFigureAsset[] }>("/api/tools/arxiv/figures", {
        arxiv_id: arxivId,
      });
      setPaperFigures(normalizePaperFigures(result.figures));
    } catch (error) {
      console.error("Failed to load paper figures in feed:", error);
    } finally {
      setLoadingFigures(false);
    }
  }

  return (
    <article
      data-feed-card="true"
      onClick={onClick}
      style={{
        position: "relative",
        padding: "24px",
        borderRadius: "var(--radius-md)",
        background: focused ? "var(--bg-panel)" : "var(--bg-card)",
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        border: focused
          ? (showcaseMode ? "2px solid var(--color-primary-light)" : "2px solid var(--color-primary)")
          : (showcaseMode ? "1px solid var(--border-color)" : "1px solid var(--border-light)"),
        boxShadow: focused ? focusedShadow : normalShadow,
        cursor: "pointer",
        transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        transform: focused ? "scale(1.01)" : "scale(1)",
      }}
      onMouseEnter={(e) => {
        if (!focused) {
          e.currentTarget.style.transform = showcaseMode ? "translateY(-6px) scale(1.005)" : "translateY(-4px)";
          e.currentTarget.style.boxShadow = hoverShadow;
          if (showcaseMode) e.currentTarget.style.borderColor = "var(--border-medium)";
        }
      }}
      onMouseLeave={(e) => {
        if (!focused) {
          e.currentTarget.style.transform = "translateY(0) scale(1)";
          e.currentTarget.style.boxShadow = normalShadow;
          if (showcaseMode) e.currentTarget.style.borderColor = "var(--border-color)";
        }
      }}
    >
      {/* Focused indicator - left gradient bar */}
      {focused && (
        <div
          style={{
            position: "absolute",
            left: "-2px",
            top: "50%",
            transform: "translateY(-50%)",
            width: "4px",
            height: "48px",
            background: "linear-gradient(180deg, var(--color-primary), var(--color-secondary))",
            borderRadius: "0 4px 4px 0",
          }}
        />
      )}

      {/* User Rating Badge */}
      {userRating && (
        <div
          style={{
            position: "absolute",
            top: "-8px",
            right: "16px",
            padding: "6px 14px",
            borderRadius: "var(--radius-full)",
            background: userRating === "like"
              ? "linear-gradient(135deg, #A8E6CF, #7DD3C0)"
              : userRating === "neutral"
              ? "linear-gradient(135deg, #FFE4B5, #F5C88C)"
              : "linear-gradient(135deg, #FFB7B2, #FF9E9A)",
            color: "white",
            fontSize: "0.8125rem",
            fontWeight: 700,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 10,
          }}
        >
          {userRating === "like" ? "👍 Like" : userRating === "neutral" ? "😐 Neutral" : "👎 Dislike"}
        </div>
      )}

      {/* Header: Score bar + Source */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        {/* Score bar */}
        <div
          style={{
            flex: 1,
            height: "8px",
            background: "var(--bg-hover)",
            borderRadius: "var(--radius-full)",
            overflow: "hidden",
            boxShadow: "var(--shadow-inner)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${scorePercent}%`,
              background:
                scorePercent >= 80
                  ? "linear-gradient(90deg, #A8E6CF, #7DD3C0)"
                  : scorePercent >= 60
                  ? "linear-gradient(90deg, #BCA4E3, #9D7BDB)"
                  : "linear-gradient(90deg, #FFE4B5, #F5C88C)",
              borderRadius: "var(--radius-full)",
              transition: "width 0.5s ease",
              boxShadow: showcaseMode
                ? "0 0 16px rgba(188, 164, 227, 0.5), 0 0 32px rgba(188, 164, 227, 0.15)"
                : "0 0 12px rgba(188, 164, 227, 0.3)",
            }}
          />
        </div>

        {/* Score percentage */}
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 700,
            color:
              scorePercent >= 80
                ? "#5BA88C"
                : scorePercent >= 60
                ? "var(--color-primary-dark)"
                : "#D4A574",
            fontFamily: "'Nunito', sans-serif",
          }}
        >
          {scorePercent}%
        </span>

        {/* Source icon + Module tag */}
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            padding: "4px 12px",
            borderRadius: "var(--radius-full)",
            background: "rgba(188, 164, 227, 0.12)",
            color: "var(--color-primary-dark)",
            border: "1px solid var(--border-light)",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
          title={card.module_id}
        >
          <span>{SOURCE_ICONS[card.module_id] || "📎"}</span>
          <span>{card.module_id}</span>
        </span>

        {/* External link */}
        {card.source_url && (
          <a
            href={card.source_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open in browser"
            style={{
              padding: "8px",
              borderRadius: "50%",
              color: "var(--text-muted)",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--color-primary)";
              e.currentTarget.style.background = "rgba(188, 164, 227, 0.1)";
              e.currentTarget.style.transform = "scale(1.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <ExternalLink style={{ width: "16px", height: "16px" }} aria-hidden />
          </a>
        )}
      </div>

      {isBilibiliCard && (upName || dynamicType || published) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          {upName && (
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 700,
                color: "var(--text-main)",
              }}
            >
              @{upName}
            </span>
          )}
          {bilibiliTypeLabel && (
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "var(--radius-full)",
                background: "rgba(0, 174, 236, 0.12)",
                color: "#0087B8",
                border: "1px solid rgba(0, 174, 236, 0.18)",
              }}
            >
              {bilibiliTypeLabel}
            </span>
          )}
          {published && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {published.replace("T", " ").slice(0, 16)}
            </span>
          )}
        </div>
      )}

      {thumbnailUrl && (
        <div
          style={{
            marginBottom: "14px",
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
            border: "1px solid var(--border-light)",
            background: "var(--bg-hover)",
          }}
        >
          <img
            src={thumbnailUrl}
            alt={card.title}
            style={{
              width: "100%",
              maxHeight: "220px",
              objectFit: "cover",
              display: "block",
            }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>
      )}

      {/* Title */}
      <h3
        style={{
          fontFamily: "'M PLUS Rounded 1c', sans-serif",
          fontSize: "1rem",
          fontWeight: 700,
          color: focused ? "var(--text-main)" : "var(--text-secondary)",
          lineHeight: 1.5,
          marginBottom: "12px",
          transition: "color 0.2s ease",
        }}
      >
        {card.title}
      </h3>

      {(intelligenceSourceLabel || intelligenceSmartGroupLabels.length > 0 || intelligenceMetricLabels.length > 0 || intelligenceAuthorLabel) && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          {intelligenceSourceLabel && (
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: "999px",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-light)",
              }}
            >
              {intelligenceSourceLabel}
            </span>
          )}
          {intelligenceSmartGroupLabels.slice(0, 2).map((label) => (
            <span
              key={label}
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: "999px",
                background: "rgba(188, 164, 227, 0.12)",
                color: "var(--color-primary)",
                border: "1px solid rgba(188, 164, 227, 0.18)",
              }}
            >
              Smart group · {label}
            </span>
          ))}
          {!isBilibiliCard && intelligenceAuthorLabel && (
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: "999px",
                background: "rgba(123, 200, 240, 0.14)",
                color: "#2C7FB8",
                border: "1px solid rgba(123, 200, 240, 0.18)",
              }}
            >
              @{intelligenceAuthorLabel}
            </span>
          )}
          {intelligenceMetricLabels.slice(0, 2).map((label) => (
            <span
              key={label}
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: "999px",
                background: "rgba(255, 183, 178, 0.14)",
                color: "#C86D67",
                border: "1px solid rgba(255, 183, 178, 0.18)",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {(paperTrackingLabel || resolvedSourcePaperTitle || paperTrackingRole === "source") && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          {paperTrackingLabel && (
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: "999px",
                background: "rgba(188, 164, 227, 0.12)",
                color: "var(--color-primary)",
                border: "1px solid rgba(188, 164, 227, 0.16)",
              }}
            >
              {paperTrackingRole === "source"
                ? "Source paper"
                : paperTrackingType === "followup"
                  ? "Follow Up"
                  : "Keyword"} · {paperTrackingLabel}
            </span>
          )}
          {paperTrackingType === "followup" && resolvedSourcePaperTitle && resolvedSourcePaperTitle !== paperTrackingLabel && (
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: "999px",
                background: "rgba(123, 200, 240, 0.14)",
                color: "#2C7FB8",
                border: "1px solid rgba(123, 200, 240, 0.18)",
              }}
            >
              Source · {resolvedSourcePaperTitle}
            </span>
          )}
        </div>
      )}

      {isPaperCard && (paperAuthors.length > 0 || paperPublished || paperCitationCount > 0 || displayId || relationshipLabel) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            marginBottom: "12px",
          }}
        >
          {paperAuthors.length > 0 && (
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
              <User style={{ width: "12px", height: "12px" }} />
              {paperAuthors.slice(0, 3).join(", ")}
              {paperAuthors.length > 3 ? ` +${paperAuthors.length - 3}` : ""}
            </span>
          )}
          {paperPublished && (
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
              <Calendar style={{ width: "12px", height: "12px" }} />
              {formatPaperDate(paperPublished)}
            </span>
          )}
          {paperCitationCount > 0 && (
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
              <Star style={{ width: "12px", height: "12px" }} />
              Cited {paperCitationCount} times
            </span>
          )}
          {displayId && (
            <span
              style={{
                fontSize: "0.75rem",
                padding: "3px 10px",
                borderRadius: "999px",
                background: "var(--bg-hover)",
                color: "var(--text-secondary)",
                fontWeight: 600,
              }}
            >
              {displayId}
            </span>
          )}
          <span
            style={{
              fontSize: "0.75rem",
              padding: "3px 10px",
              borderRadius: "999px",
              background: "rgba(123, 200, 240, 0.12)",
              color: "#2C7FB8",
              fontWeight: 600,
            }}
          >
            {relationshipLabel}
          </span>
        </div>
      )}

      {isPaperCard && hasPaperFigures && (
        <PaperFigureStrip
          figures={paperFigures}
          fallbackUrl={archiveUrl || card.source_url}
        />
      )}

      {isPaperCard && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            marginBottom: "16px",
          }}
        >
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "10px",
                background: "var(--color-primary)",
                color: "white",
                fontSize: "0.8125rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <Download style={{ width: "14px", height: "14px" }} />
              PDF
            </a>
          )}
          {archiveUrl && (
            <a
              href={archiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "10px",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <ExternalLink style={{ width: "14px", height: "14px" }} />
              Archive
            </a>
          )}
          {canLoadFigures && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void loadPaperFigures();
              }}
              disabled={loadingFigures}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "10px",
                border: "1px solid var(--border-light)",
                background: hasPaperFigures ? "var(--bg-hover)" : "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: loadingFigures ? "not-allowed" : "pointer",
              }}
            >
              {loadingFigures ? (
                <>
                  <RefreshCw style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite" }} />
                  Fetching...
                </>
              ) : (
                <>
                  <ImageIcon style={{ width: "14px", height: "14px" }} />
                  {hasPaperFigures ? `Fetched ${figureCount} figures` : "Fetch figures"}
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void onFeedback("save");
            }}
            disabled={effectiveSaved}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "10px",
              border: "1px solid var(--border-light)",
              background: "var(--bg-card)",
              color: effectiveSaved ? "#10B981" : "var(--color-primary)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: effectiveSaved ? "not-allowed" : "pointer",
            }}
          >
            {effectiveSaved ? (
              <>
                <Check style={{ width: "14px", height: "14px" }} />
                Saved to Literature Library
              </>
            ) : (
              <>
                <Save style={{ width: "14px", height: "14px" }} />
                Save to Literature Library
              </>
            )}
          </button>
        </div>
      )}

      {/* Rating Section - 3-level rating (horizontal, above abstract) */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", gap: "10px" }}>
          {RATING_ACTIONS.map(({ key, label, emoji, shortcut, gradient, shadow, color }) => {
            const isActive = userRating === key;
            return (
              <button
                key={key}
                onClick={(e) => {
                  e.stopPropagation();
                  onRating?.(key as "like" | "neutral" | "dislike");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-full)",
                  background: isActive ? gradient : "var(--bg-hover)",
                  border: isActive ? "1px solid transparent" : "1px solid var(--border-light)",
                  color: isActive ? "white" : color,
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  flex: 1,
                  justifyContent: "center",
                  boxShadow: isActive ? `0 4px 16px ${shadow}` : "none",
                  transform: isActive ? "scale(1.02)" : "scale(1)",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = gradient;
                    e.currentTarget.style.color = "white";
                    e.currentTarget.style.borderColor = "transparent";
                    e.currentTarget.style.boxShadow = `0 4px 16px ${shadow}`;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = color;
                    e.currentTarget.style.borderColor = "var(--border-light)";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
              >
                <span style={{ fontSize: "1rem" }}>{emoji}</span>
                <span>{label}</span>
                <span
                  style={{
                    fontSize: "0.6875rem",
                    opacity: 0.7,
                    marginLeft: "2px",
                  }}
                >
                  {shortcut}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary */}
      <p
        style={{
          fontSize: "0.9375rem",
          color: "var(--text-muted)",
          lineHeight: 1.7,
          marginBottom: "16px",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {card.summary}
      </p>

      {/* Tags */}
      {card.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
          {card.tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: "var(--radius-full)",
                background: "linear-gradient(135deg, rgba(188, 164, 227, 0.12), rgba(255, 183, 178, 0.08))",
                color: "var(--color-primary-dark)",
                border: "1px solid var(--border-light)",
                transition: "all 0.2s ease",
                cursor: "default",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.05)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(188, 164, 227, 0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Extended Actions */}
      <div style={{ display: "flex", gap: "10px" }}>
        {extActions.map(({ key, label, shortcut, Icon, gradient, shadow }) => (
          <button
            key={key}
            onClick={(e) => {
              e.stopPropagation();
              onFeedback(key);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "var(--radius-full)",
              background: "var(--bg-card)",
              border: "1px solid var(--border-light)",
              color: "var(--text-muted)",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
              flex: 1,
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = gradient;
              e.currentTarget.style.color = "white";
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.boxShadow = `0 4px 16px ${shadow}`;
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--bg-card)";
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "var(--border-light)";
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <Icon style={{ width: "14px", height: "14px" }} aria-hidden />
            <span>{label}</span>
            <span style={{ fontSize: "0.625rem", opacity: 0.7, marginLeft: "2px" }}>
              {shortcut}
            </span>
          </button>
        ))}
      </div>
    </article>
  );
}
