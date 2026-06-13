import { Eye, EyeOff, Globe, X } from "lucide-react";

interface BilibiliCookieModalProps {
  open: boolean;
  canClose: boolean;
  onClose: () => void;
  gettingFromBrowser: boolean;
  onFetchFromBrowser: () => void;
  cookiePreview: string | null;
  cookieInput: string;
  showFullCookie: boolean;
  onToggleFullCookie: () => void;
}

export function BilibiliCookieModal({
  open,
  canClose,
  onClose,
  gettingFromBrowser,
  onFetchFromBrowser,
  cookiePreview,
  cookieInput,
  showFullCookie,
  onToggleFullCookie,
}: BilibiliCookieModalProps) {
  if (!open) return null;

  return (
    <div
      onClick={() => canClose && onClose()}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: "20px",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "85vh",
          overflow: "auto",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-light)",
          background: "var(--bg-panel)",
          boxShadow: "var(--shadow-soft)",
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>Bilibili Cookie Configuration</div>
            <div style={{ marginTop: "4px", fontSize: "0.875rem", color: "var(--text-muted)" }}>
              Only pops up on first use or when the cookie is lost. Once configured, it no longer appears on the page.
            </div>
          </div>
          {canClose && (
            <button
              type="button"
              onClick={onClose}
              style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "14px",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-hover)",
            border: "1px solid var(--border-light)",
          }}
        >
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)" }}>One-click browser cookie</div>
            <div style={{ marginTop: "4px", fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              Connects to local Chrome or Edge in one click and reads the full Bilibili cookie.
            </div>
          </div>
          <button
            onClick={onFetchFromBrowser}
            disabled={gettingFromBrowser}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: gettingFromBrowser ? "var(--bg-muted)" : "#00AEEC",
              color: "white",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: gettingFromBrowser ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Globe size={16} />
            {gettingFromBrowser ? "Getting..." : "One-click get"}
          </button>
        </div>

        {cookiePreview && (
          <div style={{ color: "var(--color-success)", fontSize: "0.8125rem" }}>
            Cookie saved — you can preview posts, fetch favorites, and save to the library directly.
          </div>
        )}

        {cookieInput && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              type="button"
              onClick={onToggleFullCookie}
              style={{
                width: "fit-content",
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {showFullCookie ? <EyeOff size={14} /> : <Eye size={14} />}
              {showFullCookie ? "Hide full cookie" : "Show full cookie"}
            </button>

            {showFullCookie && (
              <textarea
                readOnly
                value={cookieInput}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: "132px",
                  resize: "vertical",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-subtle)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  lineHeight: 1.55,
                  wordBreak: "break-all",
                }}
              />
            )}
          </div>
        )}

        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
          Prefers a browser with the debug port already open; otherwise it tries to launch Chrome or Edge.
        </div>
      </div>
    </div>
  );
}
