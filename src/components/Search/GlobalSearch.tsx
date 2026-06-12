import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, FileText, Lightbulb, BookOpen, ExternalLink, Clock } from 'lucide-react';
import { api } from '../../core/api';
import { isActionEnterKey, isComposingKeyboardEvent } from '../../core/keyboard';
import { useStore, type FeedCard } from '../../core/store';

// ── Types ─────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  type: 'card' | 'literature' | 'idea';
  title: string;
  summary?: string;
  source_url?: string;
  module_id?: string;
  created_at?: number;
  metadata?: Record<string, unknown>;
}

interface UseGlobalSearchReturn {
  isOpen: boolean;
  searchQuery: string;
  results: SearchResult[];
  isLoading: boolean;
  selectedIndex: number;
  recentSearches: string[];
  open: () => void;
  close: () => void;
  toggle: () => void;
  setSearchQuery: (query: string) => void;
  selectNext: () => void;
  selectPrev: () => void;
  executeSelected: () => void;
  clearRecent: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────

const RECENT_SEARCHES_KEY = 'abo:recent-searches';
const MAX_RECENT = 5;

export function useGlobalSearch(): UseGlobalSearchReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const { addToast } = useStore();

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) {
        setRecentSearches(JSON.parse(saved));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save recent searches
  const saveRecentSearch = useCallback((query: string) => {
    if (!query.trim()) return;
    try {
      const newRecent = [query, ...recentSearches.filter(s => s !== query)].slice(0, MAX_RECENT);
      setRecentSearches(newRecent);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(newRecent));
    } catch {
      // Ignore localStorage errors
    }
  }, [recentSearches]);

  // Search API call
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      // Search cards using existing API
      const cards = await api.get<FeedCard[]>(`/api/cards?search=${encodeURIComponent(query)}&limit=10`);

      const searchResults: SearchResult[] = cards.map(card => ({
        id: card.id,
        type: 'card',
        title: card.title,
        summary: card.summary,
        source_url: card.source_url,
        module_id: card.module_id,
        created_at: card.created_at,
        metadata: card.metadata,
      }));

      setResults(searchResults);
    } catch (err) {
      // Silent fail - don't show error for search
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchQuery);
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery, performSearch]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, searchQuery]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    setResults([]);
    setSelectedIndex(0);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const selectNext = useCallback(() => {
    const maxIndex = results.length > 0 ? results.length - 1 : recentSearches.length - 1;
    setSelectedIndex(prev => prev < maxIndex ? prev + 1 : prev);
  }, [results.length, recentSearches.length]);

  const selectPrev = useCallback(() => {
    setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
  }, []);

  const executeSelected = useCallback(() => {
    if (results.length > 0) {
      const result = results[selectedIndex];
      if (result) {
        saveRecentSearch(searchQuery);
        close();

        // Open the result
        if (result.source_url) {
          window.open(result.source_url, '_blank');
        } else {
          addToast({
            kind: 'info',
            title: 'Selected',
            message: result.title,
          });
        }
      }
    } else if (recentSearches.length > 0 && !searchQuery.trim()) {
      // Select recent search
      const recent = recentSearches[selectedIndex];
      if (recent) {
        setSearchQuery(recent);
      }
    }
  }, [results, selectedIndex, recentSearches, searchQuery, close, saveRecentSearch, addToast]);

  const clearRecent = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Ignore
    }
  }, []);

  // Global keyboard shortcut (Cmd/Ctrl + Shift + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        toggle();
        return;
      }

      if (!isOpen) return;
      if (isComposingKeyboardEvent(e)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectNext();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectPrev();
        return;
      }

      if (isActionEnterKey(e)) {
        e.preventDefault();
        executeSelected();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggle, close, selectNext, selectPrev, executeSelected]);

  return {
    isOpen,
    searchQuery,
    results,
    isLoading,
    selectedIndex,
    recentSearches,
    open,
    close,
    toggle,
    setSearchQuery,
    selectNext,
    selectPrev,
    executeSelected,
    clearRecent,
  };
}

// ── Component ─────────────────────────────────────────────────────

export default function GlobalSearch() {
  const {
    isOpen,
    searchQuery,
    results,
    isLoading,
    selectedIndex,
    recentSearches,
    close,
    setSearchQuery,
    clearRecent,
  } = useGlobalSearch();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && isOpen) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen) return null;

  const getResultIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'card':
        return <FileText className="w-4 h-4" />;
      case 'literature':
        return <BookOpen className="w-4 h-4" />;
      case 'idea':
        return <Lightbulb className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getResultTypeLabel = (type: SearchResult['type']) => {
    switch (type) {
      case 'card':
        return 'Card';
      case 'literature':
        return 'Paper';
      case 'idea':
        return 'Idea';
      default:
        return 'Content';
    }
  };

  const showRecent = !searchQuery.trim() && recentSearches.length > 0;
  const showResults = searchQuery.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          close();
        }
      }}
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" />

      {/* Modal */}
      <div className="relative w-full max-w-2xl mx-4 bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Search Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 dark:border-gray-800">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cards, papers, ideas..."
            className="flex-1 bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 text-base outline-none"
          />
          {isLoading && (
            <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-indigo-500 rounded-full animate-spin" />
          )}
          <button
            onClick={close}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto py-2"
        >
          {/* Recent Searches */}
          {showRecent && (
            <div className="px-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Recent searches</span>
                <button
                  onClick={clearRecent}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((query, index) => (
                <button
                  key={query}
                  onClick={() => setSearchQuery(query)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-colors
                    ${index === selectedIndex
                      ? 'bg-indigo-50 dark:bg-indigo-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }
                  `}
                >
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{query}</span>
                </button>
              ))}
            </div>
          )}

          {/* Search Results */}
          {showResults && results.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                No matching results found
              </p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                Try different keywords
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="px-2">
              <div className="px-2 py-1.5">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Search results ({results.length})
                </span>
              </div>
              {results.map((result, index) => {
                const offset = showRecent ? recentSearches.length : 0;
                const actualIndex = index + offset;

                return (
                  <button
                    key={result.id}
                    onClick={() => {
                      if (result.source_url) {
                        window.open(result.source_url, '_blank');
                      }
                      close();
                    }}
                    className={`
                      w-full flex items-start gap-3 px-3 py-3 text-left rounded-lg transition-colors
                      ${actualIndex === selectedIndex
                        ? 'bg-indigo-50 dark:bg-indigo-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }
                    `}
                  >
                    {/* Icon */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400">
                      {getResultIcon(result.type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                          {result.title}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded">
                          {getResultTypeLabel(result.type)}
                        </span>
                      </div>
                      {result.summary && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                          {result.summary}
                        </p>
                      )}
                    </div>

                    {/* External Link Icon */}
                    {result.source_url && (
                      <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty State - No recent searches, no query */}
          {!showRecent && !showResults && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Type keywords to start searching
              </p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                Searches cards, papers, and ideas
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-[10px]">↑↓</kbd>
              <span>Select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-[10px]">↵</kbd>
              <span>Open</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-[10px]">ESC</kbd>
              <span>Close</span>
            </span>
          </div>
          <span className="hidden sm:inline">
            Shortcut: Cmd+Shift+K
          </span>
        </div>
      </div>
    </div>
  );
}
