import { useStore } from "../../core/store";

export default function FeedSidebar() {
  const { feedModules, activeModuleFilter, setActiveModuleFilter, unreadCounts } = useStore();

  return (
    <nav className="w-44 shrink-0 border-r border-slate-200 dark:border-slate-700/60
                    h-full overflow-y-auto py-4 px-2 flex flex-col gap-0.5">
      {feedModules.length === 0 ? (
        <div className="px-3 py-8 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            No modules
          </p>
        </div>
      ) : (
        feedModules.map((mod) => {
          const count = unreadCounts[mod.id] ?? 0;
          const active = activeModuleFilter === mod.id;
          return (
            <button
              key={mod.id}
              onClick={() => setActiveModuleFilter(active ? null : mod.id)}
              className={`flex items-center justify-between w-full px-3 py-1.5 rounded-xl text-sm
                transition-colors cursor-pointer
                ${active
                  ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-medium"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
            >
              <span className="truncate">{mod.name}</span>
              {count > 0 && (
                <span className="text-xs text-slate-400 dark:text-slate-500 ml-1 shrink-0">{count}</span>
              )}
            </button>
          );
        })
      )}
    </nav>
  );
}
