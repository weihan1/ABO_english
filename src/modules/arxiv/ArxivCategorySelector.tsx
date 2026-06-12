import { useMemo } from "react";
import { ChevronDown, ChevronUp, Tag } from "lucide-react";

export interface ArxivCategory {
  code: string;
  name: string;
  main: string;
}

interface ArxivCategorySelectorProps {
  availableCategories: ArxivCategory[];
  selectedCategories: string[];
  expandedMainCategories: Set<string>;
  onToggleCategory: (category: string) => void;
  onToggleMainCategory: (main: string) => void;
  onToggleMainCategoryExpanded: (main: string) => void;
  disabled?: boolean;
  label?: string;
  helperText?: string;
  maxHeight?: number | string;
}

const MAIN_CATEGORY_LABELS: Record<string, string> = {
  cs: "Computer Science",
  math: "Mathematics",
  physics: "Physics",
  stat: "Statistics",
  eess: "Electrical Engineering",
  econ: "Economics",
  "q-bio": "Quantitative Biology",
  "q-fin": "Quantitative Finance",
};

export function ArxivCategorySelector({
  availableCategories,
  selectedCategories,
  expandedMainCategories,
  onToggleCategory,
  onToggleMainCategory,
  onToggleMainCategoryExpanded,
  disabled = false,
  label = "Category filter",
  helperText,
  maxHeight = "260px",
}: ArxivCategorySelectorProps) {
  const selectedCategorySet = useMemo(() => new Set(selectedCategories), [selectedCategories]);

  const categoriesByMain = useMemo(
    () =>
      availableCategories.reduce<Record<string, ArxivCategory[]>>((acc, category) => {
        const main = category.main || category.code.split(".")[0];
        if (!acc[main]) acc[main] = [];
        acc[main].push(category);
        return acc;
      }, {}),
    [availableCategories],
  );

  const mainCategoryCodes = useMemo(
    () =>
      Object.keys(categoriesByMain).sort((a, b) => {
        if (a === "cs") return -1;
        if (b === "cs") return 1;
        return a.localeCompare(b);
      }),
    [categoriesByMain],
  );

  return (
    <div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "0.875rem",
          fontWeight: 600,
          color: "var(--text-main)",
          marginBottom: "12px",
        }}
      >
        <Tag style={{ width: "14px", height: "14px" }} />
        {label}
        {selectedCategories.length > 0 && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              background: "var(--color-primary)20",
              color: "var(--color-primary)",
              fontSize: "0.75rem",
            }}
          >
            {selectedCategories.length}
          </span>
        )}
      </label>

      {availableCategories.length === 0 ? (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "var(--radius-md)",
            border: "1px dashed var(--border-light)",
            background: "var(--bg-hover)",
            fontSize: "0.8125rem",
            color: "var(--text-muted)",
          }}
        >
          Loading categories...
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            maxHeight,
            overflowY: "auto",
            padding: "4px",
          }}
        >
          {mainCategoryCodes.map((main) => {
            const subcategories = categoriesByMain[main] || [];
            const selectedCount = subcategories.filter((category) => selectedCategorySet.has(category.code)).length;
            const allSelected = subcategories.length > 0 && selectedCount === subcategories.length;
            const isExpanded = expandedMainCategories.has(main);

            return (
              <div
                key={main}
                style={{
                  border: "1px solid var(--border-light)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-hover)",
                  overflow: "hidden",
                  opacity: disabled ? 0.72 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px" }}>
                  <button
                    type="button"
                    onClick={() => onToggleMainCategoryExpanded(main)}
                    aria-label={isExpanded ? `Collapse ${main}` : `Expand ${main}`}
                    disabled={disabled}
                    style={{
                      width: "28px",
                      height: "28px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-light)",
                      background: "var(--bg-card)",
                      color: "var(--text-secondary)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {isExpanded ? (
                      <ChevronUp style={{ width: "14px", height: "14px" }} />
                    ) : (
                      <ChevronDown style={{ width: "14px", height: "14px" }} />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleMainCategory(main)}
                    title={allSelected ? "Deselect this category" : "Select all subcategories under this category"}
                    disabled={disabled}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border-light)",
                      background: selectedCount > 0 ? "var(--color-primary)" : "var(--bg-card)",
                      color: selectedCount > 0 ? "white" : "var(--text-main)",
                      fontSize: "0.875rem",
                      fontWeight: 700,
                      cursor: disabled ? "not-allowed" : "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <span>{main} · {MAIN_CATEGORY_LABELS[main] || main}</span>
                    <span style={{ fontSize: "0.75rem", opacity: 0.85 }}>
                      {selectedCount > 0 ? `${selectedCount}/${subcategories.length}` : `${subcategories.length} subcategories`}
                    </span>
                  </button>
                </div>

                {isExpanded && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      padding: "0 12px 12px 44px",
                    }}
                  >
                    {subcategories.map((category) => {
                      const selected = selectedCategorySet.has(category.code);
                      return (
                        <button
                          key={category.code}
                          type="button"
                          onClick={() => onToggleCategory(category.code)}
                          title={category.name}
                          disabled={disabled}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "var(--radius-md)",
                            border: "1px solid var(--border-light)",
                            background: selected ? "var(--color-primary)" : "var(--bg-card)",
                            color: selected ? "white" : "var(--text-secondary)",
                            fontSize: "0.8125rem",
                            cursor: disabled ? "not-allowed" : "pointer",
                            transition: "all 0.2s ease",
                          }}
                        >
                          {category.code}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {helperText && (
        <div style={{ marginTop: "10px", fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
          {helperText}
        </div>
      )}
    </div>
  );
}
