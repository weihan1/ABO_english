// src/modules/dashboard/ModulePerformance.tsx
import { useMemo } from "react";
import { Layers } from "lucide-react";

interface ModulePerformanceProps {
  byModule: Record<string, number>;
}

// Module name mapping
const MODULE_NAMES: Record<string, string> = {
  "arxiv-tracker": "arXiv Tracking",
  "semantic-scholar-tracker": "Semantic Scholar",
  "xiaohongshu-tracker": "Xiaohongshu Tracking",
  "bilibili-tracker": "Bilibili Tracking",
  "xiaoyuzhou-tracker": "Xiaoyuzhou Tracking",
  "zhihu-tracker": "Zhihu Tracking",
  "folder-monitor": "Folder Monitor",
  "arxiv": "arXiv API",
  "rss": "RSS Feeds",
  "podcast": "Podcast Tracking",
};

// Module colors
const MODULE_COLORS: Record<string, string> = {
  "arxiv-tracker": "#BCA4E3",
  "semantic-scholar-tracker": "#9B7FD4",
  "xiaohongshu-tracker": "#FF6B6B",
  "bilibili-tracker": "#00AEEC",
  "xiaoyuzhou-tracker": "#FFB7B2",
  "zhihu-tracker": "#FFE4B5",
  "folder-monitor": "#A8E6CF",
  "arxiv": "#BCA4E3",
  "rss": "#F5C88C",
  "podcast": "#7DD3C0",
};

export default function ModulePerformance({ byModule }: ModulePerformanceProps) {
  const moduleData = useMemo(() => {
    const entries = Object.entries(byModule);
    const maxCount = entries.length > 0 ? Math.max(...entries.map(([, count]) => count)) : 1;
    const total = entries.reduce((sum, [, count]) => sum + count, 0);

    return {
      entries: entries
        .map(([id, count]) => ({
          id,
          name: MODULE_NAMES[id] || id,
          count,
          percentage: total > 0 ? (count / total) * 100 : 0,
          color: MODULE_COLORS[id] || "#BCA4E3",
        }))
        .sort((a, b) => b.count - a.count),
      maxCount,
      total,
    };
  }, [byModule]);

  if (moduleData.entries.length === 0) {
    return (
      <div
        style={{
          height: "200px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
        }}
      >
        <p>No module data yet</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 0" }}>
      {/* Summary */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "20px",
          padding: "12px 16px",
          background: "var(--bg-hover)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <Layers style={{ width: "20px", height: "20px", color: "var(--color-primary)" }} />
        <div>
          <span style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600 }}>
            {moduleData.entries.length} active modules
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "8px" }}>
            {moduleData.total} cards total
          </span>
        </div>
      </div>

      {/* Bar Chart */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {moduleData.entries.map((module) => (
          <div key={module.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: module.color,
                  }}
                />
                <span
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    color: "var(--text-main)",
                  }}
                >
                  {module.name}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                  }}
                >
                  {module.percentage.toFixed(1)}%
                </span>
                <span
                  style={{
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    minWidth: "32px",
                    textAlign: "right",
                  }}
                >
                  {module.count}
                </span>
              </div>
            </div>
            <div
              style={{
                height: "8px",
                background: "var(--bg-hover)",
                borderRadius: "var(--radius-full)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(module.count / moduleData.maxCount) * 100}%`,
                  background: `linear-gradient(90deg, ${module.color}, ${module.color}dd)`,
                  borderRadius: "var(--radius-full)",
                  transition: "width 0.5s ease",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          marginTop: "24px",
          paddingTop: "16px",
          borderTop: "1px solid var(--border-light)",
        }}
      >
        {moduleData.entries.slice(0, 4).map((module) => (
          <div
            key={module.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.6875rem",
              color: "var(--text-muted)",
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "2px",
                background: module.color,
              }}
            />
            <span>{module.name}</span>
          </div>
        ))}
        {moduleData.entries.length > 4 && (
          <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
            +{moduleData.entries.length - 4} more
          </span>
        )}
      </div>
    </div>
  );
}
