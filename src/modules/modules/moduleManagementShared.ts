import type { ModuleConfig } from "../../types/module";

export interface ModuleUsageMetrics {
  unreadCount: number;
  readCount: number;
  viewCount7d: number;
  saveCount7d: number;
  likeCount7d: number;
  lastCardAt: number | null;
}

export const EMPTY_MODULE_USAGE_METRICS: ModuleUsageMetrics = {
  unreadCount: 0,
  readCount: 0,
  viewCount7d: 0,
  saveCount7d: 0,
  likeCount7d: 0,
  lastCardAt: null,
};

export function normalizeDateValue(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }

  const parsedNumber = typeof value === "string" ? Number(value) : NaN;
  if (Number.isFinite(parsedNumber)) {
    return new Date(parsedNumber < 1e12 ? parsedNumber * 1000 : parsedNumber);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatRelativeDate(value: number | string | null | undefined): string {
  const date = normalizeDateValue(value);
  if (!date) return "None";

  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h ago`;
  if (diff < 7 * day) return `${Math.max(1, Math.floor(diff / day))}d ago`;

  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(value: number | string | null | undefined): string {
  const date = normalizeDateValue(value);
  if (!date) return "None";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatScheduleLabel(schedule: string | null | undefined): string {
  if (!schedule) return "Not set";
  if (schedule.startsWith("*/5")) return "Every 5 minutes";
  const cronMatch = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (cronMatch) {
    const minute = Number(cronMatch[1]);
    const hour = Number(cronMatch[2]);
    if (minute >= 0 && minute <= 59 && hour >= 0 && hour <= 23) {
      return `Daily at ${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
    }
  }
  return schedule;
}

export function getModuleFocusTokens(module: ModuleConfig): string[] {
  const keywordTokens = (module.config.keywords || []).filter(Boolean);
  const subscriptionTokens = (module.subscriptions || [])
    .map((subscription) => subscription.label || subscription.value)
    .filter(Boolean);

  return [...new Set([...keywordTokens, ...subscriptionTokens])];
}

export function getModuleFocusSummary(module: ModuleConfig): string {
  const keywordCount = module.config.keywords?.length || 0;
  const subscriptionCount = module.subscriptions?.length || 0;

  if (keywordCount > 0 && subscriptionCount > 0) {
    return `${keywordCount} keywords · ${subscriptionCount} subscriptions`;
  }
  if (keywordCount > 0) {
    return `${keywordCount} keywords`;
  }
  if (subscriptionCount > 0) {
    return `${subscriptionCount} subscriptions`;
  }
  return "No monitor targets yet";
}
