import { KeyboardEvent, ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, LucideIcon } from "lucide-react";
import { useStore } from "../core/store";

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

/** Full-screen page container - guarantees 100% fill */
export function PageContainer({ children, className = "" }: PageContainerProps) {
  const showcaseMode = useStore((s) => s.showcaseMode);
  return (
    <div
      className={`w-full h-full overflow-hidden flex flex-col ${className}`}
      style={{
        background: "var(--bg-app)",
        position: "relative",
      }}
    >
      {showcaseMode && <ShowcaseBackground />}
      <div style={{ position: "relative", zIndex: 1, width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

/** Showcase floating particles + gradient overlay */
function ShowcaseBackground() {
  const particles = [
    { size: 6, x: "12%", y: "18%", color: "#BCA4E3", delay: 0, dur: 7 },
    { size: 4, x: "85%", y: "25%", color: "#FFB7B2", delay: 1.2, dur: 9 },
    { size: 5, x: "45%", y: "72%", color: "#A8D8FF", delay: 0.5, dur: 8 },
    { size: 3, x: "72%", y: "85%", color: "#FCD34D", delay: 2, dur: 10 },
    { size: 4, x: "28%", y: "45%", color: "#A8E6CF", delay: 0.8, dur: 6 },
    { size: 5, x: "92%", y: "55%", color: "#C084FC", delay: 1.5, dur: 11 },
    { size: 3, x: "55%", y: "12%", color: "#FFB7B2", delay: 2.5, dur: 8 },
    { size: 4, x: "8%", y: "65%", color: "#818CF8", delay: 0.3, dur: 9 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      {/* Aurora gradient */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 80% 50% at 20% 30%, rgba(188, 164, 227, 0.08) 0%, transparent 50%), radial-gradient(ellipse 60% 40% at 80% 70%, rgba(255, 183, 178, 0.06) 0%, transparent 50%), radial-gradient(ellipse 50% 60% at 50% 50%, rgba(168, 216, 255, 0.04) 0%, transparent 50%)",
        animation: "showcase-aurora 12s ease infinite",
        backgroundSize: "200% 200%",
      }} />
      {/* Floating particles */}
      {particles.map((p, i) => (
        <div key={i} style={{
          position: "absolute",
          width: `${p.size}px`, height: `${p.size}px`,
          borderRadius: "50%",
          background: p.color,
          left: p.x, top: p.y,
          opacity: 0,
          boxShadow: `0 0 ${p.size * 2}px ${p.color}50`,
          animation: `showcase-sparkle ${p.dur}s ease-in-out ${p.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}

/** Unified page header */
export function PageHeader({ title, subtitle, icon: Icon, actions, className = "" }: PageHeaderProps) {
  const showcaseMode = useStore((s) => s.showcaseMode);
  return (
    <header
      className={`shrink-0 w-full ${className}`}
      style={{
        padding: "clamp(16px, 2.5vw, 24px) clamp(20px, 3vw, 32px)",
        background: "var(--bg-panel)",
        backdropFilter: "blur(20px)",
        borderBottom: showcaseMode ? "1px solid var(--border-color)" : "1px solid var(--border-light)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        ...(showcaseMode ? {
          boxShadow: "0 4px 24px rgba(188, 164, 227, 0.08)",
        } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "clamp(12px, 2vw, 16px)" }}>
        {Icon && (
          <div
            style={{
              width: "clamp(44px, 5vw, 52px)",
              height: "clamp(44px, 5vw, 52px)",
              borderRadius: "var(--radius-md)",
              background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: showcaseMode
                ? "0 6px 24px rgba(188, 164, 227, 0.4), 0 0 40px rgba(188, 164, 227, 0.12)"
                : "0 4px 16px rgba(188, 164, 227, 0.3)",
              flexShrink: 0,
              ...(showcaseMode ? { animation: "breathe 4s ease-in-out infinite" } : {}),
            }}
          >
            <Icon style={{ width: "24px", height: "24px", color: "white" }} />
          </div>
        )}
        <div>
          <h1
            style={{
              fontFamily: "'M PLUS Rounded 1c', sans-serif",
              fontSize: "clamp(1.25rem, 2.5vw, 1.75rem)",
              fontWeight: 700,
              lineHeight: 1.3,
              ...(showcaseMode ? {
                background: "linear-gradient(135deg, var(--color-primary-dark), var(--color-secondary), var(--color-primary))",
                backgroundSize: "200% 200%",
                animation: "showcase-aurora 6s ease infinite",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              } : { color: "var(--text-main)" }),
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                fontSize: "clamp(0.8125rem, 1.2vw, 0.9375rem)",
                color: "var(--text-muted)",
                marginTop: "4px",
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div style={{ display: "flex", gap: "12px", flexShrink: 0 }}>{actions}</div>}
    </header>
  );
}

interface PageContentProps {
  children: ReactNode;
  className?: string;
  maxWidth?: string;
  centered?: boolean;
}

/** Unified content area - scrollable */
export function PageContent({ children, className = "", maxWidth = "1400px", centered = true }: PageContentProps) {
  return (
    <div
      className={`flex-1 overflow-y-auto overflow-x-hidden ${className}`}
      style={{
        width: "100%",
        height: "100%",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: centered ? maxWidth : "100%",
          margin: centered ? "0 auto" : undefined,
          padding: "clamp(16px, 2.5vw, 32px)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  noPadding?: boolean;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  lazyMount?: boolean;
  summary?: ReactNode;
  style?: React.CSSProperties;
}

/** Unified card component */
export function Card({
  children,
  className = "",
  title,
  icon,
  actions,
  noPadding = false,
  collapsible = false,
  defaultExpanded = true,
  lazyMount = false,
  summary,
  style,
}: CardProps) {
  const showcaseMode = useStore((s) => s.showcaseMode);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hasExpandedOnce, setHasExpandedOnce] = useState(defaultExpanded || !lazyMount || !collapsible);
  const isExpanded = collapsible ? expanded : true;
  const shouldRenderChildren = !lazyMount || !collapsible || isExpanded || hasExpandedOnce;

  function toggleExpanded() {
    if (!collapsible) return;
    setExpanded((current) => {
      const next = !current;
      if (next) {
        setHasExpandedOnce(true);
      }
      return next;
    });
  }

  function handleHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!collapsible) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded();
    }
  }

  return (
    <div
      className={`${className}`}
      style={{
        background: "var(--bg-card)",
        backdropFilter: "blur(16px)",
        borderRadius: "var(--radius-md)",
        border: showcaseMode ? "1px solid var(--border-color)" : "1px solid var(--border-light)",
        boxShadow: showcaseMode ? "var(--shadow-medium)" : "var(--shadow-soft)",
        overflow: "hidden",
        transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
        ...style,
      }}
      onMouseEnter={showcaseMode ? (e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "var(--shadow-float)";
        e.currentTarget.style.borderColor = "var(--border-medium)";
      } : undefined}
      onMouseLeave={showcaseMode ? (e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "var(--shadow-medium)";
        e.currentTarget.style.borderColor = "var(--border-color)";
      } : undefined}
    >
      {(title || actions) && (
        <div
          role={collapsible ? "button" : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? isExpanded : undefined}
          onClick={collapsible ? toggleExpanded : undefined}
          onKeyDown={handleHeaderKeyDown}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "clamp(16px, 2vw, 20px) clamp(20px, 2.5vw, 24px)",
            borderBottom: isExpanded ? "1px solid var(--border-light)" : "none",
            background: "var(--bg-hover)",
            cursor: collapsible ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            {icon}
            <div style={{ minWidth: 0 }}>
              {title && (
                <h2
                  style={{
                    fontFamily: "'M PLUS Rounded 1c', sans-serif",
                    fontSize: "clamp(0.9375rem, 1.5vw, 1.125rem)",
                    fontWeight: 700,
                    color: "var(--text-main)",
                  }}
                >
                  {title}
                </h2>
              )}
              {summary && (
                <div
                  style={{
                    marginTop: "4px",
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    lineHeight: 1.5,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {summary}
                </div>
              )}
            </div>
          </div>
          <div
            style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
            {collapsible && (
              isExpanded
                ? <ChevronDown style={{ width: "16px", height: "16px", color: "var(--text-muted)" }} />
                : <ChevronRight style={{ width: "16px", height: "16px", color: "var(--text-muted)" }} />
            )}
          </div>
        </div>
      )}
      <div
        style={collapsible ? {
          display: "grid",
          gridTemplateRows: isExpanded ? "1fr" : "0fr",
          transition: "grid-template-rows 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        } : undefined}
      >
        <div style={collapsible ? { overflow: "hidden" } : undefined}>
          <div
            style={{
              padding: noPadding ? 0 : "clamp(16px, 2vw, 24px)",
              opacity: isExpanded ? 1 : 0,
              transition: collapsible ? "opacity 160ms ease" : undefined,
              pointerEvents: isExpanded ? "auto" : "none",
            }}
          >
            {shouldRenderChildren ? children : null}
          </div>
        </div>
      </div>
    </div>
  );
}

interface GridProps {
  children: ReactNode;
  className?: string;
  columns?: 1 | 2 | 3 | 4;
  gap?: "sm" | "md" | "lg";
  style?: React.CSSProperties;
}

/** Unified grid layout */
export function Grid({ children, className = "", columns = 2, gap = "md", style }: GridProps) {
  const gapSize = gap === "sm" ? "12px" : gap === "md" ? "20px" : "28px";

  return (
    <div
      className={`${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: gapSize,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Two-column layout - narrow left, wide right */
export function TwoColumnLayout({
  left,
  right,
  leftWidth = "320px",
  gap = "24px",
}: {
  left: ReactNode;
  right: ReactNode;
  leftWidth?: string;
  gap?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${leftWidth} 1fr`,
        gap,
        height: "100%",
      }}
    >
      <div style={{ overflow: "auto", height: "100%" }}>{left}</div>
      <div style={{ overflow: "auto", height: "100%" }}>{right}</div>
    </div>
  );
}

/** Full-screen centered empty state */
export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "20px",
        padding: "40px",
        color: "var(--text-muted)",
      }}
    >
      {Icon && (
        <div
          style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(188, 164, 227, 0.15), rgba(255, 183, 178, 0.1))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border-light)",
          }}
        >
          <Icon style={{ width: "36px", height: "36px", opacity: 0.5 }} />
        </div>
      )}
      <div style={{ textAlign: "center" }}>
        <h3
          style={{
            fontFamily: "'M PLUS Rounded 1c', sans-serif",
            fontSize: "1.25rem",
            fontWeight: 700,
            color: "var(--text-secondary)",
            marginBottom: "8px",
          }}
        >
          {title}
        </h3>
        {description && <p style={{ fontSize: "0.9375rem", opacity: 0.8 }}>{description}</p>}
      </div>
    </div>
  );
}

/** Loading state */
export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        color: "var(--text-muted)",
      }}
    >
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          border: "3px solid var(--border-light)",
          borderTopColor: "var(--color-primary)",
          animation: "spin 1s linear infinite",
        }}
      />
      <p style={{ fontSize: "0.9375rem" }}>{message}</p>
    </div>
  );
}
