// src/components/RewardNotification.tsx
// Phase 4: Real-time reward notifications with animation

import { useEffect } from "react";
import { X, Sparkles, Heart, Brain } from "lucide-react";
import { useStore } from "../core/store";

interface RewardToastProps {
  id: string;
  action: string;
  xp: number;
  happiness_delta: number;
  san_delta: number;
  message?: string;
}

function RewardToast({
  id,
  action,
  xp,
  happiness_delta,
  san_delta,
  message,
}: RewardToastProps) {
  const { dismissReward, addXP } = useStore();

  useEffect(() => {
    // Add XP to global counter
    if (xp > 0) {
      addXP(xp);
    }

    // Auto dismiss after 5 seconds
    const timer = setTimeout(() => {
      dismissReward(id);
    }, 5000);

    return () => clearTimeout(timer);
  }, [id, xp, addXP, dismissReward]);

  const actionNames: Record<string, string> = {
    card_like: "Liked content",
    card_save: "Saved content",
    card_dislike: "Marked as disliked",
    star_paper: "Starred paper",
    save_paper: "Saved paper",
    read_paper: "Read paper",
    daily_checkin: "Daily check-in",
    like_content: "Liked content",
  };

  return (
    <div
      className="relative overflow-hidden rounded-xl p-4 shadow-2xl border animate-in slide-in-from-right-full"
      style={{
        background: `linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))`,
        borderColor: "var(--color-primary-light)",
        color: "white",
      }}
    >
      {/* Sparkle background effect */}
      <div className="absolute inset-0 opacity-20">
        <div
          className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl"
          style={{ background: "var(--bg-hover)" }}
        />
      </div>

      <div className="relative flex items-start gap-3">
        <div
          className="p-2 rounded-lg"
          style={{ background: "rgba(255,255,255,0.2)" }}
        >
          <Sparkles className="w-6 h-6" style={{ color: "var(--color-warning)" }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold">{actionNames[action] || action}</span>
            <span
              className="px-2 py-0.5 rounded text-sm font-bold"
              style={{ background: "rgba(255,255,255,0.2)", color: "var(--color-warning)" }}
            >
              +{xp} XP
            </span>
          </div>

          {message && (
            <p className="text-sm mt-1 truncate" style={{ opacity: 0.9 }}>
              {message}
            </p>
          )}

          {/* Stats deltas */}
          <div className="flex items-center gap-3 mt-2 text-xs">
            {happiness_delta > 0 && (
              <span className="flex items-center gap-1" style={{ color: "var(--color-secondary)" }}>
                <Heart className="w-3 h-3" />+{happiness_delta} happiness
              </span>
            )}
            {happiness_delta < 0 && (
              <span className="flex items-center gap-1" style={{ opacity: 0.7 }}>
                <Heart className="w-3 h-3" />
                {happiness_delta} happiness
              </span>
            )}
            {san_delta > 0 && (
              <span className="flex items-center gap-1" style={{ color: "var(--color-accent)" }}>
                <Brain className="w-3 h-3" />+{san_delta} SAN
              </span>
            )}
            {san_delta < 0 && (
              <span className="flex items-center gap-1" style={{ opacity: 0.7 }}>
                <Brain className="w-3 h-3" />
                {san_delta} SAN
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => dismissReward(id)}
          className="p-1 rounded transition-colors hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.1)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function RewardNotificationContainer() {
  const { rewardQueue } = useStore();

  if (rewardQueue.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] w-80 space-y-2 pointer-events-auto">
      {rewardQueue.map((reward) => (
        <RewardToast key={reward.id} {...reward} />
      ))}
    </div>
  );
}
