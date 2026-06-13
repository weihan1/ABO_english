import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  PlayCircle,
} from "lucide-react";

export interface XiaohongshuCommentPreview {
  id: string;
  author: string;
  content: string;
  likes: number;
  is_top?: boolean;
}

export interface XiaohongshuCardNote {
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
  comments_preview?: XiaohongshuCommentPreview[];
  matched_keywords?: string[];
}

interface ActionConfig {
  label: string;
  onClick: () => void | Promise<void>;
  icon?: ReactNode;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  solid?: boolean;
}

interface AddMonitorConfig {
  label?: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
}

interface Props {
  note: XiaohongshuCardNote;
  showMatchedKeywords?: boolean;
  expanded?: boolean;
  onToggleExpand?: (noteId: string) => void;
  cardStyle?: CSSProperties;
  primaryAction?: ActionConfig;
  addToMonitorAction?: AddMonitorConfig;
  footer?: ReactNode;
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

function normalizeImageList(note: XiaohongshuCardNote): string[] {
  const images = Array.isArray(note.images)
    ? note.images.filter((image): image is string => typeof image === "string" && image.trim().length > 0)
    : [];
  const coverImage = typeof note.cover_image === "string" ? note.cover_image.trim() : "";
  if (coverImage && !images.includes(coverImage)) {
    return [coverImage, ...images];
  }
  return images;
}

export function XiaohongshuNoteCard({
  note,
  showMatchedKeywords = false,
  expanded,
  onToggleExpand,
  cardStyle,
  primaryAction,
  addToMonitorAction,
  footer,
}: Props) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const content = note.content || "";
  const isExpanded = expanded ?? internalExpanded;
  const images = normalizeImageList(note);
  const previewImages = images.slice(0, 6);
  const hasLongContent = content.length > 150;
  const handleOpenNoteDetail = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void openExternalUrl(note.url);
  };

  const handleOpenImage = (event: MouseEvent<HTMLButtonElement>, imageUrl: string) => {
    event.stopPropagation();
    void openExternalUrl(imageUrl);
  };

  const toggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand(note.id);
      return;
    }
    setInternalExpanded((value) => !value);
  };

  return (
    <div
      style={{
        padding: "16px",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-hover)",
        border: "1px solid var(--border-light)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        minHeight: "100%",
        ...cardStyle,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)", marginBottom: showMatchedKeywords ? "8px" : 0 }}>
            {note.title}
          </h4>
          {showMatchedKeywords && note.matched_keywords && note.matched_keywords.length > 0 ? (
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              {note.matched_keywords.map((keyword) => (
                <span
                  key={keyword}
                  style={{
                    padding: "2px 8px",
                    borderRadius: "var(--radius-full)",
                    background: "var(--color-primary)20",
                    color: "var(--color-primary)",
                    fontSize: "0.75rem",
                  }}
                >
                  {keyword}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleOpenNoteDetail}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "4px 8px",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-primary)20",
            color: "var(--color-primary)",
            fontSize: "0.75rem",
            border: "none",
            cursor: "pointer",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          <ExternalLink style={{ width: "12px", height: "12px" }} />
          Details
        </button>
      </div>

      <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
        {isExpanded ? content : content.slice(0, 150) + (content.length > 150 ? "..." : "")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {note.video_url && (
          <div
            style={{
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
              background: "var(--bg-card)",
              border: "1px solid var(--border-light)",
            }}
          >
            <video
              controls
              preload="metadata"
              src={note.video_url}
              style={{ width: "100%", maxHeight: "420px", display: "block", background: "#000" }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        {previewImages.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "10px",
            }}
          >
            {previewImages.map((imageUrl, index) => (
              <button
                type="button"
                key={`${note.id}-${index}`}
                onClick={(event) => handleOpenImage(event, imageUrl)}
                aria-label={`Open image ${index + 1}`}
                style={{
                  display: "block",
                  padding: 0,
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-light)",
                  aspectRatio: "1 / 1",
                  cursor: "pointer",
                }}
              >
                <img
                  src={imageUrl}
                  alt={`${note.title}-${index + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </button>
            ))}
          </div>
        ) : !note.video_url ? (
          <div
            style={{
              minHeight: "150px",
              borderRadius: "var(--radius-lg)",
              background: "linear-gradient(135deg, rgba(255, 138, 0, 0.12), rgba(245, 158, 11, 0.05))",
              border: "1px dashed rgba(245, 158, 11, 0.34)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              fontSize: "0.8125rem",
              fontWeight: 700,
            }}
          >
            No cover image
          </div>
        ) : null}
      </div>

      {note.comments_preview && note.comments_preview.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div
            style={{
              padding: "12px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-card)",
              border: "1px solid var(--border-light)",
            }}
          >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "0.8125rem",
                  color: "var(--text-muted)",
                  marginBottom: "10px",
                  fontWeight: 600,
                }}
              >
                <MessageCircle style={{ width: "14px", height: "14px" }} />
                Comment preview
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {note.comments_preview.slice(0, 3).map((comment) => (
                  <div
                    key={comment.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-hover)",
                      fontSize: "0.8125rem",
                      color: "var(--text-main)",
                      lineHeight: 1.6,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "4px" }}>
                      <span style={{ fontWeight: 600, color: "var(--color-primary)" }}>{comment.author}</span>
                      <span style={{ color: "var(--text-muted)" }}>Likes {comment.likes}</span>
                    </div>
                    {comment.content}
                  </div>
                ))}
              </div>
          </div>
        </div>
      )}

      {hasLongContent ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand();
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
            alignSelf: "flex-start",
          }}
        >
          {isExpanded ? <ChevronUp style={{ width: "14px", height: "14px" }} /> : <ChevronDown style={{ width: "14px", height: "14px" }} />}
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>Author: {note.author}</span>
        {addToMonitorAction ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void addToMonitorAction.onClick();
            }}
            disabled={addToMonitorAction.disabled || addToMonitorAction.pending}
            style={{
              padding: "4px 10px",
              borderRadius: "999px",
              border: "1px solid var(--border-light)",
              background: "var(--bg-card)",
              color: "var(--color-primary)",
              fontSize: "0.75rem",
              cursor: addToMonitorAction.disabled || addToMonitorAction.pending ? "not-allowed" : "pointer",
              opacity: addToMonitorAction.disabled ? 0.5 : 1,
            }}
          >
            {addToMonitorAction.pending
              ? (addToMonitorAction.pendingLabel || "Processing...")
              : (addToMonitorAction.label || "Add targeted follow")}
          </button>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8125rem", color: "var(--color-danger)" }}>
          <Heart style={{ width: "14px", height: "14px" }} />
          {note.likes.toLocaleString()}
        </span>
        <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>Saves: {note.collects.toLocaleString()}</span>
        <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>Comments: {note.comments_count.toLocaleString()}</span>
        {note.published_at ? <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{new Date(note.published_at).toLocaleDateString("zh-CN")}</span> : null}
        {previewImages.length > 0 ? (
          <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <ImageIcon style={{ width: "14px", height: "14px" }} />
            {images.length}
          </span>
        ) : null}
        {note.video_url ? (
          <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            <PlayCircle style={{ width: "14px", height: "14px" }} />
            Video
          </span>
        ) : null}
      </div>

      {footer ? (
        <div style={{ marginTop: "auto" }}>{footer}</div>
      ) : primaryAction ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void primaryAction.onClick();
            }}
            disabled={primaryAction.disabled || primaryAction.pending}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              border: primaryAction.solid ? "none" : "1px solid var(--border-light)",
              background: primaryAction.solid ? "var(--color-primary)" : "var(--bg-card)",
              color: primaryAction.solid ? "white" : "var(--color-primary)",
              fontSize: "0.75rem",
              cursor: primaryAction.disabled || primaryAction.pending ? "not-allowed" : "pointer",
              opacity: primaryAction.disabled || primaryAction.pending ? 0.6 : 1,
            }}
          >
            {primaryAction.icon}
            {primaryAction.pending ? (primaryAction.pendingLabel || "Processing...") : primaryAction.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default XiaohongshuNoteCard;
