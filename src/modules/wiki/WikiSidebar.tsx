import { useState, useEffect } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Eye, Search, Users, Lightbulb, FileText, Tag, FolderOpen } from "lucide-react";
import { api } from "../../core/api";
import type { WikiType } from "./Wiki";
import WikiSearch from "./WikiSearch";

interface WikiPageInfo {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  updated: string;
}

interface Props {
  wikiType: WikiType;
  activePage: string | null;
  onSelectPage: (slug: string) => void;
  onBack: () => void;
}

// Category metadata for internet wiki
const INTEL_CATEGORIES = [
  { key: "collection", label: "Folder VKI", Icon: FolderOpen, description: "Each source folder's own digest page" },
  { key: "entity", label: "Entity pages", Icon: Users, description: "Authors · Tools · Projects · Platforms" },
  { key: "concept", label: "Concept pages", Icon: Lightbulb, description: "Workflows · Views · Methods · Leads" },
];

// Category metadata for literature wiki
const LIT_CATEGORIES = [
  { key: "collection", label: "Folder VKI", Icon: FolderOpen, description: "Each folder's own narrative page" },
  { key: "paper", label: "Paper pages", Icon: FileText, description: "Per-paper abstract and conclusions" },
  { key: "topic", label: "Topic pages", Icon: Tag, description: "Methods · Problems · Research threads" },
];

export default function WikiSidebar({ wikiType, activePage, onSelectPage, onBack }: Props) {
  const [pages, setPages] = useState<WikiPageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [showSearch, setShowSearch] = useState(false);

  const categories = wikiType === "intel" ? INTEL_CATEGORIES : LIT_CATEGORIES;
  const wikiTitle = wikiType === "intel" ? "Internet Wiki" : "Literature Wiki";

  // Initialize expanded state for all categories
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    categories.forEach((c) => { initial[c.key] = true; });
    setExpandedCategories(initial);
  }, [wikiType]);

  // Fetch pages
  useEffect(() => {
    let cancelled = false;
    async function fetchPages() {
      setLoading(true);
      try {
        const data = await api.get<{ pages: WikiPageInfo[] }>(`/api/wiki/${wikiType}/pages`);
        if (!cancelled) {
          setPages(data.pages ?? []);
        }
      } catch {
        if (!cancelled) setPages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchPages();
    return () => { cancelled = true; };
  }, [wikiType]);

  function toggleCategory(key: string) {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Group pages by category
  const pagesByCategory: Record<string, WikiPageInfo[]> = {};
  categories.forEach((c) => { pagesByCategory[c.key] = []; });
  pages.forEach((p) => {
    if (pagesByCategory[p.category]) {
      pagesByCategory[p.category].push(p);
    }
  });

  return (
    <div
      style={{
        width: "240px",
        minWidth: "240px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-panel)",
        borderRight: "1px solid var(--border-light)",
        overflow: "hidden",
      }}
    >
      {/* Back button + Wiki title */}
      <div
        style={{
          padding: "16px",
          borderBottom: "1px solid var(--border-light)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            borderRadius: "var(--radius-full)",
            background: "transparent",
            border: "1px solid transparent",
            cursor: "pointer",
            transition: "all 0.2s ease",
            color: "var(--text-secondary)",
            fontSize: "0.8125rem",
            fontWeight: 500,
            width: "100%",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.borderColor = "var(--border-color)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "transparent";
          }}
        >
          <ArrowLeft style={{ width: "14px", height: "14px" }} />
          <span>Back to knowledge base</span>
        </button>

        <h2
          style={{
            fontFamily: "'M PLUS Rounded 1c', sans-serif",
            fontSize: "1.125rem",
            fontWeight: 700,
            color: "var(--text-main)",
            marginTop: "12px",
            paddingLeft: "12px",
          }}
        >
          {wikiTitle}
        </h2>
      </div>

      {/* Search toggle */}
      <div style={{ padding: "8px 16px", flexShrink: 0 }}>
        <button
          onClick={() => setShowSearch(!showSearch)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            borderRadius: "var(--radius-full)",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            cursor: "pointer",
            transition: "all 0.2s ease",
            color: "var(--text-muted)",
            fontSize: "0.8125rem",
            width: "100%",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--color-primary)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-light)";
            e.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <Search style={{ width: "14px", height: "14px" }} />
          <span>Find pages or keywords</span>
        </button>
      </div>

      {/* Inline search dropdown */}
      {showSearch && (
        <div style={{ padding: "0 16px 8px", flexShrink: 0 }}>
          <WikiSearch
            wikiType={wikiType}
            onSelectPage={(slug) => {
              onSelectPage(slug);
              setShowSearch(false);
            }}
          />
        </div>
      )}

      {/* Overview button */}
      <div style={{ padding: "4px 16px", flexShrink: 0 }}>
        <button
          onClick={() => onSelectPage("overview")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            background: activePage === "overview"
              ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))"
              : "transparent",
            color: activePage === "overview" ? "white" : "var(--text-secondary)",
            border: "none",
            cursor: "pointer",
            transition: "all 0.2s ease",
            fontSize: "0.875rem",
            fontWeight: 600,
            width: "100%",
          }}
          onMouseEnter={(e) => {
            if (activePage !== "overview") {
              e.currentTarget.style.background = "var(--bg-hover)";
            }
          }}
          onMouseLeave={(e) => {
            if (activePage !== "overview") {
              e.currentTarget.style.background = "transparent";
            }
          }}
        >
          <Eye style={{ width: "16px", height: "16px" }} />
          <span>Overview</span>
        </button>
      </div>

      {/* Scrollable category tree */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "8px 16px 16px",
        }}
      >
        {loading ? (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "0.8125rem",
            }}
          >
            Loading...
          </div>
        ) : (
          categories.map((cat) => {
            const catPages = pagesByCategory[cat.key] ?? [];
            const isExpanded = expandedCategories[cat.key] ?? true;
            const CatIcon = cat.Icon;

            return (
              <div key={cat.key} style={{ marginBottom: "8px" }}>
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(cat.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 8px",
                    borderRadius: "var(--radius-sm, 6px)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    color: "var(--text-secondary)",
                    fontSize: "0.8125rem",
                    fontWeight: 700,
                    width: "100%",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {isExpanded ? (
                    <ChevronDown style={{ width: "14px", height: "14px", flexShrink: 0 }} />
                  ) : (
                    <ChevronRight style={{ width: "14px", height: "14px", flexShrink: 0 }} />
                  )}
                  <CatIcon style={{ width: "14px", height: "14px", flexShrink: 0 }} />
                  <span style={{ flex: 1, textAlign: "left" }}>{cat.label}</span>
                  <span
                    style={{
                      fontSize: "0.6875rem",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "var(--radius-full)",
                      background: "var(--bg-hover)",
                    }}
                  >
                    {catPages.length}
                  </span>
                </button>

                {/* Category pages */}
                {isExpanded && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                      paddingLeft: "12px",
                      marginTop: "4px",
                    }}
                  >
                    {catPages.length === 0 ? (
                      <div
                        style={{
                          padding: "8px 12px",
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        No pages yet
                      </div>
                    ) : (
                      catPages.map((page) => (
                        <button
                          key={page.slug}
                          onClick={() => onSelectPage(page.slug)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "7px 12px",
                            borderRadius: "var(--radius-sm, 6px)",
                            background: activePage === page.slug
                              ? "rgba(188, 164, 227, 0.18)"
                              : "transparent",
                            color: activePage === page.slug
                              ? "var(--color-primary-dark)"
                              : "var(--text-secondary)",
                            border: "none",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            fontSize: "0.8125rem",
                            fontWeight: activePage === page.slug ? 600 : 500,
                            width: "100%",
                            textAlign: "left",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => {
                            if (activePage !== page.slug) {
                              e.currentTarget.style.background = "var(--bg-hover)";
                              e.currentTarget.style.color = "var(--text-main)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (activePage !== page.slug) {
                              e.currentTarget.style.background = "transparent";
                              e.currentTarget.style.color = "var(--text-secondary)";
                            }
                          }}
                          title={page.title}
                        >
                          <div
                            style={{
                              width: "5px",
                              height: "5px",
                              borderRadius: "50%",
                              background: activePage === page.slug
                                ? "var(--color-primary)"
                                : "var(--text-muted)",
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {page.title}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
