import { useState, useEffect, useRef } from "react";
import { Search, FileText } from "lucide-react";
import { api } from "../../core/api";
import { isActionEnterKey, isComposingKeyboardEvent } from "../../core/keyboard";
import type { WikiType } from "./Wiki";

interface WikiPageInfo {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  updated: string;
}

interface Props {
  wikiType: WikiType;
  onSelectPage: (slug: string) => void;
}

export default function WikiSearch({ wikiType, onSelectPage }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WikiPageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.get<{ pages: WikiPageInfo[] }>(
          `/api/wiki/${wikiType}/pages?q=${encodeURIComponent(query.trim())}`
        );
        setResults(data.pages ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, wikiType]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (isComposingKeyboardEvent(e)) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, -1));
    } else if (isActionEnterKey(e) && focusedIndex >= 0 && results[focusedIndex]) {
      e.preventDefault();
      onSelectPage(results[focusedIndex].slug);
    }
  }

  const CATEGORY_LABELS: Record<string, string> = {
    entity: "Entity",
    concept: "Concept",
    paper: "Paper",
    topic: "Topic",
    overview: "Overview",
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Search input */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          borderRadius: "var(--radius-md)",
          background: "var(--bg-card)",
          border: "1px solid var(--color-primary)",
          boxShadow: "0 0 0 3px rgba(188, 164, 227, 0.1)",
        }}
      >
        <Search style={{ width: "14px", height: "14px", color: "var(--color-primary)", flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search page titles or tags..."
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--text-main)",
            fontSize: "0.8125rem",
          }}
        />
        {loading && (
          <div
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              border: "2px solid var(--border-light)",
              borderTopColor: "var(--color-primary)",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {/* Results dropdown */}
      {query.trim() && (
        <div
          style={{
            marginTop: "4px",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            boxShadow: "var(--shadow-medium, 0 4px 16px rgba(0,0,0,0.1))",
            maxHeight: "240px",
            overflowY: "auto",
          }}
        >
          {results.length === 0 && !loading ? (
            <div
              style={{
                padding: "16px",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "0.8125rem",
              }}
            >
              No matching pages found
            </div>
          ) : (
            results.map((page, i) => (
              <button
                key={page.slug}
                onClick={() => onSelectPage(page.slug)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 14px",
                  width: "100%",
                  border: "none",
                  borderBottom: i < results.length - 1 ? "1px solid var(--border-light)" : "none",
                  background: focusedIndex === i ? "var(--bg-hover)" : "transparent",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                  textAlign: "left",
                }}
                onMouseEnter={() => setFocusedIndex(i)}
                onMouseLeave={() => setFocusedIndex(-1)}
              >
                <FileText
                  style={{
                    width: "14px",
                    height: "14px",
                    color: "var(--text-muted)",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      color: "var(--text-main)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {page.title}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--text-muted)",
                    fontWeight: 500,
                    flexShrink: 0,
                  }}
                >
                  {CATEGORY_LABELS[page.category] ?? page.category}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
