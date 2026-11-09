import { dateInTimeZone, type EventRecord } from "@frip-fan/core";
import { t, type Locale } from "./i18n";

export const categoryLabels: Record<EventRecord["category"], string> = {
  LIVE: "Live",
  EVENT: "Event",
  RELEASE: "Release",
  MEDIA: "Media",
  OTHER: "Other"
};

export const statusLabels: Record<EventRecord["status"], string> = {
  scheduled: "予定",
  completed: "終了",
  cancelled: "中止",
  postponed: "延期"
};

const statusKeys: Record<EventRecord["status"], "status.scheduled" | "status.completed" | "status.cancelled" | "status.postponed"> = {
  scheduled: "status.scheduled",
  completed: "status.completed",
  cancelled: "status.cancelled",
  postponed: "status.postponed",
};

export function statusLabel(locale: Locale, status: EventRecord["status"]): string {
  return t(locale, statusKeys[status]);
}

export function displayEventStatus(
  event: Pick<EventRecord, "start_date" | "end_date" | "status">,
  today = dateInTimeZone()
): EventRecord["status"] {
  if (event.status !== "scheduled") return event.status;
  return (event.end_date ?? event.start_date) < today ? "completed" : "scheduled";
}

export function formatDate(date: string, endDate?: string | null, locale: Locale = "zh-CN"): string {
  const render = (value: string) => new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
  return endDate && endDate !== date ? `${render(date)} — ${render(endDate)}` : render(date);
}

/**
 * Imported titles follow the source site's "「name」@area・venue" pattern. When the venue is shown
 * on its own, drop the "@…" tail and the single pair of brackets wrapping the whole name.
 */
export function eventDisplayTitle(title: string, hasLocation: boolean): string {
  let result = title.trim();
  if (hasLocation) result = result.replace(/\s*@[^@「」『』]+$/u, "");
  const wrapped = /^「(.+)」$/u.exec(result);
  if (wrapped && balancedBrackets(wrapped[1])) result = wrapped[1].trim();
  return result || title;
}

function balancedBrackets(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "「") depth += 1;
    else if (char === "」" && --depth < 0) return false;
  }
  return depth === 0;
}

export function formatTime(event: Pick<EventRecord, "start_time" | "end_time">, locale: Locale = "zh-CN"): string {
  if (!event.start_time) return t(locale, "date.allDay");
  return event.end_time ? `${event.start_time}–${event.end_time}` : event.start_time;
}

export function parseMonth(value: string | null, fallback: string): string {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthBounds(month: string): { from: string; to: string; days: number; offset: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(days).padStart(2, "0")}`;
  const offset = new Date(`${from}T00:00:00Z`).getUTCDay();
  return { from, to, days, offset };
}
