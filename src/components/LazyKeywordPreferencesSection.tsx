import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import KeywordPreferences from "./KeywordPreferences";

interface Props {
  title?: string;
  description?: string;
  defaultOpen?: boolean;
  style?: React.CSSProperties;
}

export default function LazyKeywordPreferencesSection({
  title = "Preference learning",
  description = "Loads on click — view positive preferences and top keywords only when needed.",
  defaultOpen = false,
  style,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [hasOpened, setHasOpened] = useState(defaultOpen);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      if (next) setHasOpened(true);
      return next;
    });
  }

  return (
    <section
      style={{
        borderTop: "1px solid var(--border-light)",
        paddingTop: "18px",
        ...style,
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "12px 14px",
          borderRadius: "10px",
          border: "1px solid var(--border-light)",
          background: open ? "var(--bg-hover)" : "var(--bg-card)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ fontSize: "0.9375rem" }}>📊</span>
            <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
              {title}
            </span>
          </div>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            {description}
          </div>
        </div>
        {open
          ? <ChevronDown style={{ width: "16px", height: "16px", color: "var(--text-muted)", flexShrink: 0 }} />
          : <ChevronRight style={{ width: "16px", height: "16px", color: "var(--text-muted)", flexShrink: 0 }} />
        }
      </button>

      {open && (
        <div style={{ marginTop: "14px" }}>
          {hasOpened ? <KeywordPreferences showHeader={false} /> : null}
        </div>
      )}
    </section>
  );
}
