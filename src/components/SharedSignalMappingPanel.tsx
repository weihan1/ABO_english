import { ChevronDown, ChevronRight, FolderTree } from "lucide-react";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { PaginationControls } from "./PaginationControls";

export interface SharedSignalEntry {
  signal: string;
  group_label: string;
  group_labels?: string[];
  count: number;
  platforms: string[];
  sample_authors: string[];
  sample_groups: string[];
}

interface SharedGroupOption {
  value: string;
  label: string;
}

interface SharedSignalMappingPanelProps {
  title?: string;
  description?: string;
  entries: SharedSignalEntry[];
  groupOptions: SharedGroupOption[];
  saving?: boolean;
  updatedAt?: string | null;
  onSave: (mapping: Record<string, string[]>) => Promise<void> | void;
}

const PAGE_SIZE_OPTIONS = [20, 50];
const MAX_VISIBLE_SUGGESTIONS = 5;

type MappingStatusFilter = "all" | "confirmed" | "unconfirmed";

function formatUpdatedAt(updatedAt?: string | null): string {
  if (!updatedAt) return "Not saved yet";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeLabels(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  values.forEach((value) => {
    const label = String(value || "").trim();
    if (label && !result.includes(label)) result.push(label);
  });
  return result;
}

function labelsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((label, index) => label === right[index]);
}

function formatGroupLabels(labels: string[]): string {
  if (labels.length === 0) return "Unspecified";
  return labels.join(" · ");
}

function resolveEntryLabels(entry: SharedSignalEntry): string[] {
  if (entry.group_labels && entry.group_labels.length > 0) {
    return normalizeLabels(entry.group_labels);
  }
  return normalizeLabels([entry.group_label]);
}

export function SharedSignalMappingPanel({
  title = "Shared grouping rules",
  description = "Raw tag -> shared rule -> shared group -> author joins group. This manages the relation between note tags and groups; based on which tags an author's sample notes hit, they will automatically join the matching shared group during the next organization pass.",
  entries,
  groupOptions,
  saving = false,
  updatedAt,
  onSave,
}: SharedSignalMappingPanelProps) {
  const [open, setOpen] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<MappingStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expandedSuggestionSignals, setExpandedSuggestionSignals] = useState<Set<string>>(new Set());
  const datalistId = useId();

  useEffect(() => {
    const nextDraft: Record<string, string[]> = {};
    const nextDraftInputs: Record<string, string> = {};
    for (const entry of entries) {
      nextDraft[entry.signal] = resolveEntryLabels(entry);
      nextDraftInputs[entry.signal] = "";
    }
    setDraft(nextDraft);
    setDraftInputs(nextDraftInputs);
    setExpandedSuggestionSignals(new Set());
  }, [entries]);

  useEffect(() => {
    setPage(1);
  }, [entries, query, statusFilter, open, pageSize]);

  const getDraftLabels = (signal: string): string[] => normalizeLabels(draft[signal] || []);
  const getDraftInput = (signal: string): string => draftInputs[signal] || "";
  const setSignalDraftLabels = (signal: string, labels: string[]) => {
    setDraft((prev) => ({ ...prev, [signal]: normalizeLabels(labels) }));
  };
  const updateDraftInput = (signal: string, value: string) => {
    setDraftInputs((prev) => ({ ...prev, [signal]: value }));
  };
  const addDraftLabel = (signal: string, label: string) => {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) return;
    setSignalDraftLabels(signal, [...getDraftLabels(signal), normalizedLabel]);
    updateDraftInput(signal, "");
  };
  const removeDraftLabel = (signal: string, label: string) => {
    setSignalDraftLabels(
      signal,
      getDraftLabels(signal).filter((item) => item !== label),
    );
  };
  const toggleDraftLabel = (signal: string, label: string) => {
    const current = getDraftLabels(signal);
    if (current.includes(label)) {
      removeDraftLabel(signal, label);
      return;
    }
    setSignalDraftLabels(signal, [...current, label]);
  };
  const toggleSuggestionExpansion = (signal: string) => {
    setExpandedSuggestionSignals((prev) => {
      const next = new Set(prev);
      if (next.has(signal)) next.delete(signal);
      else next.add(signal);
      return next;
    });
  };

  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter((entry) => {
      const haystack = [
        entry.signal,
        ...resolveEntryLabels(entry),
        ...entry.sample_authors,
        ...entry.sample_groups,
        ...entry.platforms,
      ].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [entries, query]);

  const statusFilteredEntries = useMemo(() => {
    if (statusFilter === "all") return filteredEntries;
    return filteredEntries.filter((entry) => {
      const confirmed = getDraftLabels(entry.signal).length > 0;
      return statusFilter === "confirmed" ? confirmed : !confirmed;
    });
  }, [filteredEntries, statusFilter, draft]);

  const changedCount = entries.filter((entry) => !labelsEqual(getDraftLabels(entry.signal), resolveEntryLabels(entry))).length;
  const suggestionLabels = Array.from(new Set(groupOptions.map((item) => item.label).filter(Boolean)));
  const effectiveGroupLabels = Array.from(
    new Set([
      ...suggestionLabels,
      ...entries.flatMap((entry) => resolveEntryLabels(entry)),
    ]),
  );
  const mappedCount = entries.filter((entry) => getDraftLabels(entry.signal).length > 0).length;
  const unmappedCount = Math.max(0, entries.length - mappedCount);
  const totalPages = Math.max(1, Math.ceil(statusFilteredEntries.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedEntries = statusFilteredEntries.slice((safePage - 1) * pageSize, safePage * pageSize);
  const sampleAuthors = useMemo(() => {
    const nextAuthors: string[] = [];
    for (const entry of entries) {
      for (const author of entry.sample_authors) {
        if (author && !nextAuthors.includes(author)) nextAuthors.push(author);
        if (nextAuthors.length >= 4) return nextAuthors;
      }
    }
    return nextAuthors;
  }, [entries]);
  const summaryText = entries.length > 0
    ? "Raw tag -> shared rule -> shared group -> author joins group. This manages tag-to-group relations, not the author list directly."
    : "Run \"shared smart grouping\" once first, and the cross-platform shared rule dictionary will appear here.";

  return (
    <div
      style={{
        padding: "14px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-light)",
        background: "var(--bg-card)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <datalist id={datalistId}>
        {suggestionLabels.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          width: "100%",
          padding: 0,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: "12px",
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", minWidth: 0 }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "10px",
                display: "grid",
                placeItems: "center",
                background: "rgba(14, 165, 233, 0.10)",
                color: "#0284C7",
                flexShrink: 0,
              }}
            >
              <FolderTree size={16} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--text-main)" }}>{title}</div>
                <span style={summaryChipStyle}>Shared across platforms</span>
              </div>
              <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                {summaryText}
              </div>
              <div style={{ marginTop: "6px", fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                Creators join shared groups based on the tags their sample notes hit; what you edit here is how tags map to groups.
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                <span style={summaryChipStyle}>Shared groups {effectiveGroupLabels.length}</span>
                <span style={summaryChipStyle}>Raw tags {entries.length}</span>
                <span style={summaryChipStyle}>Confirmed {mappedCount}</span>
                {unmappedCount > 0 && (
                  <span style={{ ...summaryChipStyle, background: "rgba(245, 158, 11, 0.12)", color: "#B45309" }}>
                    Pending {unmappedCount}
                  </span>
                )}
              </div>
              {sampleAuthors.length > 0 && (
                <div style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                  Current rules affect: {sampleAuthors.join(", ")}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Last updated {formatUpdatedAt(updatedAt)}
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "999px",
                border: "1px solid var(--border-light)",
                background: "var(--bg-base)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                fontWeight: 700,
              }}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {open ? "Collapse rules" : "Expand to view"}
            </div>
          </div>
        </div>
      </button>

      {open && (
        <>
          <div style={{ height: "1px", background: "var(--border-light)" }} />

          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>How to use</div>
              <div style={{ marginTop: "4px", fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: "760px" }}>
                {description}
              </div>
            </div>
            <button
              type="button"
              disabled={saving || changedCount === 0}
              onClick={() => void onSave(draft)}
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid rgba(59, 130, 246, 0.28)",
                background: saving || changedCount === 0 ? "var(--bg-muted)" : "linear-gradient(135deg, #3B82F6, #0891B2)",
                color: saving || changedCount === 0 ? "var(--text-muted)" : "white",
                fontSize: "0.8125rem",
                fontWeight: 700,
                cursor: saving || changedCount === 0 ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving..." : `Save rules${changedCount > 0 ? ` (${changedCount})` : ""}`}
            </button>
          </div>

          <div
            style={{
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(14, 165, 233, 0.16)",
              background: "rgba(14, 165, 233, 0.06)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setShowExample((value) => !value)}
              aria-expanded={showExample}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>
                    Example: how tags pull authors into shared groups
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px", lineHeight: 1.6 }}>
                    Simplest flow: define tag mappings first, then re-organize authors.
                  </div>
                </div>
                <div style={{ ...summaryChipStyle, background: "rgba(255, 255, 255, 0.78)" }}>
                  {showExample ? "Hide example" : "Show example"}
                </div>
              </div>
            </button>

            {showExample && (
              <div style={{ padding: "0 12px 12px", borderTop: "1px solid rgba(14, 165, 233, 0.16)", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.7, marginTop: "10px" }}>
                  <strong style={{ color: "var(--text-main)" }}>Raw tag</strong>
                  {" -> "}
                  <strong style={{ color: "var(--text-main)" }}>Shared rule</strong>
                  {" -> "}
                  <strong style={{ color: "var(--text-main)" }}>Shared group</strong>
                  {" -> "}
                  <strong style={{ color: "var(--text-main)" }}>Author joins group</strong>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {[
                    "Obsidian -> Knowledge Management / Obsidian",
                    "Linked notes -> Knowledge Management / Obsidian",
                    "Zettelkasten -> Knowledge Management / Obsidian",
                  ].map((item) => (
                    <span key={item} style={exampleChipStyle}>{item}</span>
                  ))}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  A Bilibili creator's last 3 posts mention <strong style={{ color: "var(--text-main)" }}>Obsidian and linked notes</strong>;
                  a Xiaohongshu blogger's local notes mention <strong style={{ color: "var(--text-main)" }}>Zettelkasten</strong>.
                  After re-organizing authors, both will join the same shared group:
                  <strong style={{ color: "var(--text-main)" }}> Knowledge Management / Obsidian</strong>.
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search raw tags / shared groups / authors"
              style={{
                flex: "1 1 260px",
                minWidth: 0,
                padding: "9px 11px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-base)",
                color: "var(--text-main)",
                fontSize: "0.8125rem",
              }}
            />
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {[
                { value: "all" as const, label: `All ${entries.length}` },
                { value: "confirmed" as const, label: `Confirmed ${mappedCount}` },
                { value: "unconfirmed" as const, label: `Unconfirmed ${unmappedCount}` },
              ].map((option) => {
                const active = statusFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusFilter(option.value)}
                    style={{
                      padding: "7px 10px",
                      borderRadius: "999px",
                      border: "1px solid",
                      borderColor: active ? "#0284C7" : "var(--border-light)",
                      background: active ? "rgba(14, 165, 233, 0.10)" : "var(--bg-base)",
                      color: active ? "#0369A1" : "var(--text-secondary)",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {entries.length} raw tags total, {statusFilteredEntries.length} matching
            </div>
          </div>

          <PaginationControls
            totalCount={statusFilteredEntries.length}
            page={safePage}
            pageSize={pageSize}
            itemLabel="tags"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => setPageSize(nextPageSize === 50 ? 50 : 20)}
            emptyText="No matching tags"
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "560px", overflow: "auto", paddingRight: "2px" }}>
            {statusFilteredEntries.length === 0 ? (
              <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                No matching raw tags.
              </div>
            ) : pagedEntries.map((entry) => {
              const entryLabels = resolveEntryLabels(entry);
              const draftLabels = getDraftLabels(entry.signal);
              const changed = !labelsEqual(draftLabels, entryLabels);
              const expandedSuggestions = expandedSuggestionSignals.has(entry.signal);
              const visibleSuggestionLabels = expandedSuggestions
                ? suggestionLabels
                : suggestionLabels.slice(0, MAX_VISIBLE_SUGGESTIONS);
              const draftInput = getDraftInput(entry.signal);

              return (
                <div
                  key={entry.signal}
                  style={{
                    padding: "12px",
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${changed ? "rgba(245, 158, 11, 0.28)" : "var(--border-light)"}`,
                    background: changed ? "rgba(245, 158, 11, 0.08)" : "var(--bg-base)",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--text-main)" }}>{entry.signal}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Seen {entry.count} times</span>
                      {entry.platforms.map((platform) => (
                        <span key={`${entry.signal}-${platform}`} style={platformChipStyle}>
                          {platform}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      Currently mapped to: {formatGroupLabels(entryLabels)}
                    </div>
                    {entry.sample_groups.length > 0 && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                        Groups affected: {entry.sample_groups.join(" / ")}
                      </div>
                    )}
                    {entry.sample_authors.length > 0 && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                        Sample authors: {entry.sample_authors.join(", ")}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 700 }}>
                        Target shared groups
                      </span>
                      <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>
                        {draftLabels.length} selected
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {draftLabels.length > 0 ? draftLabels.map((label) => (
                        <button
                          key={`${entry.signal}-selected-${label}`}
                          type="button"
                          onClick={() => removeDraftLabel(entry.signal, label)}
                          style={{
                            padding: "5px 9px",
                            borderRadius: "999px",
                            border: "1px solid rgba(59, 130, 246, 0.20)",
                            background: "rgba(59, 130, 246, 0.10)",
                            color: "#2563EB",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {label} ×
                        </button>
                      )) : (
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          No shared group assigned yet
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        list={datalistId}
                        value={draftInput}
                        onChange={(event) => updateDraftInput(entry.signal, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addDraftLabel(entry.signal, draftInput);
                          }
                        }}
                        placeholder="Type a shared group name and press Enter to add"
                        style={{
                          flex: "1 1 220px",
                          minWidth: 0,
                          padding: "9px 11px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: "white",
                          color: "var(--text-main)",
                          fontSize: "0.8125rem",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => addDraftLabel(entry.signal, draftInput)}
                        disabled={!draftInput.trim()}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: draftInput.trim() ? "var(--bg-card)" : "var(--bg-muted)",
                          color: draftInput.trim() ? "var(--text-secondary)" : "var(--text-muted)",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          cursor: draftInput.trim() ? "pointer" : "not-allowed",
                        }}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignalDraftLabels(entry.signal, [])}
                        disabled={draftLabels.length === 0}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-light)",
                          background: draftLabels.length > 0 ? "var(--bg-card)" : "var(--bg-muted)",
                          color: draftLabels.length > 0 ? "var(--text-secondary)" : "var(--text-muted)",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          cursor: draftLabels.length > 0 ? "pointer" : "not-allowed",
                        }}
                      >
                        Clear
                      </button>
                    </div>

                    {suggestionLabels.length > 0 && (
                      <div
                        style={{
                          padding: "10px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid rgba(15, 23, 42, 0.08)",
                          background: "rgba(15, 23, 42, 0.02)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          Quickly join shared groups. Multi-select; click once to add, click again to remove.
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {visibleSuggestionLabels.map((label) => {
                            const active = draftLabels.includes(label);
                            return (
                              <button
                                key={`${entry.signal}-${label}`}
                                type="button"
                                onClick={() => toggleDraftLabel(entry.signal, label)}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: "999px",
                                  border: `1px solid ${active ? "rgba(59, 130, 246, 0.24)" : "var(--border-light)"}`,
                                  background: active ? "rgba(59, 130, 246, 0.12)" : "transparent",
                                  color: active ? "#2563EB" : "var(--text-secondary)",
                                  fontSize: "0.6875rem",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                {active ? `Selected ${label}` : `Add ${label}`}
                              </button>
                            );
                          })}
                          {suggestionLabels.length > MAX_VISIBLE_SUGGESTIONS && (
                            <button
                              type="button"
                              onClick={() => toggleSuggestionExpansion(entry.signal)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: "999px",
                                border: "1px dashed var(--border-light)",
                                background: "transparent",
                                color: "var(--text-secondary)",
                                fontSize: "0.6875rem",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {expandedSuggestions ? "Collapse groups" : `... all ${suggestionLabels.length} smart groups`}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const summaryChipStyle: CSSProperties = {
  padding: "3px 8px",
  borderRadius: "999px",
  background: "rgba(15, 23, 42, 0.06)",
  color: "var(--text-secondary)",
  fontSize: "0.6875rem",
  fontWeight: 700,
};

const exampleChipStyle: CSSProperties = {
  padding: "5px 9px",
  borderRadius: "999px",
  background: "rgba(59, 130, 246, 0.10)",
  color: "#2563EB",
  fontSize: "0.75rem",
  fontWeight: 700,
};

const platformChipStyle: CSSProperties = {
  padding: "2px 7px",
  borderRadius: "999px",
  background: "rgba(15, 23, 42, 0.06)",
  color: "var(--text-secondary)",
  fontSize: "0.6875rem",
  fontWeight: 700,
};
