interface PaginationControlsProps {
  totalCount: number;
  page: number;
  pageSize: number;
  itemLabel?: string;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  emptyText?: string;
}

export function PaginationControls({
  totalCount,
  page,
  pageSize,
  itemLabel = "items",
  pageSizeOptions = [20, 50],
  onPageChange,
  onPageSizeChange,
  emptyText = "No matching items",
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = totalCount === 0 ? 0 : ((safePage - 1) * pageSize) + 1;
  const pageEnd = Math.min(safePage * pageSize, totalCount);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "12px",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
        {totalCount > 0
          ? `Page ${safePage} / ${totalPages}, showing ${pageStart}-${pageEnd} ${itemLabel}`
          : emptyText}
      </div>

      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        {onPageSizeChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            Per page
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              style={{
                padding: "7px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-light)",
                background: "var(--bg-card)",
                color: "var(--text-main)",
                fontSize: "0.75rem",
              }}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          style={{
            padding: "7px 10px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "var(--bg-card)",
            color: safePage <= 1 ? "var(--text-muted)" : "var(--text-secondary)",
            fontSize: "0.75rem",
            fontWeight: 700,
            cursor: safePage <= 1 ? "not-allowed" : "pointer",
          }}
        >
          Previous
        </button>

        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
          disabled={safePage >= totalPages}
          style={{
            padding: "7px 10px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-light)",
            background: "var(--bg-card)",
            color: safePage >= totalPages ? "var(--text-muted)" : "var(--text-secondary)",
            fontSize: "0.75rem",
            fontWeight: 700,
            cursor: safePage >= totalPages ? "not-allowed" : "pointer",
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
