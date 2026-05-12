import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ArxivCategorySelector, type ArxivCategory } from "./ArxivCategorySelector";

export type ArxivField = "all" | "ti" | "abs" | "au" | "co" | "jr" | "cat" | "id" | "rn";
export type ArxivOp = "contains" | "exact";
export type ArxivConnector = "AND" | "OR" | "ANDNOT";

export interface ArxivCondition {
  id: string;
  field: ArxivField;
  op: ArxivOp;
  value: string;
  connector: ArxivConnector;
}

export interface ArxivDateRange {
  type: "submitted" | "announced";
  mode: "past_days" | "absolute";
  past_days?: number;
  from?: string;
  to?: string;
}

export interface ArxivAdvancedQuery {
  version: 1;
  conditions: ArxivCondition[];
  categories: string[];
  date_range: ArxivDateRange | null;
  sort_by: "submittedDate" | "lastUpdatedDate" | "relevance";
  sort_order: "descending" | "ascending";
  max_results: number;
}

interface Props {
  value: ArxivAdvancedQuery;
  onChange: (next: ArxivAdvancedQuery) => void;
  availableCategories: ArxivCategory[];
  expandedMainCategories: Set<string>;
  onToggleMainCategoryExpanded: (main: string) => void;
  showRuntimeKnobs?: boolean; // sort + max_results (off for monitors)
  disabled?: boolean;
  compact?: boolean;
}

const FIELD_LABELS: Record<ArxivField, string> = {
  all: "All fields",
  ti: "Title",
  abs: "Abstract",
  au: "Author",
  co: "Comment",
  jr: "Journal ref",
  cat: "Category",
  id: "arXiv ID",
  rn: "Report number",
};

const CONNECTOR_LABELS: Record<ArxivConnector, string> = {
  AND: "AND",
  OR: "OR",
  ANDNOT: "NOT",
};

const inputStyle: React.CSSProperties = {
  height: "34px",
  padding: "0 10px",
  borderRadius: "8px",
  border: "1px solid var(--border-light)",
  background: "var(--bg-app)",
  color: "var(--text-main)",
  fontSize: "0.85rem",
  outline: "none",
  boxShadow: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  padding: "0 22px 0 8px",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  cursor: "pointer",
  backgroundImage:
    "linear-gradient(45deg, transparent 50%, var(--text-muted) 50%), linear-gradient(135deg, var(--text-muted) 50%, transparent 50%)",
  backgroundPosition: "calc(100% - 12px) center, calc(100% - 7px) center",
  backgroundSize: "5px 5px, 5px 5px",
  backgroundRepeat: "no-repeat",
};

let _condIdSeq = 0;
const nextCondId = () => `c-${Date.now()}-${++_condIdSeq}`;

export function createEmptyAdvancedQuery(): ArxivAdvancedQuery {
  return {
    version: 1,
    conditions: [{ id: nextCondId(), field: "all", op: "contains", value: "", connector: "AND" }],
    categories: [],
    date_range: { type: "submitted", mode: "past_days", past_days: 60 },
    sort_by: "submittedDate",
    sort_order: "descending",
    max_results: 50,
  };
}

function tokenize(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function fragmentForCondition(c: ArxivCondition): string | null {
  const value = c.value.trim();
  if (!value) return null;
  if (c.op === "exact") {
    const phrase = value.replace(/"/g, "").trim();
    if (!phrase) return null;
    return `${c.field}:"${phrase}"`;
  }
  const tokens = tokenize(value);
  if (tokens.length <= 1) return `${c.field}:${tokens[0] ?? value}`;
  return `(${tokens.map((t) => `${c.field}:${t}`).join(" AND ")})`;
}

export function previewAdvancedQuery(q: ArxivAdvancedQuery): string {
  const fragments: string[] = [];
  let used = 0;
  q.conditions.forEach((c) => {
    const f = fragmentForCondition(c);
    if (!f) return;
    if (!fragments.length) fragments.push(f);
    else {
      fragments.push(` ${c.connector} ${f}`);
      used++;
    }
  });
  const cond = fragments.join("").trim();
  const parts: string[] = [];
  if (cond) parts.push(used ? `(${cond})` : cond);
  if (q.categories.length === 1) parts.push(`cat:${q.categories[0]}`);
  else if (q.categories.length > 1) parts.push(`(${q.categories.map((c) => `cat:${c}`).join(" OR ")})`);
  if (q.date_range) {
    if (q.date_range.mode === "past_days" && q.date_range.past_days) {
      parts.push(`submittedDate:[past ${q.date_range.past_days}d]`);
    } else if (q.date_range.mode === "absolute" && (q.date_range.from || q.date_range.to)) {
      parts.push(`submittedDate:[${q.date_range.from || "*"} TO ${q.date_range.to || "*"}]`);
    }
  }
  return parts.join(" AND ") || "all:*";
}

export function AdvancedQueryBuilder({
  value,
  onChange,
  availableCategories,
  expandedMainCategories,
  onToggleMainCategoryExpanded,
  showRuntimeKnobs = true,
  disabled = false,
  compact = false,
}: Props) {
  const preview = useMemo(() => previewAdvancedQuery(value), [value]);

  const updateCondition = (id: string, patch: Partial<ArxivCondition>) => {
    onChange({
      ...value,
      conditions: value.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  };

  const addCondition = () => {
    onChange({
      ...value,
      conditions: [
        ...value.conditions,
        { id: nextCondId(), field: "all", op: "contains", value: "", connector: "AND" },
      ],
    });
  };

  const removeCondition = (id: string) => {
    const next = value.conditions.filter((c) => c.id !== id);
    onChange({
      ...value,
      conditions: next.length
        ? next
        : [{ id: nextCondId(), field: "all", op: "contains", value: "", connector: "AND" }],
    });
  };

  const toggleCategory = (code: string) => {
    onChange({
      ...value,
      categories: value.categories.includes(code)
        ? value.categories.filter((c) => c !== code)
        : [...value.categories, code],
    });
  };

  const toggleMainCategory = (main: string) => {
    const codes = availableCategories.filter((c) => c.main === main).map((c) => c.code);
    if (!codes.length) return;
    const allSelected = codes.every((code) => value.categories.includes(code));
    const set = new Set(value.categories);
    if (allSelected) codes.forEach((code) => set.delete(code));
    else codes.forEach((code) => set.add(code));
    onChange({ ...value, categories: Array.from(set) });
  };

  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <div style={{ display: "grid", gap: "8px" }}>
        {value.conditions.map((cond, idx) => (
          <div
            key={cond.id}
            style={{
              display: "grid",
              gridTemplateColumns: "70px 110px 90px 1fr 32px",
              gap: "6px",
              alignItems: "center",
            }}
          >
            {idx === 0 ? (
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
                WHERE
              </div>
            ) : (
              <select
                value={cond.connector}
                onChange={(e) => updateCondition(cond.id, { connector: e.target.value as ArxivConnector })}
                disabled={disabled}
                style={selectStyle}
              >
                {(Object.keys(CONNECTOR_LABELS) as ArxivConnector[]).map((k) => (
                  <option key={k} value={k}>
                    {CONNECTOR_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
            <select
              value={cond.field}
              onChange={(e) => updateCondition(cond.id, { field: e.target.value as ArxivField })}
              disabled={disabled}
              style={selectStyle}
            >
              {(Object.keys(FIELD_LABELS) as ArxivField[]).map((k) => (
                <option key={k} value={k}>
                  {FIELD_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              value={cond.op}
              onChange={(e) => updateCondition(cond.id, { op: e.target.value as ArxivOp })}
              disabled={disabled}
              style={selectStyle}
            >
              <option value="contains">contains</option>
              <option value="exact">exact phrase</option>
            </select>
            <input
              type="text"
              value={cond.value}
              placeholder={cond.op === "exact" ? "完整短语" : "关键词（空格分隔即 AND）"}
              onChange={(e) => updateCondition(cond.id, { value: e.target.value })}
              disabled={disabled}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => removeCondition(cond.id)}
              disabled={disabled || value.conditions.length === 1}
              title="删除该行"
              style={{
                height: "32px",
                width: "32px",
                borderRadius: "6px",
                border: "1px solid var(--border-light)",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: value.conditions.length === 1 ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Trash2 style={{ width: 14, height: 14 }} />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addCondition}
          disabled={disabled}
          style={{
            justifySelf: "start",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px dashed var(--border-light)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          <Plus style={{ width: 14, height: 14 }} /> 添加条件
        </button>
      </div>

      {!compact && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border-light)",
            background: "var(--bg-app)",
          }}
        >
          <ArxivCategorySelector
            availableCategories={availableCategories}
            selectedCategories={value.categories}
            expandedMainCategories={expandedMainCategories}
            onToggleCategory={toggleCategory}
            onToggleMainCategory={toggleMainCategory}
            onToggleMainCategoryExpanded={onToggleMainCategoryExpanded}
            label="分类筛选 (可选)"
            helperText="留空则不附加分类限制；勾选后与上面的条件 AND 组合。"
            maxHeight={220}
            disabled={disabled}
          />
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: showRuntimeKnobs ? "1fr 1fr 1fr 1fr" : "1fr 1fr",
          gap: 10,
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <label style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>日期范围</label>
          <select
            value={value.date_range?.mode ?? "none"}
            onChange={(e) => {
              const mode = e.target.value;
              if (mode === "none") onChange({ ...value, date_range: null });
              else if (mode === "past_days")
                onChange({
                  ...value,
                  date_range: { type: "submitted", mode: "past_days", past_days: value.date_range?.past_days ?? 60 },
                });
              else
                onChange({
                  ...value,
                  date_range: {
                    type: "submitted",
                    mode: "absolute",
                    from: value.date_range?.from ?? "",
                    to: value.date_range?.to ?? "",
                  },
                });
            }}
            disabled={disabled}
            style={selectStyle}
          >
            <option value="none">不限</option>
            <option value="past_days">最近 N 天</option>
            <option value="absolute">绝对范围</option>
          </select>
        </div>

        {value.date_range?.mode === "past_days" && (
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>N 天</label>
            <input
              type="number"
              min={0}
              max={3650}
              value={value.date_range.past_days ?? ""}
              placeholder="留空 / 0 表示不限"
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = raw === "" ? undefined : Number(raw);
                onChange({
                  ...value,
                  date_range: {
                    ...value.date_range!,
                    past_days: parsed,
                  },
                });
              }}
              disabled={disabled}
              style={inputStyle}
            />
          </div>
        )}

        {value.date_range?.mode === "absolute" && (
          <>
            <div style={{ display: "grid", gap: 4 }}>
              <label style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>起 (YYYY-MM-DD)</label>
              <input
                type="date"
                value={value.date_range.from ?? ""}
                onChange={(e) =>
                  onChange({ ...value, date_range: { ...value.date_range!, from: e.target.value } })
                }
                disabled={disabled}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <label style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>止 (YYYY-MM-DD)</label>
              <input
                type="date"
                value={value.date_range.to ?? ""}
                onChange={(e) =>
                  onChange({ ...value, date_range: { ...value.date_range!, to: e.target.value } })
                }
                disabled={disabled}
                style={inputStyle}
              />
            </div>
          </>
        )}

        {showRuntimeKnobs && (
          <>
            <div style={{ display: "grid", gap: 4 }}>
              <label style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>排序</label>
              <select
                value={`${value.sort_by}:${value.sort_order}`}
                onChange={(e) => {
                  const [sort_by, sort_order] = e.target.value.split(":") as [
                    ArxivAdvancedQuery["sort_by"],
                    ArxivAdvancedQuery["sort_order"],
                  ];
                  onChange({ ...value, sort_by, sort_order });
                }}
                disabled={disabled}
                style={selectStyle}
              >
                <option value="submittedDate:descending">提交日期 ↓</option>
                <option value="submittedDate:ascending">提交日期 ↑</option>
                <option value="lastUpdatedDate:descending">最后更新 ↓</option>
                <option value="lastUpdatedDate:ascending">最后更新 ↑</option>
                <option value="relevance:descending">相关性</option>
              </select>
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <label style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>最大条数</label>
              <input
                type="number"
                min={1}
                max={5000}
                value={value.max_results}
                onChange={(e) =>
                  onChange({ ...value, max_results: Math.max(1, Number(e.target.value) || 1) })
                }
                disabled={disabled}
                style={inputStyle}
              />
            </div>
          </>
        )}
      </div>

      <div
        style={{
          padding: "8px 10px",
          borderRadius: 6,
          border: "1px solid var(--border-light)",
          background: "var(--bg-app)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.78rem",
          color: "var(--text-muted)",
          wordBreak: "break-all",
        }}
      >
        <span style={{ color: "var(--text-main)", fontWeight: 600, marginRight: 6 }}>search_query =</span>
        {preview}
      </div>
    </div>
  );
}
