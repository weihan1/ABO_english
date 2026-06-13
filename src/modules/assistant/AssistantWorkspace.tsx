import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BarChart3,
  BookHeart,
  BookOpen,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Compass,
  Database,
  Inbox,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  Send,
  Sparkles,
  Square,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import { PageContainer, PageContent, PageHeader } from "../../components/Layout";
import { api } from "../../core/api";
import { isActionEnterKey, isComposingKeyboardEvent } from "../../core/keyboard";
import { type ActiveTab, useStore } from "../../core/store";
import { useChat } from "../../hooks/useChat";
import type { ChatRunStatus, Message } from "../../types/chat";

interface AssistantOverviewResponse {
  system: {
    provider: "codex" | "claude";
    providerLabel: string;
    vaultReady: boolean;
    literatureReady: boolean;
  };
  inbox: {
    totalUnread: number;
    unreadByModule: Record<string, number>;
    spotlight: AssistantSpotlightCard[];
  };
  wiki: {
    intel: WikiSnapshot;
    lit: WikiSnapshot;
  };
  insights: {
    totalCards: number;
    thisWeek: number;
    readingStreak: number;
    topKeyword: string | null;
    todaySummary: string | null;
    activityCount: number;
    chatCount: number;
    moduleRunCount: number;
  };
  conversations: {
    activeCount: number;
    recent: RecentConversation[];
  };
}

interface AssistantSpotlightCard {
  id: string;
  title: string;
  summary: string;
  moduleId: string;
  score: number;
  tags: string[];
  sourceUrl: string;
  createdAt: number;
}

interface WikiSnapshot {
  ready: boolean;
  total: number;
  byCategory: Record<string, number>;
}

interface RecentConversation {
  id: string;
  title: string;
  cliType: string;
  updatedAt: number;
  rawConversationId: string;
  rawSessionId: string;
  lastMessagePreview: string;
}

interface AssistantSessionsResponse {
  items: RecentConversation[];
  count: number;
}

interface WorkflowRecipe {
  id: string;
  title: string;
  description: string;
  accent: string;
  skill: string;
  skillLabel: string;
  intent: string;
  fields: WorkflowField[];
  outputSpec: string[];
  wikiLinkage: string[];
  defaultExtra?: string;
}

interface WorkflowField {
  id: string;
  label: string;
  placeholder: string;
  helper?: string;
  multiline?: boolean;
  required?: boolean;
  defaultValue?: string;
}

interface JumpShortcut {
  id: string;
  title: string;
  description: string;
  tab: ActiveTab;
  accent: string;
  icon: ReactNode;
}

const MODULE_LABELS: Record<string, string> = {
  "arxiv-tracker": "ArXiv",
  "semantic-scholar-tracker": "Semantic Scholar",
  "xiaohongshu-tracker": "Xiaohongshu",
  "bilibili-tracker": "Bilibili",
  "xiaoyuzhou-tracker": "Xiaoyuzhou",
  "zhihu-tracker": "Zhihu",
  "folder-monitor": "Folder monitor",
};

const WORKFLOWS_PER_PAGE = 6;

const shellStyle: CSSProperties = {
  borderRadius: "8px",
  border: "1px solid rgba(24, 35, 52, 0.08)",
  background: "rgba(255, 255, 255, 0.9)",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  overflow: "hidden",
};

const sectionTitleStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  fontSize: "0.95rem",
  fontWeight: 700,
  color: "#17324d",
};

const badgeBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "7px 12px",
  borderRadius: "8px",
  fontSize: "0.8125rem",
  fontWeight: 700,
  border: "1px solid rgba(23, 50, 77, 0.12)",
};

function panelHeader(title: string, icon: ReactNode, extra?: ReactNode) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "18px 20px 14px",
        borderBottom: "1px solid rgba(24, 35, 52, 0.08)",
      }}
    >
      <div style={sectionTitleStyle}>
        {icon}
        <span>{title}</span>
      </div>
      {extra}
    </div>
  );
}

function CollapseToggle({
  expanded,
  onClick,
  expandLabel = "Expand",
  collapseLabel = "Collapse",
}: {
  expanded: boolean;
  onClick: () => void;
  expandLabel?: string;
  collapseLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        borderRadius: "8px",
        border: "1px solid rgba(23, 50, 77, 0.08)",
        background: "rgba(255,255,255,0.92)",
        color: "#425466",
        padding: "6px 10px",
        fontSize: "0.78rem",
        fontWeight: 700,
        cursor: "pointer",
      }}
      aria-label={expanded ? collapseLabel : expandLabel}
    >
      {expanded ? (
        <ChevronDown style={{ width: "14px", height: "14px" }} />
      ) : (
        <ChevronRight style={{ width: "14px", height: "14px" }} />
      )}
      <span>{expanded ? collapseLabel : expandLabel}</span>
    </button>
  );
}

function readableModuleName(moduleId: string): string {
  return MODULE_LABELS[moduleId] ?? moduleId;
}

function toMillis(value: number): number {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function relativeTime(rawValue: number): string {
  const value = toMillis(rawValue);
  const diff = Date.now() - value;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function summarizeCategories(snapshot: WikiSnapshot): string {
  const entries = Object.entries(snapshot.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  if (entries.length === 0) return "No pages consolidated yet";
  return entries.map(([name, count]) => `${name} ${count}`).join(" · ");
}

function buildSpotlightPrompt(card: AssistantSpotlightCard): string {
  const tagLine = card.tags.length > 0 ? `Tags: ${card.tags.join(" / ")}` : "Tags: none";
  return [
    "Process this Daily Briefing item into actionable output:",
    "1. Decide whether it belongs in the Internet Wiki, the Literature Wiki, or should stay as Daily Briefing only.",
    "2. Extract 3 key points and 2 next actions.",
    "3. If worth consolidating, suggest a Wiki page title and category.",
    "",
    `Title: ${card.title}`,
    `Summary: ${card.summary}`,
    tagLine,
    `Source module: ${readableModuleName(card.moduleId)}`,
  ].join("\n");
}

function buildWorkflowRecipes(data: AssistantOverviewResponse | null): WorkflowRecipe[] {
  const spotlight = data?.inbox.spotlight ?? [];
  const intelCount = data?.wiki.intel.total ?? 0;
  const litCount = data?.wiki.lit.total ?? 0;
  const topKeyword = data?.insights.topKeyword ?? "current preferences";
  const topTitles =
    spotlight
      .slice(0, 3)
      .map((item, index) => `${index + 1}. ${item.title}`)
      .join("\n") || "No new high-priority intel";

  return [
    {
      id: "mentor-followup",
      title: "Mentor-style follow-up paper review",
      description: "Point at a folder of follow-up paper notes and use mentor-zh for a research review, relationship map, and idea generation.",
      accent: "#0f766e",
      skill: "$mentor-zh",
      skillLabel: "mentor-zh",
      intent: "Do mentor-style follow-up research on a folder of paper markdown files: identify the source paper, analyze each paper's challenge, setting, technical approach, and insight, and produce structured output that can be written back to Obsidian/Literature Wiki.",
      fields: [
        {
          id: "paperFolder",
          label: "Paper folder path",
          placeholder: "/Users/huanc/Library/Mobile Documents/iCloud~md~obsidian/Documents/Research/Literature/xxx-followups",
          helper: "A directory of paper markdown files, usually the source paper plus follow-up papers.",
          required: true,
        },
      ],
      outputSpec: [
        "Run mentor-zh's paper context collection flow first, then synthesize.",
        "Output: source paper identification, per-paper challenge/setting/technical insights, follow-up relationship map, Obsidian backlink suggestions.",
        "Generate 10 sufficiently specific research ideas and flag the 3 most worth pursuing.",
        "If I filled in my own idea, separately assess its feasibility, gaps, and next experiments.",
      ],
      wikiLinkage: [
        "Results must include a Literature Wiki page structure.",
        "The relationship map must be compatible with Obsidian backlinks.",
        "Finally list the link blocks that should be written back to which paper notes.",
      ],
      defaultExtra: "",
    },
    {
      id: "profile-ops",
      title: "Organize personal intel profile",
      description: "Merge recent signals into a stable profile of persona, projects, and interests.",
      accent: "#0f766e",
      skill: "assistant-profile-intel",
      skillLabel: "Personal intel organization",
      intent: "Organize the user's recent interests, projects, habits, research status, and pending items into a long-term maintainable personal intel profile.",
      fields: [
        {
          id: "profileScope",
          label: "Scope",
          placeholder: "e.g. research directions, content inputs, project progress, and energy levels over the last 30 days",
          defaultValue: `Current preference keywords: ${topKeyword}`,
        },
        {
          id: "sourceMaterial",
          label: "Extra materials or paths",
          placeholder: "Internet Wiki path, Vault path, recent chat topics, or paste material directly.",
          multiline: true,
        },
        {
          id: "maintenanceGoal",
          label: "Maintenance goal",
          placeholder: "e.g. build a personal topic tree, update the research profile, prioritize the next two weeks",
          multiline: true,
        },
      ],
      outputSpec: [
        "Output a recommended personal profile structure.",
        "List the 5 topics most worth maintaining right now.",
        "Break each topic into evidence, judgments, and next actions.",
      ],
      wikiLinkage: [
        `Take into account the current Internet Wiki page count: ${intelCount}.`,
        "Suggest Internet Wiki page titles to add or update.",
        "Mark which content should stay in Daily Briefing only and not become long-term pages.",
      ],
    },
    {
      id: "intel-wiki",
      title: "Maintain Internet Wiki",
      description: "Consolidate recent personal intel and interest signals into stable knowledge.",
      accent: "#c2410c",
      skill: "assistant-intel-wiki",
      skillLabel: "Internet Wiki maintenance",
      intent: "Consolidate recent personal intel, interest signals, creator info, and action leads into Internet Wiki pages.",
      fields: [
        {
          id: "intelSource",
          label: "Intel to process",
          placeholder: "Paste intel titles/summaries, or specify reading from Daily Briefing, a module, or a path.",
          defaultValue: topTitles,
          multiline: true,
        },
        {
          id: "wikiCategory",
          label: "Target categories",
          placeholder: "e.g. research directions / creators / toolchain / long-term watch / project leads",
        },
        {
          id: "decisionRule",
          label: "Consolidation rules",
          placeholder: "e.g. keep only reusable judgments; don't turn transient news into long-term pages.",
          multiline: true,
        },
      ],
      outputSpec: [
        "List the Internet Wiki pages most worth adding or updating.",
        "For each page give the category, title, core outline, and evidence to append.",
        "List content not worth consolidating and why.",
      ],
      wikiLinkage: [
        `Take into account the current Internet Wiki page count: ${intelCount}.`,
        "Provide backlink relations between pages.",
        "Turn Daily Briefing items into page-update tasks, not just summaries.",
      ],
    },
    {
      id: "literature-ops",
      title: "Organize this week's papers",
      description: "Cluster by topic, fill gaps, and decide what goes into the Literature Library.",
      accent: "#7c3aed",
      skill: "assistant-literature-organizer",
      skillLabel: "Literature organization",
      intent: "Cluster this week's paper intel by research topic and decide what enters the Literature Wiki versus what stays as reading leads.",
      fields: [
        {
          id: "paperSources",
          label: "Paper sources",
          placeholder: "Paste a paper list, or point at arXiv/Semantic Scholar tracking results or a Literature Library path.",
          defaultValue: topTitles,
          multiline: true,
        },
        {
          id: "researchTheme",
          label: "Research topics",
          placeholder: "e.g. 3D scene understanding / robot foundation model / long-horizon planning",
        },
        {
          id: "readingConstraint",
          label: "Reading constraints",
          placeholder: "e.g. pick only the 5 most worth reading; prioritize survey gaps; rank by experimental reproducibility.",
          multiline: true,
        },
      ],
      outputSpec: [
        "Cluster the papers by research topic.",
        "Point out the gaps most worth filling and why.",
        "Provide Literature Wiki page titles, page structure, and reading priority.",
      ],
      wikiLinkage: [
        `Take into account the current Literature Wiki page count: ${litCount}.`,
        "Link the papers to existing Literature Wiki/Internet Wiki topics.",
        "Output a list that converts directly into reading to-dos.",
      ],
    },
    {
      id: "today-brief",
      title: "Summarize Daily Briefing",
      description: "Converge first, then give next steps — don't let the Feed stay at the browsing level.",
      accent: "#2563eb",
      skill: "assistant-daily-intel",
      skillLabel: "Daily Briefing wrap-up",
      intent: "Converge Daily Briefing from browsing into signal judgments, Wiki updates, and next actions.",
      fields: [
        {
          id: "todayScope",
          label: "Today's scope",
          placeholder: "e.g. all unread intel today / Xiaohongshu and arXiv / a few items I picked manually",
          defaultValue: `Unread intel: ${data?.inbox.totalUnread ?? 0}; activities today: ${data?.insights.activityCount ?? 0}; module runs: ${data?.insights.moduleRunCount ?? 0}`,
        },
        {
          id: "priorityQuestion",
          label: "Priority judgment",
          placeholder: "e.g. Which items advance my research? Which are noise? Which belong in the Wiki?",
          multiline: true,
        },
      ],
      outputSpec: [
        "Output today's 3 most important signals.",
        "For each signal give an action suggestion and where to consolidate it.",
        "Split into three buckets: Wiki updates, to-dos, ignore.",
      ],
      wikiLinkage: [
        "The Internet Wiki holds personal intel and long-term observations.",
        "The Literature Wiki holds papers, methods, and research threads.",
        "Insufficiently stable content stays as Daily Briefing notes only.",
      ],
    },
    {
      id: "analytics-review",
      title: "Review data insights",
      description: "Adjust upcoming focus based on reading streak, activity, and preferences.",
      accent: "#be123c",
      skill: "assistant-research-rhythm",
      skillLabel: "Research cadence review",
      intent: "Combine reading streak, activity, preference keywords, and new cards to judge the user's information intake cadence and next research actions.",
      fields: [
        {
          id: "metrics",
          label: "Current data",
          placeholder: "Total cards, new this week, reading streak days, preference keywords, etc.",
          defaultValue: `Total cards: ${data?.insights.totalCards ?? 0}; new this week: ${data?.insights.thisWeek ?? 0}; reading streak: ${data?.insights.readingStreak ?? 0} days; high-priority keywords: ${topKeyword}`,
          multiline: true,
        },
        {
          id: "reviewGoal",
          label: "Review goal",
          placeholder: "e.g. cut noisy inputs, pick next week's theme, find the single research thread most worth pushing.",
          multiline: true,
        },
      ],
      outputSpec: [
        "Assess the current information intake state.",
        "Point out what to do more of and less of.",
        "Give the 3 most worthwhile next actions.",
      ],
      wikiLinkage: [
        "Write stable preferences into the personal intel profile.",
        "Sync research topic changes to the Internet Wiki.",
        "Sync the literature reading plan to the Literature Wiki.",
      ],
    },
  ];
}

function workflowValue(
  values: Record<string, string>,
  field: WorkflowField,
): string {
  return values[field.id] ?? field.defaultValue ?? "";
}

function buildSkillWorkflowPrompt(
  workflow: WorkflowRecipe,
  values: Record<string, string> = {},
  extra = "",
): string {
  const fieldLines = workflow.fields.map((field) => {
    const value = workflowValue(values, field).trim();
    return `- ${field.label}${field.required ? " (required)" : ""}: ${value || "not filled in"}`;
  });
  const skillLine = workflow.skill.startsWith("$")
    ? `Use the ${workflow.skill} skill to complete this task.`
    : `Follow the \`${workflow.skill}\` workflow to complete this task; if a local skill or tool with the same name exists, call it first, otherwise execute with the assistant workspace context.`;

  return [
    skillLine,
    "",
    `Task: ${workflow.title}`,
    `Goal: ${workflow.intent}`,
    "",
    "Template content filled in by the user:",
    ...fieldLines,
    "",
    "Required output:",
    ...workflow.outputSpec.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Integration requirements with the ABO knowledge system:",
    ...workflow.wikiLinkage.map((item) => `- ${item}`),
    "",
    "Extra notes:",
    (extra || workflow.defaultExtra || "none").trim(),
    "",
    "Execution requirements:",
    "- Check for missing information first; if key information is insufficient, list the minimum the user must add, while pushing forward with what exists.",
    "- Output must convert directly into Wiki pages, to-dos, or next-round chat instructions.",
    "- Don't just summarize; produce actionable organization results.",
  ].join("\n");
}

function compactProcessText(value: unknown, fallback = ""): string {
  return String(value ?? fallback).trim();
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function splitToolMessage(message: Message) {
  const metadata = message.metadata ?? {};
  const command = compactProcessText(metadata.command ?? metadata.toolName);
  const rawContent = message.content.trim();
  const output = command && rawContent.startsWith(command)
    ? rawContent.slice(command.length).trim()
    : rawContent;

  return {
    command,
    output: output || "",
  };
}

function ProcessBlock({
  kind,
  title,
  message,
  defaultOpen,
}: {
  kind: "tool" | "thinking";
  title: string;
  message: Message;
  defaultOpen: boolean;
}) {
  const isTool = kind === "tool";
  const { command, output } = isTool ? splitToolMessage(message) : { command: "", output: message.content.trim() };
  const accent = isTool ? "#2563eb" : "#7c3aed";
  const metadataText = safeJson(message.metadata);

  return (
    <details open={defaultOpen}>
      <summary
        style={{
          cursor: "pointer",
          fontWeight: 800,
          color: accent,
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {isTool ? <Database style={{ width: "14px", height: "14px", flexShrink: 0 }} /> : <Brain style={{ width: "14px", height: "14px", flexShrink: 0 }} />}
        <span>{title}</span>
      </summary>

      <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {command && (
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748b", marginBottom: "5px" }}>Command</div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "rgba(37, 99, 235, 0.06)",
                border: "1px solid rgba(37, 99, 235, 0.1)",
                borderRadius: "8px",
                padding: "9px 10px",
                fontSize: "0.8rem",
                lineHeight: 1.55,
                color: "#1e3a5f",
              }}
            >
              {command}
            </pre>
          </div>
        )}

        {output ? (
          <div>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748b", marginBottom: "5px" }}>
              {isTool ? "Output" : "Thinking"}
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "rgba(15, 23, 42, 0.05)",
                border: "1px solid rgba(15, 23, 42, 0.08)",
                borderRadius: "8px",
                padding: "10px",
                fontSize: "0.82rem",
                lineHeight: 1.55,
                color: "#334155",
              }}
            >
              {output}
            </pre>
          </div>
        ) : (
          <div style={{ fontSize: "0.8rem", color: "#64748b" }}>Waiting for output...</div>
        )}

        {metadataText !== "{}" && (
          <details>
            <summary style={{ cursor: "pointer", color: "#64748b", fontSize: "0.76rem", fontWeight: 800 }}>
              Raw events
            </summary>
            <pre
              style={{
                margin: "8px 0 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "rgba(15, 23, 42, 0.04)",
                border: "1px solid rgba(15, 23, 42, 0.06)",
                borderRadius: "8px",
                padding: "8px",
                fontSize: "0.74rem",
                lineHeight: 1.45,
                color: "#64748b",
              }}
            >
              {metadataText}
            </pre>
          </details>
        )}
      </div>
    </details>
  );
}

function MessageBubble({ message, streaming }: { message: Message; streaming: boolean }) {
  const isUser = message.role === "user";
  const isError = message.contentType === "error";
  const isToolCall = message.contentType === "tool_call";
  const isThinking = message.contentType === "thinking";
  const toolLabel = compactProcessText(message.metadata?.label, message.status === "completed" ? "Command finished" : "Command running");
  const thinkingLabel = message.status === "completed" ? "Thought process" : "Thinking";

  if (!isUser && !isError && !isToolCall && !isThinking && !message.content.trim()) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          display: "flex",
          flexDirection: isUser ? "row-reverse" : "row",
          gap: "10px",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            background: isUser ? "#17324d" : isError ? "#fecaca" : "rgba(15, 118, 110, 0.12)",
            color: isUser ? "white" : isError ? "#7f1d1d" : "#0f766e",
          }}
        >
          {isUser ? (
            <Sparkles style={{ width: "16px", height: "16px" }} />
          ) : (
            <Bot style={{ width: "16px", height: "16px" }} />
          )}
        </div>

        <div
          style={{
            borderRadius: "8px",
            padding: "12px 14px",
            background: isUser ? "#17324d" : isError ? "rgba(254, 226, 226, 0.92)" : "rgba(255, 255, 255, 0.96)",
            color: isUser ? "white" : isError ? "#991b1b" : "#163047",
            border: isUser ? "none" : "1px solid rgba(23, 50, 77, 0.1)",
            boxShadow: "0 10px 28px rgba(15, 23, 42, 0.06)",
            fontSize: "0.925rem",
            lineHeight: 1.7,
          }}
        >
          {isUser ? (
            <div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
          ) : (
            <div className="prose prose-sm max-w-none" style={{ color: "inherit" }}>
              {isToolCall ? (
                <ProcessBlock kind="tool" title={toolLabel} message={message} defaultOpen={message.status !== "completed"} />
              ) : isThinking ? (
                <ProcessBlock kind="thinking" title={thinkingLabel} message={message} defaultOpen={message.status !== "completed"} />
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p style={{ margin: "0 0 8px", lineHeight: 1.75 }}>{children}</p>,
                    ul: ({ children }) => <ul style={{ margin: "0 0 8px 18px" }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ margin: "0 0 8px 18px" }}>{children}</ol>,
                    code: ({ children }) => (
                      <code
                        style={{
                          background: "rgba(15, 23, 42, 0.06)",
                          padding: "2px 6px",
                          borderRadius: "6px",
                          fontSize: "0.85em",
                        }}
                      >
                        {children}
                      </code>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              )}
              {!isToolCall && !isThinking && streaming && (
                <span
                  style={{
                    display: "inline-block",
                    width: "9px",
                    height: "16px",
                    borderRadius: "3px",
                    background: "#0f766e",
                    marginLeft: "4px",
                    animation: "pulse 1s ease-in-out infinite",
                  }}
                />
              )}
              {(isToolCall || isThinking) && message.status !== "completed" && (
                <Loader2 style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite", marginTop: "8px" }} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRunSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function RunStatusBar({ status }: { status: ChatRunStatus }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-start",
      }}
    >
      <div
        style={{
          maxWidth: "720px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          borderRadius: "8px",
          border: "1px solid rgba(37, 99, 235, 0.14)",
          background: "rgba(239, 246, 255, 0.82)",
          color: "#1e3a5f",
          padding: "9px 12px",
          fontSize: "0.82rem",
          lineHeight: 1.5,
          boxShadow: "0 8px 18px rgba(37, 99, 235, 0.06)",
        }}
      >
        <Loader2 style={{ width: "15px", height: "15px", animation: "spin 1s linear infinite", flexShrink: 0 }} />
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px",
              fontWeight: 700,
            }}
          >
            <span>Worker {formatRunSeconds(status.elapsedSeconds)}</span>
            <span style={{ color: "#2563eb" }}>{status.label}</span>
          </div>
          {status.detail && (
            <div
              style={{
                color: "#64748b",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "640px",
              }}
              title={status.detail}
            >
              {status.detail}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AssistantWorkspace() {
  const setActiveTab = useStore((state) => state.setActiveTab);
  const {
    availableClis,
    selectedCli,
    selectCli,
    activeConversation,
    createNewConversation,
    switchConversation,
    closeConversation,
    refreshConversations,
    messages,
    sendMessage,
    stopGeneration,
    isConnected,
    isStreaming,
    streamStatus,
    error: chatError,
  } = useChat();

  const [overview, setOverview] = useState<AssistantOverviewResponse | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentConversation[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [recentConversationsCollapsed, setRecentConversationsCollapsed] = useState(false);
  const [hoveredConversationId, setHoveredConversationId] = useState<string | null>(null);
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null);
  const [workflowPage, setWorkflowPage] = useState(0);
  const [jumpSectionExpanded, setJumpSectionExpanded] = useState(false);
  const [contextOverviewExpanded, setContextOverviewExpanded] = useState(false);
  const [workflowInputs, setWorkflowInputs] = useState<Record<string, Record<string, string>>>({});
  const [workflowExtras, setWorkflowExtras] = useState<Record<string, string>>({});
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const pendingAutoScrollRef = useRef(false);
  const streamingRef = useRef(false);

  const workflows = useMemo(() => buildWorkflowRecipes(overview), [overview]);
  const workflowPageCount = Math.max(1, Math.ceil(workflows.length / WORKFLOWS_PER_PAGE));
  const safeWorkflowPage = Math.min(workflowPage, workflowPageCount - 1);
  const visibleWorkflows = useMemo(
    () => workflows.slice(safeWorkflowPage * WORKFLOWS_PER_PAGE, (safeWorkflowPage + 1) * WORKFLOWS_PER_PAGE),
    [safeWorkflowPage, workflows],
  );
  const recentConversations = recentSessions;
  const workflowColumns =
    viewportWidth >= 960 ? "repeat(3, minmax(0, 1fr))" : viewportWidth >= 700 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)";
  const jumpColumns =
    viewportWidth >= 1180 ? "repeat(4, minmax(0, 1fr))" : viewportWidth >= 760 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)";
  const contextColumns =
    viewportWidth >= 1120 ? "repeat(3, minmax(0, 1fr))" : viewportWidth >= 760 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)";
  const composerColumns = viewportWidth >= 760 ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)";
  const contextPending = loading && !overview;
  const recentConversationColumns =
    viewportWidth >= 1180
      ? "repeat(auto-fill, minmax(138px, 1fr))"
      : viewportWidth >= 760
      ? "repeat(auto-fill, minmax(128px, 1fr))"
      : "repeat(2, minmax(0, 1fr))";

  const shortcuts = useMemo<JumpShortcut[]>(
    () => [
      {
        id: "overview",
        title: "Back to intel feed",
        description: overview ? `${overview.inbox.totalUnread} unread — keep filtering today's inputs.` : "Keep processing today's inputs and signals.",
        tab: "overview",
        accent: "#2563eb",
        icon: <Inbox style={{ width: "18px", height: "18px" }} />,
      },
      {
        id: "wiki",
        title: "Open Wiki",
        description: overview
          ? `Internet Wiki ${overview.wiki.intel.total} pages, Literature Wiki ${overview.wiki.lit.total} pages.`
          : "View consolidated knowledge pages.",
        tab: "wiki",
        accent: "#c2410c",
        icon: <BookHeart style={{ width: "18px", height: "18px" }} />,
      },
      {
        id: "literature",
        title: "View Literature Library",
        description: overview ? `Literature Wiki currently has ${overview.wiki.lit.total} pages.` : "Keep organizing papers and reading records.",
        tab: "literature",
        accent: "#7c3aed",
        icon: <BookOpen style={{ width: "18px", height: "18px" }} />,
      },
      {
        id: "dashboard",
        title: "View data overview",
        description: overview?.insights.topKeyword
          ? `Currently focused on ${overview.insights.topKeyword} — a good time for a review.`
          : "Go back to the overview page for overall status.",
        tab: "dashboard",
        accent: "#be123c",
        icon: <BarChart3 style={{ width: "18px", height: "18px" }} />,
      },
    ],
    [overview],
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.get<AssistantOverviewResponse>("/api/assistant/overview");
      setOverview(response);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load assistant data");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecentSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const response = await api.get<AssistantSessionsResponse>("/api/assistant/sessions?limit=12");
      setRecentSessions(response.items ?? []);
      setSessionCount(response.count ?? 0);
    } catch (error) {
      setLoadError((current) => current ?? (error instanceof Error ? error.message : "Failed to load recent conversations"));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const updateWorkflowInput = useCallback((workflowId: string, fieldId: string, value: string) => {
    setWorkflowInputs((current) => ({
      ...current,
      [workflowId]: {
        ...(current[workflowId] ?? {}),
        [fieldId]: value,
      },
    }));
  }, []);

  const updateWorkflowExtra = useCallback((workflowId: string, value: string) => {
    setWorkflowExtras((current) => ({
      ...current,
      [workflowId]: value,
    }));
  }, []);

  const buildWorkflowDraft = useCallback(
    (workflow: WorkflowRecipe) => buildSkillWorkflowPrompt(
      workflow,
      workflowInputs[workflow.id] ?? {},
      workflowExtras[workflow.id] ?? workflow.defaultExtra ?? "",
    ),
    [workflowExtras, workflowInputs],
  );

  const isNearBottom = useCallback((element: HTMLDivElement | null) => {
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  }, []);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = messageListRef.current;
    if (!element) return;
    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadOverview();
      void loadRecentSessions();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadOverview, loadRecentSessions]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setWorkflowPage((current) => Math.min(current, workflowPageCount - 1));
  }, [workflowPageCount]);

  useEffect(() => {
    if (expandedWorkflowId && !visibleWorkflows.some((workflow) => workflow.id === expandedWorkflowId)) {
      setExpandedWorkflowId(null);
    }
  }, [expandedWorkflowId, visibleWorkflows]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }

    if (pendingAutoScrollRef.current || shouldStickToBottomRef.current) {
      const frame = window.requestAnimationFrame(() => {
        scrollMessagesToBottom(pendingAutoScrollRef.current ? "smooth" : "auto");
        pendingAutoScrollRef.current = false;
        shouldStickToBottomRef.current = true;
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [activeConversation?.id, isStreaming, messages, scrollMessagesToBottom]);

  useEffect(() => {
    if (streamingRef.current && !isStreaming) {
      void loadOverview();
      void loadRecentSessions();
    }
    streamingRef.current = isStreaming;
  }, [isStreaming, loadOverview, loadRecentSessions]);

  useEffect(() => {
    pendingAutoScrollRef.current = true;
  }, [activeConversation?.id]);

  const handleMessageListScroll = useCallback(() => {
    shouldStickToBottomRef.current = isNearBottom(messageListRef.current);
  }, [isNearBottom]);

  const handleSendDraft = useCallback(async () => {
    const content = draft.trim();
    if (!content || isLaunching) return;

    setIsLaunching(true);
    pendingAutoScrollRef.current = true;
    try {
      if (!activeConversation) {
        const conversation = await createNewConversation(selectedCli?.id, content.slice(0, 24), undefined, "assistant");
        if (!conversation) return;
        await sendMessage(content, conversation, "assistant");
      } else {
        await sendMessage(content, undefined, "assistant");
      }
      setDraft("");
      void loadRecentSessions();
      void loadOverview();
    } finally {
      setIsLaunching(false);
    }
  }, [activeConversation, createNewConversation, draft, isLaunching, loadOverview, loadRecentSessions, selectedCli, sendMessage]);

  const handleRunWorkflow = useCallback(
    async (workflow: WorkflowRecipe) => {
      const prompt = buildWorkflowDraft(workflow);
      setIsLaunching(true);
      pendingAutoScrollRef.current = true;
      try {
        const conversation = await createNewConversation(selectedCli?.id, workflow.title, undefined, "assistant");
        if (!conversation) return;
        await sendMessage(prompt, conversation, "assistant");
        void loadRecentSessions();
        void loadOverview();
      } finally {
        setIsLaunching(false);
      }
    },
    [buildWorkflowDraft, createNewConversation, loadOverview, loadRecentSessions, selectedCli, sendMessage],
  );

  const handleStopCurrentTurn = useCallback(async () => {
    pendingAutoScrollRef.current = false;
    await stopGeneration(activeConversation?.id);
    void loadRecentSessions();
    void loadOverview();
  }, [activeConversation?.id, loadOverview, loadRecentSessions, stopGeneration]);

  const handleDeleteConversation = useCallback(
    async (session: RecentConversation) => {
      setRecentSessions((current) => current.filter((item) => item.id !== session.id));
      setSessionCount((current) => Math.max(0, current - 1));
      await api.delete<{ success: boolean }>(`/api/assistant/sessions/${session.id}`, {
        rawConversationId: session.rawConversationId,
        rawSessionId: session.rawSessionId,
      });
      await closeConversation(session.rawConversationId, {
        activateFallback: false,
        deleteRemote: true,
      });
      await refreshConversations();
      await loadRecentSessions();
      void loadOverview();
    },
    [closeConversation, loadOverview, loadRecentSessions, refreshConversations],
  );

  const handleOpenConversation = useCallback(
    async (rawConversationId: string) => {
      pendingAutoScrollRef.current = true;
      await switchConversation(rawConversationId);
    },
    [switchConversation],
  );

  const handleJump = useCallback(
    (tab: ActiveTab) => {
      setActiveTab(tab);
    },
    [setActiveTab],
  );

  const providerBadge = (
    <div
      style={{
        ...badgeBaseStyle,
        background: "rgba(15, 118, 110, 0.08)",
        color: "#0f766e",
      }}
    >
      <Bot style={{ width: "14px", height: "14px" }} />
      <span>{overview?.system.providerLabel ?? selectedCli?.name ?? "AI assistant"}</span>
    </div>
  );

  const connectionBadge = (
    <div
      style={{
        ...badgeBaseStyle,
        background: isConnected ? "rgba(22, 163, 74, 0.08)" : "rgba(225, 29, 72, 0.08)",
        color: isConnected ? "#15803d" : "#be123c",
      }}
    >
      {isConnected ? <Wifi style={{ width: "14px", height: "14px" }} /> : <WifiOff style={{ width: "14px", height: "14px" }} />}
      <span>{isConnected ? "Connected" : "Disconnected"}</span>
    </div>
  );

  const loadingBadge = loading ? (
    <div
      style={{
        ...badgeBaseStyle,
        background: "rgba(37, 99, 235, 0.08)",
        color: "#1d4ed8",
      }}
    >
      <Loader2 style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite" }} />
      <span>{overview ? "Refreshing" : "Loading context"}</span>
    </div>
  ) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Assistant"
        subtitle="Let your AI assistant organize information, maintain the Wiki, and turn Daily Briefing into action"
        icon={Bot}
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "10px" }}>
            {providerBadge}
            {connectionBadge}
            {loadingBadge}
            <button
              onClick={() => {
                void loadOverview();
              }}
              style={{
                ...badgeBaseStyle,
                background: "rgba(15, 23, 42, 0.06)",
                color: "#17324d",
                cursor: "pointer",
              }}
            >
              <RefreshCcw style={{ width: "14px", height: "14px" }} />
              <span>Refresh</span>
            </button>
          </div>
        }
      />

      <PageContent centered={false}>
        <div
          style={{
            maxWidth: "1280px",
            margin: "0 auto",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <section style={shellStyle}>
            {panelHeader(
              "Common assistants",
              <Compass style={{ width: "18px", height: "18px", color: "#0f766e" }} />,
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "flex-end" }}>
                <StatusPill
                  label="Internet Wiki"
                  value={
                    contextPending ? "Loading" : overview?.system.vaultReady ? "Ready" : "Needs setup"
                  }
                  accent="#c2410c"
                />
                <StatusPill
                  label="Literature Wiki"
                  value={
                    contextPending ? "Loading" : overview?.system.literatureReady ? "Ready" : "Needs setup"
                  }
                  accent="#7c3aed"
                />
                <StatusPill
                  label="Daily Briefing"
                  value={contextPending ? "Updating" : `${overview?.inbox.totalUnread ?? 0} unread`}
                  accent="#2563eb"
                />
              </div>,
            )}

            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {workflowPageCount > 1 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    color: "#64748b",
                    fontSize: "0.78rem",
                  }}
                >
                  <span>
                    {WORKFLOWS_PER_PAGE} per page · page {safeWorkflowPage + 1} / {workflowPageCount}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedWorkflowId(null);
                        setWorkflowPage((current) => Math.max(0, current - 1));
                      }}
                      disabled={safeWorkflowPage === 0}
                      style={{
                        borderRadius: "8px",
                        border: "1px solid rgba(23, 50, 77, 0.08)",
                        background: "rgba(255,255,255,0.92)",
                        color: safeWorkflowPage === 0 ? "#94a3b8" : "#425466",
                        padding: "6px 9px",
                        fontSize: "0.76rem",
                        fontWeight: 700,
                        cursor: safeWorkflowPage === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      Previous
                    </button>
                    {Array.from({ length: workflowPageCount }).map((_, index) => {
                      const active = index === safeWorkflowPage;
                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            setExpandedWorkflowId(null);
                            setWorkflowPage(index);
                          }}
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "8px",
                            border: active ? "1px solid rgba(15, 118, 110, 0.24)" : "1px solid rgba(23, 50, 77, 0.08)",
                            background: active ? "rgba(15, 118, 110, 0.1)" : "rgba(255,255,255,0.92)",
                            color: active ? "#0f766e" : "#425466",
                            fontSize: "0.76rem",
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                          aria-label={`Go to page ${index + 1}`}
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedWorkflowId(null);
                        setWorkflowPage((current) => Math.min(workflowPageCount - 1, current + 1));
                      }}
                      disabled={safeWorkflowPage >= workflowPageCount - 1}
                      style={{
                        borderRadius: "8px",
                        border: "1px solid rgba(23, 50, 77, 0.08)",
                        background: "rgba(255,255,255,0.92)",
                        color: safeWorkflowPage >= workflowPageCount - 1 ? "#94a3b8" : "#425466",
                        padding: "6px 9px",
                        fontSize: "0.76rem",
                        fontWeight: 700,
                        cursor: safeWorkflowPage >= workflowPageCount - 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: workflowColumns,
                  gap: "12px",
                  alignItems: "start",
                }}
              >
                {visibleWorkflows.map((workflow) => {
                  const expanded = expandedWorkflowId === workflow.id;
                  const values = workflowInputs[workflow.id] ?? {};
                  const extra = workflowExtras[workflow.id] ?? workflow.defaultExtra ?? "";
                  const missingRequired = workflow.fields.some((field) => field.required && !workflowValue(values, field).trim());
                  const prompt = buildWorkflowDraft(workflow);

                  return (
                    <div
                      key={workflow.id}
                      style={{
                        borderRadius: "8px",
                        border: expanded ? `1px solid ${workflow.accent}33` : "1px solid rgba(23, 50, 77, 0.08)",
                        background: `linear-gradient(180deg, ${workflow.accent}12 0%, rgba(255,255,255,0.98) 100%)`,
                        padding: expanded ? "14px" : 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: expanded ? "12px" : 0,
                        minHeight: expanded ? "auto" : "92px",
                        boxShadow: expanded ? `0 12px 28px ${workflow.accent}14` : "0 8px 18px rgba(15, 23, 42, 0.035)",
                        overflow: "hidden",
                        transition: "box-shadow 160ms ease, border-color 160ms ease",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedWorkflowId((current) => (current === workflow.id ? null : workflow.id))}
                        style={{
                          width: "100%",
                          border: "none",
                          background: "transparent",
                          padding: expanded ? 0 : "15px 14px",
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: "12px",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        aria-expanded={expanded}
                        aria-label={expanded ? "Collapse template" : "Expand template"}
                        title={expanded ? "Collapse template" : "Expand template"}
                      >
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "7px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            <span
                              style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "999px",
                                background: workflow.accent,
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                minWidth: 0,
                                color: "#17324d",
                                fontSize: "0.96rem",
                                fontWeight: 800,
                                lineHeight: 1.25,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {workflow.title}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: "0.8rem",
                              color: "#64748b",
                              lineHeight: 1.45,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {workflow.description}
                          </div>
                        </div>
                        <div
                          style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "8px",
                            border: "1px solid rgba(23, 50, 77, 0.08)",
                            background: "rgba(255,255,255,0.92)",
                            color: workflow.accent,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {expanded ? <ChevronDown style={{ width: "16px", height: "16px" }} /> : <ChevronRight style={{ width: "16px", height: "16px" }} />}
                        </div>
                      </button>

                      {expanded && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                alignSelf: "flex-start",
                                gap: "6px",
                                borderRadius: "8px",
                                border: `1px solid ${workflow.accent}24`,
                                background: "rgba(255,255,255,0.78)",
                                color: workflow.accent,
                                padding: "5px 8px",
                                fontSize: "0.72rem",
                                fontWeight: 800,
                              }}
                            >
                              <Sparkles style={{ width: "12px", height: "12px" }} />
                              <span>{workflow.skillLabel}</span>
                            </div>
                          </div>

                          {workflow.fields.map((field) => {
                            const value = workflowValue(values, field);
                            const fieldStyle: CSSProperties = {
                              width: "100%",
                              boxSizing: "border-box",
                              borderRadius: "8px",
                              border: "1px solid rgba(23, 50, 77, 0.12)",
                              background: "rgba(255,255,255,0.94)",
                              color: "#17324d",
                              outline: "none",
                              fontSize: "0.84rem",
                              lineHeight: 1.55,
                              padding: "9px 10px",
                            };

                            return (
                              <label key={field.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "#334155" }}>
                                  {field.label}
                                  {field.required && <span style={{ color: "#be123c" }}> *</span>}
                                </span>
                                {field.multiline ? (
                                  <textarea
                                    value={value}
                                    onChange={(event) => updateWorkflowInput(workflow.id, field.id, event.target.value)}
                                    placeholder={field.placeholder}
                                    rows={field.id === "paperFolder" ? 2 : 3}
                                    style={{ ...fieldStyle, resize: "vertical", minHeight: "82px", maxHeight: "180px" }}
                                  />
                                ) : (
                                  <input
                                    value={value}
                                    onChange={(event) => updateWorkflowInput(workflow.id, field.id, event.target.value)}
                                    placeholder={field.placeholder}
                                    style={fieldStyle}
                                  />
                                )}
                                {field.helper && (
                                  <span style={{ color: "#64748b", fontSize: "0.72rem", lineHeight: 1.5 }}>{field.helper}</span>
                                )}
                              </label>
                            );
                          })}

                          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "#334155" }}>Extra notes</span>
                            <textarea
                              value={extra}
                              onChange={(event) => updateWorkflowExtra(workflow.id, event.target.value)}
                              placeholder="Output format, emphasis, exclusions, or ask it to pull more Wiki/Literature Library context."
                              rows={3}
                              style={{
                                width: "100%",
                                boxSizing: "border-box",
                                borderRadius: "8px",
                                border: "1px solid rgba(23, 50, 77, 0.12)",
                                background: "rgba(255,255,255,0.94)",
                                color: "#17324d",
                                outline: "none",
                                resize: "vertical",
                                minHeight: "82px",
                                maxHeight: "180px",
                                fontSize: "0.84rem",
                                lineHeight: 1.55,
                                padding: "9px 10px",
                              }}
                            />
                          </label>
                        </div>
                      )}

                      {expanded && (
                        <div style={{ marginTop: "auto", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => setDraft(prompt)}
                            style={{
                              borderRadius: "8px",
                              border: "1px solid rgba(23, 50, 77, 0.1)",
                              background: "rgba(255,255,255,0.92)",
                              color: "#17324d",
                              padding: "8px 10px",
                              fontSize: "0.82rem",
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            Write to chat box
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleRunWorkflow(workflow);
                            }}
                            disabled={isLaunching || availableClis.length === 0 || missingRequired}
                            style={{
                              borderRadius: "8px",
                              border: "none",
                              background: workflow.accent,
                              color: "white",
                              padding: "8px 12px",
                              fontSize: "0.82rem",
                              fontWeight: 800,
                              cursor: isLaunching || availableClis.length === 0 || missingRequired ? "not-allowed" : "pointer",
                              opacity: isLaunching || availableClis.length === 0 || missingRequired ? 0.5 : 1,
                            }}
                            title={missingRequired ? "Fill in required fields first" : "Run template"}
                          >
                            Run template
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section style={{ ...shellStyle, minHeight: "72vh", display: "flex", flexDirection: "column" }}>
            {panelHeader(
              "Conversations",
              <MessageSquareText style={{ width: "18px", height: "18px", color: "#2563eb" }} />,
                <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700 }}>
                {sessionCount
                  ? `${sessionCount} active sessions`
                  : "Open a new one to get started"}
              </div>,
            )}

            <div
              style={{
                padding: "16px 18px",
                borderBottom: "1px solid rgba(24, 35, 52, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#64748b" }}>Recent conversations</div>
                  <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Click a card to enter, hover to delete</div>
                </div>
                <button
                  onClick={() => setRecentConversationsCollapsed((current) => !current)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    borderRadius: "8px",
                    border: "1px solid rgba(23, 50, 77, 0.08)",
                    background: "rgba(255,255,255,0.92)",
                    color: "#425466",
                    padding: "6px 10px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                  aria-label={recentConversationsCollapsed ? "Expand recent conversations" : "Collapse recent conversations"}
                >
                  {recentConversationsCollapsed ? (
                    <ChevronRight style={{ width: "14px", height: "14px" }} />
                  ) : (
                    <ChevronDown style={{ width: "14px", height: "14px" }} />
                  )}
                  <span>{recentConversationsCollapsed ? "Expand" : "Collapse"}</span>
                </button>
              </div>

              {!recentConversationsCollapsed && recentConversations.length > 0 ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: recentConversationColumns,
                    gap: "8px",
                  }}
                >
                  {recentConversations.slice(0, 12).map((conversation) => {
                    const active = activeConversation?.id === conversation.rawConversationId;
                    const deleteVisible = hoveredConversationId === conversation.id;
                    return (
                      <div
                        key={conversation.id}
                        onClick={() => {
                          void handleOpenConversation(conversation.rawConversationId);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void handleOpenConversation(conversation.rawConversationId);
                          }
                        }}
                        onMouseEnter={() => setHoveredConversationId(conversation.id)}
                        onMouseLeave={() => setHoveredConversationId((current) => (current === conversation.id ? null : current))}
                        onFocus={() => setHoveredConversationId(conversation.id)}
                        onBlur={() => setHoveredConversationId((current) => (current === conversation.id ? null : current))}
                        title={conversation.lastMessagePreview || conversation.title}
                        role="button"
                        tabIndex={0}
                        style={{
                          position: "relative",
                          minWidth: 0,
                          borderRadius: "8px",
                          border: active ? "1px solid rgba(15, 118, 110, 0.24)" : "1px solid rgba(23, 50, 77, 0.08)",
                          background: active ? "rgba(15, 118, 110, 0.08)" : "rgba(255,255,255,0.92)",
                          color: active ? "#0f766e" : "#425466",
                          padding: "10px 34px 10px 12px",
                          minHeight: "72px",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          gap: "8px",
                          cursor: "pointer",
                          textAlign: "left",
                          boxShadow: active ? "0 8px 18px rgba(15, 118, 110, 0.08)" : "0 8px 16px rgba(15, 23, 42, 0.04)",
                        }}
                      >
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteConversation(conversation);
                          }}
                          onMouseEnter={() => setHoveredConversationId(conversation.id)}
                          style={{
                            position: "absolute",
                            top: "8px",
                            right: "8px",
                            width: "22px",
                            height: "22px",
                            border: "none",
                            borderRadius: "999px",
                            background: active ? "rgba(255,255,255,0.82)" : "rgba(248, 250, 252, 0.96)",
                            color: "#b91c1c",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            opacity: deleteVisible ? 1 : 0,
                            pointerEvents: deleteVisible ? "auto" : "none",
                            transition: "opacity 140ms ease",
                            boxShadow: "0 4px 10px rgba(15, 23, 42, 0.08)",
                          }}
                          aria-label="Delete conversation"
                          title="Delete conversation"
                        >
                          <X style={{ width: "12px", height: "12px" }} />
                        </button>

                        <div
                          style={{
                            minWidth: 0,
                            fontSize: "0.82rem",
                            fontWeight: 700,
                            lineHeight: 1.4,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {conversation.title}
                        </div>

                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: active ? "rgba(15, 118, 110, 0.82)" : "#64748b",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {relativeTime(conversation.updatedAt)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: "0.84rem", color: "#64748b", lineHeight: 1.6 }}>
                  {recentConversationsCollapsed
                    ? "Recent conversations collapsed."
                    : sessionsLoading
                    ? "Reading local recent conversations..."
                    : sessionCount
                    ? `Syncing ${sessionCount} recent conversations...`
                    : "No conversation history yet. Any assistant action above starts one."}
                </div>
              )}
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                ref={messageListRef}
                onScroll={handleMessageListScroll}
                style={{
                  flex: 1,
                  minHeight: "360px",
                  overflowY: "auto",
                  padding: "18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  background: "linear-gradient(180deg, rgba(248,250,252,0.88) 0%, rgba(241,245,249,0.78) 100%)",
                }}
              >
                {!activeConversation && messages.length === 0 && (
                  <div
                    style={{
                      minHeight: "44vh",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      textAlign: "left",
                      color: "#516579",
                    }}
                  >
                    <div style={{ maxWidth: "560px", display: "flex", flexDirection: "column", gap: "14px" }}>
                      <div
                        style={{
                          width: "52px",
                          height: "52px",
                          borderRadius: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "linear-gradient(135deg, rgba(15,118,110,0.18), rgba(37,99,235,0.16))",
                          color: "#0f766e",
                        }}
                      >
                        <Bot style={{ width: "28px", height: "28px" }} />
                      </div>
                      <div style={{ fontSize: "1.24rem", fontWeight: 800, color: "#17324d", lineHeight: 1.35 }}>
                        Pick a task first, or just tell the assistant what you want organized.
                      </div>
                      <div style={{ fontSize: "0.95rem", lineHeight: 1.7 }}>
                        {contextPending
                          ? "You can start a conversation directly."
                          : "Context is ready. Start from a common assistant, or send a more specific instruction directly."}
                      </div>
                    </div>
                  </div>
                )}

                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    streaming={isStreaming && index === messages.length - 1 && message.role === "assistant"}
                  />
                ))}
                {streamStatus && <RunStatusBar status={streamStatus} />}
              </div>

              <div
                style={{
                  borderTop: "1px solid rgba(24, 35, 52, 0.08)",
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {availableClis.length > 0 ? (
                    availableClis.map((cli) => {
                      const active = selectedCli?.id === cli.id;
                      return (
                        <button
                          key={cli.id}
                          onClick={() => selectCli(cli)}
                          style={{
                            borderRadius: "8px",
                            border: active ? "1px solid rgba(15,118,110,0.18)" : "1px solid rgba(23, 50, 77, 0.08)",
                            background: active ? "rgba(15,118,110,0.08)" : "rgba(255,255,255,0.92)",
                            color: active ? "#0f766e" : "#425466",
                            padding: "7px 11px",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {cli.name}
                        </button>
                      );
                    })
                  ) : (
                    <div style={{ fontSize: "0.84rem", color: "#be123c", fontWeight: 700 }}>No usable AI assistant detected</div>
                  )}
                </div>

                {chatError && (
                  <div
                    style={{
                      borderRadius: "8px",
                      background: "rgba(254, 226, 226, 0.86)",
                      border: "1px solid rgba(239, 68, 68, 0.18)",
                      color: "#991b1b",
                      padding: "10px 12px",
                      fontSize: "0.86rem",
                    }}
                  >
                    {chatError}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: composerColumns,
                    gap: "10px",
                    alignItems: "end",
                  }}
                >
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (isComposingKeyboardEvent(event)) return;

                      if (isActionEnterKey(event) && !event.shiftKey) {
                        event.preventDefault();
                        void handleSendDraft();
                      }
                    }}
                    placeholder="e.g. Turn today's high-value intel into a Wiki plan, then give me next actions."
                    rows={4}
                    style={{
                      resize: "vertical",
                      minHeight: "108px",
                      maxHeight: "240px",
                      borderRadius: "8px",
                      border: "1px solid rgba(23, 50, 77, 0.12)",
                      background: "rgba(255,255,255,0.96)",
                      padding: "14px 16px",
                      outline: "none",
                      fontSize: "0.93rem",
                      lineHeight: 1.7,
                      color: "#17324d",
                    }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "flex-end" }}>
                    {isStreaming && (
                      <button
                        onClick={() => {
                          void handleStopCurrentTurn();
                        }}
                        style={{
                          height: "46px",
                          borderRadius: "8px",
                          border: "1px solid rgba(185, 28, 28, 0.18)",
                          background: "rgba(254, 226, 226, 0.92)",
                          color: "#991b1b",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                          cursor: "pointer",
                          padding: "0 14px",
                          minWidth: "96px",
                          fontWeight: 800,
                        }}
                        title="Stop current reply"
                      >
                        <Square style={{ width: "15px", height: "15px", fill: "currentColor" }} />
                        <span>Stop</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        void handleSendDraft();
                      }}
                      disabled={!draft.trim() || availableClis.length === 0 || isLaunching}
                      style={{
                        height: "46px",
                        borderRadius: "8px",
                        border: "none",
                        background:
                          !draft.trim() || availableClis.length === 0 || isLaunching ? "rgba(148, 163, 184, 0.5)" : "#17324d",
                        color: "white",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        cursor: !draft.trim() || availableClis.length === 0 || isLaunching ? "not-allowed" : "pointer",
                        padding: "0 16px",
                        minWidth: "96px",
                        fontWeight: 800,
                      }}
                    >
                      {isLaunching ? (
                        <Loader2 style={{ width: "18px", height: "18px", animation: "spin 1s linear infinite" }} />
                      ) : (
                        <Send style={{ width: "18px", height: "18px" }} />
                      )}
                      <span>{isLaunching ? "Processing" : "Send"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section style={shellStyle}>
            {panelHeader(
              "Quick jump",
              <BookOpen style={{ width: "18px", height: "18px", color: "#c2410c" }} />,
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                {loadError && (
                  <div
                    style={{
                      ...badgeBaseStyle,
                      padding: "6px 10px",
                      background: "rgba(254, 226, 226, 0.9)",
                      color: "#b91c1c",
                      borderColor: "rgba(239, 68, 68, 0.2)",
                    }}
                  >
                    {loadError}
                  </div>
                )}
                <CollapseToggle
                  expanded={jumpSectionExpanded}
                  onClick={() => setJumpSectionExpanded((current) => !current)}
                />
              </div>,
            )}

            {jumpSectionExpanded && (
              <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ maxWidth: "760px", color: "#516579", fontSize: "0.86rem", lineHeight: 1.65 }}>
                  Jump straight to the matching workspace; your chat draft is kept when you return to the assistant.
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: jumpColumns,
                    gap: "10px",
                  }}
                >
                  {shortcuts.map((shortcut) => (
                    <button
                      key={shortcut.id}
                      onClick={() => handleJump(shortcut.tab)}
                      style={{
                        borderRadius: "8px",
                        border: "1px solid rgba(23, 50, 77, 0.08)",
                        background: "rgba(255,255,255,0.96)",
                        padding: "11px",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          background: `${shortcut.accent}12`,
                          color: shortcut.accent,
                        }}
                      >
                        {shortcut.icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#17324d", marginBottom: "3px" }}>
                          {shortcut.title}
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#516579", lineHeight: 1.5 }}>{shortcut.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section style={shellStyle}>
            {panelHeader(
              "Context overview",
              <Database style={{ width: "18px", height: "18px", color: "#17324d" }} />,
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                  {contextPending ? "Updating in background" : "Ready to feed into chat"}
                </div>
                <CollapseToggle
                  expanded={contextOverviewExpanded}
                  onClick={() => setContextOverviewExpanded((current) => !current)}
                />
              </div>,
            )}

            {contextOverviewExpanded && (
              <div
                style={{
                  padding: "14px",
                  display: "grid",
                  gridTemplateColumns: contextColumns,
                  gap: "12px",
                }}
              >
                <ContextCard title="Daily Briefing" accent="#2563eb" icon={<Inbox style={{ width: "18px", height: "18px" }} />}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                    <MetricTile label="Unread" value={overview?.inbox.totalUnread ?? 0} color="#2563eb" loading={contextPending} />
                    <MetricTile
                      label="Active modules"
                      value={Object.keys(overview?.inbox.unreadByModule ?? {}).length}
                      color="#0f766e"
                      loading={contextPending}
                    />
                  </div>

                  {contextPending ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <SkeletonBlock height="72px" />
                      <SkeletonBlock height="72px" />
                    </div>
                  ) : (overview?.inbox.spotlight ?? []).length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {(overview?.inbox.spotlight ?? []).slice(0, 3).map((card) => (
                        <button
                          key={card.id}
                          onClick={() => setDraft(buildSpotlightPrompt(card))}
                          style={{
                            textAlign: "left",
                            borderRadius: "8px",
                            border: "1px solid rgba(23, 50, 77, 0.08)",
                            background: "rgba(248,250,252,0.96)",
                            padding: "12px",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                            <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#2563eb" }}>
                              {readableModuleName(card.moduleId)}
                            </span>
                            <span style={{ fontSize: "0.74rem", color: "#64748b" }}>{relativeTime(card.createdAt)}</span>
                          </div>
                          <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#17324d", lineHeight: 1.45 }}>
                            {card.title}
                          </div>
                          <div style={{ fontSize: "0.82rem", lineHeight: 1.6, color: "#516579" }}>{card.summary}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.84rem", color: "#64748b", lineHeight: 1.6 }}>
                      No new high-priority intel. Keep organizing in the intel feed and this fills in automatically.
                    </div>
                  )}
                </ContextCard>

                <ContextCard title="Knowledge Base Status" accent="#c2410c" icon={<BookHeart style={{ width: "18px", height: "18px" }} />}>
                  <WikiBlock
                    title="Internet Wiki"
                    snapshot={overview?.wiki.intel ?? { ready: false, total: 0, byCategory: {} }}
                    color="#c2410c"
                    loading={contextPending}
                    onDraft={() => {
                      const workflow = workflows.find((item) => item.id === "intel-wiki");
                      if (workflow) setDraft(buildWorkflowDraft(workflow));
                    }}
                  />
                  <WikiBlock
                    title="Literature Wiki"
                    snapshot={overview?.wiki.lit ?? { ready: false, total: 0, byCategory: {} }}
                    color="#7c3aed"
                    loading={contextPending}
                    onDraft={() => {
                      const workflow = workflows.find((item) => item.id === "literature-ops");
                      if (workflow) setDraft(buildWorkflowDraft(workflow));
                    }}
                  />
                </ContextCard>

                <ContextCard title="Data Insights" accent="#be123c" icon={<Brain style={{ width: "18px", height: "18px" }} />}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                    <MetricTile label="Total cards" value={overview?.insights.totalCards ?? 0} color="#be123c" loading={contextPending} />
                    <MetricTile label="Streak days" value={overview?.insights.readingStreak ?? 0} color="#0f766e" loading={contextPending} />
                    <MetricTile label="New this week" value={overview?.insights.thisWeek ?? 0} color="#2563eb" loading={contextPending} />
                    <MetricTile label="Chats" value={overview?.insights.chatCount ?? 0} color="#c2410c" loading={contextPending} />
                  </div>

                  {contextPending ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <SkeletonBlock height="14px" width="72px" />
                      <SkeletonBlock height="24px" width="58%" />
                      <SkeletonBlock height="56px" />
                    </div>
                  ) : (
                    <div
                      style={{
                        borderRadius: "8px",
                        border: "1px solid rgba(23, 50, 77, 0.08)",
                        background: "rgba(248,250,252,0.94)",
                        padding: "12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748b" }}>Preference focus</div>
                      <div style={{ fontSize: "1rem", fontWeight: 800, color: "#17324d" }}>
                        {overview?.insights.topKeyword ?? "No stable preference yet"}
                      </div>
                      <div style={{ fontSize: "0.84rem", lineHeight: 1.65, color: "#516579" }}>
                        {overview?.insights.todaySummary ??
                          "No auto-summary today yet. Start a conversation and the assistant will combine Daily Briefing with your workflows."}
                      </div>
                    </div>
                  )}
                </ContextCard>
              </div>
            )}
          </section>

          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.35; }
            }

            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }

            @keyframes assistant-skeleton {
              0% { opacity: 0.55; }
              50% { opacity: 1; }
              100% { opacity: 0.55; }
            }
          `}</style>
        </div>
      </PageContent>
    </PageContainer>
  );
}

function StatusPill({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "5px 8px",
        borderRadius: "8px",
        background: `${accent}12`,
        color: accent,
        fontSize: "0.74rem",
        fontWeight: 700,
      }}
    >
      <span>{label}</span>
      <span style={{ color: "#17324d" }}>{value}</span>
    </div>
  );
}

function ContextCard({
  title,
  icon,
  accent,
  children,
}: {
  title: string;
  icon: ReactNode;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        borderRadius: "8px",
        border: "1px solid rgba(23, 50, 77, 0.08)",
        background: "rgba(255,255,255,0.96)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${accent}12`,
            color: accent,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#17324d" }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

function SkeletonBlock({
  width = "100%",
  height = "16px",
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: "6px",
        background: "linear-gradient(90deg, rgba(226,232,240,0.7) 0%, rgba(241,245,249,1) 50%, rgba(226,232,240,0.7) 100%)",
        animation: "assistant-skeleton 1.4s ease-in-out infinite",
      }}
    />
  );
}

function MetricTile({
  label,
  value,
  color,
  loading = false,
}: {
  label: string;
  value: ReactNode;
  color: string;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: "8px",
        border: "1px solid rgba(23, 50, 77, 0.08)",
        background: "rgba(248,250,252,0.94)",
        padding: "12px",
      }}
    >
      <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "#64748b", marginBottom: "8px" }}>{label}</div>
      {loading ? <SkeletonBlock height="24px" width="60%" /> : <div style={{ fontSize: "1.2rem", fontWeight: 800, color }}>{value}</div>}
    </div>
  );
}

function WikiBlock({
  title,
  snapshot,
  color,
  onDraft,
  loading = false,
}: {
  title: string;
  snapshot: WikiSnapshot;
  color: string;
  onDraft: () => void;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: "8px",
        border: "1px solid rgba(23, 50, 77, 0.08)",
        background: "rgba(248,250,252,0.94)",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#17324d" }}>{title}</div>
        {loading ? (
          <SkeletonBlock width="72px" height="28px" />
        ) : (
          <div style={{ ...badgeBaseStyle, padding: "5px 10px", background: `${color}12`, color }}>
            <Database style={{ width: "13px", height: "13px" }} />
            <span>{snapshot.ready ? `${snapshot.total} pages` : "Not connected"}</span>
          </div>
        )}
      </div>

      {loading ? (
        <SkeletonBlock height="14px" width="82%" />
      ) : (
        <div style={{ fontSize: "0.84rem", lineHeight: 1.6, color: "#516579" }}>
          {snapshot.ready ? summarizeCategories(snapshot) : "Configure a local Vault first so the assistant can consolidate results into the Wiki."}
        </div>
      )}

      <button
        onClick={onDraft}
        disabled={loading}
        style={{
          alignSelf: "flex-start",
          borderRadius: "8px",
          border: "1px solid rgba(23, 50, 77, 0.1)",
          background: "rgba(255,255,255,0.96)",
          color: "#17324d",
          padding: "8px 10px",
          fontSize: "0.82rem",
          fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.6 : 1,
        }}
      >
        Generate maintenance instruction
      </button>
    </div>
  );
}
