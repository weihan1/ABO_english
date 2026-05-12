import { useStore, ActiveTab } from "../../core/store";
import { useThemeMode } from "../../core/theme";
import { filterModulesForManagement } from "../../core/moduleVisibility";
import BrandMark from "../../components/BrandMark";
import AvatarDisplay from "../profile/AvatarDisplay";
import { normalizeFeedPreferences } from "../feed/intelligence";
import {
  Inbox, BookOpen, FileText,
  Rss, Heart, Settings, User, Menu, X, Moon, Sun, LayoutGrid, FolderOpen,
  ChevronDown, BookHeart, Tv, BarChart3, Bot
} from "lucide-react";
import { useState, useEffect } from "react";

type NavItem = { id: ActiveTab; label: string; Icon: React.FC<{ className?: string; "aria-hidden"?: boolean }> };

const MAIN: NavItem[] = [
  { id: "profile",    label: "角色主页",   Icon: User },
  { id: "assistant",  label: "助手",       Icon: Bot },
  { id: "overview",   label: "今日情报",   Icon: Inbox },
  { id: "dashboard",  label: "数据洞察",   Icon: BarChart3 },
  { id: "vault",      label: "情报库",     Icon: FolderOpen },
  { id: "literature", label: "文献库",     Icon: BookOpen },
  { id: "wiki",       label: "Wiki",       Icon: BookHeart },
  { id: "journal",    label: "手记",       Icon: FileText },
];

export default function NavSidebar() {
  const [isMobile, setIsMobile] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [modulesExpanded, setModulesExpanded] = useState(false);
  const { isDark, toggleTheme } = useThemeMode();
  const isMacDesktopApp =
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    navigator.platform.toLowerCase().includes("mac");
  const desktopSidebarPadding = isMacDesktopApp
    ? "clamp(40px, 5vw, 52px) clamp(16px, 2vw, 24px) clamp(16px, 2vw, 24px)"
    : "clamp(16px, 2vw, 24px)";

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) setIsOpen(false);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const {
    activeTab, setActiveTab,
    unreadCounts, config, feedModules,
    profileEnergy, profileSan, profileMotto, profileCodename,
    setModuleToConfigure,
    showcaseMode,
  } = useStore();
  const hiddenTodayIds = normalizeFeedPreferences(config?.feed_preferences).hidden_module_ids;
  const totalUnread = Object.entries(unreadCounts).reduce(
    (sum, [moduleId, count]) => hiddenTodayIds.includes(moduleId) ? sum : sum + count,
    0,
  );
  const vaultOk = Boolean(config?.vault_path);
  const managementModules = filterModulesForManagement(feedModules);

  const getEnergyColor = (energy: number) => {
    if (energy >= 70) return "linear-gradient(135deg, #A8E6CF, #7DD3C0)";
    if (energy >= 40) return "linear-gradient(135deg, #FFE4B5, #F5C88C)";
    return "linear-gradient(135deg, #FFB7B2, #E89B96)";
  };

  function NavPill({ id, label, Icon }: NavItem) {
    const active = activeTab === id;
    const activeBoxShadow = active
      ? (showcaseMode
        ? "0 4px 24px rgba(188, 164, 227, 0.5), 0 0 40px rgba(188, 164, 227, 0.12)"
        : "0 4px 20px rgba(188, 164, 227, 0.4)")
      : "none";
    return (
      <button
        onClick={() => {
          setActiveTab(id);
          if (isMobile) setIsOpen(false);
        }}
        style={{
          width: "100%",
          padding: "clamp(10px, 1.5vw, 12px) clamp(14px, 2vw, 16px)",
          borderRadius: "var(--radius-full)",
          background: active ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))" : "transparent",
          color: active ? "white" : "var(--text-secondary)",
          transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          border: active ? "none" : "1px solid transparent",
          boxShadow: activeBoxShadow,
          transform: active ? "scale(1.02)" : "scale(1)",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.background = "rgba(188, 164, 227, 0.1)";
            e.currentTarget.style.borderColor = "var(--border-color)";
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
          }
        }}
      >
        <div
          style={{
            width: "clamp(32px, 4vw, 36px)",
            height: "clamp(32px, 4vw, 36px)",
            borderRadius: "50%",
            background: active ? "rgba(255,255,255,0.2)" : "var(--bg-card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: active ? "none" : "1px solid var(--border-light)",
            flexShrink: 0,
          }}
        >
          <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden />
        </div>

        <span style={{ fontWeight: 600, fontSize: "clamp(0.875rem, 1.2vw, 0.9375rem)", flex: 1, textAlign: "left" }}>
          {label}
        </span>

        {id === "overview" && totalUnread > 0 && (
          <span
            style={{
              background: "linear-gradient(135deg, #FFB7B2, #E89B96)",
              color: "white",
              fontSize: "0.75rem",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              boxShadow: "0 2px 8px rgba(255, 183, 178, 0.4)",
              flexShrink: 0,
            }}
          >
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>
    );
  }

  function ModuleItem({ mod, isMobile, setIsOpen }: { mod: { id: string; name: string; enabled: boolean }; isMobile: boolean; setIsOpen: (v: boolean) => void }) {
    const unread = unreadCounts[mod.id] ?? 0;
    const { setModuleHistoryId, setActiveTab } = useStore();
    return (
      <button
        onClick={() => {
          const current = useStore.getState().moduleHistoryId;
          if (current === mod.id) {
            setModuleHistoryId(null);
            requestAnimationFrame(() => {
              setModuleHistoryId(mod.id);
            });
          } else {
            setModuleHistoryId(mod.id);
          }
          setActiveTab("modules");
          if (isMobile) setIsOpen(false);
        }}
        style={{
          width: "100%",
          padding: "10px 14px 10px 52px",
          borderRadius: "var(--radius-full)",
          background: "transparent",
          color: "var(--text-secondary)",
          transition: "all 0.2s ease",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          border: "1px solid transparent",
          fontSize: "0.8125rem",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text-main)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-secondary)";
        }}
      >
        <div
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: mod.enabled ? "#A8E6CF" : "var(--text-muted)",
            flexShrink: 0,
            boxShadow: mod.enabled ? "0 0 6px rgba(168, 230, 207, 0.6)" : "none",
          }}
        />
        <span style={{ flex: 1, textAlign: "left", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {mod.name}
        </span>
        {unread > 0 && (
          <span
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: "var(--color-primary)",
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              background: "rgba(188, 164, 227, 0.15)",
              flexShrink: 0,
            }}
          >
            {unread}
          </span>
        )}
      </button>
    );
  }

  const sidebarContent = (
    <>
      {/* Logo Section */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px", padding: "0 8px 4px", flexShrink: 0 }}>
        <BrandMark size="clamp(44px, 5vw, 52px)" isDark={isDark} showcase={showcaseMode} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "'M PLUS Rounded 1c', sans-serif",
              fontSize: "clamp(1.25rem, 2vw, 1.5rem)",
              fontWeight: 800,
              letterSpacing: "0.04em",
              background: "linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-secondary) 56%, #B58FE6 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              filter: "drop-shadow(0 8px 18px rgba(188, 164, 227, 0.18))",
            }}
          >
            ABO
          </div>
          <div style={{
            display: "grid",
            gap: "1px",
            marginTop: "1px",
            lineHeight: 1.02,
          }}>
            <span style={{
              fontSize: "0.625rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "linear-gradient(135deg, #A78BFA, #818CF8)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              opacity: 0.95,
            }}>
              Another Brain
            </span>
            <span style={{
              fontSize: "0.72rem",
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontStyle: "italic",
              background: "linear-gradient(135deg, #6DD5FA, #FF6B9D, #C084FC)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              filter: "drop-shadow(0 6px 12px rgba(192, 132, 252, 0.16))",
            }}>
              ODYSSEY
            </span>
          </div>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          style={{
            padding: "8px",
            borderRadius: "50%",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.3s ease",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.transform = "scale(1.1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--bg-card)";
            e.currentTarget.style.transform = "scale(1)";
          }}
          title={isDark ? "切换浅色模式" : "切换深色模式"}
        >
          {isDark ? (
            <Sun className="w-4 h-4" style={{ color: "var(--color-warning)" }} />
          ) : (
            <Moon className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
          )}
        </button>

        {/* Close button for mobile */}
        {isMobile && (
          <button
            onClick={() => setIsOpen(false)}
            style={{ padding: "8px", borderRadius: "50%", background: "var(--bg-card)", flexShrink: 0 }}
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Profile Summary Card */}
      <button
        onClick={() => {
          setActiveTab("profile");
          if (isMobile) setIsOpen(false);
        }}
        style={{
          background: "var(--bg-card)",
          backdropFilter: "blur(12px)",
          borderRadius: "var(--radius-md)",
          padding: "clamp(12px, 2vw, 16px)",
          border: "1px solid var(--border-light)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          cursor: "pointer",
          transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
          marginBottom: "20px",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "var(--shadow-medium)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div
          style={{
            position: "relative",
            padding: "3px",
            borderRadius: "50%",
            background: getEnergyColor(profileEnergy),
            flexShrink: 0,
          }}
        >
          <div style={{ background: "var(--bg-app)", borderRadius: "50%", padding: "2px" }}>
            <AvatarDisplay
              codename={profileCodename}
              san={Math.round(profileSan / 10)}
              energy={profileEnergy}
              size={3}
            />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <div
              style={{
                flex: 1,
                height: "6px",
                background: "var(--bg-hover)",
                borderRadius: "var(--radius-full)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${profileEnergy}%`,
                  background: getEnergyColor(profileEnergy),
                  borderRadius: "var(--radius-full)",
                  transition: "width 0.7s ease",
                }}
              />
            </div>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)", flexShrink: 0 }}>
              {profileEnergy}%
            </span>
          </div>

          <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {profileMotto || "开始记录，见证成长"}
          </p>
        </div>
      </button>

      {/* Main Navigation */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", flexShrink: 0 }}>
        {MAIN.map((item) => (
          <NavPill key={item.id} {...item} />
        ))}
      </div>

      {/* Divider */}
      <div style={{ height: "1px", background: "var(--border-light)", margin: "16px 8px", flexShrink: 0 }} />

      {/* Section Label */}
      <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 16px 8px", flexShrink: 0 }}>
        自动化模块
      </div>

      {/* Expandable Module Management */}
      <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {/* Module Management Header */}
        <button
          onClick={() => {
            setModuleToConfigure(null);  // Reset to list view
            setActiveTab("modules");
            if (isMobile) setIsOpen(false);
          }}
          style={{
            width: "100%",
            padding: "clamp(10px, 1.5vw, 12px) clamp(14px, 2vw, 16px)",
            borderRadius: "var(--radius-full)",
            background: activeTab === "modules"
              ? "linear-gradient(135deg, rgba(168, 230, 207, 0.4), rgba(168, 230, 207, 0.3))"
              : "linear-gradient(135deg, rgba(168, 230, 207, 0.2), rgba(168, 230, 207, 0.1))",
            color: "#5BA88C",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            border: activeTab === "modules" ? "1px solid rgba(168, 230, 207, 0.6)" : "1px solid rgba(168, 230, 207, 0.4)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (activeTab !== "modules") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(168, 230, 207, 0.3), rgba(168, 230, 207, 0.2))";
            }
            e.currentTarget.style.transform = "scale(1.02)";
          }}
          onMouseLeave={(e) => {
            if (activeTab !== "modules") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(168, 230, 207, 0.2), rgba(168, 230, 207, 0.1))";
            }
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <div
            style={{
              width: "clamp(32px, 4vw, 36px)",
              height: "clamp(32px, 4vw, 36px)",
              borderRadius: "50%",
              background: activeTab === "modules" ? "rgba(168, 230, 207, 0.4)" : "rgba(168, 230, 207, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <LayoutGrid className="w-[18px] h-[18px] shrink-0" style={{ color: "#5BA88C" }} aria-hidden />
          </div>
          <span style={{ fontWeight: 600, fontSize: "clamp(0.875rem, 1.2vw, 0.9375rem)", flex: 1, textAlign: "left" }}>
            模块管理
          </span>
          <div
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              setModulesExpanded(!modulesExpanded);
            }}
          >
            <ChevronDown
              className="w-5 h-5"
              style={{ color: "#5BA88C", transition: "transform 0.3s ease", transform: modulesExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </div>
        </button>

        {/* Expandable Module List */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            maxHeight: modulesExpanded ? "500px" : "0px",
            opacity: modulesExpanded ? 1 : 0,
            overflow: "hidden",
            transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
            marginTop: modulesExpanded ? "8px" : "0px",
            paddingLeft: "4px",
          }}
        >
          {managementModules.map((mod) => (
            <ModuleItem key={mod.id} mod={mod} isMobile={isMobile} setIsOpen={setIsOpen} />
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: "1px", background: "var(--border-light)", margin: "16px 8px", flexShrink: 0 }} />

      {/* Section Label */}
      <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 16px 8px", flexShrink: 0 }}>
        主动工具
      </div>

      {/* Active Tools */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", flexShrink: 0 }}>
        {/* Xiaohongshu Tool */}
        <button
          onClick={() => {
            setActiveTab("xiaohongshu");
            if (isMobile) setIsOpen(false);
          }}
          style={{
            width: "100%",
            padding: "clamp(10px, 1.5vw, 12px) clamp(14px, 2vw, 16px)",
            borderRadius: "var(--radius-full)",
            background: activeTab === "xiaohongshu"
              ? "linear-gradient(135deg, rgba(255, 107, 107, 0.3), rgba(255, 107, 107, 0.2))"
              : "linear-gradient(135deg, rgba(255, 107, 107, 0.2), rgba(255, 107, 107, 0.1))",
            color: "#E85D5D",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            border: "1px solid rgba(255, 107, 107, 0.4)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (activeTab !== "xiaohongshu") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(255, 107, 107, 0.3), rgba(255, 107, 107, 0.2))";
            }
            e.currentTarget.style.transform = "scale(1.02)";
          }}
          onMouseLeave={(e) => {
            if (activeTab !== "xiaohongshu") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(255, 107, 107, 0.2), rgba(255, 107, 107, 0.1))";
            }
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <div
            style={{
              width: "clamp(32px, 4vw, 36px)",
              height: "clamp(32px, 4vw, 36px)",
              borderRadius: "50%",
              background: "rgba(255, 107, 107, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <BookHeart className="w-[18px] h-[18px] shrink-0" style={{ color: "#E85D5D" }} aria-hidden />
          </div>
          <span style={{ fontWeight: 600, fontSize: "clamp(0.875rem, 1.2vw, 0.9375rem)", flex: 1, textAlign: "left" }}>
            小红书工具
          </span>
        </button>

        {/* Bilibili Tool */}
        <button
          onClick={() => {
            setActiveTab("bilibili");
            if (isMobile) setIsOpen(false);
          }}
          style={{
            width: "100%",
            padding: "clamp(10px, 1.5vw, 12px) clamp(14px, 2vw, 16px)",
            borderRadius: "var(--radius-full)",
            background: activeTab === "bilibili"
              ? "linear-gradient(135deg, rgba(0, 174, 236, 0.3), rgba(0, 174, 236, 0.2))"
              : "linear-gradient(135deg, rgba(0, 174, 236, 0.2), rgba(0, 174, 236, 0.1))",
            color: "#00AEEC",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            border: "1px solid rgba(0, 174, 236, 0.4)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (activeTab !== "bilibili") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(0, 174, 236, 0.3), rgba(0, 174, 236, 0.2))";
            }
            e.currentTarget.style.transform = "scale(1.02)";
          }}
          onMouseLeave={(e) => {
            if (activeTab !== "bilibili") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(0, 174, 236, 0.2), rgba(0, 174, 236, 0.1))";
            }
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <div
            style={{
              width: "clamp(32px, 4vw, 36px)",
              height: "clamp(32px, 4vw, 36px)",
              borderRadius: "50%",
              background: "rgba(0, 174, 236, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Tv className="w-[18px] h-[18px] shrink-0" style={{ color: "#00AEEC" }} aria-hidden />
          </div>
          <span style={{ fontWeight: 600, fontSize: "clamp(0.875rem, 1.2vw, 0.9375rem)", flex: 1, textAlign: "left" }}>
            哔哩哔哩工具
          </span>
        </button>

        <button
          onClick={() => {
            setActiveTab("arxiv");
            if (isMobile) setIsOpen(false);
          }}
          style={{
            width: "100%",
            padding: "clamp(10px, 1.5vw, 12px) clamp(14px, 2vw, 16px)",
            borderRadius: "var(--radius-full)",
            background: activeTab === "arxiv"
              ? "linear-gradient(135deg, rgba(188, 164, 227, 0.25), rgba(188, 164, 227, 0.15))"
              : "linear-gradient(135deg, rgba(188, 164, 227, 0.15), rgba(188, 164, 227, 0.08))",
            color: "var(--color-primary-dark)",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            border: "1px solid rgba(188, 164, 227, 0.3)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (activeTab !== "arxiv") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(188, 164, 227, 0.25), rgba(188, 164, 227, 0.15))";
            }
            e.currentTarget.style.transform = "scale(1.02)";
          }}
          onMouseLeave={(e) => {
            if (activeTab !== "arxiv") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(188, 164, 227, 0.15), rgba(188, 164, 227, 0.08))";
            }
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <div
            style={{
              width: "clamp(32px, 4vw, 36px)",
              height: "clamp(32px, 4vw, 36px)",
              borderRadius: "50%",
              background: "rgba(188, 164, 227, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Rss className="w-[18px] h-[18px] shrink-0" style={{ color: "var(--color-primary-dark)" }} aria-hidden />
          </div>
          <span style={{ fontWeight: 600, fontSize: "clamp(0.875rem, 1.2vw, 0.9375rem)", flex: 1, textAlign: "left" }}>
            论文追踪
          </span>
        </button>

        {/* [DISABLED 2026-05] arXiv API 侧边栏入口已下线，统一并入「论文追踪」。
            如需恢复，去掉下面的注释，并同步恢复 store.ts 的 "arxiv-api" 联合分支与
            MainContent.tsx 里的 <ArxivAPITool /> 渲染。 */}
        {/*
        <button
          onClick={() => {
            setActiveTab("arxiv-api");
            if (isMobile) setIsOpen(false);
          }}
          style={{
            width: "100%",
            padding: "clamp(10px, 1.5vw, 12px) clamp(14px, 2vw, 16px)",
            borderRadius: "var(--radius-full)",
            background: activeTab === "arxiv-api"
              ? "linear-gradient(135deg, rgba(188, 164, 227, 0.3), rgba(188, 164, 227, 0.2))"
              : "linear-gradient(135deg, rgba(188, 164, 227, 0.2), rgba(188, 164, 227, 0.1))",
            color: "var(--color-primary-dark)",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            border: "1px solid rgba(188, 164, 227, 0.4)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (activeTab !== "arxiv-api") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(188, 164, 227, 0.3), rgba(188, 164, 227, 0.2))";
            }
            e.currentTarget.style.transform = "scale(1.02)";
          }}
          onMouseLeave={(e) => {
            if (activeTab !== "arxiv-api") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(188, 164, 227, 0.2), rgba(188, 164, 227, 0.1))";
            }
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <div
            style={{
              width: "clamp(32px, 4vw, 36px)",
              height: "clamp(32px, 4vw, 36px)",
              borderRadius: "50%",
              background: "rgba(188, 164, 227, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <BookOpen className="w-[18px] h-[18px] shrink-0" style={{ color: "var(--color-primary-dark)" }} aria-hidden />
          </div>
          <span style={{ fontWeight: 600, fontSize: "clamp(0.875rem, 1.2vw, 0.9375rem)", flex: 1, textAlign: "left" }}>
            arXiv API
          </span>
        </button>
        */}

        <button
          onClick={() => {
            setActiveTab("health");
            if (isMobile) setIsOpen(false);
          }}
          style={{
            width: "100%",
            padding: "clamp(10px, 1.5vw, 12px) clamp(14px, 2vw, 16px)",
            borderRadius: "var(--radius-full)",
            background: activeTab === "health"
              ? "linear-gradient(135deg, rgba(255, 183, 178, 0.3), rgba(255, 183, 178, 0.2))"
              : "linear-gradient(135deg, rgba(255, 183, 178, 0.2), rgba(255, 183, 178, 0.1))",
            color: "#D48984",
            transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            border: "1px solid rgba(255, 183, 178, 0.4)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            if (activeTab !== "health") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(255, 183, 178, 0.3), rgba(255, 183, 178, 0.2))";
            }
            e.currentTarget.style.transform = "scale(1.02)";
          }}
          onMouseLeave={(e) => {
            if (activeTab !== "health") {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(255, 183, 178, 0.2), rgba(255, 183, 178, 0.1))";
            }
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <div
            style={{
              width: "clamp(32px, 4vw, 36px)",
              height: "clamp(32px, 4vw, 36px)",
              borderRadius: "50%",
              background: "rgba(255, 183, 178, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Heart className="w-[18px] h-[18px] shrink-0" style={{ color: "#D48984" }} aria-hidden />
          </div>
          <span style={{ fontWeight: 600, fontSize: "clamp(0.875rem, 1.2vw, 0.9375rem)", flex: 1, textAlign: "left" }}>
            健康管理
          </span>
        </button>
      </div>

      {/* Spacer to push bottom section down */}
      <div style={{ flex: 1, minHeight: "20px" }} />

      {/* Bottom Section */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 16px",
            borderRadius: "var(--radius-full)",
            background: vaultOk ? "rgba(168, 230, 207, 0.15)" : "rgba(255, 183, 178, 0.15)",
            border: `1px solid ${vaultOk ? "rgba(168, 230, 207, 0.3)" : "rgba(255, 183, 178, 0.3)"}`,
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: vaultOk ? "#A8E6CF" : "#FFB7B2",
              boxShadow: vaultOk ? "0 0 8px rgba(168, 230, 207, 0.6)" : "0 0 8px rgba(255, 183, 178, 0.6)",
              animation: vaultOk ? "pulse-glow 2s infinite" : "none",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: vaultOk ? "#5BA88C" : "#D48984" }}>
            {vaultOk ? "库已连接" : "请配置情报库"}
          </span>
        </div>

        <NavPill id="settings" label="设置" Icon={Settings} />
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      {!isMobile && (
        <nav
          style={{
            width: "clamp(240px, 22vw, 300px)",
            minWidth: "220px",
            maxWidth: "320px",
            height: "100vh",
            maxHeight: "100vh",
            background: "var(--bg-sidebar)",
            backdropFilter: "blur(24px) saturate(180%)",
            borderRight: showcaseMode ? "1px solid var(--border-medium)" : "1px solid var(--border-color)",
            padding: desktopSidebarPadding,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
            flexShrink: 0,
            ...(showcaseMode ? {
              boxShadow: "4px 0 32px rgba(188, 164, 227, 0.08), 0 0 60px rgba(188, 164, 227, 0.03)",
            } : {}),
          }}
        >
          {/* Scrollable Content Area */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              gap: "8px",
              paddingRight: "4px",
              marginRight: "-4px",
            }}
          >
            {sidebarContent}
          </div>
        </nav>
      )}

      {/* Mobile Overlay */}
      {isMobile && isOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 40,
            animation: "fadeIn 0.3s ease",
          }}
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Mobile Sidebar Drawer */}
      {isMobile && (
        <nav
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            bottom: 0,
            width: "min(280px, 80vw)",
            maxHeight: "100vh",
            background: "var(--bg-sidebar)",
            backdropFilter: "blur(24px) saturate(180%)",
            borderRight: "1px solid var(--border-color)",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            zIndex: 50,
            transform: isOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
            overflow: "hidden",
          }}
        >
          {/* Scrollable Content Area for Mobile */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
              gap: "8px",
            }}
          >
            {sidebarContent}
          </div>
        </nav>
      )}

      {/* Mobile Menu Button */}
      {isMobile && (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            position: "fixed",
            bottom: "20px",
            left: "20px",
            zIndex: 30,
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
            boxShadow: "0 4px 20px rgba(188, 164, 227, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            cursor: "pointer",
          }}
        >
          <Menu className="w-6 h-6 text-white" />
        </button>
      )}
    </>
  );
}
