import { useState } from "react";
import { api } from "../core/api";
import { isComposingKeyboardEvent } from "../core/keyboard";
import { useStore, AppConfig } from "../core/store";
import { BookOpen } from "lucide-react";

export default function SetupWizard() {
  const setConfig = useStore((s) => s.setConfig);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    setLoading(true);
    setError("");
    try {
      const config = await api.post<AppConfig>("/api/config", {
        vault_path: path.trim(),
      });
      setConfig(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to configure vault");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-lg p-10 w-full max-w-md">
        {/* Icon + title */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-14 h-14 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
            <BookOpen className="w-7 h-7 text-indigo-500 dark:text-indigo-400" aria-hidden />
          </div>
          <h1 className="text-2xl font-heading text-slate-800 dark:text-slate-100">
            Welcome to ABO
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
            Choose your Obsidian Vault directory. ABO will create the folder structure it needs inside it.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="vault-path"
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Vault path
            </label>
            <input
              id="vault-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isComposingKeyboardEvent(e)) {
                  e.preventDefault();
                }
              }}
              placeholder="~/Documents/MyVault"
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-colors duration-150"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !path.trim()}
            className="mt-2 py-2.5 px-4 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-medium transition-colors duration-150 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {loading ? "Configuring…" : "Get started"}
          </button>
        </form>
      </div>
    </div>
  );
}
