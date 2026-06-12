import { useState } from "react";
import { Plus, X } from "lucide-react";
import { isActionEnterKey } from "../core/keyboard";

export interface SubType {
  type: string;
  label: string;
  placeholder?: string;
}

interface Props {
  types: SubType[];
  subscriptions: Record<string, string[]>; // e.g. { up_uids: ["123", "456"] }
  onChange: (next: Record<string, string[]>) => void;
  disabled?: boolean;
}

const keyMap: Record<string, string> = {
  up_uid: "up_uids",
  user_id: "user_ids",
  user: "users",
  topic: "topics",
  podcast_id: "podcast_ids",
};

export default function SubscriptionManager({ types, subscriptions, onChange, disabled }: Props) {
  const [adding, setAdding] = useState<Record<string, string>>({});

  if (!types || types.length === 0) return null;

  function add(subType: SubType) {
    const raw = (adding[subType.type] || "").trim();
    if (!raw) return;
    const key = keyMap[subType.type];
    const current = subscriptions[key] || [];
    if (current.includes(raw)) return;
    onChange({ ...subscriptions, [key]: [...current, raw] });
    setAdding((prev) => ({ ...prev, [subType.type]: "" }));
  }

  function remove(subType: SubType, value: string) {
    const key = keyMap[subType.type];
    const current = subscriptions[key] || [];
    onChange({ ...subscriptions, [key]: current.filter((v) => v !== value) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {types.map((subType) => {
        const key = keyMap[subType.type];
        const list = subscriptions[key] || [];
        return (
          <div key={subType.type}>
            <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "8px" }}>
              {subType.label}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
              {list.map((value) => (
                <span
                  key={value}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "9999px",
                    background: "var(--bg-hover)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                  }}
                >
                  {value}
                  <button
                    onClick={() => remove(subType, value)}
                    className="sub-remove-btn"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      border: "none",
                      background: "var(--text-muted)",
                      color: "white",
                      cursor: "pointer",
                    }}
                    aria-label="Remove"
                  >
                    <X style={{ width: "10px", height: "10px" }} />
                  </button>
                </span>
              ))}
              {list.length === 0 && (
                <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>No subscriptions yet</span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                disabled={disabled || false}
                value={adding[subType.type] || ""}
                onChange={(e) => setAdding((prev) => ({ ...prev, [subType.type]: e.target.value }))}
                onKeyDown={(e) => {
                  if (isActionEnterKey(e)) {
                    e.preventDefault();
                    add(subType);
                  }
                }}
                placeholder={subType.placeholder || `Add ${subType.label}`}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: "var(--radius-full)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-app)",
                  color: "var(--text-main)",
                  fontSize: "0.9375rem",
                  outline: "none",
                }}
              />
              <button
                onClick={() => add(subType)}
                disabled={disabled || false}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "10px 16px",
                  borderRadius: "var(--radius-full)",
                  border: "none",
                  background: "var(--color-primary)",
                  color: "white",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Plus style={{ width: "14px", height: "14px" }} />
                Add
              </button>
            </div>
          </div>
        );
      })}
      <style>{`
        .sub-remove-btn:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
