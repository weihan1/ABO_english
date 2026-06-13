import { useEffect, useRef, useState, type CSSProperties, type FC } from "react";
import {
  BookOpen,
  ExternalLink,
  FileText,
  FolderOpen,
  Headphones,
  HelpCircle,
  MoreVertical,
  Pause,
  Play,
  RefreshCw,
  Rss,
  ShoppingBag,
  Video,
} from "lucide-react";

import type { ModuleConfig, ModuleStatus } from "../../types/module";
import {
  type ModuleUsageMetrics,
  formatRelativeDate,
  formatScheduleLabel,
  getModuleFocusSummary,
  getModuleFocusTokens,
} from "./moduleManagementShared";

interface ModuleCardProps {
  module: ModuleConfig;
  usage: ModuleUsageMetrics;
  onOpenHistory: () => void;
  onOpenOverview: () => void;
  onOpenTool: () => void;
  onRun: () => void;
  onToggle: () => void;
}

const STATUS_STYLES: Record<ModuleStatus, { color: string; bg: string; border: string; label: string }> = {
  active: { color: "#22c55e", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.24)", label: "Running" },
  paused: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.24)", label: "Paused" },
  error: { color: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.24)", label: "Needs attention" },
  unconfigured: { color: "var(--text-muted)", bg: "var(--bg-hover)", border: "var(--border-light)", label: "Needs setup" },
};

const MODULE_ICONS: Record<string, FC<{ style?: CSSProperties }>> = {
  "arxiv-tracker": BookOpen,
  "semantic-scholar-tracker": FileText,
  "bilibili-tracker": Video,
  "xiaohongshu-tracker": ShoppingBag,
  "xiaoyuzhou-tracker": Headphones,
  "zhihu-tracker": HelpCircle,
  "folder-monitor": FolderOpen,
};

const MODULE_GRADIENTS: Record<string, string> = {
  "arxiv-tracker": "linear-gradient(135deg, #BCA4E3, #9D7BDB)",
  "semantic-scholar-tracker": "linear-gradient(135deg, #7BC8F0, #5BA8D0)",
  "bilibili-tracker": "linear-gradient(135deg, #FFB7B2, #E89B96)",
  "xiaohongshu-tracker": "linear-gradient(135deg, #FF6B6B, #E85555)",
  "xiaoyuzhou-tracker": "linear-gradient(135deg, #A8E6CF, #7DD3C0)",
  "zhihu-tracker": "linear-gradient(135deg, #4A9DFF, #3478CC)",
  "folder-monitor": "linear-gradient(135deg, #F5C88C, #D4A574)",
};

export function ModuleCard({
  module,
  usage,
  onOpenHistory,
  onOpenOverview,
  onOpenTool,
  onRun,
  onToggle,
}: ModuleCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [hovered, setHovered] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const status = STATUS_STYLES[module.status];
  const Icon = MODULE_ICONS[module.id] || Rss;
  const gradient = MODULE_GRADIENTS[module.id] || "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))";
  const focusTokens = getModuleFocusTokens(module).slice(0, 3);
  const isUnconfigured = module.status === "unconfigured";
  const primaryActionLabel = isUnconfigured
    ? "Open tool"
    : module.status === "active"
      ? "Pause"
      : "Start";

  return (
    <div
      onClick={onOpenHistory}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "18px",
        borderRadius: "var(--radius-xl)",
        background: "var(--bg-card)",
        border: hovered ? "1px solid rgba(188,164,227,0.28)" : "1px solid var(--border-light)",
        cursor: "pointer",
        transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? "0 10px 26px rgba(15,23,42,0.08)" : "0 4px 16px rgba(15,23,42,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", minWidth: 0 }}>
          <div
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "12px",
              background: gradient,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 8px 18px ${status.color}22`,
              flexShrink: 0,
            }}
          >
            <Icon style={{ width: "20px", height: "20px", color: "white" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
              <h3
                style={{
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  lineHeight: 1.2,
                  margin: 0,
                }}
              >
                {module.name}
              </h3>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "3px 8px",
                  borderRadius: "999px",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  background: status.bg,
                  color: status.color,
                  border: `1px solid ${status.border}`,
                }}
              >
                {module.status === "active" && (
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: status.color,
                      animation: "modulePulse 2s infinite",
                    }}
                  />
                )}
                {status.label}
              </span>
            </div>
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                margin: 0,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {module.description}
            </p>
          </div>
        </div>

        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={(event) => {
              event.stopPropagation();
              setShowMenu((value) => !value);
            }}
            style={iconButtonStyle}
            aria-label="More actions"
          >
            <MoreVertical style={{ width: "16px", height: "16px", color: "var(--text-muted)" }} />
          </button>
          {showMenu && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 6px)",
                minWidth: "160px",
                background: "var(--bg-card)",
                borderRadius: "12px",
                border: "1px solid var(--border-light)",
                boxShadow: "0 16px 32px rgba(15,23,42,0.14)",
                overflow: "hidden",
                zIndex: 20,
              }}
            >
              {[
                {
                  label: "View overview",
                  icon: <FileText style={{ width: "14px", height: "14px" }} />,
                  action: onOpenOverview,
                },
                {
                  label: "Run now",
                  icon: <RefreshCw style={{ width: "14px", height: "14px" }} />,
                  action: onRun,
                },
                {
                  label: "Open tool",
                  icon: <ExternalLink style={{ width: "14px", height: "14px" }} />,
                  action: onOpenTool,
                },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowMenu(false);
                    item.action();
                  }}
                  style={menuItemStyle}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "10px 12px",
          borderRadius: "12px",
          background: "var(--bg-hover)",
          marginBottom: "14px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "3px" }}>Monitor scope</div>
          <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)" }}>{getModuleFocusSummary(module)}</div>
        </div>
        {focusTokens.length > 0 && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {focusTokens.map((token) => (
              <span
                key={token}
                style={{
                  padding: "4px 8px",
                  borderRadius: "999px",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  color: "var(--color-primary)",
                  background: "rgba(188,164,227,0.12)",
                }}
              >
                {token}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "8px", marginBottom: "14px" }}>
        {[
          { label: "Pending", value: usage.unreadCount, tone: "#f59e0b" },
          { label: "Read", value: usage.readCount, tone: "var(--text-main)" },
          { label: "Views (7d)", value: usage.viewCount7d, tone: "#2563eb" },
          { label: "New this week", value: module.stats.thisWeek, tone: "#7c3aed" },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              padding: "10px 8px",
              borderRadius: "12px",
              background: "var(--bg-hover)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "4px" }}>{item.label}</div>
            <div style={{ fontSize: "0.95rem", fontWeight: 800, color: item.tone }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px",
          marginBottom: "14px",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "12px",
            border: "1px solid var(--border-light)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "4px" }}>Run cadence</div>
          <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)" }}>{formatScheduleLabel(module.schedule)}</div>
        </div>
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "12px",
            border: "1px solid var(--border-light)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "4px" }}>Recent content</div>
          <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)" }}>{formatRelativeDate(usage.lastCardAt)}</div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: module.stats.lastError ? "10px" : 0 }}>
        <button
          onClick={(event) => {
            event.stopPropagation();
            if (isUnconfigured) {
              onOpenTool();
              return;
            }
            onToggle();
          }}
          style={{
            ...actionButtonStyle,
            background: isUnconfigured
              ? "rgba(188,164,227,0.14)"
              : module.status === "active"
                ? "rgba(245,158,11,0.14)"
                : "rgba(34,197,94,0.12)",
            borderColor: isUnconfigured
              ? "rgba(188,164,227,0.25)"
              : module.status === "active"
                ? "rgba(245,158,11,0.25)"
                : "rgba(34,197,94,0.24)",
            color: isUnconfigured
              ? "var(--color-primary)"
              : module.status === "active"
                ? "#b45309"
                : "#15803d",
          }}
        >
          {isUnconfigured ? (
            <ExternalLink style={{ width: "15px", height: "15px" }} />
          ) : module.status === "active" ? (
            <Pause style={{ width: "15px", height: "15px" }} />
          ) : (
            <Play style={{ width: "15px", height: "15px" }} />
          )}
          {primaryActionLabel}
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onOpenHistory();
          }}
          style={actionButtonStyle}
        >
          <FileText style={{ width: "15px", height: "15px" }} />
          View records
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onOpenTool();
          }}
          style={{ ...actionButtonStyle, paddingInline: "10px" }}
          title="Open tool"
          aria-label="Open tool"
        >
          <ExternalLink style={{ width: "15px", height: "15px" }} />
        </button>
      </div>

      {module.stats.lastError && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: "10px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.16)",
            color: "#dc2626",
            fontSize: "0.75rem",
            lineHeight: 1.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {module.stats.lastError}
        </div>
      )}

      <style>{`
        @keyframes modulePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>
    </div>
  );
}

const iconButtonStyle: CSSProperties = {
  width: "32px",
  height: "32px",
  borderRadius: "8px",
  border: "1px solid var(--border-light)",
  background: "transparent",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const menuItemStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "11px 12px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "var(--text-secondary)",
  fontSize: "0.8125rem",
  fontWeight: 600,
};

const actionButtonStyle: CSSProperties = {
  height: "36px",
  padding: "0 12px",
  borderRadius: "8px",
  border: "1px solid var(--border-light)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: "0.8125rem",
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
};
