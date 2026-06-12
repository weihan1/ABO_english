// src/components/GamePanel.tsx
// Compact gamification status panel - XP, Level, Happiness, SAN

import { useEffect } from "react";
import { Heart, Brain, Zap, Trophy, Sparkles } from "lucide-react";
import { useStore } from "../core/store";
import { api } from "../core/api";

export default function GamePanel() {
  const { gameStats, todayXP, totalXP, level, setGameStats } = useStore();

  useEffect(() => {
    loadGameStats();
    const interval = setInterval(loadGameStats, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadGameStats() {
    try {
      const stats = await api.get<any>("/api/game/stats");
      setGameStats(stats);
    } catch (e) {
      console.error("Failed to load game stats:", e);
    }
  }

  const xpForCurrentLevel = (level - 1) * 100;
  const xpProgress = totalXP - xpForCurrentLevel;
  const xpToNextLevel = 100;
  const xpPct = Math.min(100, (xpProgress / xpToNextLevel) * 100);

  // SAN: san_7d_avg is already 0-100 scale, no need to multiply
  const sanValue = Math.min(100, Math.round(gameStats?.san_7d_avg || 0));
  const happinessValue = Math.min(100, Math.round(gameStats?.happiness || 0));
  const energyValue = Math.min(100, Math.round(gameStats?.energy || 70));
  const achievementCount = gameStats?.achievements?.length || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Level & XP - compact row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 14px", borderRadius: "10px",
        background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
        color: "white",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Trophy style={{ width: "16px", height: "16px", color: "var(--color-warning)", flexShrink: 0 }} />
          <span style={{ fontSize: "1.125rem", fontWeight: 700 }}>Lv.{level}</span>
          <span style={{ fontSize: "0.75rem", opacity: 0.75 }}>Researcher</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "0.75rem", opacity: 0.75 }}>Today</span>
          <span style={{ fontSize: "0.9375rem", fontWeight: 700 }}>+{todayXP} XP</span>
        </div>
      </div>

      {/* XP progress bar */}
      <div style={{ padding: "0 2px" }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "4px",
        }}>
          <span>Level progress</span>
          <span style={{ fontFamily: "monospace" }}>{xpProgress}/{xpToNextLevel}</span>
        </div>
        <div style={{
          height: "5px", borderRadius: "3px", overflow: "hidden",
          background: "var(--bg-hover)",
        }}>
          <div style={{
            height: "100%", borderRadius: "3px",
            width: `${xpPct}%`,
            background: "linear-gradient(90deg, var(--color-primary), var(--color-secondary))",
            transition: "width 0.5s ease",
          }} />
        </div>
      </div>

      {/* 4 stats - compact 2x2 grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <StatRow icon={<Heart style={{ width: "14px", height: "14px", color: "#E89B96" }} />}
          label="Happiness" value={happinessValue} max={100} color="#E89B96" />
        <StatRow icon={<Brain style={{ width: "14px", height: "14px", color: "#9D7BDB" }} />}
          label="Sanity" value={sanValue} max={100} color="#9D7BDB" />
        <StatRow icon={<Zap style={{ width: "14px", height: "14px", color: "#F59E0B" }} />}
          label="Energy" value={energyValue} max={100} color="#F59E0B" />
        <StatRow icon={<Sparkles style={{ width: "14px", height: "14px", color: "var(--color-primary)" }} />}
          label="Achievements" value={achievementCount} color="var(--color-primary)" />
      </div>

      {/* Total XP footer */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: "0.75rem", color: "var(--text-muted)", padding: "0 2px",
      }}>
        <span>Total XP</span>
        <span style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>
          {totalXP.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function StatRow({ icon, label, value, max, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  max?: number;
  color: string;
}) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px",
      padding: "8px 10px", borderRadius: "8px",
      background: "var(--bg-hover)",
    }}>
      <div style={{
        width: "28px", height: "28px", borderRadius: "7px",
        background: `${color}18`, display: "flex",
        alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
        }}>
          <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>{label}</span>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
            {value}{max ? <span style={{ fontSize: "0.6875rem", fontWeight: 400, color: "var(--text-light)" }}>/{max}</span> : null}
          </span>
        </div>
        {max && (
          <div style={{
            height: "3px", borderRadius: "2px", overflow: "hidden",
            background: "var(--bg-card)", marginTop: "4px",
          }}>
            <div style={{
              height: "100%", borderRadius: "2px",
              width: `${Math.max(3, pct)}%`,
              background: pct > 70 ? "#10B981" : pct > 40 ? "#F59E0B" : "#EF4444",
              transition: "width 0.5s ease",
            }} />
          </div>
        )}
      </div>
    </div>
  );
}
