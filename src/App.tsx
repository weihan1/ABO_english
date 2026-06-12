import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import NavSidebar from "./modules/nav/NavSidebar";
import MainContent from "./modules/MainContent";
import ToastContainer from "./components/Toast";
import RewardNotificationContainer from "./components/RewardNotification";
import OnboardingWizard from "./modules/onboarding/OnboardingWizard";
import { CommandPalette } from "./components/CommandPalette";
import { GlobalSearch } from "./components/Search";
import WindowDragHandle from "./components/WindowDragHandle";
import HealthReminderDaemon from "./components/HealthReminderDaemon";
import { useStore, FeedCard, FeedModule } from "./core/store";
import { api, buildWsUrl } from "./core/api";
import { bilibiliCancelAllKnownTasksSilently } from "./api/bilibili";
import AppErrorBoundary from "./components/AppErrorBoundary";
import { FEED_WS_MESSAGE_EVENT } from "./core/feedRealtime";

const FEED_SYNC_LIMIT = 500;
const FEED_IDLE_SYNC_INTERVAL_MS = 12000;
const FEED_ACTIVE_SYNC_INTERVAL_MS = 3500;
const FEED_ACTIVE_SYNC_BOOST_MS = 30000;
const LOADING_MEME_ROTATE_MS = 3200;

type LoadingMeme = {
  label: string;
  src: string;
};

const loadingMemeModules = import.meta.glob(
  ["../docs/meme/*.{png,jpg,jpeg,webp,avif}", "!../docs/meme/16x.png"],
  {
    eager: true,
    import: "default",
  },
) as Record<string, string>;

const LOADING_MEMES: LoadingMeme[] = Object.entries(loadingMemeModules)
  .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath, "zh-Hans-CN"))
  .map(([path, src]) => ({
    label: path.split("/").pop()?.replace(/\.[^.]+$/, "") || "ABO",
    src,
  }));

interface AppConfig {
  vault_path: string;
  literature_path?: string;
  version: string;
  ai_provider?: "codex" | "claude";
  claude_code_compat_enabled?: boolean;
  paper_ai_scoring_enabled?: boolean;
  intelligence_delivery_enabled?: boolean;
  intelligence_delivery_time?: string;
  onboarding_completed?: boolean;
  onboarding_step?: number;
  feed_preferences?: {
    hidden_module_ids?: string[];
    group_mode?: "timeline" | "smart";
    show_recommendations?: boolean;
  };
}

function AppLoadingScreen({
  currentMeme,
  isTauriRuntime,
  memeIndex,
}: {
  currentMeme: LoadingMeme | null;
  isTauriRuntime: boolean;
  memeIndex: number;
}) {
  const memeLabel = currentMeme?.label === "base" ? "ABO expression set" : currentMeme?.label || "ABO";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: `
          radial-gradient(circle at 16% 18%, rgba(122, 157, 184, 0.16), transparent 26%),
          radial-gradient(circle at 86% 14%, rgba(250, 210, 132, 0.18), transparent 24%),
          linear-gradient(180deg, color-mix(in srgb, var(--bg-app) 92%, #f7f0e3 8%) 0%, var(--bg-app) 100%)
        `,
      }}
    >
      <WindowDragHandle />
      <div className="boot-orb boot-orb-left" />
      <div className="boot-orb boot-orb-right" />
      <div className="boot-shell">
        <section className="boot-copy">
          <div className="boot-kicker">ABO is starting</div>
          <h1 className="boot-title">Opening the desktop shell first, then waking up your local brain.</h1>
          <p className="boot-summary">
            First launch may take 10-60s. Subsequent launches are usually faster.
          </p>
          <div className="boot-status-card">
            <div className="boot-spinner" aria-hidden />
            <div style={{ display: "grid", gap: "6px" }}>
              <strong className="boot-status-title">Connecting to local backend</strong>
              <span className="boot-status-text">
                {isTauriRuntime
                  ? "The packaged app starts the local service automatically; once ready you’ll land in the workspace."
                  : "Loading the current view."}
              </span>
            </div>
          </div>
          <div className="boot-meta-row">
            <span className="boot-pill">{memeLabel}</span>
            <span className="boot-count">
              {String(memeIndex + 1).padStart(2, "0")} / {String(LOADING_MEMES.length).padStart(2, "0")}
            </span>
          </div>
        </section>

        <section className="boot-stage" aria-label="ABO startup carousel">
          <div className="boot-stage-frame">
            {LOADING_MEMES.map((meme, index) => {
              const active = index === memeIndex;
              return (
                <figure
                  key={meme.label}
                  className={`boot-slide${active ? " is-active" : ""}`}
                  aria-hidden={!active}
                >
                  <img src={meme.src} alt={`ABO startup image: ${meme.label}`} />
                </figure>
              );
            })}
          </div>
        </section>
      </div>
      <style>{`
        .boot-shell {
          position: relative;
          z-index: 1;
          width: min(1080px, calc(100vw - 32px));
          display: grid;
          grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
          gap: clamp(20px, 4vw, 44px);
          align-items: center;
        }

        .boot-copy {
          display: grid;
          gap: clamp(16px, 2vw, 24px);
          align-content: center;
        }

        .boot-kicker {
          width: fit-content;
          padding: 7px 12px;
          border-radius: 999px;
          background: rgba(122, 157, 184, 0.14);
          border: 1px solid rgba(122, 157, 184, 0.2);
          color: color-mix(in srgb, var(--text-main) 72%, #6d8faa 28%);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .boot-title {
          margin: 0;
          max-width: 10ch;
          font-size: clamp(2rem, 4.8vw, 3.6rem);
          line-height: 0.94;
          letter-spacing: -0.04em;
          color: var(--text-main);
        }

        .boot-summary {
          margin: 0;
          max-width: 30ch;
          font-size: clamp(0.98rem, 1.7vw, 1.08rem);
          line-height: 1.75;
          color: var(--text-secondary);
        }

        .boot-status-card {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 14px;
          align-items: center;
          padding: 16px 18px;
          border-radius: 22px;
          background: rgba(255, 250, 241, 0.72);
          border: 1px solid rgba(122, 157, 184, 0.14);
          box-shadow: 0 18px 36px rgba(81, 68, 56, 0.08);
          backdrop-filter: blur(12px);
        }

        .boot-spinner {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 3px solid rgba(122, 157, 184, 0.18);
          border-top-color: var(--color-primary);
          animation: boot-spin 1s linear infinite;
        }

        .boot-status-title {
          font-size: 0.95rem;
          color: var(--text-main);
        }

        .boot-status-text {
          color: var(--text-secondary);
          font-size: 0.84rem;
          line-height: 1.6;
        }

        .boot-meta-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .boot-pill,
        .boot-count {
          display: inline-flex;
          align-items: center;
          min-height: 34px;
          padding: 0 14px;
          border-radius: 999px;
          background: rgba(255, 250, 241, 0.72);
          border: 1px solid rgba(122, 157, 184, 0.14);
          color: var(--text-secondary);
          font-size: 0.82rem;
          font-weight: 700;
          box-shadow: 0 14px 28px rgba(81, 68, 56, 0.06);
        }

        .boot-stage {
          min-width: 0;
        }

        .boot-stage-frame {
          position: relative;
          overflow: hidden;
          width: 100%;
          aspect-ratio: 1 / 1;
          border-radius: clamp(26px, 4vw, 36px);
          background:
            linear-gradient(180deg, rgba(255, 249, 239, 0.96) 0%, rgba(248, 240, 226, 0.98) 100%);
          border: 1px solid rgba(122, 157, 184, 0.14);
          box-shadow:
            0 28px 60px rgba(81, 68, 56, 0.14),
            inset 0 1px 0 rgba(255, 255, 255, 0.7);
          isolation: isolate;
        }

        .boot-stage-frame::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 16% 12%, rgba(122, 157, 184, 0.16), transparent 24%),
            radial-gradient(circle at 84% 18%, rgba(250, 210, 132, 0.18), transparent 22%);
          pointer-events: none;
        }

        .boot-slide {
          position: absolute;
          inset: 0;
          margin: 0;
          opacity: 0;
          transform: scale(1.06);
          transition:
            opacity 680ms ease,
            transform ${LOADING_MEME_ROTATE_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .boot-slide.is-active {
          opacity: 1;
          transform: scale(1);
        }

        .boot-slide img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          display: block;
        }

        .boot-orb {
          position: absolute;
          width: clamp(220px, 28vw, 360px);
          aspect-ratio: 1 / 1;
          border-radius: 50%;
          pointer-events: none;
          filter: blur(12px);
          opacity: 0.42;
        }

        .boot-orb-left {
          top: -8%;
          left: -8%;
          background: radial-gradient(circle, rgba(122, 157, 184, 0.34), transparent 70%);
        }

        .boot-orb-right {
          right: -8%;
          bottom: -12%;
          background: radial-gradient(circle, rgba(250, 210, 132, 0.34), transparent 70%);
        }

        @keyframes boot-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @media (max-width: 860px) {
          .boot-shell {
            width: min(720px, calc(100vw - 24px));
            grid-template-columns: 1fr;
            gap: 18px;
          }

          .boot-copy {
            justify-items: center;
            text-align: center;
          }

          .boot-title,
          .boot-summary {
            max-width: none;
          }

          .boot-status-card {
            text-align: left;
            width: min(100%, 520px);
          }

          .boot-meta-row {
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  const setConfig = useStore((s) => s.setConfig);
  const setAiProvider = useStore((s) => s.setAiProvider);
  const addToast = useStore((s) => s.addToast);
  const setFeedModules = useStore((s) => s.setFeedModules);
  const setFeedCards = useStore((s) => s.setFeedCards);
  const prependCard = useStore((s) => s.prependCard);
  const setUnreadCounts = useStore((s) => s.setUnreadCounts);
  const setFeedRealtimeStatus = useStore((s) => s.setFeedRealtimeStatus);
  const showcaseMode = useStore((s) => s.showcaseMode);
  const activeTab = useStore((s) => s.activeTab);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMemeIndex, setLoadingMemeIndex] = useState(0);
  const [bootError, setBootError] = useState("");
  const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const bootTimeoutMs = isTauriRuntime ? 60_000 : 20_000;
  const bootRetryIntervalMs = isTauriRuntime ? 250 : 150;
  const currentLoadingMeme = LOADING_MEMES[loadingMemeIndex] ?? null;

  // Sync showcase class on mount and changes
  useEffect(() => {
    document.documentElement.classList.toggle("showcase", showcaseMode);
  }, [showcaseMode]);

  useEffect(() => {
    if (!isLoading || LOADING_MEMES.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setLoadingMemeIndex((current) => (current + 1) % LOADING_MEMES.length);
    }, LOADING_MEME_ROTATE_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [isLoading]);

  // Check onboarding status on mount.
  // First-run users should see the wizard unless config explicitly marks it completed.
  useEffect(() => {
    const loadAppConfig = async () => {
      try {
        setBootError("");
        const config = await api.waitForGet<AppConfig>("/api/config", {
          timeoutMs: bootTimeoutMs,
          intervalMs: bootRetryIntervalMs,
        });
        setConfig(config);
        setAiProvider(
          config.ai_provider === "claude" && config.claude_code_compat_enabled
            ? "claude"
            : "codex",
        );
        setOnboardingCompleted(config.onboarding_completed ?? false);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Backend failed to start";
        setBootError(message);
        setOnboardingCompleted(null);
      } finally {
        setIsLoading(false);
      }
    };

    void loadAppConfig();

    const handleOnboardingConfigChange = () => {
      setIsLoading(true);
      void loadAppConfig();
    };
    window.addEventListener("abo:onboarding-status-updated", handleOnboardingConfigChange);
    return () => {
      window.removeEventListener("abo:onboarding-status-updated", handleOnboardingConfigChange);
    };
  }, [bootRetryIntervalMs, bootTimeoutMs, setAiProvider, setConfig]);

  // Load modules on app start so FeedSidebar shows all modules
  useEffect(() => {
    if (onboardingCompleted) {
      api.get<{ modules: FeedModule[] }>("/api/modules")
        .then((r) => setFeedModules(r.modules))
        .catch(() => {});
    }
  }, [setFeedModules, onboardingCompleted]);

  useEffect(() => {
    if (!onboardingCompleted) return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let syncTimer: number | null = null;
    let activeSyncBoostUntil = 0;
    const burstSyncTimers = new Set<number>();

    const clearHeartbeat = () => {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const clearSyncTimer = () => {
      if (syncTimer !== null) {
        window.clearTimeout(syncTimer);
        syncTimer = null;
      }
    };

    const clearBurstSyncTimers = () => {
      burstSyncTimers.forEach((timerId) => window.clearTimeout(timerId));
      burstSyncTimers.clear();
    };

    const syncFeedState = async () => {
      const [cardsResult, unreadCountsResult] = await Promise.allSettled([
        api.get<{ cards: FeedCard[] }>(`/api/cards?unread_only=true&limit=${FEED_SYNC_LIMIT}`),
        api.get<Record<string, number>>("/api/cards/unread-counts"),
      ]);

      if (cardsResult.status === "fulfilled") {
        setFeedCards(cardsResult.value.cards || []);
      }
      if (unreadCountsResult.status === "fulfilled") {
        setUnreadCounts(unreadCountsResult.value || {});
      }
    };

    const scheduleNextPeriodicSync = () => {
      if (disposed) return;
      clearSyncTimer();
      const nextDelay = Date.now() < activeSyncBoostUntil
        ? FEED_ACTIVE_SYNC_INTERVAL_MS
        : FEED_IDLE_SYNC_INTERVAL_MS;
      syncTimer = window.setTimeout(() => {
        syncTimer = null;
        void syncFeedState().finally(() => {
          scheduleNextPeriodicSync();
        });
      }, nextDelay);
    };

    const startActiveSyncBoost = (durationMs = FEED_ACTIVE_SYNC_BOOST_MS) => {
      activeSyncBoostUntil = Math.max(activeSyncBoostUntil, Date.now() + durationMs);
      scheduleNextPeriodicSync();
    };

    const scheduleSyncBurst = (delays: number[]) => {
      delays.forEach((delayMs) => {
        const timerId = window.setTimeout(() => {
          burstSyncTimers.delete(timerId);
          if (disposed) return;
          void syncFeedState();
        }, delayMs);
        burstSyncTimers.add(timerId);
      });
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      setFeedRealtimeStatus("reconnecting");
      startActiveSyncBoost(15000);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectRealtimeFeed();
      }, 1500);
    };

    const connectRealtimeFeed = () => {
      if (disposed) return;
      clearHeartbeat();
      setFeedRealtimeStatus(reconnectTimer === null ? "connecting" : "reconnecting");
      ws = new WebSocket(buildWsUrl("/ws/feed"));

      ws.onopen = () => {
        setFeedRealtimeStatus("connected");
        clearHeartbeat();
        startActiveSyncBoost(10000);
        scheduleSyncBurst([400, 1400]);
        heartbeatTimer = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "ping",
              timestamp: new Date().toISOString(),
            }));
          }
        }, 15000);
        void syncFeedState();
      };

      ws.onclose = () => {
        clearHeartbeat();
        if (disposed) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (disposed) return;
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          ws.close();
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "pong") {
            return;
          }
          window.dispatchEvent(new CustomEvent(FEED_WS_MESSAGE_EVENT, { detail: data }));
          if (data.type === "new_card" && data.card) {
            startActiveSyncBoost();
            scheduleSyncBurst([250, 1000, 2500]);
            const nextCard = data.card;
            const store = useStore.getState();
            const alreadyExists = store.feedCards.some((card) => card.id === nextCard.id);
            prependCard(nextCard);
            if (!alreadyExists) {
              setUnreadCounts({
                ...store.unreadCounts,
                [nextCard.module_id]: (store.unreadCounts[nextCard.module_id] || 0) + 1,
              });
            }
          }
          if (
            data.type === "crawl_started"
            || data.type === "crawl_progress"
            || data.type === "s2_progress"
          ) {
            startActiveSyncBoost();
          }
          if (
            data.type === "crawl_complete"
            || data.type === "crawl_error"
            || data.type === "crawl_cancelled"
            || data.type === "s2_complete"
            || data.type === "s2_error"
          ) {
            startActiveSyncBoost(12000);
            scheduleSyncBurst([300, 1200, 3500]);
          }
          if (data.type === "reward_earned") {
            useStore.getState().addReward({
              action: data.action,
              xp: data.rewards?.xp || 0,
              happiness_delta: data.rewards?.happiness_delta || 0,
              san_delta: data.rewards?.san_delta || 0,
              message: data.metadata?.card_title || "",
            });
          }
        } catch {
          // Ignore malformed realtime payloads; the next full sync will correct state.
        }
      };
    };

    connectRealtimeFeed();
    startActiveSyncBoost(10000);
    scheduleNextPeriodicSync();

    const handleWindowFocus = () => {
      startActiveSyncBoost(10000);
      void syncFeedState();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startActiveSyncBoost(10000);
        void syncFeedState();
      }
    };
    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      clearHeartbeat();
      clearSyncTimer();
      clearBurstSyncTimers();
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      setFeedRealtimeStatus("disconnected");
      ws?.close();
    };
  }, [
    onboardingCompleted,
    prependCard,
    setFeedCards,
    setFeedRealtimeStatus,
    setUnreadCounts,
  ]);

  const handleOnboardingComplete = () => {
    setOnboardingCompleted(true);
    // Load modules after onboarding
    api.get<{ modules: FeedModule[] }>("/api/modules")
      .then((r) => setFeedModules(r.modules))
      .catch(() => {});
  };

  useEffect(() => {
    const handleBrowserPageHide = () => {
      bilibiliCancelAllKnownTasksSilently();
    };
    window.addEventListener("pagehide", handleBrowserPageHide);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauriRuntime) {
      void getCurrentWindow()
        .onCloseRequested(() => {
          // Do not block native close. Page-leave-safe cancellation already uses sendBeacon/keepalive.
          bilibiliCancelAllKnownTasksSilently();
        })
        .then((cleanup) => {
          if (disposed) {
            cleanup();
            return;
          }
          unlisten = cleanup;
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", handleBrowserPageHide);
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (!bootError) {
      return;
    }
    addToast({
      kind: "error",
      title: "ABO backend not ready",
      message: bootError,
    });
  }, [addToast, bootError]);

  // Show loading state while checking onboarding status
  if (isLoading) {
    return (
      <AppLoadingScreen
        currentMeme={currentLoadingMeme}
        isTauriRuntime={isTauriRuntime}
        memeIndex={loadingMemeIndex}
      />
    );
  }

  if (bootError) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-app)",
          padding: "24px",
        }}
      >
        <WindowDragHandle />
        <div
          style={{
            maxWidth: "520px",
            width: "100%",
            padding: "28px",
            borderRadius: "24px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-soft)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.3rem", color: "var(--text-main)" }}>ABO failed to start</h1>
          <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.7, color: "var(--text-secondary)" }}>
            The desktop shell is open, but the local backend service is not ready yet. The packaged app starts the backend automatically; if the error persists after about 1 minute, check whether the sidecar is missing or blocked by macOS.
          </p>
          <code
            style={{
              padding: "12px 14px",
              borderRadius: "14px",
              background: "var(--bg-hover)",
              color: "var(--text-main)",
              fontSize: "0.82rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {bootError}
          </code>
          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              setBootError("");
              setOnboardingCompleted(null);
              window.dispatchEvent(new Event("abo:onboarding-status-updated"));
            }}
            style={{
              alignSelf: "flex-start",
              padding: "10px 16px",
              borderRadius: "999px",
              border: "none",
              background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
              color: "white",
              fontSize: "0.875rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Retry startup
          </button>
        </div>
      </div>
    );
  }

  // Show onboarding wizard if not completed
  if (!onboardingCompleted) {
    return <OnboardingWizard onComplete={handleOnboardingComplete} />;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
        display: "flex",
        overflow: "hidden",
        background: "var(--bg-app)",
        fontFamily: "'Nunito', 'M PLUS Rounded 1c', sans-serif",
      }}
    >
      <WindowDragHandle />
      <NavSidebar />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          overflow: "hidden",
          position: "relative",
          background: "linear-gradient(135deg, var(--bg-app) 0%, rgba(188, 164, 227, 0.03) 100%)",
        }}
      >
        {/* Subtle background decoration */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `
              radial-gradient(ellipse 80% 50% at 20% 40%, rgba(188, 164, 227, 0.06) 0%, transparent 50%),
              radial-gradient(ellipse 60% 40% at 80% 60%, rgba(255, 183, 178, 0.04) 0%, transparent 50%)
            `,
          }}
        />
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <AppErrorBoundary resetKey={activeTab}>
            <MainContent />
          </AppErrorBoundary>
        </div>
      </main>
      <ToastContainer />
      <HealthReminderDaemon />
      <RewardNotificationContainer />
      <CommandPalette />
      <GlobalSearch />
    </div>
  );
}
