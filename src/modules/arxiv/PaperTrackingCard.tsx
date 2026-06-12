import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BookHeart,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Image as ImageIcon,
  RefreshCw,
  Save,
  Star,
  User,
} from "lucide-react";
import { Card } from "../../components/Layout";
import { api, API_BASE_URL } from "../../core/api";
import { useStore } from "../../core/store";
import { fetchArxivPaperIntroduction } from "./arxivPaperApi";

export type PaperFigureAsset = {
  url?: string;
  caption: string;
  is_method?: boolean;
  local_path?: string;
  original_url?: string;
  filename?: string;
};

export interface PaperTrackingCardPaper {
  id: string;
  title: string;
  summary: string;
  score: number;
  tags: string[];
  source_url: string;
  obsidian_path?: string;
  metadata: Record<string, unknown>;
}

const API_BASE = API_BASE_URL;

async function openExternalUrl(url: string) {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) return;
  try {
    await openUrl(cleanUrl);
  } catch {
    window.open(cleanUrl, "_blank", "noopener,noreferrer");
  }
}

function metadataString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function metadataRecord(metadata: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = metadata[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataStringList(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item === "string" && item.trim()) return [item.trim()];
        if (item && typeof item === "object" && "name" in item) {
          const name = (item as { name?: unknown }).name;
          return typeof name === "string" && name.trim() ? [name.trim()] : [];
        }
        return [];
      })
    : [];
}

function normalizePaperFigures(figures: unknown): PaperFigureAsset[] {
  if (!Array.isArray(figures) || !figures.length) return [];

  const seen = new Set<string>();
  return figures.flatMap((figure, index) => {
    if (!figure || typeof figure !== "object") return [];
    const item = figure as Record<string, unknown>;
    const normalized: PaperFigureAsset = {
      url: typeof item.url === "string" ? item.url : undefined,
      caption: typeof item.caption === "string" && item.caption.trim() ? item.caption : `Figure ${index + 1}`,
      is_method: typeof item.is_method === "boolean" ? item.is_method : undefined,
      local_path: typeof item.local_path === "string" ? item.local_path : undefined,
      original_url: typeof item.original_url === "string" ? item.original_url : undefined,
      filename: typeof item.filename === "string" ? item.filename : undefined,
    };
    const key = normalized.local_path || normalized.url || normalized.original_url || normalized.filename || `figure-${index}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function normalizeArxivFigureUrl(url: string): string {
  if (!url.startsWith("http")) return url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "arxiv.org") return url;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "html" || parts.length < 3) return url;

    const docId = parts[1];
    const nested = parts[2];
    if (nested === docId || nested.startsWith(`${docId}v`)) {
      parsed.pathname = `/html/${parts.slice(2).join("/")}`;
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}

function getPaperFigureRemoteUrl(figure: PaperFigureAsset): string {
  const remoteUrl = figure.original_url || figure.url || "";
  return normalizeArxivFigureUrl(remoteUrl);
}

function getPaperFigureImageUrl(figure: PaperFigureAsset, preferLocal = true): string {
  if (preferLocal && figure.local_path) {
    return `${API_BASE}/api/literature/file?path=${encodeURIComponent(figure.local_path)}`;
  }

  const remoteUrl = getPaperFigureRemoteUrl(figure);
  if (!remoteUrl) return "";
  if (remoteUrl.startsWith("data:image/")) return remoteUrl;
  if (remoteUrl.startsWith(`${API_BASE}/api/proxy/image?url=`)) return remoteUrl;
  return `${API_BASE}/api/proxy/image?url=${encodeURIComponent(remoteUrl)}`;
}

function getPaperFigureTargetUrl(figure: PaperFigureAsset, fallbackUrl: string): string {
  const remoteUrl = getPaperFigureRemoteUrl(figure);
  if (remoteUrl.startsWith("data:image/")) return fallbackUrl;
  return remoteUrl || getPaperFigureImageUrl(figure) || fallbackUrl;
}

function PaperFigureStrip({
  figures,
  fallbackUrl,
  preferLocal = true,
}: {
  figures: PaperFigureAsset[];
  fallbackUrl: string;
  preferLocal?: boolean;
}) {
  if (!figures.length) return null;

  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          display: "flex",
          gap: "16px",
          overflowX: "auto",
          paddingBottom: "12px",
          scrollbarWidth: "thin",
        }}
      >
        {figures.map((figure, index) => {
          const imageUrl = getPaperFigureImageUrl(figure, preferLocal);
          const targetUrl = getPaperFigureTargetUrl(figure, fallbackUrl);
          const fallbackImageUrl = getPaperFigureImageUrl(figure, false);
          return (
            <div
              key={`${targetUrl}-${index}`}
              style={{
                flexShrink: 0,
                width: "min(480px, 88vw)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
              }}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={figure.caption}
                  style={{
                    width: "100%",
                    height: "280px",
                    objectFit: "contain",
                    background: "var(--bg-hover)",
                    cursor: "pointer",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openExternalUrl(targetUrl);
                  }}
                  onError={(e) => {
                    if (!fallbackImageUrl || e.currentTarget.src === fallbackImageUrl) return;
                    e.currentTarget.src = fallbackImageUrl;
                  }}
                  loading="lazy"
                />
              ) : (
                <a
                  href={fallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void openExternalUrl(fallbackUrl);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "100%",
                    height: "280px",
                    background: "var(--bg-hover)",
                    color: "var(--text-muted)",
                    textDecoration: "none",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                  }}
                >
                  View paper figures
                </a>
              )}
              <div
                style={{
                  padding: "10px 12px",
                  fontSize: "0.8125rem",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  background: "var(--bg-card)",
                }}
              >
                {figure.caption}
                {figure.is_method && (
                  <span
                    style={{
                      marginLeft: "8px",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      background: "var(--color-primary)",
                      color: "white",
                      fontSize: "0.6875rem",
                      fontWeight: 600,
                    }}
                  >
                    Architecture diagram
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function extractArxivIdFromValue(value: unknown): string {
  const match = String(value || "").match(/([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match?.[1] || "";
}

function getTrackedPaperArxivId(paper: PaperTrackingCardPaper): string {
  return (
    metadataString(paper.metadata, "arxiv_id")
    || metadataString(paper.metadata, "arxiv-id")
    || extractArxivIdFromValue(paper.id)
    || extractArxivIdFromValue(paper.source_url)
  );
}

function joinRelativePath(baseFilePath: string, assetPath: string): string {
  const baseParts = baseFilePath.split("/").filter(Boolean);
  const assetParts = assetPath.split("/").filter(Boolean);
  if (baseParts.length > 0) {
    baseParts.pop();
  }

  const merged = [...baseParts, ...assetParts];
  const normalized: string[] = [];
  for (const part of merged) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join("/");
}

function getTrackedPaperLocalFileUrl(paper: PaperTrackingCardPaper, assetPath: string): string {
  if (!assetPath) return "";
  if (assetPath.startsWith("http://") || assetPath.startsWith("https://")) {
    return assetPath;
  }

  const normalizedAssetPath = assetPath.replace(/^\/+/, "");
  if (normalizedAssetPath.startsWith("Literature/")) {
    return `${API_BASE}/api/literature/file?path=${encodeURIComponent(normalizedAssetPath.slice("Literature/".length))}`;
  }

  const basePath = metadataString(paper.metadata, "literature_path") || paper.obsidian_path || "";
  const resolvedPath = (
    normalizedAssetPath.includes("/")
    && !normalizedAssetPath.startsWith("./")
    && !normalizedAssetPath.startsWith("../")
  )
    ? normalizedAssetPath
    : (basePath ? joinRelativePath(basePath, normalizedAssetPath) : normalizedAssetPath);
  return `${API_BASE}/api/literature/file?path=${encodeURIComponent(resolvedPath)}`;
}

function getTrackedPaperPdfUrl(paper: PaperTrackingCardPaper): string {
  const localPdfPath = metadataString(paper.metadata, "pdf_path") || metadataString(paper.metadata, "pdf-path");
  if (localPdfPath) {
    return getTrackedPaperLocalFileUrl(paper, localPdfPath);
  }

  const remotePdfUrl = metadataString(paper.metadata, "pdf-url") || metadataString(paper.metadata, "pdf_url");
  if (remotePdfUrl) {
    return remotePdfUrl;
  }
  if (paper.source_url.endsWith(".pdf")) {
    return paper.source_url;
  }

  const arxivId = getTrackedPaperArxivId(paper);
  return arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : "";
}

function getTrackedPaperArchiveUrl(paper: PaperTrackingCardPaper): string {
  const metadataUrl = metadataString(paper.metadata, "arxiv_url") || metadataString(paper.metadata, "arxiv-url");
  if (metadataUrl) return metadataUrl;
  const arxivId = getTrackedPaperArxivId(paper);
  if (arxivId) return `https://arxiv.org/abs/${arxivId}`;
  const htmlUrl = metadataString(paper.metadata, "html-url") || metadataString(paper.metadata, "html_url");
  if (htmlUrl) return htmlUrl;
  const s2Url = metadataString(paper.metadata, "s2_url") || metadataString(paper.metadata, "s2-url");
  return paper.source_url || s2Url || "";
}

export function getTrackedPaperDisplayId(paper: PaperTrackingCardPaper): string {
  return (
    getTrackedPaperArxivId(paper)
    || metadataString(paper.metadata, "paper_id")
    || paper.id.replace(/^followup-monitor:/, "").replace(/^source-paper:/, "").replace(/^arxiv-monitor:/, "")
  );
}

export function formatPaperDate(dateStr: string) {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

type PaperTrackingCardProps = {
  paper: PaperTrackingCardPaper;
  isSaved: boolean;
  isSaving?: boolean;
  onSave: () => void | Promise<void>;
  onSaveAndWiki?: () => void | Promise<void>;
  isSavingToWiki?: boolean;
  hasLiteraturePath: boolean;
  onUpdatePaper?: (updatedPaper: PaperTrackingCardPaper) => void;
  cardStyle?: CSSProperties;
  footerContent?: ReactNode;
};

export default function PaperTrackingCard({
  paper,
  isSaved,
  isSaving = false,
  onSave,
  onSaveAndWiki,
  isSavingToWiki = false,
  hasLiteraturePath,
  onUpdatePaper,
  cardStyle,
  footerContent,
}: PaperTrackingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = paper.metadata || {};
  const authors = metadataStringList(meta, "authors");
  const arxivId = getTrackedPaperArxivId(paper);
  const archiveUrl = getTrackedPaperArchiveUrl(paper);
  const pdfUrl = getTrackedPaperPdfUrl(paper);
  const displayId = getTrackedPaperDisplayId(paper);
  const effectiveSaved = isSaved || Boolean(meta.saved_to_literature || meta.literature_path);
  const [introduction, setIntroduction] = useState(metadataString(meta, "introduction"));
  const [introExpanded, setIntroExpanded] = useState(false);
  const [loadingIntroduction, setLoadingIntroduction] = useState(false);
  const [introAttempted, setIntroAttempted] = useState(Boolean(metadataString(meta, "introduction")));
  const sourcePaper = metadataRecord(meta, "source_paper");
  const sourcePaperMetaTitle = typeof sourcePaper.title === "string" ? sourcePaper.title.trim() : "";
  const resolvedSourcePaperTitle = metadataString(meta, "source_paper_title") || sourcePaperMetaTitle;
  const initialFigures = useMemo(
    () => normalizePaperFigures(
      effectiveSaved && Array.isArray(meta.local_figures) && meta.local_figures.length > 0
        ? meta.local_figures
        : meta.figures
    ),
    [effectiveSaved, meta.figures, meta.local_figures],
  );
  const [figures, setFigures] = useState<PaperFigureAsset[]>(initialFigures);
  const [loadingFigures, setLoadingFigures] = useState(false);
  const [figureAttempted, setFigureAttempted] = useState(initialFigures.length > 0);
  const score = Math.round(Math.max(0, Math.min(1, Number.isFinite(paper.score) ? paper.score : 0)) * 10);
  const scoreColor = score >= 8 ? "#10B981" : score >= 6 ? "#F59E0B" : "#94A3B8";
  const scoreBg = score >= 8 ? "rgba(16, 185, 129, 0.1)" : score >= 6 ? "rgba(245, 158, 11, 0.1)" : "rgba(148, 163, 184, 0.1)";
  const paperTrackingRole = metadataString(meta, "paper_tracking_role");
  const paperTrackingType = metadataString(meta, "paper_tracking_type");
  const relationship = metadataString(meta, "relationship");
  const relationshipColor = paperTrackingRole === "source"
    ? "#F59E0B"
    : relationship === "citation"
      ? "#10B981"
      : relationship === "reference"
        ? "#6366F1"
        : paperTrackingType === "keyword"
          ? "#8B5CF6"
          : "#94A3B8";
  const relationshipLabel = metadataString(meta, "relationship_label")
    || (paperTrackingRole === "source"
      ? "Source paper"
      : paperTrackingType === "keyword"
        ? "Keyword tracking"
        : relationship === "citation"
          ? "Citing papers"
          : relationship === "reference"
            ? "References"
            : "Paper tracking");
  const figureCount = figures.length;
  const hasFigures = figureCount > 0;
  // S2 follow-up cards hide the figure UI entirely when the user opted out of figure crawling.
  // Source papers and arXiv-tracker papers always allow figures.
  const semanticScholarFetchFigures = useStore((s) => s.semanticScholarFetchFigures);
  const isS2FollowupCard =
    metadataString(meta, "abo-type") === "semantic-scholar-paper"
    && paperTrackingRole !== "source";
  const figuresEnabled = !(isS2FollowupCard && !semanticScholarFetchFigures);
  const canLoadFigures = Boolean(arxivId) && figuresEnabled;
  const canToggleIntroduction = Boolean(arxivId || introduction);

  useEffect(() => {
    setFigures(initialFigures);
    setFigureAttempted(initialFigures.length > 0);
  }, [paper.id, initialFigures]);

  useEffect(() => {
    const nextIntroduction = metadataString(meta, "introduction");
    setIntroduction(nextIntroduction);
    setIntroAttempted(Boolean(nextIntroduction));
  }, [paper.id, meta]);

  const updatePaperMetadata = (patch: Record<string, unknown>) => {
    if (!onUpdatePaper) return;
    onUpdatePaper({
      ...paper,
      metadata: {
        ...paper.metadata,
        ...patch,
      },
    });
  };

  const applyIntroductionResult = (result: { introduction: string; formatted_digest: string }) => {
    setIntroduction(result.introduction || "");
    updatePaperMetadata({
      introduction: result.introduction || metadataString(meta, "introduction"),
      "formatted-digest": result.formatted_digest || metadataString(meta, "formatted-digest"),
    });
  };

  const loadFigures = async () => {
    if (!arxivId || loadingFigures) return;

    setLoadingFigures(true);
    setFigureAttempted(true);
    try {
      const result = await api.post<{ figures: PaperFigureAsset[] }>("/api/tools/arxiv/figures", {
        arxiv_id: arxivId,
      });
      const normalizedFigures = normalizePaperFigures(result.figures);
      setFigures(normalizedFigures);
      updatePaperMetadata({
        figures: normalizedFigures,
      });
    } catch (error) {
      console.error("Failed to load paper figures:", error);
    } finally {
      setLoadingFigures(false);
    }
  };

  const toggleIntroduction = async () => {
    if (introExpanded) {
      setIntroExpanded(false);
      return;
    }

    setIntroExpanded(true);
    if (introduction || loadingIntroduction || !arxivId) return;

    setLoadingIntroduction(true);
    setIntroAttempted(true);
    try {
      const result = await fetchArxivPaperIntroduction(arxivId, metadataString(meta, "abstract") || paper.summary);
      applyIntroductionResult(result);
    } catch (error) {
      console.error("Failed to load paper introduction:", error);
    } finally {
      setLoadingIntroduction(false);
    }
  };

  useEffect(() => {
    if (!figureAttempted && canLoadFigures) {
      void loadFigures();
    }
  }, [figureAttempted, canLoadFigures]);

  return (
    <Card noPadding style={cardStyle}>
      <div style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "var(--radius-md)",
              background: scoreBg,
              border: `2px solid ${scoreColor}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "1.25rem", fontWeight: 700, color: scoreColor, lineHeight: 1 }}>
              {score}
            </span>
            <span style={{ fontSize: "0.625rem", color: scoreColor, opacity: 0.8 }}>pts</span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <a
              href={paper.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void openExternalUrl(paper.source_url);
              }}
              style={{
                fontSize: "1.0625rem",
                fontWeight: 600,
                color: "var(--text-main)",
                textDecoration: "none",
                display: "flex",
                alignItems: "flex-start",
                gap: "6px",
                lineHeight: 1.5,
              }}
            >
              <span style={{ flex: 1 }}>{paper.title}</span>
              <ExternalLink style={{ width: "16px", height: "16px", flexShrink: 0, opacity: 0.5, marginTop: "4px" }} />
            </a>

            <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "8px", flexWrap: "wrap" }}>
              {authors.length > 0 && (
                <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <User style={{ width: "12px", height: "12px" }} />
                  {authors.slice(0, 3).join(", ")}
                  {authors.length > 3 && ` +${authors.length - 3}`}
                </span>
              )}
              {metadataString(meta, "published") ? (
                <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <Calendar style={{ width: "12px", height: "12px" }} />
                  {formatPaperDate(metadataString(meta, "published"))}
                </span>
              ) : metadataNumber(meta, "year") > 0 ? (
                <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <Calendar style={{ width: "12px", height: "12px" }} />
                  {metadataNumber(meta, "year")}
                </span>
              ) : null}
              {metadataNumber(meta, "citation_count") > 0 && (
                <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <Star style={{ width: "12px", height: "12px" }} />
                  Cited {metadataNumber(meta, "citation_count")} times
                </span>
              )}
              {displayId && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    padding: "2px 10px",
                    borderRadius: "var(--radius-full)",
                    background: "var(--bg-hover)",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                  }}
                >
                  {displayId}
                </span>
              )}
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "2px 10px",
                  borderRadius: "var(--radius-full)",
                  background: `${relationshipColor}20`,
                  color: relationshipColor,
                  fontWeight: 600,
                }}
              >
                {relationshipLabel}
              </span>
            </div>
          </div>
        </div>

        {paperTrackingType === "followup" && resolvedSourcePaperTitle && resolvedSourcePaperTitle !== paper.title && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "12px",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              background: "rgba(123, 200, 240, 0.08)",
              border: "1px solid rgba(123, 200, 240, 0.16)",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#2C7FB8",
                whiteSpace: "nowrap",
              }}
            >
              Source paper
            </span>
            <span
              style={{
                fontSize: "0.875rem",
                color: "var(--text-main)",
                lineHeight: 1.5,
              }}
            >
              {resolvedSourcePaperTitle}
            </span>
          </div>
        )}

        {paper.tags?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
            {paper.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  padding: "4px 10px",
                  borderRadius: "var(--radius-full)",
                  background: "var(--bg-hover)",
                  fontSize: "0.75rem",
                  color: "var(--text-secondary)",
                  fontWeight: 500,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {metadataString(meta, "contribution") && (
          <div
            style={{
              display: "flex",
              gap: "10px",
              marginBottom: "16px",
              padding: "12px 16px",
              background: "linear-gradient(135deg, rgba(188, 164, 227, 0.08), rgba(168, 230, 207, 0.05))",
              borderRadius: "var(--radius-lg)",
              border: "1px solid rgba(188, 164, 227, 0.2)",
            }}
          >
            <Star style={{ width: "18px", height: "18px", color: "var(--color-primary)", flexShrink: 0, marginTop: "2px" }} />
            <p style={{ fontSize: "0.9375rem", color: "var(--text-main)", lineHeight: 1.6, margin: 0 }}>
              {metadataString(meta, "contribution")}
            </p>
          </div>
        )}

        {hasFigures && figuresEnabled && (
          <PaperFigureStrip
            figures={figures}
            fallbackUrl={archiveUrl || paper.source_url}
            preferLocal={effectiveSaved}
          />
        )}

        {(pdfUrl || archiveUrl || hasLiteraturePath || canLoadFigures) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              marginBottom: "16px",
            }}
          >
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void openExternalUrl(pdfUrl);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-primary)",
                  color: "white",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  textDecoration: "none",
                  transition: "all 0.2s ease",
                }}
              >
                <Download style={{ width: "14px", height: "14px" }} />
                PDF
              </a>
            )}
            {archiveUrl && (
              <a
                href={archiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void openExternalUrl(archiveUrl);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--text-main)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  textDecoration: "none",
                  transition: "all 0.2s ease",
                }}
              >
                <ExternalLink style={{ width: "14px", height: "14px" }} />
                Archive
              </a>
            )}
            {canLoadFigures && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void loadFigures();
                }}
                disabled={loadingFigures}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-light)",
                  background: hasFigures ? "var(--bg-hover)" : "var(--bg-card)",
                  color: hasFigures ? "var(--text-muted)" : "var(--text-main)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: loadingFigures ? "not-allowed" : "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {loadingFigures ? (
                  <>
                    <RefreshCw style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite" }} />
                    Loading figures...
                  </>
                ) : (
                  <>
                    <ImageIcon style={{ width: "14px", height: "14px" }} />
                    {hasFigures ? `Loaded ${figureCount} figures` : "Fetch figures"}
                  </>
                )}
              </button>
            )}
            {hasLiteraturePath && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void onSave();
                }}
                disabled={effectiveSaved || isSaving || isSavingToWiki}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: effectiveSaved ? "#10B981" : "var(--color-primary)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: effectiveSaved || isSaving || isSavingToWiki ? "not-allowed" : "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {isSaving ? (
                  <>
                    <RefreshCw style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite" }} />
                    Saving...
                  </>
                ) : effectiveSaved ? (
                  <>
                    <Check style={{ width: "14px", height: "14px" }} />
                    Saved to Literature Library
                  </>
                ) : (
                  <>
                    <Save style={{ width: "14px", height: "14px" }} />
                    Save to Literature Library
                  </>
                )}
              </button>
            )}
            {hasLiteraturePath && onSaveAndWiki && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void onSaveAndWiki();
                }}
                disabled={isSaving || isSavingToWiki}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-light)",
                  background: "var(--bg-card)",
                  color: "var(--color-primary)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: isSaving || isSavingToWiki ? "not-allowed" : "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {isSavingToWiki ? (
                  <>
                    <RefreshCw style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite" }} />
                    Processing...
                  </>
                ) : (
                  <>
                    <BookHeart style={{ width: "14px", height: "14px" }} />
                    {effectiveSaved ? "Write to Literature Wiki" : "Save and write to Literature Wiki"}
                  </>
                )}
              </button>
            )}
          </div>
        )}

        <div>
          <p
            style={{
              fontSize: "0.9375rem",
              color: "var(--text-secondary)",
              lineHeight: 1.7,
              margin: 0,
              display: expanded ? "block" : "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {expanded && metadataString(meta, "abstract") ? metadataString(meta, "abstract") : paper.summary}
          </p>
        </div>

        {introExpanded && (
          <div
            style={{
              marginTop: "16px",
              padding: "14px 16px",
              borderRadius: "var(--radius-lg)",
              background: "var(--bg-hover)",
              border: "1px solid var(--border-light)",
            }}
          >
            <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "8px" }}>
              Introduction
            </div>
            <p
              style={{
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
                lineHeight: 1.75,
                margin: 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {loadingIntroduction
                ? "Fetching Introduction..."
                : introduction || (introAttempted ? "No usable Introduction content found." : "")}
            </p>
          </div>
        )}

        {((metadataString(meta, "abstract") || paper.summary.length > 100) || canToggleIntroduction) && (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px", marginBottom: footerContent ? "16px" : "0" }}>
            {(metadataString(meta, "abstract") || paper.summary.length > 100) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-full)",
                  background: "transparent",
                  border: "1px solid var(--border-light)",
                  color: "var(--color-primary)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {expanded ? (
                  <>
                    <ChevronUp style={{ width: "14px", height: "14px" }} />
                    Collapse abstract
                  </>
                ) : (
                  <>
                    <ChevronDown style={{ width: "14px", height: "14px" }} />
                    Expand full abstract
                  </>
                )}
              </button>
            )}

            {canToggleIntroduction && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleIntroduction();
                }}
                disabled={loadingIntroduction}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-full)",
                  background: introExpanded ? "rgba(188, 164, 227, 0.12)" : "transparent",
                  border: "1px solid var(--border-light)",
                  color: "var(--color-primary)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: loadingIntroduction ? "not-allowed" : "pointer",
                  opacity: loadingIntroduction ? 0.7 : 1,
                  transition: "all 0.2s ease",
                }}
              >
                {loadingIntroduction ? (
                  <>
                    <RefreshCw style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite" }} />
                    Fetching Intro
                  </>
                ) : introExpanded ? (
                  <>
                    <ChevronUp style={{ width: "14px", height: "14px" }} />
                    Collapse Introduction
                  </>
                ) : (
                  <>
                    <ChevronDown style={{ width: "14px", height: "14px" }} />
                    Expand Introduction
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {footerContent}
      </div>
    </Card>
  );
}
