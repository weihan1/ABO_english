// src/modules/dashboard/TodaySnapshot.tsx
// Section 1: Today's quick overview — activities, hourly heatmap, todo, wellness
import { Eye, Heart, Bookmark, MessageCircle, Zap, CheckCircle2, Brain } from "lucide-react";

interface ActivityCounts {
  total: number;
  views: number;
  likes: number;
  saves: number;
  dislikes: number;
  chats: number;
  module_runs: number;
}

interface HourlyActivity {
  hour: number;
  count: number;
}

interface TodoProgress {
  total: number;
  done: number;
  rate: number;
}

interface WellnessSnapshot {
  energy: number;
  san: number;
  happiness: number;
}

interface TopInteraction {
  id: string;
  title: string;
  action: string;
}

interface TodayData {
  date: string;
  activityCounts: ActivityCounts;
  hourlyHeatmap: HourlyActivity[];
  todoProgress: TodoProgress;
  wellness: WellnessSnapshot;
  summary: string | null;
  topInteractions: TopInteraction[];
}

export default function TodaySnapshot({ data }: { data: TodayData }) {
  const maxHourly = Math.max(...data.hourlyHeatmap.map((h) => h.count), 1);
  const now = new Date();
  const currentHour = now.getHours();

  // Determine greeting based on time
  const greeting =
    currentHour < 12 ? "Good Morning" : currentHour < 18 ? "Good Afternoon" : "Good Evening";

  const statItems = [
    { label: "Views", value: data.activityCounts.views, icon: Eye, color: "#9B7FD4" },
    { label: "Likes", value: data.activityCounts.likes, icon: Heart, color: "#FF6B6B" },
    { label: "Saves", value: data.activityCounts.saves, icon: Bookmark, color: "#F5C88C" },
    { label: "Chats", value: data.activityCounts.chats, icon: MessageCircle, color: "#7DD3C0" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Top row: Stats + Wellness */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* Activity Stats */}
        <div
          style={{
            background: "var(--bg-card)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-light)",
            padding: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                {greeting}
              </div>
              <div
                style={{
                  fontSize: "clamp(1.5rem, 2.5vw, 2rem)",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  fontFamily: "'M PLUS Rounded 1c', sans-serif",
                }}
              >
                {data.activityCounts.total}{" "}
                <span style={{ fontSize: "0.875rem", fontWeight: 400, color: "var(--text-muted)" }}>
                  interactions
                </span>
              </div>
            </div>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #BCA4E3, #9B7FD4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Zap style={{ width: "22px", height: "22px", color: "white" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
            {statItems.map((item) => (
              <div
                key={item.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 4px",
                  background: "var(--bg-hover)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <item.icon style={{ width: "16px", height: "16px", color: item.color }} />
                <span
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 700,
                    color: "var(--text-main)",
                    fontFamily: "'M PLUS Rounded 1c', sans-serif",
                  }}
                >
                  {item.value}
                </span>
                <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Wellness + Todo */}
        <div
          style={{
            background: "var(--bg-card)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-light)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {/* Wellness gauges */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
            {[
              { label: "Energy", value: data.wellness.energy, max: 100, color: "#A8E6CF", unit: "" },
              { label: "SAN", value: data.wellness.san, max: 100, color: "#BCA4E3", unit: "" },
              {
                label: "Happiness",
                value: data.wellness.happiness,
                max: 100,
                color: "#FFB7B2",
                unit: "",
              },
            ].map((g) => {
              const pct = Math.min((g.value / g.max) * 100, 100);
              return (
                <div
                  key={g.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {/* Circular gauge */}
                  <div style={{ position: "relative", width: "56px", height: "56px" }}>
                    <svg viewBox="0 0 36 36" style={{ width: "100%", height: "100%" }}>
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="var(--border-light)"
                        strokeWidth="3"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke={g.color}
                        strokeWidth="3"
                        strokeDasharray={`${pct}, 100`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "var(--text-main)",
                      }}
                    >
                      {typeof g.value === "number" ? (g.value % 1 === 0 ? g.value : g.value.toFixed(1)) : g.value}
                    </div>
                  </div>
                  <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                    {g.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Todo progress */}
          <div
            style={{
              padding: "12px 16px",
              background: "var(--bg-hover)",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <CheckCircle2
              style={{
                width: "18px",
                height: "18px",
                color: data.todoProgress.rate >= 1 ? "#5BA88C" : "var(--text-muted)",
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "6px",
                }}
              >
                <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)" }}>
                  Today's Tasks
                </span>
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  {data.todoProgress.done}/{data.todoProgress.total}
                </span>
              </div>
              <div
                style={{
                  height: "6px",
                  background: "var(--border-light)",
                  borderRadius: "var(--radius-full)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${data.todoProgress.rate * 100}%`,
                    background:
                      data.todoProgress.rate >= 1
                        ? "linear-gradient(90deg, #A8E6CF, #5BA88C)"
                        : "linear-gradient(90deg, #BCA4E3, #9B7FD4)",
                    borderRadius: "var(--radius-full)",
                    transition: "width 0.5s ease",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hourly Heatmap */}
      <div
        style={{
          background: "var(--bg-card)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-light)",
          padding: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "16px",
          }}
        >
          <Brain style={{ width: "16px", height: "16px", color: "var(--color-primary)" }} />
          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)" }}>
            Activity Heatmap
          </span>
          <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginLeft: "auto" }}>
            24h
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(24, 1fr)",
            gap: "3px",
            alignItems: "end",
            height: "60px",
          }}
        >
          {data.hourlyHeatmap.map((h) => {
            const height = h.count > 0 ? Math.max(20, (h.count / maxHourly) * 100) : 8;
            const isNow = h.hour === currentHour;
            const opacity = h.count > 0 ? 0.4 + (h.count / maxHourly) * 0.6 : 0.15;
            return (
              <div
                key={h.hour}
                title={`${h.hour}:00 — ${h.count} activities`}
                style={{
                  height: `${height}%`,
                  borderRadius: "2px 2px 0 0",
                  background: isNow
                    ? "linear-gradient(180deg, #BCA4E3, #9B7FD4)"
                    : `rgba(188, 164, 227, ${opacity})`,
                  border: isNow ? "1px solid #BCA4E3" : "none",
                  transition: "height 0.3s ease",
                  minHeight: "4px",
                }}
              />
            );
          })}
        </div>

        {/* Hour labels */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(24, 1fr)",
            gap: "3px",
            marginTop: "4px",
          }}
        >
          {data.hourlyHeatmap.map((h) => (
            <span
              key={h.hour}
              style={{
                fontSize: "0.5625rem",
                color: h.hour === currentHour ? "var(--color-primary)" : "var(--text-muted)",
                textAlign: "center",
                fontWeight: h.hour === currentHour ? 700 : 400,
              }}
            >
              {h.hour % 6 === 0 ? h.hour : ""}
            </span>
          ))}
        </div>
      </div>

      {/* Today's top interactions */}
      {data.topInteractions.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          {data.topInteractions.slice(0, 6).map((item) => (
            <div
              key={item.id}
              style={{
                padding: "6px 12px",
                background: "var(--bg-card)",
                border: "1px solid var(--border-light)",
                borderRadius: "var(--radius-full)",
                fontSize: "0.75rem",
                color: "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                maxWidth: "250px",
              }}
            >
              {item.action === "like" ? (
                <Heart style={{ width: "12px", height: "12px", color: "#FF6B6B" }} />
              ) : (
                <Bookmark style={{ width: "12px", height: "12px", color: "#F5C88C" }} />
              )}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* AI Summary */}
      {data.summary && (
        <div
          style={{
            padding: "16px 20px",
            background: "linear-gradient(135deg, rgba(188, 164, 227, 0.08), rgba(168, 230, 207, 0.08))",
            borderRadius: "var(--radius-md)",
            border: "1px solid rgba(188, 164, 227, 0.2)",
            fontSize: "0.8125rem",
            lineHeight: 1.7,
            color: "var(--text-secondary)",
          }}
        >
          <div
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: "var(--text-muted)",
              marginBottom: "8px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            AI Daily Summary
          </div>
          {data.summary}
        </div>
      )}
    </div>
  );
}
