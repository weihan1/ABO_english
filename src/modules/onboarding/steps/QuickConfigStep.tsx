import { useEffect, useState } from "react";
import {
  Settings,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Video,
  ShoppingBag,
  Headphones,
  HelpCircle,
  FileText,
  Rss,
  Check,
  Cookie,
  Loader2,
  Globe,
  CheckCircle2,
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { api } from "../../../core/api";
import { useStore } from "../../../core/store";
import {
  bilibiliGetConfig,
  bilibiliGetCookieFromBrowser,
  bilibiliVerifySessdata,
} from "../../../api/bilibili";
import {
  xiaohongshuGetConfig,
  xiaohongshuGetCookieFromBrowser,
  xiaohongshuVerifyCookie,
} from "../../../api/xiaohongshu";

interface QuickConfigStepProps {
  onNext: () => void;
  onBack: () => void;
}

interface ModuleConfig {
  id: string;
  name: string;
  icon: React.ReactNode;
  enabled: boolean;
  keywords: string[];
  requiresCookie: boolean;
  description: string;
  advanced?: boolean;
  configHint?: string;
}

type CookiePlatform = "bilibili" | "xiaohongshu";

interface CookieSetupState {
  configured: boolean;
  verified: boolean;
  loading: boolean;
  testing: boolean;
  expanded: boolean;
  preview: string | null;
  source?: string;
  message?: string;
  error?: string;
}

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  "arxiv-tracker": ["machine learning", "artificial intelligence", "neural networks"],
  "bilibili-tracker": ["machine learning", "AI tech", "programming tutorials"],
  "xiaohongshu-tracker": ["gadget reviews", "study notes", "productivity tools"],
  "xiaoyuzhou-tracker": ["tech podcasts", "business thinking", "personal growth"],
  "zhihu-tracker": ["artificial intelligence", "deep learning", "research methods"],
  "semantic-scholar-tracker": ["computer vision", "NLP", "reinforcement learning"],
  "folder-monitor": ["research", "notes", "ideas"],
};

const AI_PROVIDER_OPTIONS = [
  { id: "codex" as const, label: "Codex", supported: true, hint: "Available by default" },
  { id: "claude" as const, label: "Claude Code", supported: false, hint: "Compatibility off by default; enable manually in Settings" },
];

export default function QuickConfigStep({ onNext, onBack }: QuickConfigStepProps) {
  const { addToast, setConfig, setAiProvider: setGlobalAiProvider } = useStore();
  const [isSaving, setIsSaving] = useState(false);
  const [showCookieHint, setShowCookieHint] = useState(true);
  const [aiProvider, setAiProvider] = useState<"codex" | "claude">("codex");
  const [paperAiScoringEnabled, setPaperAiScoringEnabled] = useState(false);
  const [intelligenceDeliveryEnabled, setIntelligenceDeliveryEnabled] = useState(true);
  const [intelligenceDeliveryTime, setIntelligenceDeliveryTime] = useState("09:00");
  const [semanticScholarApiKey, setSemanticScholarApiKey] = useState("");
  const [showAdvancedModules, setShowAdvancedModules] = useState(false);
  const [cookieSetup, setCookieSetup] = useState<Record<CookiePlatform, CookieSetupState>>({
    bilibili: {
      configured: false,
      verified: false,
      loading: false,
      testing: false,
      expanded: true,
      preview: null,
      message: "After one-click reading the browser cookie, SESSDATA availability is checked automatically.",
    },
    xiaohongshu: {
      configured: false,
      verified: false,
      loading: false,
      testing: false,
      expanded: true,
      preview: null,
      message: "After one-click reading the browser cookie, web_session availability is checked automatically.",
    },
  });

  const [modules, setModules] = useState<ModuleConfig[]>([
    {
      id: "arxiv-tracker",
      name: "arXiv Tracker",
      icon: <BookOpen style={{ width: "20px", height: "20px" }} />,
      enabled: true,
      keywords: DEFAULT_KEYWORDS["arxiv-tracker"],
      requiresCookie: false,
      description: "Scheduled crawl of arXiv keyword papers",
      configHint: "Active Tools: Paper Tracking / arXiv API",
    },
    {
      id: "semantic-scholar-tracker",
      name: "Semantic Scholar",
      icon: <FileText style={{ width: "20px", height: "20px" }} />,
      enabled: true,
      keywords: DEFAULT_KEYWORDS["semantic-scholar-tracker"],
      requiresCookie: false,
      description: "Track follow-up research on a paper",
      configHint: "API key optional; works even if blank",
    },
    {
      id: "bilibili-tracker",
      name: "Bilibili Tracker",
      icon: <Video style={{ width: "20px", height: "20px" }} />,
      enabled: true,
      keywords: DEFAULT_KEYWORDS["bilibili-tracker"],
      requiresCookie: true,
      description: "Track the follow feed, creators, and saved videos",
      configHint: "Active Tools: Bilibili Tools",
    },
    {
      id: "xiaohongshu-tracker",
      name: "Xiaohongshu Tracker",
      icon: <ShoppingBag style={{ width: "20px", height: "20px" }} />,
      enabled: true,
      keywords: DEFAULT_KEYWORDS["xiaohongshu-tracker"],
      requiresCookie: true,
      description: "Track bookmark albums, keywords, and the follow feed",
      configHint: "Active Tools: Xiaohongshu Tools",
    },
    {
      id: "xiaoyuzhou-tracker",
      name: "Xiaoyuzhou Tracker",
      icon: <Headphones style={{ width: "20px", height: "20px" }} />,
      enabled: false,
      keywords: DEFAULT_KEYWORDS["xiaoyuzhou-tracker"],
      requiresCookie: false,
      description: "Track podcast content",
      advanced: true,
    },
    {
      id: "zhihu-tracker",
      name: "Zhihu Tracker",
      icon: <HelpCircle style={{ width: "20px", height: "20px" }} />,
      enabled: false,
      keywords: DEFAULT_KEYWORDS["zhihu-tracker"],
      requiresCookie: true,
      description: "Q&A and in-depth articles",
      advanced: true,
    },
    {
      id: "folder-monitor",
      name: "Folder Monitor",
      icon: <Rss style={{ width: "20px", height: "20px" }} />,
      enabled: false,
      keywords: DEFAULT_KEYWORDS["folder-monitor"],
      requiresCookie: false,
      description: "Watch local file changes",
      advanced: true,
    },
  ]);

  const toggleModule = (id: string) => {
    setModules((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
    );
  };

  const updateKeywords = (id: string, keywordsStr: string) => {
    const keywords = keywordsStr
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k);
    setModules((prev) =>
      prev.map((m) => (m.id === id ? { ...m, keywords } : m))
    );
  };

  useEffect(() => {
    void loadGlobalConfig();
    void loadModuleStatus();
    void loadCookieStatus();
  }, []);

  const loadGlobalConfig = async () => {
    try {
      const config = await api.get<Record<string, unknown>>("/api/config");
      setAiProvider(config.ai_provider === "claude" && Boolean(config.claude_code_compat_enabled) ? "claude" : "codex");
      setPaperAiScoringEnabled(Boolean(config.paper_ai_scoring_enabled));
      setIntelligenceDeliveryEnabled(config.intelligence_delivery_enabled !== false);
      setIntelligenceDeliveryTime(String(config.intelligence_delivery_time || "09:00"));
      setSemanticScholarApiKey(String(config.semantic_scholar_api_key || ""));
    } catch (error) {
      console.error("Failed to load onboarding config:", error);
    }
  };

  const loadModuleStatus = async () => {
    try {
      const moduleList = await api.get<{ modules: Array<{ id: string; enabled?: boolean }> }>("/api/modules");
      const enabledById = new Map(moduleList.modules.map((module) => [module.id, module.enabled !== false]));
      const configResults = await Promise.allSettled(
        modules.map((module) =>
          api.get<{ keywords?: string[] }>(`/api/modules/${module.id}/config`)
            .then((config) => ({ id: module.id, keywords: config.keywords }))
        )
      );
      const keywordsById = new Map<string, string[]>();
      configResults.forEach((result) => {
        if (result.status === "fulfilled" && Array.isArray(result.value.keywords) && result.value.keywords.length > 0) {
          keywordsById.set(result.value.id, result.value.keywords);
        }
      });
      setModules((current) =>
        current.map((module) => ({
          ...module,
          enabled: enabledById.has(module.id) ? Boolean(enabledById.get(module.id)) : module.enabled,
          keywords: keywordsById.get(module.id) || module.keywords,
        }))
      );
    } catch (error) {
      console.error("Failed to load onboarding module status:", error);
    }
  };

  const setCookiePlatformState = (
    platform: CookiePlatform,
    updater: (current: CookieSetupState) => CookieSetupState
  ) => {
    setCookieSetup((prev) => ({
      ...prev,
      [platform]: updater(prev[platform]),
    }));
  };

  const extractCookieValue = (cookieText: string | undefined, name: string): string | null => {
    if (!cookieText?.trim()) return null;

    try {
      if (cookieText.startsWith("[") || cookieText.startsWith("{")) {
        const parsed = JSON.parse(cookieText);
        if (Array.isArray(parsed)) {
          const matched = parsed.find((item: any) => item?.name === name);
          if (matched?.value) return String(matched.value);
        }
      }
    } catch (error) {
      console.error(`Failed to parse cookie JSON for ${name}:`, error);
    }

    const match = cookieText.match(new RegExp(`${name}=([^;\\s]+)`));
    return match ? match[1] : null;
  };

  const loadCookieStatus = async () => {
    try {
      const [bilibiliConfig, xiaohongshuConfig] = await Promise.all([
        bilibiliGetConfig(),
        xiaohongshuGetConfig(),
      ]);

      setCookieSetup((prev) => ({
        ...prev,
        bilibili: {
          ...prev.bilibili,
          configured: bilibiliConfig.cookie_configured,
          preview: bilibiliConfig.cookie_preview,
          message: bilibiliConfig.cookie_configured
            ? "A saved browser cookie was detected — you can re-test directly."
            : prev.bilibili.message,
        },
        xiaohongshu: {
          ...prev.xiaohongshu,
          configured: xiaohongshuConfig.cookie_configured,
          preview: xiaohongshuConfig.cookie_preview,
          message: xiaohongshuConfig.cookie_configured
            ? "A saved browser cookie was detected — you can re-test directly."
            : prev.xiaohongshu.message,
        },
      }));
    } catch (error) {
      console.error("Failed to load onboarding cookie status:", error);
    }
  };

  const handleBilibiliCookieFetch = async () => {
    setCookiePlatformState("bilibili", (current) => ({
      ...current,
      loading: true,
      testing: false,
      error: undefined,
      message: "Reading the Bilibili cookie from the browser...",
    }));

    try {
      const result = await bilibiliGetCookieFromBrowser();
      if (!result.success) {
        throw new Error(result.error || "Bilibili cookie not found");
      }

      const sessdata = extractCookieValue(result.cookie, "SESSDATA");
      if (!sessdata) {
        throw new Error("Got the cookie but could not parse SESSDATA");
      }

      setCookiePlatformState("bilibili", (current) => ({
        ...current,
        configured: true,
        preview: result.cookie_preview || result.cookie || current.preview,
        source: "Browser",
        loading: false,
        testing: true,
        message: "Cookie read; verifying login state...",
      }));

      const verify = await bilibiliVerifySessdata({ sessdata });

      setCookiePlatformState("bilibili", (current) => ({
        ...current,
        verified: verify.valid,
        configured: true,
        loading: false,
        testing: false,
        error: verify.valid ? undefined : verify.message,
        message: verify.valid ? "Test passed; ready for post-onboarding module config." : verify.message,
      }));

      if (verify.valid) {
        addToast({
          kind: "success",
          title: "Bilibili cookie usable",
          message: verify.message,
        });
      } else {
        addToast({
          kind: "info",
          title: "Bilibili cookie verification failed",
          message: verify.message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get browser cookie";
      setCookiePlatformState("bilibili", (current) => ({
        ...current,
        loading: false,
        testing: false,
        verified: false,
        error: message,
        message,
      }));
      addToast({
        kind: "error",
        title: "Bilibili one-click fetch failed",
        message,
      });
    }
  };

  const handleXiaohongshuCookieFetch = async () => {
    setCookiePlatformState("xiaohongshu", (current) => ({
      ...current,
      loading: true,
      testing: false,
      error: undefined,
      message: "Reading the Xiaohongshu cookie from the browser...",
    }));

    try {
      const result = await xiaohongshuGetCookieFromBrowser();
      if (!result.success) {
        throw new Error(result.error || "Xiaohongshu cookie not found");
      }

      const webSession = result.web_session || extractCookieValue(result.cookie, "web_session");
      const idToken = result.id_token || extractCookieValue(result.cookie, "id_token") || undefined;

      if (!webSession) {
        throw new Error("Got the cookie but could not parse web_session");
      }

      setCookiePlatformState("xiaohongshu", (current) => ({
        ...current,
        configured: true,
        preview: result.cookie_preview || result.cookie || current.preview,
        source: result.source,
        loading: false,
        testing: true,
        message: "Cookie read; verifying login state...",
      }));

      const verify = await xiaohongshuVerifyCookie({
        web_session: webSession,
        id_token: idToken,
      });

      setCookiePlatformState("xiaohongshu", (current) => ({
        ...current,
        verified: verify.valid,
        configured: true,
        loading: false,
        testing: false,
        error: verify.valid ? undefined : verify.message,
        message: verify.valid ? "Test passed; ready for search and saving." : verify.message,
      }));

      if (verify.valid) {
        addToast({
          kind: "success",
          title: "Xiaohongshu cookie usable",
          message: verify.message,
        });
      } else {
        addToast({
          kind: "info",
          title: "Xiaohongshu cookie verification failed",
          message: verify.message,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get browser cookie";
      setCookiePlatformState("xiaohongshu", (current) => ({
        ...current,
        loading: false,
        testing: false,
        verified: false,
        error: message,
        message,
      }));
      addToast({
        kind: "error",
        title: "Xiaohongshu one-click fetch failed",
        message,
      });
    }
  };

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      const savedConfig = await api.post<Record<string, unknown>>("/api/config", {
        ai_provider: aiProvider,
        paper_ai_scoring_enabled: paperAiScoringEnabled,
        intelligence_delivery_enabled: intelligenceDeliveryEnabled,
        intelligence_delivery_time: intelligenceDeliveryTime,
        ...(semanticScholarApiKey.trim()
          ? { semantic_scholar_api_key: semanticScholarApiKey.trim() }
          : {}),
      });
      setConfig(savedConfig as any);
      setGlobalAiProvider(aiProvider);

      const results = await Promise.allSettled(
        modules.map(async (module) => {
          await api.patch(`/api/modules/${module.id}`, { enabled: module.enabled });
          await api.post(`/api/modules/${module.id}/config`, {
            keywords: module.keywords,
          });
        })
      );

      const failed = results.filter((r) => r.status === "rejected").length;
      const enabledModules = modules.filter((m) => m.enabled);
      if (failed > 0) {
        addToast({
          kind: "info",
          title: "Some settings failed to save",
          message: `${modules.length - failed}/${modules.length} modules saved; reconfigure later in Module Management or Settings`,
        });
      } else {
        addToast({
          kind: "success",
          title: "Quick config saved",
          message: `Default push ${intelligenceDeliveryEnabled ? "enabled" : "disabled"}; ${enabledModules.length} modules enabled`,
        });
      }

      // Always proceed to next step
      onNext();
    } catch (error) {
      console.error("Failed to save config:", error);
      // Even on unexpected error, still proceed
      onNext();
    } finally {
      setIsSaving(false);
    }
  };

  const enabledCount = modules.filter((m) => m.enabled).length;
  const cookieRequiredCount = modules.filter((m) => m.enabled && m.requiresCookie).length;
  const advancedCount = modules.filter((m) => m.advanced).length;
  const visibleModules = modules.filter((m) => !m.advanced || showAdvancedModules);
  const showCookieSetup = modules.some(
    (module) =>
      module.enabled && (module.id === "bilibili-tracker" || module.id === "xiaohongshu-tracker")
  );

  const renderCookieSetupCard = (
    platform: CookiePlatform,
    title: string,
    description: string,
    onFetch: () => Promise<void>
  ) => {
    const state = cookieSetup[platform];
    const isBusy = state.loading || state.testing;
    const statusText = isBusy
      ? state.testing
        ? "Testing"
        : "Fetching"
      : state.verified
        ? "Test passed"
        : state.configured
          ? "Fetched, pending test"
          : "Not configured";

    const statusColor = isBusy
      ? "#D48984"
      : state.verified
        ? "#22c55e"
        : state.configured
          ? "#E89B96"
          : "var(--text-muted)";

    return (
      <div
        style={{
          padding: "16px",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-card)",
          border: "1px solid var(--border-light)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>{title}</div>
            <div style={{ marginTop: "4px", fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {description}
            </div>
          </div>

          <span
            style={{
              padding: "4px 10px",
              borderRadius: "999px",
              background: `${statusColor}18`,
              color: statusColor,
              fontSize: "0.75rem",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {statusText}
          </span>
        </div>

        <div
          style={{
            padding: "12px",
            borderRadius: "var(--radius-md)",
            background: state.verified ? "rgba(34, 197, 94, 0.08)" : "var(--bg-hover)",
            border: `1px solid ${state.verified ? "rgba(34, 197, 94, 0.2)" : "var(--border-light)"}`,
            color: state.verified ? "#22c55e" : "var(--text-secondary)",
            fontSize: "0.8125rem",
            lineHeight: 1.6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {state.verified ? (
              <CheckCircle2 style={{ width: "16px", height: "16px", color: "#22c55e" }} />
            ) : (
              <AlertCircle style={{ width: "16px", height: "16px", color: statusColor }} />
            )}
            <span>{state.message}</span>
          </div>
          {state.source && <div style={{ marginTop: "6px", color: "var(--text-muted)" }}>Source: {state.source}</div>}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <button
            onClick={() => void onFetch()}
            disabled={isBusy}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "10px 16px",
              borderRadius: "var(--radius-md)",
              border: "none",
              background: isBusy ? "var(--bg-muted)" : "var(--color-primary)",
              color: "white",
              fontSize: "0.875rem",
              fontWeight: 700,
              cursor: isBusy ? "not-allowed" : "pointer",
            }}
          >
            {isBusy ? (
              <>
                <Loader2 style={{ width: "16px", height: "16px", animation: "spin 1s linear infinite" }} />
                {state.testing ? "Testing..." : "Fetching..."}
              </>
            ) : (
              <>
                <Globe style={{ width: "16px", height: "16px" }} />
                One-click fetch & test
              </>
            )}
          </button>

          <button
            onClick={() =>
              setCookiePlatformState(platform, (current) => ({
                ...current,
                expanded: !current.expanded,
              }))
            }
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              background: "var(--bg-app)",
              color: "var(--text-secondary)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {state.expanded ? <ChevronUp style={{ width: "14px", height: "14px" }} /> : <ChevronDown style={{ width: "14px", height: "14px" }} />}
            {state.expanded ? "Collapse details" : "View details"}
          </button>
        </div>

        {state.expanded && (
          <div
            style={{
              padding: "12px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-hover)",
              border: "1px dashed var(--border-light)",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
              Reuses the current tool page's cookie acquisition and writes it to ABO's global config.
            </div>
            {state.preview ? (
              <textarea
                readOnly
                value={state.preview}
                style={{
                  width: "100%",
                  minHeight: "92px",
                  resize: "vertical",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-app)",
                  color: "var(--text-secondary)",
                  fontFamily: "monospace",
                  fontSize: "0.75rem",
                  lineHeight: 1.55,
                }}
              />
            ) : (
              <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                No cookie read yet. Confirm the browser is logged in to the site first.
              </div>
            )}
            {state.error && (
              <div style={{ fontSize: "0.8125rem", color: "#ef4444", lineHeight: 1.6 }}>{state.error}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        padding: "48px 32px",
        maxWidth: "800px",
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "32px" }}>
        <div
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "var(--radius-xl)",
            background: "linear-gradient(135deg, #BCA4E3, #9D7BDB)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            boxShadow: "0 8px 32px rgba(188, 164, 227, 0.4)",
          }}
        >
          <Settings style={{ width: "36px", height: "36px", color: "white" }} />
        </div>

        <h2
          style={{
            fontFamily: "'M PLUS Rounded 1c', sans-serif",
            fontSize: "1.75rem",
            fontWeight: 700,
            color: "var(--text-main)",
            marginBottom: "8px",
          }}
        >
          Quick Config
        </h2>

        <p
          style={{
            fontSize: "0.9375rem",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
          }}
        >
          Keep the defaults and continue — basic setup takes ~10 seconds; automation module keywords can be left blank for now.
          <br />
          {enabledCount} modules enabled, {cookieRequiredCount} of which need a browser cookie — configure those cookies first.
        </p>
      </div>

      {/* Core Preferences */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            padding: "18px",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
            <Clock style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>Daily Briefing</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>Runs the configured monitors on schedule</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {intelligenceDeliveryEnabled ? "Default push enabled" : "Default push disabled; manual crawl only"}
            </span>
            <button
              onClick={() => setIntelligenceDeliveryEnabled((current) => !current)}
              style={{
                width: "48px",
                height: "26px",
                borderRadius: "999px",
                border: "none",
                background: intelligenceDeliveryEnabled ? "var(--color-primary)" : "var(--border-light)",
                position: "relative",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "3px",
                  left: intelligenceDeliveryEnabled ? "25px" : "3px",
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  background: "white",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.16)",
                  transition: "left 180ms ease",
                }}
              />
            </button>
          </div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px", fontWeight: 700 }}>
            Default push time
          </label>
          <input
            type="time"
            step={1800}
            value={intelligenceDeliveryTime}
            onChange={(event) => setIntelligenceDeliveryTime(event.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              background: "var(--bg-app)",
              color: "var(--text-main)",
              fontSize: "0.875rem",
            }}
          />
        </div>

        <div
          style={{
            padding: "18px",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
            <Bot style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>AI Assistant</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>Affects the assistant entry and paper-reading scoring</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            {AI_PROVIDER_OPTIONS.map((provider) => {
              const active = aiProvider === provider.id;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    if (!provider.supported) return;
                    setAiProvider(provider.id);
                  }}
                  disabled={!provider.supported}
                  title={provider.hint}
                  style={{
                    flex: 1,
                    padding: "9px 12px",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${provider.supported ? (active ? "var(--color-primary)" : "var(--border-light)") : "rgba(15, 23, 42, 0.12)"}`,
                    background: provider.supported
                      ? (active ? "rgba(188, 164, 227, 0.14)" : "var(--bg-app)")
                      : "rgba(15, 23, 42, 0.74)",
                    color: provider.supported
                      ? (active ? "var(--color-primary)" : "var(--text-secondary)")
                      : "rgba(255, 255, 255, 0.72)",
                    fontSize: "0.8125rem",
                    fontWeight: 800,
                    cursor: provider.supported ? "pointer" : "not-allowed",
                    opacity: provider.supported ? 1 : 0.92,
                  }}
                >
                  {provider.label}
                </button>
              );
            })}
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "rgba(15, 23, 42, 0.08)",
              color: "var(--text-secondary)",
              fontSize: "0.75rem",
              lineHeight: 1.6,
              marginBottom: "12px",
            }}
          >
            Codex is used by default. Claude Code compatibility is off by default; enable it manually in Settings if needed.
          </div>
          <button
            onClick={() => setPaperAiScoringEnabled((current) => !current)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              background: paperAiScoringEnabled ? "rgba(168, 230, 207, 0.16)" : "var(--bg-app)",
              color: paperAiScoringEnabled ? "#4f9b80" : "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              justifyContent: "center",
              fontSize: "0.8125rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            <ShieldCheck style={{ width: "16px", height: "16px" }} />
            {paperAiScoringEnabled ? "Paper AI reading-score enabled" : "AI paper scoring off for now"}
          </button>
        </div>

        <div
          style={{
            padding: "18px",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
            <KeyRound style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>Academic API</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>arXiv needs no key; Semantic Scholar optional</div>
            </div>
          </div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "8px", fontWeight: 700 }}>
            Semantic Scholar API Key (optional)
          </label>
          <input
            type="password"
            value={semanticScholarApiKey}
            onChange={(event) => setSemanticScholarApiKey(event.target.value)}
            placeholder="Leave blank to get started"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-light)",
              background: "var(--bg-app)",
              color: "var(--text-main)",
              fontSize: "0.875rem",
              marginBottom: "10px",
            }}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
            If you run a lot of Follow Up later, request your own key from Semantic Scholar. No need to fill it in now.
          </div>
        </div>
      </div>

      {/* Cookie Setup */}
      <div
        style={{
          padding: "16px 20px",
          borderRadius: "var(--radius-lg)",
          background: "rgba(255, 183, 178, 0.08)",
          border: "1px solid rgba(255, 183, 178, 0.2)",
          marginBottom: "24px",
        }}
      >
        <button
          onClick={() => setShowCookieHint(!showCookieHint)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            width: "100%",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <Cookie style={{ width: "20px", height: "20px", color: "#E89B96" }} />
          <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--text-main)", fontWeight: 600 }}>
            About cookie configuration
          </span>
          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            {showCookieHint ? "Collapse" : "Expand"}
          </span>
        </button>

        {showCookieHint && (
          <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid rgba(255, 183, 178, 0.2)" }}>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: "12px" }}>
              Onboarding already wires up the current tool page's one-click fetch. Bilibili and Xiaohongshu are tested immediately after fetching; Zhihu can still be configured manually later in Module Management.
            </p>
            {showCookieSetup && (
              <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                {modules.some((module) => module.enabled && module.id === "bilibili-tracker") &&
                  renderCookieSetupCard(
                    "bilibili",
                    "Bilibili Cookie",
                    "Reads the browser login state, auto-verifies SESSDATA, and saves it to the post-onboarding module environment.",
                    handleBilibiliCookieFetch
                  )}
                {modules.some((module) => module.enabled && module.id === "xiaohongshu-tracker") &&
                  renderCookieSetupCard(
                    "xiaohongshu",
                    "Xiaohongshu Cookie",
                    "Reads the browser login state, auto-verifies web_session, and saves it for later search and saving flows.",
                    handleXiaohongshuCookieFetch
                  )}
              </div>
            )}

            {!showCookieSetup && (
              <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                The one-click fetch entry only appears when the Bilibili or Xiaohongshu module is enabled.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Module List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "32px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            padding: "4px 2px",
          }}
        >
          <div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>Automation Modules</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
              This only toggles modules and keywords. Configure fine-grained Xiaohongshu, Bilibili, and paper monitors on their Active Tool pages.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedModules((current) => !current)}
            style={{
              padding: "8px 12px",
              borderRadius: "999px",
              border: "1px solid var(--border-light)",
              background: showAdvancedModules ? "rgba(188, 164, 227, 0.12)" : "var(--bg-card)",
              color: showAdvancedModules ? "var(--color-primary)" : "var(--text-secondary)",
              fontSize: "0.75rem",
              fontWeight: 800,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {showAdvancedModules ? "Hide TODO modules" : `Show TODO modules ${advancedCount}`}
          </button>
        </div>

        {visibleModules.map((module) => (
          <div
            key={module.id}
            style={{
              padding: "20px",
              borderRadius: "var(--radius-lg)",
              background: module.enabled ? "var(--bg-card)" : "var(--bg-hover)",
              border: `1px solid ${module.enabled ? "var(--color-primary-light)" : "var(--border-light)"}`,
              opacity: module.enabled ? 1 : 0.7,
              transition: "all 0.3s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: module.enabled ? "16px" : 0 }}>
              {/* Toggle */}
              <button
                onClick={() => toggleModule(module.id)}
                style={{
                  width: "48px",
                  height: "26px",
                  borderRadius: "var(--radius-full)",
                  background: module.enabled
                    ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))"
                    : "var(--bg-hover)",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  position: "relative",
                  boxShadow: module.enabled ? "0 2px 8px rgba(188, 164, 227, 0.4)" : "inset 0 2px 4px rgba(0,0,0,0.1)",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "3px",
                    left: module.enabled ? "25px" : "3px",
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: "white",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                    transition: "left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                />
              </button>

              {/* Icon */}
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "var(--radius-md)",
                  background: module.enabled
                    ? "linear-gradient(135deg, var(--color-primary-light), var(--color-primary))"
                    : "var(--bg-hover)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: module.enabled ? "white" : "var(--text-muted)",
                }}
              >
                {module.icon}
              </div>

              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-main)" }}>
                    {module.name}
                  </h3>
                  {module.requiresCookie && (
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        background: "rgba(255, 183, 178, 0.2)",
                        fontSize: "0.6875rem",
                        color: "#D48984",
                        fontWeight: 600,
                      }}
                    >
                      Cookie
                    </span>
                  )}
                </div>
                <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{module.description}</p>
                {module.configHint && (
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>{module.configHint}</p>
                )}
              </div>

              {/* Status */}
              {module.enabled && (
                <Check style={{ width: "20px", height: "20px", color: "#22c55e" }} />
              )}
            </div>

            {/* Keywords Input */}
            {module.enabled && (
              <div style={{ marginLeft: "64px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8125rem",
                    color: "var(--text-secondary)",
                    marginBottom: "8px",
                    fontWeight: 500,
                  }}
                >
                  Keywords (comma-separated)
                </label>
                <input
                  type="text"
                  value={module.keywords.join(", ")}
                  onChange={(e) => updateKeywords(module.id, e.target.value)}
                  placeholder="Leave blank for now, configure later"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                    background: "var(--bg-app)",
                    color: "var(--text-main)",
                    fontSize: "0.875rem",
                    transition: "all 0.2s ease",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--color-primary)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-light)";
                  }}
                />
                <p
                  style={{
                    marginTop: "8px",
                    fontSize: "0.75rem",
                    lineHeight: 1.6,
                    color: module.keywords.length > 0 ? "var(--text-muted)" : "var(--text-secondary)",
                  }}
                >
                  {module.keywords.length > 0
                    ? "You can also fine-tune later in the Active Tools."
                    : module.requiresCookie
                      ? "Can be left blank for now; but configure the cookie first."
                      : "Can be left blank and configured later."}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", gap: "16px", justifyContent: "center", marginTop: "auto" }}>
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "14px 28px",
            borderRadius: "var(--radius-full)",
            background: "var(--bg-hover)",
            border: "1px solid var(--border-light)",
            color: "var(--text-secondary)",
            fontSize: "0.9375rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-card)";
            e.currentTarget.style.borderColor = "var(--color-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.borderColor = "var(--border-light)";
          }}
        >
          <ArrowLeft style={{ width: "18px", height: "18px" }} />
          Back
        </button>

        <button
          onClick={handleContinue}
          disabled={isSaving || enabledCount === 0}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "14px 32px",
            borderRadius: "var(--radius-full)",
            background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
            border: "none",
            color: "white",
            fontSize: "0.9375rem",
            fontWeight: 700,
            cursor: isSaving || enabledCount === 0 ? "not-allowed" : "pointer",
            opacity: isSaving || enabledCount === 0 ? 0.6 : 1,
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            boxShadow: "0 4px 16px rgba(188, 164, 227, 0.3)",
          }}
          onMouseEnter={(e) => {
            if (!isSaving && enabledCount > 0) {
              e.currentTarget.style.transform = "translateY(-2px) scale(1.02)";
              e.currentTarget.style.boxShadow = "0 6px 24px rgba(188, 164, 227, 0.4)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0) scale(1)";
            e.currentTarget.style.boxShadow = "0 4px 16px rgba(188, 164, 227, 0.3)";
          }}
        >
          {isSaving ? (
            <>
              <Loader2 style={{ width: "18px", height: "18px", animation: "spin 1s linear infinite" }} />
              Saving...
            </>
          ) : (
            <>
              Continue
              <ArrowRight style={{ width: "18px", height: "18px" }} />
            </>
          )}
        </button>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
