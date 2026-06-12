import { useRef, useEffect } from 'react';
import { Search, Command, X } from 'lucide-react';
import { useCommandPalette, formatShortcut } from './useCommandPalette';

export default function CommandPalette() {
  const {
    isOpen,
    searchQuery,
    selectedIndex,
    filteredCommands,
    close,
    setSearchQuery,
  } = useCommandPalette();

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
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
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 text-base outline-none"
          />
          <div className="flex items-center gap-2">
            <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <Command className="w-3 h-3" />
              <span>K</span>
            </kbd>
            <button
              onClick={close}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Command List */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto py-2"
        >
          {filteredCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                No matching commands found
              </p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                Try different keywords
              </p>
            </div>
          ) : (
            filteredCommands.map((command, index) => {
              const Icon = command.icon;
              const isSelected = index === selectedIndex;

              return (
                <button
                  key={command.id}
                  onClick={() => {
                    // Execute command
                    setTimeout(() => {
                      command.action();
                    }, 50);
                    close();
                  }}
                  onMouseEnter={() => {
                    // Hover visual feedback handled by CSS
                  }}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                    ${isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    }
                  `}
                >
                  {/* Icon */}
                  <div
                    className={`
                      flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center
                      ${isSelected
                        ? 'bg-indigo-100 dark:bg-indigo-800/30 text-indigo-600 dark:text-indigo-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                      }
                    `}
                  >
                    <Icon className="w-5 h-5" />
                  </div>

                  {/* Text Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`
                          font-medium text-sm
                          ${isSelected
                            ? 'text-indigo-900 dark:text-indigo-100'
                            : 'text-gray-900 dark:text-gray-100'
                          }
                        `}
                      >
                        {command.title}
                      </span>
                    </div>
                    {command.subtitle && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {command.subtitle}
                      </p>
                    )}
                  </div>

                  {/* Shortcut Badge */}
                  {command.shortcut && (
                    <kbd
                      className={`
                        hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded
                        ${isSelected
                          ? 'bg-indigo-100 dark:bg-indigo-800/40 text-indigo-700 dark:text-indigo-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                        }
                      `}
                    >
                      {formatShortcut(command.shortcut)}
                    </kbd>
                  )}
                </button>
              );
            })
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
              <span>Run</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-[10px]">ESC</kbd>
              <span>Close</span>
            </span>
          </div>
          <span>
            {filteredCommands.length} commands
          </span>
        </div>
      </div>
    </div>
  );
}
