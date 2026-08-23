import { physicalLocationLabel } from "./locations";
import type { EventRecord } from "./types";

export interface CalendarOptions {
  siteUrl: string;
  calendarName?: string;
  description?: string;
}

const encoder = new TextEncoder();

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatUtc(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "19700101T000000Z" : formatUtc(date);
}

function localDateTimeAsUtc(date: string, time: string, timeZone: string): string | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
      const represented = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
      );
      const difference = target - represented;
      guess += difference;
      if (difference === 0) break;
    }

    return formatUtc(new Date(guess));
  } catch {
    return null;
  }
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function foldLine(line: string): string {
  const folded: string[] = [];
  let current = "";
  let length = 0;

  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75 && current) {
      folded.push(current);
      current = ` ${character}`;
      length = 1 + bytes;
    } else {
      current += character;
      length += bytes;
    }
  }

  folded.push(current);
  return folded.join("\r\n");
}

function eventStatus(event: EventRecord): "CONFIRMED" | "TENTATIVE" | "CANCELLED" {
  if (event.status === "cancelled") return "CANCELLED";
  if (event.status === "postponed") return "TENTATIVE";
  return "CONFIRMED";
}

function eventLines(event: EventRecord, siteUrl: URL): string[] {
  const detailUrl = new URL(`/events/${encodeURIComponent(event.slug)}`, siteUrl).href;
  const location = physicalLocationLabel(event);
  const description = [
    event.classification ? `分类：${event.classification}` : null,
    event.remark,
    `详情：${detailUrl}`
  ].filter((value): value is string => Boolean(value)).join("\n\n");
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@fripsi.de`,
    `DTSTAMP:${timestamp(event.updated_at)}`,
    `CREATED:${timestamp(event.created_at)}`,
    `LAST-MODIFIED:${timestamp(event.updated_at)}`,
    `SEQUENCE:${event.version}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${detailUrl}`,
    `STATUS:${eventStatus(event)}`,
    "CLASS:PUBLIC",
    "TRANSP:TRANSPARENT",
    `CATEGORIES:${event.category}`
  ];

  if (location) lines.push(`LOCATION:${escapeText(location)}`);

  if (!event.start_time) {
    const inclusiveEnd = event.end_date ?? event.start_date;
    lines.push(`DTSTART;VALUE=DATE:${compactDate(event.start_date)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(inclusiveEnd, 1))}`);
  } else {
    const start = localDateTimeAsUtc(event.start_date, event.start_time, event.timezone);
    lines.push(start
      ? `DTSTART:${start}`
      : `DTSTART:${compactDate(event.start_date)}T${event.start_time.replace(":", "")}00`);

    if (event.end_time) {
      const endDate = event.end_date ?? event.start_date;
      const end = localDateTimeAsUtc(endDate, event.end_time, event.timezone);
      lines.push(end
        ? `DTEND:${end}`
        : `DTEND:${compactDate(endDate)}T${event.end_time.replace(":", "")}00`);
    }
  }

  lines.push("END:VEVENT");
  return lines;
}

export function generateICalendar(events: EventRecord[], options: CalendarOptions): string {
  const siteUrl = new URL(options.siteUrl);
  const name = options.calendarName ?? "fripSide Fan Site";
  const description = options.description ?? "fripsi.de 公开活动日历（非官方网站）";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//fripsi.de//fripSide Fan Site Calendar//ZH-CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-CALDESC:${escapeText(description)}`,
    "X-WR-TIMEZONE:Asia/Tokyo",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    ...events.flatMap((event) => eventLines(event, siteUrl)),
    "END:VCALENDAR"
  ];

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
