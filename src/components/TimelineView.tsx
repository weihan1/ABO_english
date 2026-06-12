import { useEffect, useState } from "react";
import { Calendar, Sun, CloudSun, Moon, Sparkles, Clock, RefreshCw } from "lucide-react";
import { api } from "../core/api";

interface Activity {
  id: string;
  type: string;
  timestamp: string;
  card_title?: string;
  module_id?: string;
  chat_topic?: string;
  metadata?: Record<string, any>;
}

interface TimelineData {
  date: string;
  activities: Activity[];
  summary?: string;
  summary_generated_at?: string;
  chat_path: Array<{ time: string; topic: string; context: string }>;
  interaction_summary: Record<string, number>;
}

const activityLabels: Record<string, string> = {
  card_view: "Viewed",
  card_like: "Liked",
  card_save: "Saved",
  card_dislike: "Not interested",
  chat_message: "Chat",
  chat_start: "Started chat",
  module_run: "Ran crawler",
  checkin: "Check-in",
};

interface PeriodData {
  key: string;
  label: string;
  icon: React.ReactNode;
  counts: Record<string, number>;
  total: number;
}

function groupByPeriod(activities: Activity[]): PeriodData[] {
  const periods: PeriodData[] = [
    { key: "morning", label: "Morning", icon: <Sun className="w-3.5 h-3.5" />, counts: {}, total: 0 },
    { key: "afternoon", label: "Afternoon", icon: <CloudSun className="w-3.5 h-3.5" />, counts: {}, total: 0 },
    { key: "evening", label: "Evening", icon: <Moon className="w-3.5 h-3.5" />, counts: {}, total: 0 },
  ];

  for (const act of activities) {
    const hour = parseInt(act.timestamp.slice(11, 13));
    const period = hour < 12 ? periods[0] : hour < 18 ? periods[1] : periods[2];
    period.counts[act.type] = (period.counts[act.type] || 0) + 1;
    period.total++;
  }

  return periods;
}

function getHourCounts(activities: Activity[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const act of activities) {
    const hour = parseInt(act.timestamp.slice(11, 13));
    counts.set(hour, (counts.get(hour) || 0) + 1);
  }
  return counts;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${d.getMonth() + 1}/${d.getDate()} · ${days[d.getDay()]}`;
}

export default function TimelineView() {
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadTimeline();
  }, []);

  async function loadTimeline() {
    try {
      setLoading(true);
      const data = await api.get<TimelineData>("/api/timeline/today");
      setTimeline(data);
    } catch (e) {
      console.error("Failed to load timeline:", e);
    } finally {
      setLoading(false);
    }
  }

  async function generateSummary() {
    try {
      setGenerating(true);
      await api.post("/api/summary/generate", {});
      await loadTimeline();
    } catch (e) {
      console.error("Failed to generate summary:", e);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "120px", color: "var(--text-muted)",
      }}>
        <Clock style={{ width: "16px", height: "16px", animation: "spin 1s linear infinite", marginRight: "8px" }} />
        <span style={{ fontSize: "0.875rem" }}>Loading...</span>
      </div>
    );
  }

  if (!timeline || timeline.activities.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)" }}>
        <Calendar style={{ width: "36px", height: "36px", margin: "0 auto 8px", opacity: 0.3 }} />
        <p style={{ fontSize: "0.875rem" }}>No activity today</p>
        <p style={{ fontSize: "0.75rem", marginTop: "4px", color: "var(--text-light)" }}>
          Start browsing or chatting
        </p>
      </div>
    );
  }

  const periods = groupByPeriod(timeline.activities);
  const hourCounts = getHourCounts(timeline.activities);
  const maxHourCount = Math.max(...Array.from(hourCounts.values()), 1);
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  const hourLabels = [6, 9, 12, 15, 18, 21];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Date Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Calendar style={{ width: "15px", height: "15px", color: "var(--color-primary)" }} />
          <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)" }}>
            {formatDate(timeline.date)}
          </span>
        </div>
        <span style={{
          fontSize: "0.6875rem", padding: "2px 8px", borderRadius: "8px",
          background: "var(--bg-hover)", color: "var(--text-muted)",
        }}>
          {timeline.activities.length} activities
        </span>
      </div>

      {/* Hour Activity Bar */}
      <div style={{
        padding: "10px 10px 6px",
        borderRadius: "10px",
        background: "var(--bg-hover)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "28px" }}>
          {hours.map(h => {
            const count = hourCounts.get(h) || 0;
            const barHeight = count > 0 ? Math.max(6, (count / maxHourCount) * 24) : 3;
            return (
              <div
                key={h}
                style={{
                  flex: 1,
                  height: `${barHeight}px`,
                  borderRadius: count > 0 ? "3px 3px 1px 1px" : "1px",
                  background: count > 0 ? "var(--color-primary)" : "var(--border-light)",
                  opacity: count > 0 ? 0.35 + (count / maxHourCount) * 0.65 : 0.4,
                  transition: "height 0.3s ease",
                }}
                title={count > 0 ? `${h}:00 — ${count} activities` : `${h}:00`}
              />
            );
          })}
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          marginTop: "4px", padding: "0 2px",
        }}>
          {hourLabels.map(h => (
            <span key={h} style={{ fontSize: "9px", color: "var(--text-light)", fontFamily: "monospace" }}>
              {h}
            </span>
          ))}
        </div>
      </div>

      {/* Period Summary */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {periods.map(period => (
          <div
            key={period.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 10px",
              borderRadius: "8px",
              background: period.total > 0 ? "var(--bg-hover)" : "transparent",
              opacity: period.total > 0 ? 1 : 0.45,
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", gap: "5px",
              minWidth: "48px", flexShrink: 0,
              color: period.total > 0 ? "var(--text-secondary)" : "var(--text-light)",
            }}>
              {period.icon}
              <span style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{period.label}</span>
            </div>
            {period.total > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {Object.entries(period.counts).map(([type, count]) => (
                  <span
                    key={type}
                    style={{
                      fontSize: "0.6875rem",
                      padding: "1px 7px",
                      borderRadius: "5px",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-light)",
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activityLabels[type] || type} {count}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "var(--text-light)" }}>—</span>
            )}
          </div>
        ))}
      </div>

      {/* Chat Path (compact) */}
      {timeline.chat_path.length > 0 && (
        <div style={{
          padding: "8px 10px",
          borderRadius: "8px",
          background: "var(--bg-hover)",
        }}>
          <div style={{ fontSize: "0.6875rem", color: "var(--text-light)", marginBottom: "4px" }}>
            Conversation paths
          </div>
          <div style={{
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            lineHeight: 1.5,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {timeline.chat_path.map((c, i) => (
              <span key={i}>
                {i > 0 && <span style={{ color: "var(--text-light)", margin: "0 4px" }}>&rarr;</span>}
                <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: "0.625rem" }}>
                  {c.time.slice(11, 16)}
                </span>
                {" "}
                {c.topic || "Chat"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* AI Summary */}
      {timeline.summary ? (
        <div style={{
          padding: "10px 12px",
          borderRadius: "8px",
          background: "linear-gradient(135deg, rgba(188, 164, 227, 0.08), rgba(157, 123, 219, 0.05))",
          border: "1px solid var(--border-light)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
            <Sparkles style={{ width: "13px", height: "13px", color: "var(--color-primary)" }} />
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)" }}>
              Today's summary
            </span>
            <span style={{ fontSize: "0.625rem", marginLeft: "auto", color: "var(--text-light)" }}>
              {timeline.summary_generated_at?.slice(11, 16)}
            </span>
          </div>
          <p style={{
            fontSize: "0.8125rem", lineHeight: 1.6,
            color: "var(--text-secondary)", whiteSpace: "pre-line",
            margin: 0,
          }}>
            {timeline.summary}
          </p>
        </div>
      ) : (
        <button
          onClick={generateSummary}
          disabled={generating}
          style={{
            width: "100%", padding: "8px",
            borderRadius: "8px", fontSize: "0.8125rem",
            background: "var(--bg-hover)",
            border: "1px solid var(--border-light)",
            color: "var(--text-muted)",
            cursor: generating ? "not-allowed" : "pointer",
            opacity: generating ? 0.6 : 1,
          }}
        >
          {generating ? (
            <>
              <RefreshCw style={{
                width: "13px", height: "13px",
                display: "inline", verticalAlign: "middle",
                marginRight: "6px", animation: "spin 1s linear infinite",
              }} />
              Generating...
            </>
          ) : (
            <>
              <Sparkles style={{
                width: "13px", height: "13px",
                display: "inline", verticalAlign: "middle",
                marginRight: "6px", color: "var(--color-primary)",
              }} />
              Generate today's summary
            </>
          )}
        </button>
      )}
    </div>
  );
}
