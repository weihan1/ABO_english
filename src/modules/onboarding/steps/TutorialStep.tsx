import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  FileText,
  FolderDown,
  Layers,
  Route,
  Settings,
  Sparkles,
} from "lucide-react";
import {
  configurationFlow,
  coreUsageWorkflows,
  dailyWorkflow,
  guideDocumentPath,
  nestedSidebarSections,
  sidebarSections,
} from "../onboardingContent";

interface TutorialStepProps {
  onComplete: () => void;
}

type GuideTab = "core" | "map" | "config" | "routine" | "reference";

const tabs: Array<{ id: GuideTab; label: string; icon: React.ReactNode }> = [
  { id: "core", label: "Core flow", icon: <FolderDown style={{ width: "16px", height: "16px" }} /> },
  { id: "map", label: "Sidebar map", icon: <Compass style={{ width: "16px", height: "16px" }} /> },
  { id: "config", label: "Config flow", icon: <Settings style={{ width: "16px", height: "16px" }} /> },
  { id: "routine", label: "Daily routine", icon: <Route style={{ width: "16px", height: "16px" }} /> },
  { id: "reference", label: "Reference guide", icon: <FileText style={{ width: "16px", height: "16px" }} /> },
];

const nextActions = [
  "Check Daily Briefing for existing cards first; none is normal — it means no tool or scheduled task has run yet.",
  "Run a manual preview in Xiaohongshu Tools or Bilibili Tools to confirm the cookie, filters, and save path all work.",
  "Configure an arXiv keyword monitor in Paper Tracking, or use Semantic Scholar to find a paper's Follow Up.",
  "After saving a few items, open Wiki to generate the Internet Wiki or Literature Wiki, then let the assistant build on those pages.",
];

export default function TutorialStep({ onComplete }: TutorialStepProps) {
  const [activeTab, setActiveTab] = useState<GuideTab>("core");

  const renderCoreFlow = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "14px" }}>
      {coreUsageWorkflows.map((workflow, index) => (
        <article
          key={workflow.title}
          style={{
            padding: "18px",
            borderRadius: "22px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "12px" }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "14px",
                background: "rgba(188, 164, 227, 0.16)",
                color: "var(--color-primary-dark)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.9rem",
                fontWeight: 900,
                flexShrink: 0,
              }}
            >
              {index + 1}
            </div>
            <div>
              <div style={{ fontSize: "1rem", fontWeight: 900, color: "var(--text-main)", marginBottom: "4px" }}>
                {workflow.title}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                {workflow.goal}
              </div>
            </div>
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "14px",
              background: "var(--bg-hover)",
              color: "var(--color-primary-dark)",
              fontSize: "0.78rem",
              fontWeight: 850,
              marginBottom: "12px",
            }}
          >
            Entry: {workflow.entry}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
            {workflow.steps.map((step) => (
              <div key={step} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: "9px", alignItems: "start" }}>
                <Check style={{ width: "15px", height: "15px", color: "#4f9b80", marginTop: "3px" }} />
                <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.55 }}>{step}</span>
              </div>
            ))}
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "14px",
              background: "rgba(168, 230, 207, 0.14)",
              color: "#4f9b80",
              fontSize: "0.78rem",
              lineHeight: 1.55,
              fontWeight: 750,
            }}
          >
            Result: {workflow.result}
          </div>
        </article>
      ))}
    </div>
  );

  const renderMap = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
      {[...sidebarSections, ...nestedSidebarSections].map((section) => (
        <article
          key={section.title}
          style={{
            padding: "18px",
            borderRadius: "20px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <div style={{ fontSize: "1rem", fontWeight: 900, color: "var(--text-main)", marginBottom: "6px" }}>
            {section.title}
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.55, marginBottom: "12px" }}>
            {section.subtitle}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {section.items.map((item) => (
              <div key={item.label} style={{ display: "grid", gridTemplateColumns: "86px 1fr", gap: "10px", alignItems: "start" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 850, color: "var(--color-primary-dark)" }}>{item.label}</span>
                <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.55 }}>{item.summary}</span>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );

  const renderConfig = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {configurationFlow.map((step) => (
        <div
          key={step.title}
          style={{
            display: "grid",
            gridTemplateColumns: "44px 1fr",
            gap: "14px",
            padding: "16px",
            borderRadius: "18px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
          }}
        >
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "15px",
              background: "rgba(188, 164, 227, 0.16)",
              color: "var(--color-primary-dark)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
            }}
          >
            {step.title.slice(0, 1)}
          </div>
          <div>
            <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "var(--text-main)", marginBottom: "4px" }}>{step.title}</div>
            <div style={{ fontSize: "0.86rem", color: "var(--text-secondary)", lineHeight: 1.65 }}>{step.body}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderRoutine = () => (
    <div
      style={{
        padding: "22px",
        borderRadius: "24px",
        background: "linear-gradient(135deg, rgba(168, 230, 207, 0.14), rgba(188, 164, 227, 0.12))",
        border: "1px solid rgba(188, 164, 227, 0.22)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
        <Layers style={{ width: "20px", height: "20px", color: "var(--color-primary)" }} />
        <div>
          <div style={{ fontSize: "1.05rem", fontWeight: 900, color: "var(--text-main)" }}>Recommended 15-minutes-a-day routine</div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "3px" }}>Reclaim your attention first, then keep the knowledge and write down the past.</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {dailyWorkflow.map((item, index) => (
          <div
            key={item}
            style={{
              display: "grid",
              gridTemplateColumns: "30px 1fr",
              gap: "12px",
              alignItems: "start",
              padding: "12px",
              borderRadius: "16px",
              background: "rgba(255,255,255,0.62)",
              border: "1px solid var(--border-light)",
            }}
          >
            <span
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "999px",
                background: "var(--color-primary)",
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.8rem",
                fontWeight: 900,
              }}
            >
              {index + 1}
            </span>
            <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: 1.65 }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderReference = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "18px" }}>
      <div
        style={{
          padding: "22px",
          borderRadius: "24px",
          background: "var(--bg-card)",
          border: "1px solid var(--border-light)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <BookOpen style={{ width: "28px", height: "28px", color: "var(--color-primary)", marginBottom: "12px" }} />
        <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "var(--text-main)", marginBottom: "8px" }}>The full reference guide has been written to Markdown</div>
        <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: "14px" }}>
          The document includes the sidebar map, main groups for each entry, initial setup, daily workflows, paper/Xiaohongshu/Bilibili paths, and troubleshooting tips.
        </div>
        <code
          style={{
            display: "block",
            padding: "12px",
            borderRadius: "12px",
            background: "var(--bg-hover)",
            color: "var(--text-main)",
            fontSize: "0.82rem",
            wordBreak: "break-all",
          }}
        >
          {guideDocumentPath}
        </code>
      </div>

      <div
        style={{
          padding: "22px",
          borderRadius: "24px",
          background: "var(--bg-card)",
          border: "1px solid var(--border-light)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <Sparkles style={{ width: "20px", height: "20px", color: "var(--color-primary)" }} />
          <div style={{ fontSize: "1rem", fontWeight: 900, color: "var(--text-main)" }}>Do these 4 things after finishing the wizard</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {nextActions.map((action) => (
            <div key={action} style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: "10px", alignItems: "start" }}>
              <Check style={{ width: "16px", height: "16px", color: "#4f9b80", marginTop: "3px" }} />
              <span style={{ fontSize: "0.86rem", color: "var(--text-secondary)", lineHeight: 1.65 }}>{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderActiveContent = () => {
    if (activeTab === "core") return renderCoreFlow();
    if (activeTab === "config") return renderConfig();
    if (activeTab === "routine") return renderRoutine();
    if (activeTab === "reference") return renderReference();
    return renderMap();
  };

  return (
    <div
      style={{
        minHeight: "100%",
        padding: "clamp(28px, 4vw, 48px)",
        maxWidth: "1120px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ textAlign: "center", marginBottom: "28px" }}>
        <div
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "24px",
            background: "linear-gradient(135deg, #FFB7B2, #E89B96)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 18px",
            boxShadow: "0 16px 38px rgba(255, 183, 178, 0.34)",
          }}
        >
          <Sparkles style={{ width: "34px", height: "34px", color: "white" }} />
        </div>
        <h2
          style={{
            fontFamily: "'M PLUS Rounded 1c', sans-serif",
            fontSize: "clamp(1.7rem, 4vw, 2.4rem)",
            fontWeight: 900,
            color: "var(--text-main)",
            marginBottom: "8px",
          }}
        >
          Last page: how to actually use it
        </h2>
        <p style={{ fontSize: "0.96rem", color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: "680px", margin: "0 auto" }}>
          ABO's point isn't a one-time crawl but turning inputs into a reviewable knowledge structure every day. Read the map first, then follow the routine.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          justifyContent: "center",
          marginBottom: "22px",
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "999px",
                border: `1px solid ${active ? "var(--color-primary)" : "var(--border-light)"}`,
                background: active ? "rgba(188, 164, 227, 0.14)" : "var(--bg-card)",
                color: active ? "var(--color-primary)" : "var(--text-secondary)",
                fontSize: "0.82rem",
                fontWeight: 850,
                cursor: "pointer",
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      <main style={{ flex: 1, minHeight: 0, marginBottom: "26px" }}>{renderActiveContent()}</main>

      <footer style={{ display: "flex", justifyContent: "center" }}>
        <button
          onClick={onComplete}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "15px 32px",
            borderRadius: "999px",
            background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
            border: "none",
            color: "white",
            fontSize: "0.96rem",
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 12px 30px rgba(188, 164, 227, 0.34)",
          }}
        >
          <Check style={{ width: "19px", height: "19px" }} />
          Finish and enter ABO
          <ArrowRight style={{ width: "19px", height: "19px" }} />
        </button>
      </footer>
    </div>
  );
}
