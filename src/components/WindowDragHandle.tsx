import type { PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export default function WindowDragHandle() {
  if (!isTauriRuntime()) return null;

  async function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Ignore non-Tauri or transient window state errors.
    }
  }

  return (
    <div
      data-tauri-drag-region
      onPointerDown={handlePointerDown}
      title="Drag window"
      aria-label="Drag window"
      style={{
        position: "fixed",
        top: "8px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "168px",
        height: "22px",
        borderRadius: "9999px",
        border: "1px solid var(--border-light)",
        background: "color-mix(in srgb, var(--bg-panel) 84%, transparent)",
        backdropFilter: "blur(16px)",
        boxShadow: "var(--shadow-soft)",
        cursor: "grab",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
      }}
    >
      <div
        style={{
          width: "52px",
          height: "4px",
          borderRadius: "9999px",
          background: "linear-gradient(90deg, var(--color-primary-light), var(--color-secondary-light))",
          opacity: 0.95,
        }}
      />
    </div>
  );
}
