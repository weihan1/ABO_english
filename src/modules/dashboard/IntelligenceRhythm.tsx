import { useMemo, useState } from "react";
import {
  Activity,
  BookOpenText,
  Clock3,
  Lightbulb,
  RadioTower,
  Sparkles,
} from "lucide-react";

interface InsightBucket {
  label: string;
  count: number;
  share: number;
  delta: number;
  examples: string[];
}

interface PreferenceSignal {
  keyword: string;
  score: number;
  count: number;
  sourceModules: string[];
}

interface HourlyRhythmPoint {
  hour: number;
  interaction: number;
  feed: number;
  combined: number;
}

interface WeekdayRhythmPoint {
  weekday: number;
  label: string;
  interaction: number;
  feed: number;
  combined: number;
}

interface PeakWindow {
  label: string;
  startHour: number;
  endHour: number;
  interactionCount: number;
  feedCount: number;
}

interface InsightHighlight {
  title: string;
  moduleId: string;
  moduleLabel: string;
  detail: string;
  createdAt: string;
}

interface InsightSuggestion {
  kind: string;
  title: string;
  detail: string;
}

export interface IntelligenceRhythmData {
  windowDays: number;
  recentFeedCount: number;
  recentInteractionCount: number;
  activeDays: number;
  latestSignalDate: string;
  cadenceLabel: string;
  rhythmSource: string;
  summary: string;
  peakWindow: PeakWindow;
  feedMix: InsightBucket[];
  themeMix: InsightBucket[];
  paperMix: InsightBucket[];
  preferences: PreferenceSignal[];
  hourlyRhythm: HourlyRhythmPoint[];
  weekdayRhythm: WeekdayRhythmPoint[];
  highlights: InsightHighlight[];
  suggestions: InsightSuggestion[];
}

type Lens = "rhythm" | "themes" | "papers";
type RhythmMode = "combined" | "interaction" | "feed";

const LENS_OPTIONS: Array<{ id: Lens; label: string; icon: typeof Clock3 }> = [
  { id: "rhythm", label: "Rhythm", icon: Clock3 },
  { id: "themes", label: "Themes", icon: Sparkles },
  { id: "papers", label: "Papers", icon: BookOpenText },
];

const RHYTHM_MODE_LABELS: Record<RhythmMode, string> = {
  combined: "Combined",
  interaction: "Your actions",
  feed: "Intel inflow",
};

const PALETTE = ["#2F7F73", "#E16A54", "#C89A2A", "#4D8CBF", "#A45D78", "#567D46"];

function formatShare(value: number) {
  return `${Math.round(value * 100)}%`;
}

function deltaLabel(delta: number) {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return "Flat";
}

function isPeakHour(hour: number, peakWindow: PeakWindow) {
  if (peakWindow.startHour < peakWindow.endHour) {
    return hour >= peakWindow.startHour && hour < peakWindow.endHour;
  }
  return hour >= peakWindow.startHour || hour < peakWindow.endHour;
}

function insightSurfaceStyle() {
  return {
    background: "var(--bg-hover)",
    border: "1px solid var(--border-light)",
    borderRadius: "8px",
  } as const;
}

function renderBucketList(
  buckets: InsightBucket[],
  emptyText: string,
  compact = false
) {
  if (buckets.length === 0) {
    return (
      <div
        style={{
          ...insightSurfaceStyle(),
          padding: "18px 16px",
          color: "var(--text-muted)",
          fontSize: "0.8125rem",
          lineHeight: 1.7,
        }}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? "10px" : "12px" }}>
      {buckets.map((bucket, index) => (
        <div
          key={bucket.label}
          style={{
            ...insightSurfaceStyle(),
            padding: compact ? "12px 14px" : "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "12px",
              marginBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "999px",
                  background: PALETTE[index % PALETTE.length],
                  flexShrink: 0,
                }}
              />
              <div
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "var(--text-main)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {bucket.label}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {bucket.count}
              </span>
              <span
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  color:
                    bucket.delta > 0
                      ? "#2F7F73"
                      : bucket.delta < 0
                        ? "#E16A54"
                        : "var(--text-muted)",
                }}
              >
                {deltaLabel(bucket.delta)}
              </span>
            </div>
          </div>

          <div
            style={{
              height: "7px",
              borderRadius: "999px",
              overflow: "hidden",
              background: "rgba(47, 127, 115, 0.09)",
              marginBottom: bucket.examples.length > 0 ? "8px" : 0,
            }}
          >
            <div
              style={{
                width: `${Math.max(bucket.share * 100, 6)}%`,
                height: "100%",
                borderRadius: "999px",
                background: PALETTE[index % PALETTE.length],
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {formatShare(bucket.share)}
            </span>
            {bucket.examples.map((example) => (
              <span
                key={example}
                style={{
                  fontSize: "0.6875rem",
                  color: "var(--text-secondary)",
                  background: "rgba(0, 0, 0, 0.04)",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={example}
              >
                {example}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function IntelligenceRhythm({ data }: { data: IntelligenceRhythmData }) {
  const [lens, setLens] = useState<Lens>("rhythm");
  const [rhythmMode, setRhythmMode] = useState<RhythmMode>(
    data.rhythmSource === "feed"
      ? "feed"
      : data.rhythmSource === "interaction"
        ? "interaction"
        : "combined"
  );

  const hourlyMax = useMemo(() => {
    return Math.max(
      ...data.hourlyRhythm.map((point) => {
        if (rhythmMode === "interaction") return point.interaction;
        if (rhythmMode === "feed") return point.feed;
        return point.combined;
      }),
      1
    );
  }, [data.hourlyRhythm, rhythmMode]);

  const weekdayMax = useMemo(() => {
    return Math.max(
      ...data.weekdayRhythm.map((point) => {
        if (rhythmMode === "interaction") return point.interaction;
        if (rhythmMode === "feed") return point.feed;
        return point.combined;
      }),
      1
    );
  }, [data.weekdayRhythm, rhythmMode]);

  const rhythmColor =
    rhythmMode === "interaction"
      ? "#E16A54"
      : rhythmMode === "feed"
        ? "#C89A2A"
        : "#2F7F73";

  const topStats = [
    { label: "Recent intel", value: `${data.recentFeedCount}` },
    { label: "Interactions", value: `${data.recentInteractionCount}` },
    { label: "Active days", value: `${data.activeDays}` },
    { label: "Peak window", value: data.peakWindow.label },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div
        style={{
          ...insightSurfaceStyle(),
          padding: "18px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          background:
            "linear-gradient(135deg, rgba(47, 127, 115, 0.09), rgba(225, 106, 84, 0.05) 48%, rgba(200, 154, 42, 0.06))",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 360px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "5px 10px",
                borderRadius: "999px",
                background: "rgba(255, 255, 255, 0.72)",
                border: "1px solid rgba(47, 127, 115, 0.12)",
                marginBottom: "10px",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "#2F7F73",
              }}
            >
              <RadioTower style={{ width: "14px", height: "14px" }} />
              Intel mirror of the last {data.windowDays} days
            </div>
            <div
              style={{
                fontSize: "0.9375rem",
                lineHeight: 1.75,
                color: "var(--text-main)",
              }}
            >
              {data.summary}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: "8px",
              minWidth: "180px",
            }}
          >
            <div
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                background: "rgba(255, 255, 255, 0.78)",
                border: "1px solid rgba(0, 0, 0, 0.06)",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--text-main)",
              }}
            >
              {data.cadenceLabel}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Data through {data.latestSignalDate}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          {topStats.map((stat) => (
            <div
              key={stat.label}
              style={{
                background: "rgba(255, 255, 255, 0.72)",
                border: "1px solid rgba(0, 0, 0, 0.05)",
                borderRadius: "8px",
                padding: "10px 12px",
                minWidth: "110px",
              }}
            >
              <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                {stat.label}
              </div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {LENS_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = lens === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setLens(option.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                borderRadius: "8px",
                border: active ? `1px solid ${rhythmColor}33` : "1px solid var(--border-light)",
                background: active ? `${rhythmColor}14` : "var(--bg-card)",
                color: active ? "var(--text-main)" : "var(--text-secondary)",
                padding: "8px 12px",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Icon style={{ width: "15px", height: "15px" }} />
              {option.label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
          {lens === "rhythm" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {(["combined", "interaction", "feed"] as RhythmMode[]).map((mode) => {
                  const active = rhythmMode === mode;
                  const color =
                    mode === "interaction" ? "#E16A54" : mode === "feed" ? "#C89A2A" : "#2F7F73";
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setRhythmMode(mode)}
                      style={{
                        borderRadius: "8px",
                        border: active ? `1px solid ${color}44` : "1px solid var(--border-light)",
                        background: active ? `${color}14` : "transparent",
                        color: active ? color : "var(--text-secondary)",
                        padding: "7px 11px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {RHYTHM_MODE_LABELS[mode]}
                    </button>
                  );
                })}
              </div>

              <div style={{ ...insightSurfaceStyle(), padding: "16px 16px 14px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    marginBottom: "14px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Activity style={{ width: "16px", height: "16px", color: rhythmColor }} />
                    <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                      24-hour distribution
                    </span>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Peak {data.peakWindow.label}
                  </span>
                </div>

                <div
                  style={{
                    height: "150px",
                    display: "grid",
                    gridTemplateColumns: "repeat(24, minmax(0, 1fr))",
                    gap: "4px",
                    alignItems: "end",
                  }}
                >
                  {data.hourlyRhythm.map((point) => {
                    const raw =
                      rhythmMode === "interaction"
                        ? point.interaction
                        : rhythmMode === "feed"
                          ? point.feed
                          : point.combined;
                    const ratio = raw / hourlyMax;
                    return (
                      <div
                        key={point.hour}
                        title={`${point.hour}:00 · ${RHYTHM_MODE_LABELS[rhythmMode]} ${raw}`}
                        style={{
                          height: `${Math.max(10, ratio * 100)}%`,
                          minHeight: "8px",
                          borderRadius: "4px 4px 0 0",
                          background:
                            isPeakHour(point.hour, data.peakWindow)
                              ? rhythmColor
                              : `${rhythmColor}${raw > 0 ? "AA" : "22"}`,
                          border:
                            isPeakHour(point.hour, data.peakWindow)
                              ? `1px solid ${rhythmColor}`
                              : "1px solid transparent",
                        }}
                      />
                    );
                  })}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(24, minmax(0, 1fr))",
                    gap: "4px",
                    marginTop: "6px",
                  }}
                >
                  {data.hourlyRhythm.map((point) => (
                    <div
                      key={point.hour}
                      style={{
                        fontSize: "0.625rem",
                        color: "var(--text-muted)",
                        textAlign: "center",
                      }}
                    >
                      {point.hour % 4 === 0 ? `${point.hour}` : ""}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...insightSurfaceStyle(), padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                  <Clock3 style={{ width: "16px", height: "16px", color: rhythmColor }} />
                  <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                    Weekly distribution
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "10px" }}>
                  {data.weekdayRhythm.map((point) => {
                    const raw =
                      rhythmMode === "interaction"
                        ? point.interaction
                        : rhythmMode === "feed"
                          ? point.feed
                          : point.combined;
                    const ratio = raw / weekdayMax;
                    return (
                      <div key={point.weekday} style={{ textAlign: "center" }}>
                        <div
                          style={{
                            height: "84px",
                            display: "flex",
                            alignItems: "flex-end",
                            justifyContent: "center",
                            marginBottom: "8px",
                          }}
                        >
                          <div
                            title={`${point.label} · ${raw}`}
                            style={{
                              width: "100%",
                              maxWidth: "34px",
                              height: `${Math.max(10, ratio * 100)}%`,
                              minHeight: "8px",
                              borderRadius: "6px 6px 0 0",
                              background: `${rhythmColor}${raw > 0 ? "CC" : "20"}`,
                            }}
                          />
                        </div>
                        <div style={{ fontSize: "0.6875rem", color: "var(--text-secondary)" }}>{point.label}</div>
                        <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>{raw}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {lens === "themes" && (
            <>
              <div>
                <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "10px" }}>
                  Module activity
                </div>
                {renderBucketList(data.feedMix, "No stable source structure has formed in the recent window yet.", true)}
              </div>

              <div>
                <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "10px" }}>
                  Smart groups / keyword echoes
                </div>
                {renderBucketList(
                  data.themeMix,
                  "Not enough group or keyword signals captured yet. As you keep using the Feed, life facets will gradually emerge."
                )}
              </div>

              <div style={{ ...insightSurfaceStyle(), padding: "16px" }}>
                <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "12px" }}>
                  Feedback bias
                </div>
                {data.preferences.length === 0 ? (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                    No stable preference feedback yet. Give cards more like / save / dislike and the profile will better track your recent interest shifts.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {data.preferences.map((preference, index) => (
                      <div
                        key={preference.keyword}
                        style={{
                          borderRadius: "8px",
                          padding: "10px 12px",
                          background: `${PALETTE[index % PALETTE.length]}14`,
                          border: `1px solid ${PALETTE[index % PALETTE.length]}33`,
                          minWidth: "120px",
                        }}
                      >
                        <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)" }}>
                          {preference.keyword}
                        </div>
                        <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: "3px" }}>
                          score {preference.score.toFixed(2)} · {preference.count}x
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {lens === "papers" && (
            <>
              <div>
                <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "10px" }}>
                  Recent paper categories
                </div>
                {renderBucketList(
                  data.paperMix,
                  "No clear paper-category focus has formed in the recent window yet."
                )}
              </div>

              <div style={{ ...insightSurfaceStyle(), padding: "16px" }}>
                <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "12px" }}>
                  Paper feedback hint
                </div>
                <div style={{ display: "grid", gap: "10px" }}>
                  {data.paperMix.slice(0, 3).map((bucket, index) => (
                    <div
                      key={bucket.label}
                      style={{
                        padding: "12px 14px",
                        borderRadius: "8px",
                        background: `${PALETTE[index % PALETTE.length]}10`,
                        border: `1px solid ${PALETTE[index % PALETTE.length]}2D`,
                      }}
                    >
                      <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                        {bucket.label}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                        Recent share {formatShare(bucket.share)}, vs. the previous window {deltaLabel(bucket.delta)}.
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
          <div style={{ ...insightSurfaceStyle(), padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <Lightbulb style={{ width: "16px", height: "16px", color: "#C89A2A" }} />
              <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                Basic suggestions
              </span>
            </div>

            {data.suggestions.length === 0 ? (
              <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                There isn't enough data yet — keep using it for a few days and it will become a truer mirror of your life.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {data.suggestions.map((suggestion, index) => (
                  <div
                    key={`${suggestion.kind}-${index}`}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "8px",
                      background: `${PALETTE[index % PALETTE.length]}10`,
                      border: `1px solid ${PALETTE[index % PALETTE.length]}24`,
                    }}
                  >
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                      {suggestion.title}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                      {suggestion.detail}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ ...insightSurfaceStyle(), padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <Sparkles style={{ width: "16px", height: "16px", color: "#2F7F73" }} />
              <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                Recent samples
              </span>
            </div>

            {data.highlights.length === 0 ? (
              <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                Not enough new samples in this period yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {data.highlights.map((highlight, index) => (
                  <div
                    key={`${highlight.moduleId}-${highlight.title}-${index}`}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-light)",
                      background: "rgba(255, 255, 255, 0.45)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.6875rem",
                          color: "var(--text-muted)",
                          padding: "4px 7px",
                          borderRadius: "999px",
                          background: "var(--bg-hover)",
                          border: "1px solid var(--border-light)",
                        }}
                      >
                        {highlight.moduleLabel}
                      </span>
                      <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                        {highlight.createdAt.slice(5, 16).replace("T", " ")}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        color: "var(--text-main)",
                        lineHeight: 1.5,
                        marginBottom: "4px",
                      }}
                    >
                      {highlight.title}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      {highlight.detail}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
