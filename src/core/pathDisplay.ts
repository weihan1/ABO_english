import type { AppConfig } from "./store";

export type LibraryRootKind = "vault" | "literature";

function normalizePath(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function stripRootPrefix(path: string, root: string): string {
  if (!path || !root) return path;
  const loweredPath = path.toLowerCase();
  const loweredRoot = root.toLowerCase();
  if (loweredPath === loweredRoot) return "";
  if (loweredPath.startsWith(`${loweredRoot}/`)) {
    return path.slice(root.length + 1);
  }
  return path;
}

export function dirnamePath(path: string | null | undefined): string {
  const normalized = normalizePath(path);
  if (!normalized) return "";
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) return normalized;
  return normalized.slice(0, slashIndex);
}

export function formatLibraryLocation(
  path: string | null | undefined,
  kind: LibraryRootKind,
  config?: Pick<AppConfig, "vault_path" | "literature_path"> | null,
): string {
  const rootLabel = kind === "vault" ? "Intel Library" : "Literature Library";
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return rootLabel;

  const rootPath = normalizePath(
    kind === "literature"
      ? (config?.literature_path || config?.vault_path || "")
      : (config?.vault_path || ""),
  );
  const relativePath = stripRootPrefix(normalizedPath, rootPath).replace(/^\.?\//, "");
  return relativePath ? `${rootLabel} / ${relativePath}` : rootLabel;
}

export function withLocationSuffix(
  message: string,
  path: string | null | undefined,
  kind: LibraryRootKind,
  config?: Pick<AppConfig, "vault_path" | "literature_path"> | null,
): string {
  const location = formatLibraryLocation(path, kind, config);
  return `${message} · Path: ${location}`;
}
