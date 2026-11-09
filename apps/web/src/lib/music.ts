import type {
  ReleaseType,
  SetlistCompleteness,
  SetlistConfidence,
  SetlistSection,
  VersionRelationType,
} from "@frip-fan/core";
import { normalizeForDuplicate } from "@frip-fan/core";
import { t, type Locale } from "./i18n";

export const releaseTypeLabels: Record<ReleaseType, string> = {
  album: "Album",
  single: "Single",
  ep: "EP",
  compilation: "Compilation",
  video: "Video",
  other: "Other",
};

export const setlistCompletenessLabels: Record<SetlistCompleteness, string> = {
  complete: "完整歌单",
  partial: "部分歌单",
  unknown: "完整度待确认",
};

export const setlistConfidenceLabels: Record<SetlistConfidence, string> = {
  official: "官方来源",
  reported: "现场记录",
  unverified: "待核实",
};

export const setlistEventTypeLabels: Record<string, string> = {
  "专场": "单独公演",
  "拼盘": "拼盘",
};

export function setlistEventTypeLabel(value: string | null, locale: Locale = "zh-CN"): string {
  if (!value) return t(locale, "music.unclassified");
  if (value === "专场") return t(locale, "music.solo");
  if (value === "拼盘") return t(locale, "music.festival");
  return value;
}

export function setlistSectionLabel(value: SetlistSection, locale: Locale): string {
  return t(locale, `music.section.${value}` as `music.section.${SetlistSection}`);
}

export function releaseTypeLabel(value: ReleaseType, locale: Locale): string {
  return t(locale, `music.releaseType.${value}` as `music.releaseType.${ReleaseType}`);
}

/** Avoid printing a release title beside a song when it repeats the song title. */
export function distinctReleaseTitles(displayTitle: string, releaseTitles: string | null): string | null {
  if (!releaseTitles) return null;
  return normalizeForDuplicate(displayTitle) === normalizeForDuplicate(releaseTitles) ? null : releaseTitles;
}

export const versionRelationLabels: Record<VersionRelationType, string> = {
  "re-recording_of": "重新录制自",
  rearrangement_of: "重新编曲自",
  remix_of: "Remix 自",
  cover_of: "翻唱自",
  live_version_of: "Live 版本源自",
  instrumental_of: "器乐版本源自",
  edit_of: "剪辑版本源自",
  other: "关联版本",
};

export function formatMusicDate(value: string | null, locale: Locale = "zh-CN"): string {
  if (!value) return t(locale, "common.datePending");
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/** Years between two performances, one decimal, in the page locale (e.g. 7.8). */
export function formatGapYears(days: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(Math.floor((days / 365.25) * 10) / 10);
}

/** Month, day and weekday labels for a date block, formatted for the page locale. */
export function musicDateParts(value: string | null, locale: Locale): { year: string; month: string; day: string; weekday: string } | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).formatToParts(date).find(item => item.type === type)?.value ?? "";
  return {
    year: value.slice(0, 4),
    month: new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date),
    day: part({ day: "numeric" }, "day"),
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date),
  };
}

export function setlistCompletenessLabel(value: SetlistCompleteness, locale: Locale): string {
  return t(locale, {
    complete: "music.complete",
    partial: "music.partial",
    unknown: "music.unknownCompleteness",
  }[value] as "music.complete" | "music.partial" | "music.unknownCompleteness");
}

export function setlistConfidenceLabel(value: SetlistConfidence, locale: Locale): string {
  return t(locale, {
    official: "music.official",
    reported: "music.reported",
    unverified: "music.unverified",
  }[value] as "music.official" | "music.reported" | "music.unverified");
}

export function versionRelationLabel(value: VersionRelationType, locale: Locale): string {
  return t(locale, `relation.${value}` as `relation.${VersionRelationType}`);
}

export function setlistDisplayTitle(setlist: { title: string | null; event_title: string; performance_label: string }): string {
  return setlist.title || `${setlist.event_title} · ${setlist.performance_label}`;
}

export function shouldShowPerformedVersion(displayTitle: string, performedVersionTitle: string | null): boolean {
  return Boolean(
    performedVersionTitle
    && normalizeForDuplicate(displayTitle) !== normalizeForDuplicate(performedVersionTitle),
  );
}
