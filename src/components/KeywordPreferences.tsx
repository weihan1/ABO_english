import { useEffect, useMemo, useState } from "react";
import { Hash, RefreshCw, TrendingUp, ThumbsUp } from "lucide-react";
import { useStore } from "../core/store";
import { api } from "../core/api";

type TopKeywordItem = [string, number] | { keyword: string; score: number };

interface KeywordPreferencesProps {
  showHeader?: boolean;
}

function normalizeTopKeywords(items: TopKeywordItem[]): [string, number][] {
  return items.flatMap((item) => {
    if (Array.isArray(item) && item.length >= 2) {
      return [[String(item[0]), Number(item[1] ?? 0)] as [string, number]];
    }
    if (item && typeof item === "object" && "keyword" in item) {
      return [[String(item.keyword), Number(item.score ?? 0)] as [string, number]];
    }
    return [];
  });
}

function priorityLabel(score: number, count: number): string {
  if (score >= 0.45 || count >= 5) return "High priority";
  if (score >= 0.25 || count >= 3) return "Stable preference";
  return "Observing";
}

export default function KeywordPreferences({ showHeader = true }: KeywordPreferencesProps) {
  const { keywordPrefs, setKeywordPrefs } = useStore();
  const [topKeywords, setTopKeywords] = useState<[string, number][]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPreferences();
  }, []);

  async function loadPreferences() {
    try {
      setLoading(true);
      const data = await api.get<{
        keywords?: Record<string, {
          keyword: string;
          score: number;
          count: number;
          source_modules: string[];
          last_updated: string;
        }>;
        top?: TopKeywordItem[];
      }>("/api/preferences/keywords");
      setKeywordPrefs(data.keywords || {});
      setTopKeywords(normalizeTopKeywords(data.top || []));
    } catch (error) {
      console.error("Failed to load keyword preferences:", error);
    } finally {
      setLoading(false);
    }
  }

  const likedKeywords = useMemo(
    () =>
      Object.entries(keywordPrefs)
        .filter(([, value]) => value.score > 0)
        .sort((a, b) => {
          if (b[1].score !== a[1].score) return b[1].score - a[1].score;
          if (b[1].count !== a[1].count) return b[1].count - a[1].count;
          return (b[1].last_updated || "").localeCompare(a[1].last_updated || "");
        }),
    [keywordPrefs]
  );

  const totalPositiveInteractions = likedKeywords.reduce((sum, [, value]) => sum + value.count, 0);
  const activeModules = new Set(
    likedKeywords.flatMap(([, value]) => value.source_modules || [])
  ).size;

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-40"
        style={{ color: "var(--text-muted)" }}
      >
        <TrendingUp className="w-5 h-5 animate-pulse mr-2" />
        Loading positive preferences...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {showHeader && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Hash className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
              <h3
                className="text-lg font-semibold"
                style={{ color: "var(--text-main)" }}
              >
                Positive preferences
              </h3>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Only what you like is kept, and it is used to boost recommendations and sorting.
            </p>
          </div>
          <button
            type="button"
            onClick={loadPreferences}
            className="inline-flex items-center gap-1 text-xs transition-colors hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-hover)" }}>
          <div className="text-2xl font-bold" style={{ color: "var(--color-success-text)" }}>
            {likedKeywords.length}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Positive keywords
          </div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-hover)" }}>
          <div className="text-2xl font-bold" style={{ color: "var(--color-primary)" }}>
            {totalPositiveInteractions}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Total recorded count
          </div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-hover)" }}>
          <div className="text-2xl font-bold" style={{ color: "var(--color-accent)" }}>
            {activeModules}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
            Source modules
          </div>
        </div>
      </div>

      <div
        className="rounded-xl p-4"
        style={{
          background: "color-mix(in srgb, var(--color-success) 10%, var(--bg-card))",
          border: "1px solid color-mix(in srgb, var(--color-success) 24%, transparent)",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <ThumbsUp className="w-4 h-4" style={{ color: "var(--color-success-text)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>
            Sorting strategy
          </span>
        </div>
        <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
          Currently only positive feedback boosts related content; negative feedback is not yet part of keyword preference calculation.
        </p>
      </div>

      {topKeywords.length > 0 && (
        <div>
          <h4
            className="text-sm font-medium mb-3"
            style={{ color: "var(--text-secondary)" }}
          >
            Current top preferences
          </h4>
          <div className="flex flex-wrap gap-2">
            {topKeywords.slice(0, 8).map(([keyword, score]) => (
              <span
                key={keyword}
                className="px-3 py-1.5 rounded-full text-sm"
                style={{
                  background: "rgba(168, 230, 207, 0.15)",
                  border: "1px solid rgba(168, 230, 207, 0.3)",
                  color: "var(--color-success)",
                }}
              >
                {keyword}
                <span style={{ opacity: 0.72, marginLeft: "6px", fontFamily: "monospace" }}>
                  +{score.toFixed(2)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {likedKeywords.length > 0 && (
        <div>
          <h4
            className="text-sm font-medium mb-3 flex items-center gap-2"
            style={{ color: "var(--color-success-text)" }}
          >
            <ThumbsUp className="w-4 h-4" />
            Confirmed likes ({likedKeywords.length})
          </h4>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {likedKeywords.map(([keyword, data]) => (
              <div
                key={keyword}
                className="rounded-lg border px-4 py-3"
                style={{
                  background: "rgba(168, 230, 207, 0.08)",
                  borderColor: "rgba(168, 230, 207, 0.24)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" style={{ color: "var(--text-main)" }}>
                        {keyword}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full text-xs"
                        style={{
                          background: "rgba(168, 230, 207, 0.18)",
                          color: "var(--color-success-text)",
                        }}
                      >
                        {priorityLabel(data.score, data.count)}
                      </span>
                    </div>
                    <div
                      className="mt-1 text-xs flex items-center gap-3 flex-wrap"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span>Recorded {data.count} times</span>
                      <span>Modules {data.source_modules.length}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className="text-sm font-mono font-semibold"
                      style={{ color: "var(--color-success-text)" }}
                    >
                      +{data.score.toFixed(2)}
                    </div>
                    <div className="text-xs" style={{ color: "var(--text-light)" }}>
                      Preference score
                    </div>
                  </div>
                </div>
                <div
                  className="mt-3 h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--bg-hover)" }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(12, data.score * 100))}%`,
                      height: "100%",
                      borderRadius: "999px",
                      background: "linear-gradient(90deg, var(--color-success), var(--color-accent))",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {likedKeywords.length === 0 && (
        <div className="text-center py-8" style={{ color: "var(--text-muted)" }}>
          <Hash className="w-12 h-12 mx-auto mb-3" style={{ opacity: 0.3 }} />
          <p>No stable positive preferences yet</p>
          <p className="text-sm mt-1">
            Use likes, saves, and deep reads in the Feed, and the system will surface the topics you truly enjoy.
          </p>
        </div>
      )}
    </div>
  );
}
