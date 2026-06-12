import { Hash } from "lucide-react";

interface SmartGroupActionButtonProps {
  onClick: () => void;
  running: boolean;
  disabled?: boolean;
  idleLabel?: string;
  runningLabel?: string;
  gradient?: string;
  borderColor?: string;
  secondaryLabel?: string;
  onSecondaryClick?: () => void;
  secondaryDisabled?: boolean;
}

export function SmartGroupActionButton({
  onClick,
  running,
  disabled = false,
  idleLabel = "Shared smart grouping",
  runningLabel = "Organizing...",
  gradient = "linear-gradient(135deg, #FB7299, #8B5CF6)",
  borderColor = "rgba(236, 72, 153, 0.32)",
  secondaryLabel,
  onSecondaryClick,
  secondaryDisabled = false,
}: SmartGroupActionButtonProps) {
  const blocked = running || disabled;
  const secondaryBlocked = running || secondaryDisabled;

  return (
    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onClick}
        disabled={blocked}
        style={{
          padding: "10px 14px",
          borderRadius: "8px",
          border: `1px solid ${borderColor}`,
          background: blocked ? "var(--bg-muted)" : gradient,
          color: blocked ? "var(--text-muted)" : "white",
          fontSize: "0.8125rem",
          fontWeight: 800,
          cursor: blocked ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <Hash size={14} />
        {running ? runningLabel : idleLabel}
      </button>

      {secondaryLabel && onSecondaryClick ? (
        <button
          type="button"
          onClick={onSecondaryClick}
          disabled={secondaryBlocked}
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            border: `1px solid ${borderColor}`,
            background: secondaryBlocked ? "var(--bg-muted)" : "var(--bg-card)",
            color: secondaryBlocked ? "var(--text-muted)" : "var(--text-secondary)",
            fontSize: "0.8125rem",
            fontWeight: 700,
            cursor: secondaryBlocked ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Hash size={14} />
          {secondaryLabel}
        </button>
      ) : null}
    </div>
  );
}
