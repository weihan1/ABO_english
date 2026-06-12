import { useState, useEffect } from "react";
import { Map as MapIcon, FileText, BookOpen, Sparkles, ArrowRight } from "lucide-react";
import { PageContainer, PageHeader, EmptyState } from "../../components/Layout";
import { api } from "../../core/api";
import { useToast } from "../../components/Toast";
import WikiSidebar from "./WikiSidebar";
import WikiPageView from "./WikiPageView";
import type { WikiType, ViewMode } from "./Wiki";

interface Props {
  wikiType: WikiType;
  activePage: string | null;
  viewMode: ViewMode;
  onBack: () => void;
  onSelectPage: (slug: string) => void;
  onNavigateToPage: (slug: string) => void;
  onSetViewMode: (mode: ViewMode) => void;
}

interface WikiControlData {
  wiki_type: string;
  wiki_title: string;
  has_overview: boolean;
  primary_action_label: string;
  workflow_hint: string;
  source_summary: {
    total_sources: number;
    total_discovered_sources?: number;
    enabled_folder_count?: number;
    disabled_folder_count?: number;
    collections: Array<{ label: string; count: number }>;
    top_tags: string[];
    recent_sources: Array<{
      title: string;
      collection: string;
      path: string;
      excerpt: string;
      updated: number;
    }>;
  };
  source_folders: Array<{
    id: string;
    label: string;
    relative_path: string;
    folder_path: string;
    note_count: number;
    enabled: boolean;
    page_slug: string;
    has_page: boolean;
    top_tags: string[];
    highlights: string[];
    updated: number;
  }>;
  scan_roots: string[];
  source_config_updated: string;
  reference_notes: Array<{
    title: string;
    path: string;
    excerpt: string;
    score: number;
  }>;
}

export default function WikiView({
  wikiType,
  activePage,
  viewMode,
  onBack,
  onSelectPage,
  onNavigateToPage,
  onSetViewMode,
}: Props) {
  const toast = useToast();
  const wikiTitle = wikiType === "intel" ? "Internet Wiki" : "Literature Wiki";
  const [control, setControl] = useState<WikiControlData | null>(null);
  const [controlLoading, setControlLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [sourceSavingId, setSourceSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchControl() {
      setControlLoading(true);
      try {
        const data = await api.get<WikiControlData>(`/api/wiki/${wikiType}/control`);
        if (!cancelled) setControl(data);
      } catch {
        if (!cancelled) setControl(null);
      } finally {
        if (!cancelled) setControlLoading(false);
      }
    }
    fetchControl();
    return () => { cancelled = true; };
  }, [wikiType]);

  useEffect(() => {
    if (!activePage && viewMode === "pages" && control?.has_overview) {
      onSelectPage("overview");
    }
  }, [activePage, control?.has_overview, onSelectPage, viewMode]);

  async function refreshControl() {
    try {
      const data = await api.get<WikiControlData>(`/api/wiki/${wikiType}/control`);
      setControl(data);
    } catch {
      // ignore refresh errors; the next full reload will retry
    }
  }

  async function openInObsidian(slug?: string) {
    try {
      await api.post(`/api/wiki/${wikiType}/open`, slug ? { slug } : {});
    } catch (error) {
      toast.error("Failed to open", error instanceof Error ? error.message : "Please check the Obsidian path");
    }
  }

  async function bootstrapWiki() {
    setActionLoading(true);
    try {
      const result = await api.post<{ pages_updated: number }>("/api/wiki/" + wikiType + "/bootstrap", {});
      await refreshControl();
      onSelectPage("overview");
      toast.success(
        wikiType === "intel" ? "Internet Wiki generated" : "Literature Wiki generated",
        `Updated ${result.pages_updated} starter pages`
      );
    } catch (error) {
      toast.error("Generation failed", error instanceof Error ? error.message : "Please try again later");
    } finally {
      setActionLoading(false);
    }
  }

  async function updateSourceFolder(folderId: string, enabled: boolean) {
    if (!control) return;
    const nextStates = Object.fromEntries(
      control.source_folders.map((item) => [item.id, item.id === folderId ? enabled : item.enabled])
    );
    setSourceSavingId(folderId);
    try {
      const result = await api.post<{ control: WikiControlData }>(`/api/wiki/${wikiType}/sources`, {
        folder_states: nextStates,
      });
      setControl(result.control);
      toast.success(
        "Source folder updated",
        enabled ? "This folder will join the next Wiki generation" : "This folder will be excluded from the next Wiki generation"
      );
    } catch (error) {
      toast.error("Update failed", error instanceof Error ? error.message : "Please try again later");
    } finally {
      setSourceSavingId(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={wikiTitle}
        subtitle={wikiType === "intel" ? "Generate the Internet Wiki overview first, then add from Daily Briefing with one click" : "Generate the Literature Wiki overview first, then link new papers, follow-ups, old notes, and guidance"}
        actions={
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              onClick={bootstrapWiki}
              disabled={actionLoading}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
                color: "white",
                border: "none",
                cursor: actionLoading ? "wait" : "pointer",
                transition: "all 0.2s ease",
                fontSize: "0.8125rem",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 8px 24px rgba(188, 164, 227, 0.24)",
                opacity: actionLoading ? 0.8 : 1,
              }}
            >
              <Sparkles style={{ width: "14px", height: "14px" }} />
              {actionLoading ? "Generating..." : (control?.primary_action_label ?? (wikiType === "intel" ? "Generate Internet Wiki overview" : "Generate Literature Wiki overview"))}
            </button>
            <button
              onClick={() => openInObsidian(activePage ?? undefined)}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                background: "var(--bg-card)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-light)",
                cursor: "pointer",
                transition: "all 0.2s ease",
                fontSize: "0.8125rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginRight: "8px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--color-primary-light)";
                e.currentTarget.style.color = "var(--color-primary-dark)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border-light)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <BookOpen style={{ width: "14px", height: "14px" }} />
              Obsidian
            </button>
            <button
              onClick={() => onSetViewMode("pages")}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                background: viewMode === "pages"
                  ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))"
                  : "var(--bg-card)",
                color: viewMode === "pages" ? "white" : "var(--text-secondary)",
                border: viewMode === "pages" ? "none" : "1px solid var(--border-light)",
                cursor: "pointer",
                transition: "all 0.2s ease",
                fontSize: "0.8125rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <FileText style={{ width: "14px", height: "14px" }} />
              Pages
            </button>
            <button
              onClick={() => onSetViewMode("mindmap")}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                background: viewMode === "mindmap"
                  ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))"
                  : "var(--bg-card)",
                color: viewMode === "mindmap" ? "white" : "var(--text-secondary)",
                border: viewMode === "mindmap" ? "none" : "1px solid var(--border-light)",
                cursor: "pointer",
                transition: "all 0.2s ease",
                fontSize: "0.8125rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <MapIcon style={{ width: "14px", height: "14px" }} />
              Mind map
            </button>
          </div>
        }
      />

      {/* Main body: sidebar + content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* Sidebar */}
        <WikiSidebar
          wikiType={wikiType}
          activePage={activePage}
          onSelectPage={onSelectPage}
          onBack={onBack}
        />

        {/* Content area */}
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {viewMode === "mindmap" ? (
            <WikiMindMapPlaceholder wikiType={wikiType} onSelectPage={(slug) => { onNavigateToPage(slug); onSetViewMode("pages"); }} />
          ) : activePage ? (
            <WikiPageView
              wikiType={wikiType}
              slug={activePage}
              onNavigateToPage={onNavigateToPage}
            />
          ) : (
            <WikiControlPanel
              wikiType={wikiType}
              control={control}
              loading={controlLoading}
              actionLoading={actionLoading}
              sourceSavingId={sourceSavingId}
              onBootstrap={bootstrapWiki}
              onOpenOverview={() => onSelectPage("overview")}
              onOpenObsidian={() => openInObsidian()}
              onOpenPage={onSelectPage}
              onToggleSourceFolder={updateSourceFolder}
            />
          )}
        </div>
      </div>
    </PageContainer>
  );
}

interface WikiControlPanelProps {
  wikiType: WikiType;
  control: WikiControlData | null;
  loading: boolean;
  actionLoading: boolean;
  sourceSavingId: string | null;
  onBootstrap: () => void;
  onOpenOverview: () => void;
  onOpenObsidian: () => void;
  onOpenPage: (slug: string) => void;
  onToggleSourceFolder: (folderId: string, enabled: boolean) => void;
}

function WikiControlPanel({
  wikiType,
  control,
  loading,
  actionLoading,
  sourceSavingId,
  onBootstrap,
  onOpenOverview,
  onOpenObsidian,
  onOpenPage,
  onToggleSourceFolder,
}: WikiControlPanelProps) {
  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
        }}
      >
        Loading...
      </div>
    );
  }

  if (!control) {
    return (
      <EmptyState
        icon={FileText}
        title="Wiki status unavailable right now"
        description="Try again later, or check that the Obsidian path is usable"
      />
    );
  }

  const usageSteps = wikiType === "intel"
    ? [
        "Click \"Generate Internet Wiki overview\" first so your current Bilibili / Xiaohongshu collections grow into an overview page.",
        "Later, when you see content worth keeping in Daily Briefing, just click \"Write to Internet Wiki\".",
        "Back on the overview page, you only top up the highlights — no organizing from scratch.",
      ]
    : [
        "Click \"Generate Literature Wiki overview\" first to grow existing papers, follow-ups, and old archives into an overview page.",
        "Later, newly found or newly read papers are added to the Literature Wiki when you click \"Save to Literature Library\".",
        "Internal pages in the overview show topic threads; click \"Mind map\" above to see relationships, and external links go back to the actual markdown.",
      ];

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(24px, 3vw, 40px)",
      }}
    >
      <div style={{ maxWidth: "860px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "28px" }}>
        <section
          style={{
            display: "grid",
            gap: "18px",
            padding: "24px",
            borderRadius: "12px",
            background: "linear-gradient(135deg, rgba(188, 164, 227, 0.14), rgba(168, 230, 207, 0.12))",
            border: "1px solid rgba(188, 164, 227, 0.16)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginBottom: "8px", color: "var(--color-primary-dark)", fontSize: "0.8125rem", fontWeight: 700 }}>
                <Sparkles style={{ width: "14px", height: "14px" }} />
                Recommended first move
              </div>
              <h2 style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif", fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)", lineHeight: 1.3 }}>
                {wikiType === "intel" ? "Let your collections grow an Internet Wiki overview first" : "Let papers, follow-ups, and old notes grow a Literature Wiki overview first"}
              </h2>
              <p style={{ marginTop: "10px", fontSize: "0.9375rem", lineHeight: 1.7, color: "var(--text-secondary)", maxWidth: "640px" }}>
                {control.workflow_hint}
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                onClick={onBootstrap}
                disabled={actionLoading}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "11px 16px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: actionLoading ? "wait" : "pointer",
                  background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
                  color: "white",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  boxShadow: "0 10px 24px rgba(188, 164, 227, 0.24)",
                }}
              >
                <Sparkles style={{ width: "15px", height: "15px" }} />
                {actionLoading ? "Generating..." : control.primary_action_label}
              </button>

              {control.has_overview && (
                <button
                  onClick={onOpenOverview}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "11px 16px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-light)",
                    cursor: "pointer",
                    background: "var(--bg-card)",
                    color: "var(--text-secondary)",
                    fontSize: "0.875rem",
                    fontWeight: 700,
                  }}
                >
                  Open overview
                  <ArrowRight style={{ width: "15px", height: "15px" }} />
                </button>
              )}

              <button
                onClick={onOpenObsidian}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "11px 16px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-light)",
                  cursor: "pointer",
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                }}
              >
                <BookOpen style={{ width: "15px", height: "15px" }} />
                View in Obsidian
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
            <div style={{ padding: "14px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.56)", border: "1px solid rgba(255,255,255,0.5)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: "6px" }}>Source count</div>
              <div style={{ fontSize: "1.375rem", fontWeight: 700, color: "var(--text-main)" }}>
                {control.source_summary.total_sources}
              </div>
            </div>
            <div style={{ padding: "14px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.56)", border: "1px solid rgba(255,255,255,0.5)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: "6px" }}>Enabled folders</div>
              <div style={{ fontSize: "1.375rem", fontWeight: 700, color: "var(--text-main)" }}>
                {control.source_summary.enabled_folder_count ?? control.source_folders.length}
              </div>
            </div>
            <div style={{ padding: "14px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.56)", border: "1px solid rgba(255,255,255,0.5)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: "6px" }}>Excluded folders</div>
              <div style={{ fontSize: "1.375rem", fontWeight: 700, color: "var(--text-main)" }}>
                {control.source_summary.disabled_folder_count ?? 0}
              </div>
            </div>
            <div style={{ padding: "14px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.56)", border: "1px solid rgba(255,255,255,0.5)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: "6px" }}>Reference notes</div>
              <div style={{ fontSize: "1.375rem", fontWeight: 700, color: "var(--text-main)" }}>
                {control.reference_notes.length}
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: "grid", gap: "12px" }}>
          <h3 style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif", fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>
            Source overview
          </h3>
          {control.scan_roots.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {control.scan_roots.map((root) => (
                <span
                  key={root}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.72)",
                    border: "1px solid var(--border-light)",
                    color: "var(--text-muted)",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                  }}
                >
                  {root}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {control.source_summary.collections.length > 0 ? control.source_summary.collections.map((item) => (
              <div
                key={item.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-light)",
                  color: "var(--text-secondary)",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                }}
              >
                <span>{item.label}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{item.count}</span>
              </div>
            )) : (
              <div style={{ color: "var(--text-muted)", fontSize: "0.9375rem" }}>No usable sources found yet — check the path configuration first.</div>
            )}
          </div>
          {control.source_summary.top_tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {control.source_summary.top_tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    background: "rgba(188, 164, 227, 0.1)",
                    color: "var(--color-primary-dark)",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: "grid", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <h3 style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif", fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>
              Source folders
            </h3>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
              Checkboxes decide which folders join the next generation pass
            </div>
          </div>

          {control.source_folders.length > 0 ? (
            <div style={{ display: "grid", gap: "10px" }}>
              {control.source_folders.map((folder) => {
                const isSaving = sourceSavingId === folder.id;
                return (
                  <div
                    key={folder.id}
                    style={{
                      padding: "14px 16px",
                      borderRadius: "10px",
                      background: folder.enabled ? "var(--bg-card)" : "rgba(255, 183, 178, 0.08)",
                      border: folder.enabled ? "1px solid var(--border-light)" : "1px solid rgba(255, 183, 178, 0.2)",
                      display: "grid",
                      gap: "10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: "4px" }}>
                        <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
                          {folder.label}
                        </div>
                        <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                          {folder.relative_path}
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span
                          style={{
                            padding: "5px 9px",
                            borderRadius: "999px",
                            background: folder.enabled ? "rgba(168, 230, 207, 0.18)" : "rgba(255, 183, 178, 0.18)",
                            color: folder.enabled ? "#2E7D68" : "#C76C65",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                          }}
                        >
                          {folder.enabled ? "Included" : "Excluded"}
                        </span>
                        {folder.has_page && (
                          <button
                            onClick={() => onOpenPage(folder.page_slug)}
                            style={{
                              padding: "7px 10px",
                              borderRadius: "8px",
                              border: "1px solid var(--border-light)",
                              background: "var(--bg-card)",
                              cursor: "pointer",
                              color: "var(--text-secondary)",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                            }}
                          >
                            Open VKI
                          </button>
                        )}
                        <button
                          onClick={() => onToggleSourceFolder(folder.id, !folder.enabled)}
                          disabled={isSaving}
                          style={{
                            padding: "7px 10px",
                            borderRadius: "8px",
                            border: "none",
                            background: folder.enabled
                              ? "rgba(255, 183, 178, 0.18)"
                              : "rgba(168, 230, 207, 0.22)",
                            cursor: isSaving ? "wait" : "pointer",
                            color: folder.enabled ? "#C76C65" : "#2E7D68",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            opacity: isSaving ? 0.75 : 1,
                          }}
                        >
                          {isSaving ? "Saving..." : folder.enabled ? "Exclude" : "Include"}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                        {folder.note_count} items
                      </span>
                      {folder.top_tags.slice(0, 4).map((tag) => (
                        <span
                          key={`${folder.id}-${tag}`}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "8px",
                            background: "rgba(188, 164, 227, 0.1)",
                            color: "var(--color-primary-dark)",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                          }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>

                    {folder.highlights.length > 0 && (
                      <div style={{ fontSize: "0.8125rem", lineHeight: 1.7, color: "var(--text-secondary)" }}>
                        {folder.highlights.slice(0, 2).join(" / ")}
                      </div>
                    )}

                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {folder.folder_path}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: "0.9375rem" }}>
              No manageable source folders found yet.
            </div>
          )}
        </section>

        <section style={{ display: "grid", gap: "12px" }}>
          <h3 style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif", fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>
            How to use
          </h3>
          <div style={{ display: "grid", gap: "10px" }}>
            {usageSteps.map((step, index) => (
              <div
                key={step}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr",
                  gap: "12px",
                  alignItems: "start",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-light)",
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "8px",
                    background: "rgba(188, 164, 227, 0.12)",
                    color: "var(--color-primary-dark)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.8125rem",
                    fontWeight: 700,
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ fontSize: "0.9375rem", lineHeight: 1.7, color: "var(--text-secondary)" }}>{step}</div>
              </div>
            ))}
          </div>
        </section>

        {control.reference_notes.length > 0 && (
          <section style={{ display: "grid", gap: "12px" }}>
            <h3 style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif", fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>
              Existing notes used as reference
            </h3>
            <div style={{ display: "grid", gap: "10px" }}>
              {control.reference_notes.map((note) => (
                <div
                  key={note.path}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "10px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "6px" }}>
                    {note.title}
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "8px" }}>
                    {note.path}
                  </div>
                  <div style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "var(--text-secondary)" }}>
                    {note.excerpt || "Included as a reference sample in the initial generation."}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Mindmap placeholder (can be upgraded to full React Flow later) ──────────

interface GraphNode {
  id: string;
  label: string;
  category: string;
  size: number;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const CATEGORY_COLORS: Record<string, string> = {
  collection: "#8FC1FF",
  entity: "#BCA4E3",
  concept: "#A8E6CF",
  paper: "#C4B5FD",
  topic: "#FDBA74",
  overview: "#FFB7B2",
};

interface MindMapPlaceholderProps {
  wikiType: WikiType;
  onSelectPage: (slug: string) => void;
}

function WikiMindMapPlaceholder({ wikiType, onSelectPage }: MindMapPlaceholderProps) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchGraph() {
      setLoading(true);
      try {
        const data = await api.get<GraphData>(`/api/wiki/${wikiType}/graph`);
        if (!cancelled) setGraph(data);
      } catch {
        if (!cancelled) setGraph({ nodes: [], edges: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchGraph();
    return () => { cancelled = true; };
  }, [wikiType]);

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            border: "3px solid var(--border-light)",
            borderTopColor: "var(--color-primary)",
            animation: "spin 1s linear infinite",
          }}
        />
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <EmptyState
        icon={MapIcon}
        title="No mind map data yet"
        description="The mind map generates automatically as you add more Wiki pages and links"
      />
    );
  }

  // Simple circle-packing layout
  const nodes = graph.nodes;
  const centerX = 400;
  const centerY = 300;
  const radius = Math.min(250, nodes.length * 20);
  // Count edges per node to compute size
  const edgeCount = new globalThis.Map<string, number>();
  graph.edges.forEach((e) => {
    edgeCount.set(e.source, (edgeCount.get(e.source) ?? 0) + 1);
    edgeCount.set(e.target, (edgeCount.get(e.target) ?? 0) + 1);
  });
  const nodesWithSize = nodes.map((n) => ({ ...n, size: n.size ?? (edgeCount.get(n.id) ?? 1) }));
  const maxSize = Math.max(...nodesWithSize.map((n) => n.size), 1);

  const positionedNodes = nodesWithSize.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = radius * (0.5 + 0.5 * (node.size / maxSize));
    return {
      ...node,
      x: centerX + r * Math.cos(angle),
      y: centerY + r * Math.sin(angle),
    };
  });

  const nodePositionMap = new globalThis.Map(positionedNodes.map((n) => [n.id, n]));

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: "24px",
        position: "relative",
      }}
    >
      <div
        style={{
          marginBottom: "16px",
          padding: "10px 12px",
          borderBottom: "1px solid var(--border-light)",
          color: "var(--text-secondary)",
          fontSize: "0.875rem",
          lineHeight: 1.6,
        }}
      >
        Click a dot to jump to its wiki page. External links in pages still go to the original markdown; the mind map only shows internal structure.
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
          <div key={cat} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: color,
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 500 }}>
              {cat === "collection"
                ? "Folder"
                : cat === "entity"
                  ? "Entity"
                  : cat === "concept"
                    ? "Concept"
                    : cat === "paper"
                      ? "Paper"
                      : cat === "topic"
                        ? "Topic"
                        : "Overview"}
            </span>
          </div>
        ))}
      </div>

      <svg
        width="800"
        height="600"
        viewBox="0 0 800 600"
        style={{ width: "100%", maxWidth: "800px", height: "auto" }}
      >
        {/* Edges */}
        {graph.edges.map((edge, i) => {
          const source = nodePositionMap.get(edge.source);
          const target = nodePositionMap.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              key={`edge-${i}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="var(--border-color)"
              strokeWidth={1}
              strokeOpacity={0.4}
            />
          );
        })}

        {/* Nodes */}
        {positionedNodes.map((node) => {
          const nodeSize = 10 + node.size * 4;
          const color = CATEGORY_COLORS[node.category] ?? "var(--color-primary)";
          const isHovered = hoveredNode === node.id;

          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={isHovered ? nodeSize + 4 : nodeSize}
                fill={color}
                fillOpacity={isHovered ? 0.9 : 0.6}
                stroke={isHovered ? color : "transparent"}
                strokeWidth={2}
                style={{ cursor: "pointer", transition: "all 0.2s ease" }}
                onClick={() => onSelectPage(node.id)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              />
              <text
                x={node.x}
                y={node.y + nodeSize + 14}
                textAnchor="middle"
                fill="var(--text-secondary)"
                fontSize="11"
                fontWeight={isHovered ? 700 : 500}
                style={{ pointerEvents: "none" }}
              >
                {node.label.length > 8 ? node.label.slice(0, 8) + "..." : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
