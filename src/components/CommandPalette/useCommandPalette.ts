import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '../../core/store';
import { api } from '../../core/api';
import { isActionEnterKey, isComposingKeyboardEvent } from '../../core/keyboard';
import {
  LayoutDashboard,
  User,
  BookOpen,
  Settings,
  Bot,
  Play,
  PlayCircle,
  Lightbulb,
  Search,
  FileText,
  type LucideIcon,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  icon: LucideIcon;
  action: () => void | Promise<void>;
  keywords?: string[];
}

export interface UseCommandPaletteReturn {
  isOpen: boolean;
  searchQuery: string;
  selectedIndex: number;
  filteredCommands: Command[];
  open: () => void;
  close: () => void;
  toggle: () => void;
  setSearchQuery: (query: string) => void;
  selectNext: () => void;
  selectPrev: () => void;
  executeSelected: () => void;
  executeCommand: (commandId: string) => void;
}

// ── Helper Functions ──────────────────────────────────────────────

const isMac = navigator.platform.toLowerCase().includes('mac');

export const formatShortcut = (shortcut: string): string => {
  return shortcut
    .replace('Cmd', isMac ? '⌘' : 'Ctrl')
    .replace('Ctrl', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', '⇧')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace(/\s+/g, '');
};

// ── Hook ──────────────────────────────────────────────────────────

export function useCommandPalette(): UseCommandPaletteReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, setRunningModules] = useState<Set<string>>(new Set());

  const {
    setActiveTab,
    addToast,
  } = useStore();

  // Define all available commands
  const commands: Command[] = useMemo(() => [
    // Navigation commands
    {
      id: 'goto-assistant',
      title: 'Open Assistant',
      subtitle: 'Connect intel, wiki, and chat with your AI CLI',
      shortcut: 'G A',
      icon: Bot,
      keywords: ['assistant', 'codex', 'chat', 'wiki', 'intel'],
      action: () => setActiveTab('assistant'),
    },
    {
      id: 'goto-feed',
      title: 'Open Feed',
      subtitle: 'View the intel card stream',
      shortcut: 'G F',
      icon: LayoutDashboard,
      keywords: ['feed', 'cards', 'intel', 'home'],
      action: () => setActiveTab('overview'),
    },
    {
      id: 'goto-profile',
      title: 'Open Character Home',
      subtitle: 'View personal status and the six-axis radar chart',
      shortcut: 'G P',
      icon: User,
      keywords: ['profile', 'character', 'home', 'status', 'radar'],
      action: () => setActiveTab('profile'),
    },
    {
      id: 'goto-literature',
      title: 'Open Literature Library',
      subtitle: 'Manage and search papers',
      shortcut: 'G L',
      icon: BookOpen,
      keywords: ['literature', 'papers', 'arxiv', 'academic'],
      action: () => setActiveTab('literature'),
    },
    {
      id: 'goto-modules',
      title: 'Open Module Management',
      subtitle: 'Manage all automation modules',
      shortcut: 'G M',
      icon: Settings,
      keywords: ['modules', 'management', 'config', 'crawler'],
      action: () => setActiveTab('modules'),
    },
    {
      id: 'goto-settings',
      title: 'Open Settings',
      subtitle: 'App configuration and preferences',
      shortcut: 'Cmd ,',
      icon: Settings,
      keywords: ['settings', 'config', 'preferences'],
      action: () => setActiveTab('settings'),
    },
    // Module commands
    {
      id: 'run-arxiv',
      title: 'Run arXiv Crawler',
      subtitle: 'Run the arXiv paper tracking module now',
      shortcut: 'R A',
      icon: Play,
      keywords: ['arxiv', 'crawler', 'run', 'papers', 'academic'],
      action: async () => {
        try {
          setRunningModules(prev => new Set(prev).add('arxiv-tracker'));
          await api.post('/api/modules/arxiv-tracker/run', {});
          addToast({
            kind: 'success',
            title: 'arXiv crawler started',
            message: 'Fetching the latest papers...',
          });
        } catch (err) {
          addToast({
            kind: 'error',
            title: 'Run failed',
            message: err instanceof Error ? err.message : 'Could not run the arXiv crawler',
          });
        } finally {
          setRunningModules(prev => {
            const next = new Set(prev);
            next.delete('arxiv-tracker');
            return next;
          });
        }
      },
    },
    {
      id: 'run-all',
      title: 'Run All Modules',
      subtitle: 'Run all enabled modules now',
      shortcut: 'R R',
      icon: PlayCircle,
      keywords: ['run', 'all', 'modules', 'crawler'],
      action: async () => {
        try {
          addToast({
            kind: 'info',
            title: 'Running all modules',
            message: 'Please wait...',
          });
          // Run all modules in parallel
          const modules = ['arxiv-tracker', 'semantic-scholar-tracker', 'xiaohongshu-tracker', 'bilibili-tracker'];
          await Promise.all(
            modules.map(id => api.post(`/api/modules/${id}/run`, {}).catch(() => null))
          );
          addToast({
            kind: 'success',
            title: 'All modules started',
            message: 'Running in the background...',
          });
        } catch (err) {
          addToast({
            kind: 'error',
            title: 'Run failed',
            message: err instanceof Error ? err.message : 'Could not run modules',
          });
        }
      },
    },
    // Content creation commands
    {
      id: 'create-idea',
      title: 'New Idea',
      subtitle: 'Create a new idea in the Idea Workshop',
      shortcut: 'C I',
      icon: Lightbulb,
      keywords: ['idea', 'new', 'create', 'workshop'],
      action: () => {
        // Navigate to ideas tab (vault for now, can be updated when ideas module exists)
        setActiveTab('vault');
        addToast({
          kind: 'info',
          title: 'Note',
          message: 'Create the new idea in your Vault',
        });
      },
    },
    // Search command
    {
      id: 'global-search',
      title: 'Global Search',
      subtitle: 'Search cards, papers, and ideas',
      shortcut: 'Cmd K',
      icon: Search,
      keywords: ['search', 'find', 'global'],
      action: () => {
        // This will be handled by the command palette itself
        // Just keep the palette open
      },
    },
    // Quick module access
    {
      id: 'goto-arxiv',
      title: 'Open arXiv Tracker',
      subtitle: 'Advanced arXiv paper search and tracking',
      icon: FileText,
      keywords: ['arxiv', 'tracker', 'papers', 'academic', 'search'],
      action: () => setActiveTab('arxiv'),
    },
    {
      id: 'goto-chat',
      title: 'Open Agent Chat',
      subtitle: 'Chat with the AI assistant',
      icon: LayoutDashboard,
      keywords: ['chat', 'agent', 'claude', 'codex', 'ai', 'assistant'],
      action: () => setActiveTab('chat'),
    },
  ], [setActiveTab, addToast]);

  // Filter commands based on search query
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return commands;

    const query = searchQuery.toLowerCase();
    return commands.filter(cmd => {
      const titleMatch = cmd.title.toLowerCase().includes(query);
      const subtitleMatch = cmd.subtitle?.toLowerCase().includes(query);
      const keywordMatch = cmd.keywords?.some(k => k.toLowerCase().includes(query));
      const idMatch = cmd.id.toLowerCase().includes(query);
      return titleMatch || subtitleMatch || keywordMatch || idMatch;
    });
  }, [commands, searchQuery]);

  // Reset selected index when filtered commands change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length, searchQuery]);

  // Keyboard shortcut handlers
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    setSelectedIndex(0);
  }, []);
  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const selectNext = useCallback(() => {
    setSelectedIndex(prev =>
      prev < filteredCommands.length - 1 ? prev + 1 : prev
    );
  }, [filteredCommands.length]);

  const selectPrev = useCallback(() => {
    setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
  }, []);

  const executeCommand = useCallback((commandId: string) => {
    const command = commands.find(c => c.id === commandId);
    if (command) {
      close();
      // Small delay to allow modal to close before action
      setTimeout(() => {
        command.action();
      }, 50);
    }
  }, [commands, close]);

  const executeSelected = useCallback(() => {
    const command = filteredCommands[selectedIndex];
    if (command) {
      close();
      // Small delay to allow modal to close before action
      setTimeout(() => {
        command.action();
      }, 50);
    }
  }, [filteredCommands, selectedIndex, close]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to open
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
        return;
      }

      // Cmd/Ctrl + , for settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        if (!isOpen) {
          setActiveTab('settings');
        }
        return;
      }

      // Only handle these shortcuts when palette is open
      if (!isOpen) return;
      if (isComposingKeyboardEvent(e)) return;

      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }

      // Arrow navigation
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

      // Enter to execute
      if (isActionEnterKey(e)) {
        e.preventDefault();
        executeSelected();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggle, close, selectNext, selectPrev, executeSelected, setActiveTab]);

  return {
    isOpen,
    searchQuery,
    selectedIndex,
    filteredCommands,
    open,
    close,
    toggle,
    setSearchQuery,
    selectNext,
    selectPrev,
    executeSelected,
    executeCommand,
  };
}
