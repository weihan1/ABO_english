// src/modules/dashboard/ReadingStats.tsx
import { Flame, Tag, BookOpen } from "lucide-react";

interface ReadingStatsProps {
  streak: number;
  topTags: [string, number][];
  thisWeek: number;
}

export default function ReadingStats({ streak, topTags, thisWeek }: ReadingStatsProps) {
  const maxTagCount = topTags.length > 0 ? topTags[0][1] : 1;

  return (
    <div style={{ padding: "20px 0" }}>
      {/* Streak Section */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "16px",
          background: "linear-gradient(135deg, rgba(255, 183, 178, 0.15), rgba(255, 183, 178, 0.05))",
          borderRadius: "var(--radius-md)",
          marginBottom: "24px",
          border: "1px solid rgba(255, 183, 178, 0.3)",
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #FFB7B2, #E89B96)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Flame style={{ width: "28px", height: "28px", color: "white" }} />
        </div>
        <div>
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: "#D48984",
              fontFamily: "'M PLUS Rounded 1c', sans-serif",
            }}
          >
            {streak} days
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "var(--text-muted)",
            }}
          >
            Reading streak
          </div>
        </div>
      </div>

      {/* Top Tags Section */}
      <div style={{ marginBottom: "24px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "16px",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "var(--text-main)",
          }}
        >
          <Tag style={{ width: "16px", height: "16px", color: "var(--color-primary)" }} />
          Top tags
        </div>

        {topTags.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "20px",
              color: "var(--text-muted)",
              fontSize: "0.8125rem",
            }}
          >
            No tag data yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {topTags.slice(0, 5).map(([tag, count], index) => (
              <div key={tag} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span
                  style={{
                    width: "24px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                  }}
                >
                  #{index + 1}
                </span>
                <span
                  style={{
                    width: "80px",
                    fontSize: "0.8125rem",
                    color: "var(--text-main)",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tag}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: "8px",
                    background: "var(--bg-hover)",
                    borderRadius: "var(--radius-full)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(count / maxTagCount) * 100}%`,
                      background:
                        index === 0
                          ? "linear-gradient(90deg, #FFB7B2, #E89B96)"
                          : index === 1
                          ? "linear-gradient(90deg, #FFE4B5, #F5C88C)"
                          : index === 2
                          ? "linear-gradient(90deg, #A8E6CF, #7DD3C0)"
                          : "linear-gradient(90deg, #BCA4E3, #9B7FD4)",
                      borderRadius: "var(--radius-full)",
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
                <span
                  style={{
                    width: "32px",
                    textAlign: "right",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}
                >
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weekly Stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "16px",
          background: "var(--bg-hover)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <BookOpen style={{ width: "20px", height: "20px", color: "var(--color-primary)" }} />
        <div>
          <div
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--text-main)",
            }}
          >
            Read {thisWeek} cards this week
          </div>
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: "2px",
            }}
          >
            {thisWeek > 0 ? "Keep it up!" : "Start reading"}
          </div>
        </div>
      </div>
    </div>
  );
}
