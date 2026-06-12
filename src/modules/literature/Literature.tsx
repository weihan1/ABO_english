import { useState, useEffect, useCallback } from "react";
import { BookOpen, FileText, ArrowLeft, Clock, ExternalLink, FolderOpen, HardDrive } from "lucide-react";
import { PageContainer, PageHeader, PageContent, Card } from "../../components/Layout";
import { api } from "../../core/api";
import { useStore } from "../../core/store";
import { readJsonStorage } from "../../core/storage";
import { open } from "@tauri-apps/plugin-dialog";

// Obsidian Icon SVG Component
function ObsidianIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      style={style}
    >
      <path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2zm0 3c.552 0 1 .448 1 1v5.172c0 .553-.448 1-1 1s-1-.447-1-1V6c0-.552.448-1 1-1zm0 11c3.314 0 6 2.686 6 6s-2.686 6-6 6-6-2.686-6-6 2.686-6 6-6z" />
      <path d="M16 8.5c-.828 0-1.5-.672-1.5-1.5s.672-1.5 1.5-1.5 1.5.672 1.5 1.5-.672 1.5-1.5 1.5z" fill="currentColor" />
    </svg>
  );
}

interface LiteratureItem {
  name: string;
  path: string;
  type: "folder" | "file";
  size: number | null;
  modified: number;
}

interface ItemStats {
  itemCount: number;
  accessCount: number;
  lastAccessed: number;
}

// Get color based on folder item count
function getBubbleColor(itemCount: number): string {
  if (itemCount >= 20) return "linear-gradient(135deg, #A8E6CF, #7DD3C0)";
  if (itemCount >= 10) return "linear-gradient(135deg, #BCA4E3, #9D7BDB)";
  if (itemCount >= 5) return "linear-gradient(135deg, #FFB7B2, #E89B96)";
  return "linear-gradient(135deg, #A8D8FF, #7BC8F0)";
}

// Calculate bubble size
function getBubbleSize(itemCount: number): number {
  const minSize = 80;
  const maxSize = 160;
  const maxItems = 50;
  return minSize + (Math.min(itemCount, maxItems) / maxItems) * (maxSize - minSize);
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Load folder stats
function getItemStats(path: string): ItemStats {
  const key = `lit-stats-${path}`;
  return readJsonStorage(key, { itemCount: 0, accessCount: 0, lastAccessed: 0 });
}

// Save file/folder access
function recordItemAccess(path: string, itemCount: number) {
  const key = `lit-stats-${path}`;
  const stats = getItemStats(path);
  stats.accessCount++;
  stats.lastAccessed = Date.now();
  stats.itemCount = itemCount;
  localStorage.setItem(key, JSON.stringify(stats));
}

function isUiFolderPath(path: string): boolean {
  if (!path) return false;
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1]?.toLowerCase() === "ui";
}

function sortItemsForDisplay<T extends LiteratureItem>(items: T[], filesFirst: boolean): T[] {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) {
      if (filesFirst) return a.type === "file" ? -1 : 1;
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
  });
}

export default function Literature() {
  const { config, setConfig } = useStore();
  const [items, setItems] = useState<LiteratureItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"bubbles" | "list">("bubbles");
  const [needsConfig, setNeedsConfig] = useState(!config?.literature_path && !config?.vault_path);

  // Update needsConfig when config changes - only show config UI if both paths are empty
  useEffect(() => {
    setNeedsConfig(!config?.literature_path && !config?.vault_path);
  }, [config?.literature_path, config?.vault_path]);

  // Load folder contents
  const loadFolder = useCallback(async (path: string = "") => {
    // Allow empty literaturePath - backend will handle fallback to vault_path
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ items: LiteratureItem[]; current_path: string }>(
        `/api/literature/browse?path=${encodeURIComponent(path)}`
      );
      setItems(data.items);
      setCurrentPath(data.current_path);
      setNeedsConfig(false);
    } catch (err) {
      console.error("Failed to load literature:", err);
      setError("Failed to load. Please check the Literature Library path setting");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadFolder();
  }, [loadFolder]);

  async function selectLiteraturePath() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title:"Choose Literature Library folder",
      });
      if (selected && typeof selected === "string") {
        // Only send literature_path — don't touch vault_path
        await api.post("/api/config", { literature_path: selected });
        // Re-fetch full config to update store
        const refreshed = await api.get<{ vault_path: string; literature_path?: string; version: string }>("/api/config");
        setConfig(refreshed);
        setNeedsConfig(false);
        loadFolder("");
      }
    } catch (err) {
      console.error("Failed to select path:", err);
      alert("Failed to choose folder. Please try again");
    }
  }

  async function openInFinder() {
    // Backend will handle fallback to vault_path if literature_path is not set
    try {
      await api.post("/api/literature/open", { path: "" });
    } catch (err) {
      console.error("Failed to open:", err);
      alert("Failed to open. Please check the Literature Library path");
    }
  }

  async function openInObsidian() {
    // Open literature folder in Obsidian via dedicated API
    try {
      await api.post("/api/literature/open-obsidian", { path: "" });
    } catch (err) {
      console.error("Failed to open Obsidian:", err);
      // Fallback: try URL scheme directly
      window.location.href = "obsidian://open?vault=Literature";
    }
  }

  async function openWithSystem(item: LiteratureItem) {
    try {
      recordItemAccess(item.path, item.size ?? 0);
      await api.post("/api/literature/open", { path: item.path });
    } catch (err) {
      console.error("Failed to open:", err);
      alert("Failed to open");
    }
  }

  function openFolder(item: LiteratureItem) {
    if (item.type === "folder") {
      recordItemAccess(item.path, items.filter(i => i.type === "file").length);
      loadFolder(item.path);
    }
  }

  function goBack() {
    if (!currentPath) return;
    const parentPath = currentPath.includes("/")
      ? currentPath.split("/").slice(0, -1).join("/")
      : "";
    loadFolder(parentPath);
  }

  const folders = items.filter((i) => i.type === "folder");
  const filesFirstInCurrentFolder = isUiFolderPath(currentPath);
  const orderedItems = sortItemsForDisplay(items, filesFirstInCurrentFolder);
  const orderedFiles = orderedItems.filter((item) => item.type === "file");
  const orderedFolders = orderedItems.filter((item) => item.type === "folder");

  const foldersWithStats = folders.map(folder => ({
    ...folder,
    stats: getItemStats(folder.path),
  }));
  const orderedFoldersWithStats = orderedFolders.map((folder) => ({
    ...folder,
    stats: getItemStats(folder.path),
  }));

  const sortedFolders = [...foldersWithStats].sort(
    (a, b) => b.stats.accessCount - a.stats.accessCount
  );

  const hotItems = [...items]
    .map((item) => ({
      ...item,
      stats: getItemStats(item.path),
    }))
    .filter((item) => item.stats.accessCount > 0)
    .sort((a, b) => {
      if (b.stats.accessCount !== a.stats.accessCount) {
        return b.stats.accessCount - a.stats.accessCount;
      }
      return b.stats.lastAccessed - a.stats.lastAccessed;
    })
    .slice(0, 3);

  // Config needed state
  if (needsConfig) {
    return (
      <PageContainer>
        <PageHeader
          title="Literature Library"
          subtitle="Manage papers and reference materials"
          icon={BookOpen}
        />
        <PageContent maxWidth="800px">
          <Card title="Configure Path" icon={<HardDrive style={{ width: "18px", height: "18px" }} />}>
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <div
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, rgba(188, 164, 227, 0.2), rgba(168, 230, 207, 0.2))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 24px",
                }}
              >
                <FolderOpen style={{ width: "40px", height: "40px", color: "var(--color-primary)" }} />
              </div>
              <h3 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "12px" }}>
                No path configured yet
              </h3>
              <p style={{ fontSize: "0.9375rem", color: "var(--text-muted)", marginBottom: "24px", lineHeight: 1.6 }}>
                Configure the Intel Library path on the home page, or set a separate Literature Library path below.
              </p>
              <button
                onClick={selectLiteraturePath}
                style={{
                  padding: "12px 24px",
                  borderRadius: "var(--radius-full)",
                  background: "var(--color-primary)",
                  border: "none",
                  color: "white",
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  boxShadow: "0 4px 16px rgba(188, 164, 227, 0.4)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 6px 24px rgba(188, 164, 227, 0.5)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 16px rgba(188, 164, 227, 0.4)";
                }}
              >
                Choose Literature Library folder
              </button>
            </div>
          </Card>
        </PageContent>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Literature Library"
        subtitle="Bubble view - manage papers and reference materials"
        icon={BookOpen}
        actions={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {/* Open in Obsidian */}
            <button
              onClick={openInObsidian}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "var(--radius-full)",
                background: "linear-gradient(135deg, #7B68EE, #9D7BDB)",
                border: "none",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.3s ease",
                boxShadow: "0 2px 8px rgba(123, 104, 238, 0.4)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(123, 104, 238, 0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(123, 104, 238, 0.4)";
              }}
            >
              <ObsidianIcon style={{ width: "16px", height: "16px" }} />
              Open in Obsidian
            </button>

            <div style={{ width: "1px", height: "24px", background: "var(--border-light)", margin: "0 4px" }} />

            {/* Open in Finder */}
            <button
              onClick={openInFinder}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-hover)",
                border: "1px solid var(--border-light)",
                color: "var(--text-secondary)",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--color-primary)";
                e.currentTarget.style.color = "white";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <ExternalLink style={{ width: "14px", height: "14px" }} />
              Open in Finder
            </button>

            {/* Change Path */}
            <button
              onClick={selectLiteraturePath}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "var(--radius-full)",
                background: "var(--color-primary)",
                border: "none",
                color: "white",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.3s ease",
                boxShadow: "0 2px 8px rgba(188, 164, 227, 0.4)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(188, 164, 227, 0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(188, 164, 227, 0.4)";
              }}
            >
              <FolderOpen style={{ width: "14px", height: "14px" }} />
              Change path
            </button>

            <div style={{ width: "1px", height: "24px", background: "var(--border-light)", margin: "0 4px" }} />

            {/* View Mode */}
            <button
              onClick={() => setViewMode("bubbles")}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-full)",
                background: viewMode === "bubbles" ? "var(--color-primary)" : "var(--bg-card)",
                color: viewMode === "bubbles" ? "white" : "var(--text-secondary)",
                border: `1px solid ${viewMode === "bubbles" ? "transparent" : "var(--border-light)"}`,
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
            >
              Bubble view
            </button>
            <button
              onClick={() => setViewMode("list")}
              style={{
                padding: "8px 16px",
                borderRadius: "var(--radius-full)",
                background: viewMode === "list" ? "var(--color-primary)" : "var(--bg-card)",
                color: viewMode === "list" ? "white" : "var(--text-secondary)",
                border: `1px solid ${viewMode === "list" ? "transparent" : "var(--border-light)"}`,
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
            >
              List view
            </button>
          </div>
        }
      />
      <PageContent maxWidth="1200px">
        {/* Breadcrumb */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "24px",
            padding: "12px 20px",
            background: "var(--bg-card)",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--border-light)",
            width: "fit-content",
          }}
        >
          {currentPath && (
            <button
              onClick={goBack}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-hover)",
                border: "none",
                color: "var(--text-secondary)",
                fontSize: "0.875rem",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--color-primary-light)";
                e.currentTarget.style.color = "white";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <ArrowLeft style={{ width: "16px", height: "16px" }} />
              Back
            </button>
          )}
          <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Literature Library{currentPath ? ` / ${currentPath}` : ""}
          </span>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
            <p>Loading...</p>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "20px",
              background: "rgba(255, 183, 178, 0.1)",
              border: "1px solid rgba(255, 183, 178, 0.3)",
              borderRadius: "var(--radius-lg)",
              color: "#D48984",
              marginBottom: "24px",
            }}
          >
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
            <BookOpen style={{ width: "48px", height: "48px", opacity: 0.5, margin: "0 auto 16px" }} />
            <p>This folder is empty</p>
          </div>
        )}

        {/* Hot Folders */}
        {!currentPath && viewMode === "bubbles" && hotItems.length > 0 && (
          <div style={{ marginBottom: "32px" }}>
            <h3
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: "var(--text-main)",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span style={{ fontSize: "1.2rem" }}>🔥</span>
              Frequently accessed
            </h3>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {hotItems.map((item, index) => (
                <div
                  key={item.path}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "16px 24px",
                    borderRadius: "var(--radius-lg)",
                    background: getBubbleColor(item.stats.itemCount || 5),
                    color: "white",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                    cursor: "pointer",
                    transition: "all 0.3s ease",
                    animation: `fadeInUp 0.5s ease ${index * 0.1}s both`,
                  }}
                  onClick={() => item.type === "folder" ? openFolder(item) : openWithSystem(item)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-4px) scale(1.05)";
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0) scale(1)";
                    e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)";
                  }}
                >
                  {item.type === "folder" ? (
                    <BookOpen style={{ width: "24px", height: "24px" }} />
                  ) : (
                    <FileText style={{ width: "24px", height: "24px" }} />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "1rem" }}>{item.name}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.9 }}>
                      {item.type === "folder" ? "Folder" : "File"} · accessed {item.stats.accessCount} times
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bubble View */}
        {viewMode === "bubbles" ? (
          <>
            {filesFirstInCurrentFolder && orderedFiles.length > 0 && (
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "16px" }}>
                  Files ({orderedFiles.length}) - click to open with system app
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", justifyContent: "flex-start", marginBottom: "32px" }}>
                  {orderedFiles.map((file, index) => (
                    <button
                      key={file.path}
                      onClick={() => openWithSystem(file)}
                      style={{
                        width: "100px",
                        height: "100px",
                        borderRadius: "50%",
                        background: "var(--bg-hover)",
                        border: "2px dashed var(--border-light)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        cursor: "pointer",
                        animation: `fadeInScale 0.5s ease ${index * 0.03}s both`,
                        transition: "all 0.3s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--bg-card)";
                        e.currentTarget.style.borderColor = "var(--color-primary)";
                        e.currentTarget.style.transform = "scale(1.05)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--bg-hover)";
                        e.currentTarget.style.borderColor = "var(--border-light)";
                        e.currentTarget.style.transform = "scale(1)";
                      }}
                    >
                      <FileText style={{ width: "24px", height: "24px", color: "var(--color-primary)" }} />
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "var(--text-main)",
                          maxWidth: "80%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textAlign: "center",
                        }}
                      >
                        {file.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Folders */}
            {orderedFolders.length > 0 && (
              <div style={{ marginBottom: "32px" }}>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "16px" }}>
                  Folders ({orderedFolders.length})
                </h3>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "24px",
                    justifyContent: "flex-start",
                    padding: "20px 0",
                  }}
                >
                  {(filesFirstInCurrentFolder ? orderedFoldersWithStats : sortedFolders).map((folder, index) => {
                    const size = getBubbleSize(folder.stats.itemCount || 3);
                    return (
                      <button
                        key={folder.path}
                        onClick={() => openFolder(folder)}
                        style={{
                          width: size,
                          height: size,
                          borderRadius: "50%",
                          background: getBubbleColor(folder.stats.itemCount || 3),
                          border: "none",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                          cursor: "pointer",
                          transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
                          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                          animation: `fadeInScale 0.5s ease ${index * 0.05}s both`,
                          position: "relative",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = "scale(1.1)";
                          e.currentTarget.style.zIndex = "10";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = "scale(1)";
                          e.currentTarget.style.zIndex = "1";
                        }}
                      >
                        <BookOpen style={{ width: size * 0.25, height: size * 0.25, color: "white" }} />
                        <span
                          style={{
                            fontSize: size * 0.12,
                            fontWeight: 700,
                            color: "white",
                            maxWidth: "80%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            padding: "0 8px",
                          }}
                        >
                          {folder.name}
                        </span>
                        <span style={{ fontSize: size * 0.09, color: "white", opacity: 0.8 }}>
                          {folder.stats.accessCount > 0 ? `${folder.stats.accessCount} visits` : "Not visited"}
                        </span>
                        {folder.stats.accessCount > 5 && (
                          <div
                            style={{
                              position: "absolute",
                              top: "10%",
                              right: "10%",
                              width: "12px",
                              height: "12px",
                              borderRadius: "50%",
                              background: "#FFD700",
                              boxShadow: "0 0 8px #FFD700",
                              animation: "pulse-glow 2s infinite",
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Files */}
            {!filesFirstInCurrentFolder && orderedFiles.length > 0 && (
              <div>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "16px" }}>
                  Files ({orderedFiles.length}) - click to open with system app
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", justifyContent: "flex-start" }}>
                  {orderedFiles.map((file, index) => (
                    <button
                      key={file.path}
                      onClick={() => openWithSystem(file)}
                      style={{
                        width: "100px",
                        height: "100px",
                        borderRadius: "50%",
                        background: "var(--bg-hover)",
                        border: "2px dashed var(--border-light)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                        cursor: "pointer",
                        animation: `fadeInScale 0.5s ease ${index * 0.03}s both`,
                        transition: "all 0.3s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--bg-card)";
                        e.currentTarget.style.borderColor = "var(--color-primary)";
                        e.currentTarget.style.transform = "scale(1.05)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "var(--bg-hover)";
                        e.currentTarget.style.borderColor = "var(--border-light)";
                        e.currentTarget.style.transform = "scale(1)";
                      }}
                    >
                      <FileText style={{ width: "24px", height: "24px", color: "var(--color-primary)" }} />
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "var(--text-main)",
                          maxWidth: "80%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textAlign: "center",
                        }}
                      >
                        {file.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* List View */
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {orderedItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => item.type === "folder" ? openFolder(item) : openWithSystem(item)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "16px 20px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border-light)",
                    cursor: "pointer",
                    transition: "all 0.3s ease",
                    textAlign: "left",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-card)";
                    e.currentTarget.style.transform = "translateX(4px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.transform = "translateX(0)";
                  }}
                >
                  <div
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "var(--radius-md)",
                      background: item.type === "folder" ? getBubbleColor(5) : "var(--color-primary-light)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {item.type === "folder" ? (
                      <BookOpen style={{ width: "22px", height: "22px", color: "white" }} />
                    ) : (
                      <FileText style={{ width: "22px", height: "22px", color: "white" }} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-main)" }}>
                      {item.name}
                    </div>
                    <div
                      style={{
                        fontSize: "0.8125rem",
                        color: "var(--text-muted)",
                        marginTop: "2px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <Clock style={{ width: "12px", height: "12px" }} />
                        {new Date(item.modified * 1000).toLocaleDateString()}
                      </span>
                      {item.type === "file" && item.size !== null && <span>{formatSize(item.size)}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", opacity: 0.6 }}>
                    {item.type === "folder" ? "Enter →" : "Open →"}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* Legend */}
        <div
          style={{
            marginTop: "32px",
            padding: "20px",
            background: "var(--bg-card)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-light)",
          }}
        >
          <h4 style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "12px" }}>
            Heat legend
          </h4>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
            {[
              { color: "#A8E6CF", label: "High (>20 items)" },
              { color: "#BCA4E3", label: "Medium-high (10-20 items)" },
              { color: "#FFB7B2", label: "Medium (5-10 items)" },
              { color: "#A8D8FF", label: "Low (<5 items)" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: item.color }} />
                <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </PageContent>

      {/* Animation keyframes */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 8px #FFD700; }
          50% { box-shadow: 0 0 16px #FFD700, 0 0 24px #FFD700; }
        }
      `}</style>
    </PageContainer>
  );
}
