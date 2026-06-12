import { useEffect } from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";
import { useStore, ToastKind } from "../core/store";

export function useToast() {
  const addToast = useStore((s) => s.addToast);
  return {
    success: (title: string, message?: string) => addToast({ kind: "success", title, message }),
    error: (title: string, message?: string) => addToast({ kind: "error", title, message }),
    info: (title: string, message?: string) => addToast({ kind: "info", title, message }),
  };
}

const ICONS: Record<ToastKind, React.FC<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const COLORS: Record<ToastKind, string> = {
  success: "text-emerald-500",
  error: "text-red-500",
  info: "text-indigo-500",
};

function AutoDismiss({ id }: { id: string }) {
  const removeToast = useStore((s) => s.removeToast);
  useEffect(() => {
    const t = setTimeout(() => removeToast(id), 4000);
    return () => clearTimeout(t);
  }, [id, removeToast]);
  return null;
}

export default function ToastContainer() {
  const { toasts, removeToast } = useStore();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-white dark:bg-slate-800
                       border border-slate-200 dark:border-slate-700 shadow-lg min-w-[280px]"
          >
            <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${COLORS[t.kind]}`} aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.title}</p>
              {t.message && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t.message}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <AutoDismiss id={t.id} />
          </div>
        );
      })}
    </div>
  );
}
