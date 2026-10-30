import type { EventRecord } from "./types";
import { normalizeForDuplicate } from "./utils";

export const SYNC_POLICY_VERSION = "official-sync-v2";
export const SYNC_TOOL_LIMIT = 80;

export function occurrenceLabel(title: string): string | null {
  const text = title.normalize("NFKC");
  const part = text.match(/第?([1-9一二三四五六七八九])部/);
  if (part) return `part:${({ 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" } as Record<string,string>)[part[1]] ?? part[1]}`;
  const day = text.match(/\bDAY\s*([1-9])\b/i);
  if (day) return `day:${day[1]}`;
  if (/昼公演|昼の部/.test(text)) return "time:matinee";
  if (/夜公演|夜の部/.test(text)) return "time:evening";
  return null;
}

export function distinctOccurrence(
  incoming: { title: string; category?: string; location_mode?: string },
  existing: { title: string; category: string; location_mode: string },
): boolean {
  const left = occurrenceLabel(incoming.title), right = occurrenceLabel(existing.title);
  if (left && right && left.split(":")[0] === right.split(":")[0] && left !== right) return true;
  const physical = new Set(["physical", "multiple", "undisclosed"]);
  const remote = new Set(["online", "broadcast"]);
  return (incoming.category === "EVENT" && existing.category === "MEDIA" && physical.has(incoming.location_mode ?? "") && remote.has(existing.location_mode))
    || (incoming.category === "MEDIA" && existing.category === "EVENT" && remote.has(incoming.location_mode ?? "") && physical.has(existing.location_mode));
}

export function canonicalClassification(category: string, value?: string | null): string | null {
  if (!value) return null;
  if (category === "LIVE" && /^(ワンマン(?:ライブ)?|one[ -]?man|专场|巡演)$/i.test(value)) return "专场";
  if (category === "MEDIA" && /生放送|freakSide之森|製作委員会の森/i.test(value)) return "生放送";
  if (category === "MEDIA" && /^radio$/i.test(value)) return "Radio";
  if (category === "MEDIA" && /^(web|web掲載)$/i.test(value)) return "WEB";
  return value;
}

export function policyExclusion(category: string, sourceTitle: string, sourceText: string): string | null {
  if (category === "OTHER") return "manual_calendar_category";
  if (/VIPコース|会員規約|長期会員特典カード|発送に関する|お客様情報確認/.test(sourceTitle)) return "not_a_calendar_occurrence";
  if (category === "LIVE" && /1泊2日|旅行期間/.test(sourceText) && /ミニライブ|弾き語り/.test(sourceText)
    && /DAY\s*1|旅行内|にて.{0,30}ミニライブ/s.test(sourceText)
    && !/ミニライブのみ.{0,30}(申込|参加)|ミニライブ.{0,30}(別売|別途チケット|単独販売)/s.test(sourceText)) return "bundle_into_trip_event";
  return null;
}

export function normalizeBroadcastTime(date: string, rawTime: string): { date: string; time: string } {
  const match = rawTime.normalize("NFKC").match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match || Number(match[1]) > 47 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_broadcast_time");
  const instant = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(instant.valueOf()) || instant.toISOString().slice(0, 10) !== date) throw new Error("invalid_broadcast_date");
  instant.setUTCDate(instant.getUTCDate() + Math.floor(Number(match[1]) / 24));
  return { date: instant.toISOString().slice(0, 10), time: `${String(Number(match[1]) % 24).padStart(2, "0")}:${match[2]}` };
}

export function normalizeClockNotation(text: string): string {
  return text.normalize("NFKC").replace(/(\d{1,2})時(?:(\d{1,2})分)?/g, (_all, hour: string, minute: string | undefined) => `${hour}:${(minute ?? "00").padStart(2,"0")}`);
}

export function sourceStartTimes(text: string, title: string): string[] {
  let context = normalizeClockNotation(text);
  const label = occurrenceLabel(title);
  if (label?.startsWith("part:")) {
    const labels = [...context.matchAll(/第?([1-9]\d?|[一二三四五六七八九])部/g)];
    const index = labels.findIndex((match) => occurrenceLabel(`第${match[1]}部`) === label);
    if (index >= 0) context = context.slice(labels[index].index! + labels[index][0].length, labels[index + 1]?.index);
  }
  const times: string[] = [];
  for (const match of context.matchAll(/(?:開演|開始)(?:予定|時刻|時間)?\s*[:：]?\s*(\d{1,2}):([0-5]\d)/g)) {
    if (/受付|募集|申込|応募/.test(context.slice(Math.max(0, match.index! - 4), match.index))) continue;
    times.push(`${match[1]}:${match[2]}`);
  }
  for (const match of context.matchAll(/(\d{1,2}):([0-5]\d)\s*(?:開始|開演)/g)) times.push(`${match[1]}:${match[2]}`);
  if (!times.length && !/開場|受付|募集/.test(context) && (label?.startsWith("part:") || /放送日時|配信日時|開催日時|開催日程/.test(context))) {
    const first = context.match(/(\d{1,2}):([0-5]\d)/); if (first) times.push(`${first[1]}:${first[2]}`);
  }
  return [...new Set(times)];
}

export function compactEvent(event: EventRecord) {
  return {
    event_id: event.id, title: event.title, start_date: event.start_date, end_date: event.end_date,
    start_time: event.start_time, end_time: event.end_time, timezone: event.timezone,
    category: event.category, classification: event.classification, status: event.status, version: event.version,
    location_mode: event.location_mode, location_label: event.location_label,
    venues: event.venues.map((venue) => ({ venue_id: venue.id, canonical_name: venue.canonical_name })),
    channels: event.channels.map(({ channel_type, name, url }) => ({ channel_type, name, url })),
    sources: event.sources?.map(({ url }) => ({ url })),
  };
}

export function sameActivityTitle(a: string, b: string): boolean {
  const strip = (text: string) => normalizeForDuplicate(text.replace(/^【(?:番組|生放送|freakSide|LIVE)】/i, "").replace(/(?:放送のご案内|開催のご案内|のお知らせ)$/, ""));
  return strip(a) === strip(b);
}
