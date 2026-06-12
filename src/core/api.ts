/** Typed HTTP client with build-specific local backend origin. */

const API_HOST = import.meta.env.VITE_ABO_API_HOST || "127.0.0.1";
const API_PORT = import.meta.env.VITE_ABO_API_PORT || "8765";

export const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;
export const WS_BASE_URL = `ws://${API_HOST}:${API_PORT}`;
const BASE = API_BASE_URL;

export function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildWsUrl(path: string): string {
  return `${WS_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildImageProxyUrl(url: string): string {
  return buildApiUrl(`/api/proxy/image?url=${encodeURIComponent(url)}`);
}

interface WaitForReadyOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

async function retryUntilAvailable<T>(
  attempt: () => Promise<T>,
  options: WaitForReadyOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastError = "Backend not started yet";

  while (Date.now() < deadline) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Failed to connect to backend";
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for backend to start: ${lastError}`);
}

async function waitForReady(options: WaitForReadyOptions = {}): Promise<void> {
  await retryUntilAvailable(async () => {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) {
      throw new Error(`API ${res.status}`);
    }
  }, options);
}

async function waitForGet<T>(path: string, options: WaitForReadyOptions = {}): Promise<T> {
  return retryUntilAvailable(() => request<T>(path), options);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      body: body ? JSON.stringify(body) : undefined,
    }),
  waitForReady,
  waitForGet,
};
