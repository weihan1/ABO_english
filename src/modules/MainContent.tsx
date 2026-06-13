import { useStore } from "../core/store";
import Feed from "./feed/Feed";
import Literature from "./literature/Literature";
import Journal from "./journal/Journal";
import { ChatPanel } from "./chat/ChatPanel";
import Profile from "./profile/Profile";
import ArxivTracker from "./arxiv/ArxivTracker";
import HealthDashboard from "./health/HealthDashboard";
import Settings from "./settings/Settings";
import BubbleVault from "./vault/BubbleVault";
import { ModuleManagementPanel } from "./modules/ModuleManagementPanel";
import { XiaohongshuTool } from "./xiaohongshu/XiaohongshuTool";
import { BilibiliTool } from "./bilibili/BilibiliTool";
import { BilibiliFavoritesPage } from "./bilibili/BilibiliFavoritesPage";
// [DISABLED 2026-05] The ArxivAPITool sidebar entry is retired; component source and import are kept as comments.
// import { ArxivAPITool } from "./arxiv/ArxivAPITool";
import Dashboard from "./dashboard/Dashboard";
import Wiki from "./wiki/Wiki";
import AssistantWorkspace from "./assistant/AssistantWorkspace";

export default function MainContent() {
  const activeTab = useStore((s) => s.activeTab);

  const persistentTabStyle = (visible: boolean): React.CSSProperties => ({
    display: visible ? "block" : "none",
    height: "100%",
  });

  // Overview tab with feed
  if (activeTab === "overview") {
    return (
      <main
        style={{
          flex: 1,
          minHeight: 0,
          height: "100%",
          overflow: "hidden",
          background: "var(--bg-app)",
        }}
      >
        <Feed />
      </main>
    );
  }

  // Other tabs
  return (
    <main
      style={{
        flex: 1,
        height: "100%",
        overflow: "hidden",
        background: "var(--bg-app)",
        position: "relative",
      }}
    >
      {activeTab === "profile"    && <Profile />}
      {activeTab === "assistant"  && <AssistantWorkspace />}
      {activeTab === "vault"      && <BubbleVault />}
      {activeTab === "literature" && <Literature />}
      {activeTab === "journal"    && <Journal />}
      {activeTab === "claude"     && <ChatPanel />}
      {activeTab === "chat"       && <ChatPanel />}
      <div style={persistentTabStyle(activeTab === "arxiv")}>
        <ArxivTracker />
      </div>
      {activeTab === "health"     && <HealthDashboard />}
      {activeTab === "settings"   && <Settings />}
      {activeTab === "modules"    && <ModuleManagementPanel />}
      <div style={persistentTabStyle(activeTab === "xiaohongshu")}>
        <XiaohongshuTool />
      </div>
      {activeTab === "bilibili" && <BilibiliTool />}
      {activeTab === "bilibili-favorites" && <BilibiliFavoritesPage />}
      {/* [DISABLED 2026-05] {activeTab === "arxiv-api" && <ArxivAPITool />} */}
      {activeTab === "wiki"      && <Wiki />}
      {activeTab === "dashboard" && <Dashboard />}
    </main>
  );
}
