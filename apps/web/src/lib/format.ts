import type { EventRecord } from "@frip-fan/core";
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

export function formatTime(event: EventRecord, locale: Locale = "zh-CN"): string {
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
