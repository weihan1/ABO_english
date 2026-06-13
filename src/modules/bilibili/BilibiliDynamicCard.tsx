import { type CSSProperties, type ReactNode } from "react";
import { ExternalLink, FileText, FolderHeart, Image as ImageIcon, MessageSquare, Play } from "lucide-react";
import { buildImageProxyUrl } from "../../core/api";

export interface BilibiliCardDynamic {
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
}

interface ActionConfig {
  label: string;
  onClick: () => void | Promise<void>;
  icon?: ReactNode;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  primary?: boolean;
}

interface Props {
  dynamic: BilibiliCardDynamic;
  selected?: boolean;
  selectLabel?: string;
  onToggleSelect?: (dynamicId: string) => void;
  onOpenSource?: () => void | Promise<void>;
  sourceDisabled?: boolean;
  primaryAction?: ActionConfig;
  secondaryAction?: ActionConfig;
  footer?: ReactNode;
  cardStyle?: CSSProperties;
  authorGroupLabel?: string;
  authorGroupAccent?: string;
}

const DYNAMIC_TYPE_META: Record<
  BilibiliCardDynamic["dynamic_type"],
  { label: string; icon: typeof Play; color: string }
> = {
  video: { label: "Video", icon: Play, color: "#00AEEC" },
  image: { label: "Image post", icon: ImageIcon, color: "#FB7299" },
  text: { label: "Text", icon: MessageSquare, color: "#FF7F50" },
  article: { label: "Article", icon: FileText, color: "#52C41A" },
};

function proxiedImage(url: string): string {
  if (!url) return "";
  return buildImageProxyUrl(url);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "Unknown time";
  const date = new Date(dateStr);
  return date.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderActionButton(action: ActionConfig, fallbackPrimary = false) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void action.onClick();
      }}
      disabled={action.disabled || action.pending}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 12px",
        borderRadius: "var(--radius-sm)",
        border: action.primary || fallbackPrimary ? "none" : "1px solid var(--border-light)",
        background: action.primary || fallbackPrimary ? "linear-gradient(135deg, #10B981, #00AEEC)" : "var(--bg-card)",
        color: action.primary || fallbackPrimary
          ? "white"
          : (action.disabled || action.pending ? "var(--text-muted)" : "var(--text-secondary)"),
        fontSize: "0.75rem",
        fontWeight: 800,
        cursor: action.disabled || action.pending ? "not-allowed" : "pointer",
      }}
    >
      {action.icon}
      {action.pending ? (action.pendingLabel || "Processing...") : action.label}
    </button>
  );
}

export default function BilibiliDynamicCard({
  dynamic,
  selected = false,
  selectLabel = "Select for saving",
  onToggleSelect,
  onOpenSource,
  sourceDisabled = false,
  primaryAction,
  secondaryAction,
  footer,
  cardStyle,
  authorGroupLabel,
  authorGroupAccent = "var(--color-primary)",
}: Props) {
  const typeConfig = DYNAMIC_TYPE_META[dynamic.dynamic_type] || DYNAMIC_TYPE_META.text;
  const TypeIcon = typeConfig.icon;
  const previewImages = Array.isArray(dynamic.images) ? dynamic.images.filter(Boolean).slice(0, 4) : [];

  return (
    <div
      style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-card)",
        border: selected ? `1px solid ${typeConfig.color}` : "1px solid var(--border-light)",
        borderLeft: `4px solid ${typeConfig.color}`,
        ...cardStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {onToggleSelect ? (
            <label
              onClick={(event) => event.stopPropagation()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 8px",
                borderRadius: "9999px",
                background: selected ? `${typeConfig.color}18` : "var(--bg-hover)",
                color: selected ? typeConfig.color : "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(dynamic.id)}
              />
              {selectLabel}
            </label>
          ) : null}

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 10px",
              borderRadius: "9999px",
              background: `${typeConfig.color}15`,
              color: typeConfig.color,
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            <TypeIcon size={12} />
            {typeConfig.label}
          </span>

          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            {formatDate(dynamic.published_at)}
          </span>

          {dynamic.monitor_label ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "4px 10px",
                borderRadius: "9999px",
                background: "rgba(16, 185, 129, 0.12)",
                color: "#0F9F6E",
                fontSize: "0.75rem",
                fontWeight: 700,
              }}
            >
              {dynamic.monitor_label}
            </span>
          ) : null}
        </div>

        {onOpenSource ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void onOpenSource();
            }}
            disabled={sourceDisabled}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "0",
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: "0.8125rem",
              cursor: sourceDisabled ? "not-allowed" : "pointer",
            }}
          >
            Open original
            <ExternalLink size={14} />
          </button>
        ) : null}
      </div>

      <div style={{ marginBottom: "10px" }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "4px" }}>
          {dynamic.author}
        </div>
        <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)", lineHeight: 1.5 }}>
          {dynamic.title}
        </div>
      </div>

      {dynamic.content ? (
        <div
          style={{
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            marginBottom: "12px",
          }}
        >
          {dynamic.content}
        </div>
      ) : null}

      {(dynamic.matched_keywords?.length || dynamic.matched_tags?.length) ? (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          {(dynamic.matched_keywords || []).slice(0, 6).map((keyword) => (
            <span
              key={`${dynamic.id}-matched-kw-${keyword}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: "9999px",
                background: "rgba(0, 174, 236, 0.12)",
                color: "#078FBF",
                fontSize: "0.75rem",
                fontWeight: 700,
              }}
            >
              Matched word · {keyword}
            </span>
          ))}
          {(dynamic.matched_tags || []).slice(0, 6).map((tag) => (
            <span
              key={`${dynamic.id}-matched-tag-${tag}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: "9999px",
                background: "rgba(16, 185, 129, 0.12)",
                color: "#0F9F6E",
                fontSize: "0.75rem",
                fontWeight: 700,
              }}
            >
              Matched tag · {tag}
            </span>
          ))}
        </div>
      ) : null}

      {dynamic.tags?.length > 0 ? (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          {dynamic.tags.slice(0, 8).map((tag) => (
            <span
              key={`${dynamic.id}-${tag}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: "9999px",
                background: "var(--bg-hover)",
                border: "1px solid var(--border-light)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      {previewImages.length > 0 ? (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
          {previewImages.map((img, idx) => (
            <div
              key={`${dynamic.id}-img-${idx}`}
              style={{
                width: "120px",
                height: "80px",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
                background: "var(--bg-muted)",
                position: "relative",
              }}
            >
              <img
                src={proxiedImage(img)}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              {dynamic.images.length > 4 && idx === 3 ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                  }}
                >
                  +{dynamic.images.length - 4}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {dynamic.dynamic_type === "video" && dynamic.pic ? (
        <img
          src={proxiedImage(dynamic.pic)}
          alt={dynamic.title}
          style={{
            width: "100%",
            maxHeight: "320px",
            objectFit: "cover",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            marginBottom: "12px",
          }}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}

      {(primaryAction || secondaryAction) ? (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginTop: "8px", marginBottom: "8px" }}>
          {primaryAction ? renderActionButton(primaryAction, true) : null}
          {secondaryAction ? renderActionButton(secondaryAction) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
        <span>{dynamic.dynamic_type}</span>
        {dynamic.bvid ? <span>{dynamic.bvid}</span> : null}
        {dynamic.monitor_subfolder ? <span>Save folder: {dynamic.monitor_subfolder}</span> : null}
        {authorGroupLabel ? (
          <span style={{ color: authorGroupAccent, fontWeight: 700 }}>
            {authorGroupLabel}
          </span>
        ) : null}
      </div>

      {footer ? (
        <div style={{ marginTop: "12px" }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export const BILIBILI_DYNAMIC_CARD_ICONS = {
  save: <FolderHeart size={14} />,
  original: <ExternalLink size={14} />,
};
