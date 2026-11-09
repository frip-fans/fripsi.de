import { parseAppleMusicRef, parseYouTubeId, ServiceError } from "@frip-fan/core";
import type {
  TourSaveInput,
  DirectEventSaveInput,
  EventDraft,
  EventChannelInput,
  EventPatch,
  EventVenueInput,
  ReleaseSaveInput,
  SetlistSaveInput,
  SongSaveInput,
  SourceInput,
} from "@frip-fan/core";

function optional(form: FormData, key: string): string | null {
  const value = String(form.get(key) ?? "").trim();
  return value || null;
}

export function parseSources(value: string): SourceInput[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [url, label, sourceType] = line.split(/\s*\|\s*/, 3);
    return { url, label: label || undefined, source_type: sourceType || "official" };
  });
}

export function readEventForm(form: FormData): EventDraft {
  const venueIds = all(form, "venue_id");
  const venueNames = all(form, "venue_name");
  const venueAreas = all(form, "venue_area_id");
  const venueRoles = all(form, "venue_role");
  const venueSnapshots = all(form, "venue_snapshot");
  const venueAddresses = all(form, "venue_address");
  const venueLatitudes = all(form, "venue_latitude");
  const venueLongitudes = all(form, "venue_longitude");
  const venuePrecisions = all(form, "venue_precision");
  const venueCount = Math.max(venueIds.length, venueNames.length);
  const venues: EventVenueInput[] = Array.from({ length: venueCount }, (_, index) => {
    const venue_id = venueIds[index] || undefined;
    const canonical_name = venueNames[index] || undefined;
    const latitude = venueLatitudes[index] ? Number(venueLatitudes[index]) : null;
    const longitude = venueLongitudes[index] ? Number(venueLongitudes[index]) : null;
    return {
      venue_id,
      canonical_name,
      administrative_area_id: venueAreas[index] || null,
      address_text: venueAddresses[index] || null,
      latitude,
      longitude,
      coordinate_precision: (venuePrecisions[index] || null) as EventVenueInput["coordinate_precision"],
      role: (venueRoles[index] || "primary") as EventVenueInput["role"],
      position: index + 1,
      display_name_snapshot: venueSnapshots[index] || canonical_name || null,
    };
  }).filter((venue) => Boolean(venue.venue_id || venue.canonical_name));

  const channelTypes = all(form, "channel_type");
  const channelNames = all(form, "channel_name");
  const channelUrls = all(form, "channel_url");
  const channels: EventChannelInput[] = channelNames.map((name, index) => ({
    channel_type: (channelTypes[index] || "other") as EventChannelInput["channel_type"],
    name,
    url: channelUrls[index] || null,
    position: index + 1,
  })).filter((channel) => Boolean(channel.name));

  return {
    slug: optional(form, "slug") ?? undefined,
    title: String(form.get("title") ?? ""),
    start_date: String(form.get("start_date") ?? ""),
    end_date: optional(form, "end_date"),
    start_time: optional(form, "start_time"),
    end_time: optional(form, "end_time"),
    timezone: optional(form, "timezone") ?? "Asia/Tokyo",
    category: String(form.get("category") ?? "OTHER") as EventDraft["category"],
    classification: optional(form, "classification"),
    location_mode: String(form.get("location_mode") ?? "none") as EventDraft["location_mode"],
    location_note: optional(form, "location_note"),
    venues,
    channels,
    remark: optional(form, "remark"),
    status: String(form.get("status") ?? "scheduled") as EventDraft["status"],
    sources: parseSources(String(form.get("sources") ?? ""))
  };
}

export function readEventPatch(form: FormData): EventPatch {
  const event = readEventForm(form);
  return event;
}

function numeric(form: FormData, key: string, fallback = 0): number {
  const value = Number(form.get(key));
  return Number.isFinite(value) ? value : fallback;
}

/** One trimmed value per non-empty line. */
function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function all(form: FormData, key: string): string[] {
  return form.getAll(key).map((value) => String(value).trim());
}

export function readDirectEventSave(form: FormData): DirectEventSaveInput {
  const id = optional(form, "id") ?? undefined;
  return {
    id,
    expected_version: id ? numeric(form, "expected_version") : undefined,
    published: form.has("published"),
    idempotency_key: String(form.get("idempotency_key") ?? ""),
    event: readEventForm(form),
    // Only the admin form sends display fields; an empty value clears them.
    display: form.has("display_field") ? {
      alias: optional(form, "alias"),
      tour_id: optional(form, "tour_id"),
      tour_stop: optional(form, "tour_stop"),
    } : undefined,
  };
}

export function readReleaseSave(form: FormData): ReleaseSaveInput {
  const versions = all(form, "track_version_id");
  const discs = all(form, "track_disc");
  const numbers = all(form, "track_number");
  const titles = all(form, "track_title");
  const notes = all(form, "track_notes");
  const appleTracks = all(form, "track_apple_music");
  const youtubeTracks = all(form, "track_youtube");
  // The editor posts the streaming fields only when it renders them; absent fields keep stored ids.
  const hasStreaming = form.has("apple_music_album");
  const album = parseStreamingField(optional(form, "apple_music_album"), (value) => parseAppleMusicRef(value, "album")?.albumId, "Apple Music 专辑");
  const albumRef = parseAppleMusicRef(optional(form, "apple_music_album"), "album");
  return {
    id: optional(form, "id") ?? undefined,
    expected_updated_at: optional(form, "expected_updated_at") ?? undefined,
    idempotency_key: String(form.get("idempotency_key") ?? ""),
    slug: optional(form, "slug") ?? undefined,
    title: String(form.get("title") ?? ""),
    release_type: String(form.get("release_type") ?? "album") as ReleaseSaveInput["release_type"],
    release_date: optional(form, "release_date"),
    cover_url: optional(form, "cover_url"),
    cover_source_url: optional(form, "cover_source_url"),
    catalog_number: optional(form, "catalog_number"),
    edition: optional(form, "edition"),
    notes: optional(form, "notes"),
    published: form.has("published"),
    // Older editors without the field keep the stored aliases.
    ...(form.has("aliases") ? { aliases: lines(String(form.get("aliases"))) } : {}),
    sources: parseSources(String(form.get("sources") ?? "")),
    tracks: versions.map((song_version_id, index) => ({
      song_version_id,
      disc_number: Number(discs[index] ?? 1),
      track_number: Number(numbers[index] ?? index + 1),
      display_title: titles[index] ?? "",
      notes: notes[index] || null,
      ...(hasStreaming ? {
        apple_music_track_id: parseStreamingField(appleTracks[index], (value) => parseAppleMusicRef(value, "track")?.trackId, `第 ${index + 1} 行 Apple Music 曲目`),
        youtube_video_id: parseStreamingField(youtubeTracks[index], parseYouTubeId, `第 ${index + 1} 行 YouTube`),
      } : {}),
    })),
    ...(hasStreaming ? { apple_music_album_id: album, apple_music_storefront: albumRef?.storefront ?? null } : {}),
  };
}

/** Empty clears the id; anything else must parse, so a mistyped link is reported instead of silently dropped. */
function parseStreamingField(value: string | null | undefined, parse: (value: string) => string | null | undefined, label: string): string | null {
  const input = value?.trim();
  if (!input) return null;
  const id = parse(input);
  if (!id) throw new ServiceError("invalid_streaming_id", `${label}：无法识别的链接或 ID`, 400);
  return id;
}

export function readSongSave(form: FormData): SongSaveInput {
  const versionIds = all(form, "version_id");
  const versionSlugs = all(form, "version_slug");
  const versionTitles = all(form, "version_title");
  const versionLabels = all(form, "version_label");
  const artistCredits = all(form, "version_artist_credit");
  const releaseDates = all(form, "version_release_date");
  const versionNotes = all(form, "version_notes");
  const versionPublished = all(form, "version_published");
  const versionSources = all(form, "version_sources");
  const aliases = lines(String(form.get("aliases") ?? ""));
  return {
    id: optional(form, "id") ?? undefined,
    expected_updated_at: optional(form, "expected_updated_at") ?? undefined,
    idempotency_key: String(form.get("idempotency_key") ?? ""),
    slug: optional(form, "slug") ?? undefined,
    title: String(form.get("title") ?? ""),
    original_artist: String(form.get("original_artist") ?? "fripSide"),
    first_release_date: optional(form, "first_release_date"),
    phases: readSongPhases(form),
    notes: optional(form, "notes"),
    published: form.has("published"),
    aliases,
    sources: parseSources(String(form.get("sources") ?? "")),
    versions: versionTitles.map((title, index) => ({
      id: versionIds[index] || undefined,
      slug: versionSlugs[index] || undefined,
      title,
      version_label: versionLabels[index] || null,
      artist_credit: artistCredits[index] || "fripSide",
      release_date: releaseDates[index] || null,
      notes: versionNotes[index] || null,
      published: versionPublished[index] !== "0",
      sources: parseSources(versionSources[index] ?? ""),
    })),
  };
}

export function readSetlistSave(form: FormData): SetlistSaveInput {
  const songs = all(form, "entry_song_id");
  const versions = all(form, "entry_version_id");
  const sections = all(form, "entry_section");
  const titles = all(form, "entry_title");
  const medleys = all(form, "entry_medley");
  const notes = all(form, "entry_notes");
  return {
    id: optional(form, "id") ?? undefined,
    expected_updated_at: optional(form, "expected_updated_at") ?? undefined,
    idempotency_key: String(form.get("idempotency_key") ?? ""),
    event_id: String(form.get("event_id") ?? ""),
    performance_label: String(form.get("performance_label") ?? ""),
    title: form.has("title") ? optional(form, "title") : undefined,
    completeness: String(form.get("completeness") ?? "unknown") as SetlistSaveInput["completeness"],
    confidence: String(form.get("confidence") ?? "unverified") as SetlistSaveInput["confidence"],
    notes: optional(form, "notes"),
    published: form.has("published"),
    sources: parseSources(String(form.get("sources") ?? "")),
    entries: songs.map((song_id, index) => ({
      song_id,
      performed_version_id: versions[index] || null,
      section: (sections[index] || "main") as SetlistSaveInput["entries"][number]["section"],
      display_title: titles[index] ?? "",
      medley_group: medleys[index] || null,
      notes: notes[index] || null,
    })),
  };
}

export async function boundedFormData(request: Request, maximumBytes = 512 * 1024): Promise<FormData> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ServiceError("payload_too_large", "表单内容过大", 413);
  }
  return request.formData();
}

export function htmlError(error: unknown, back = "/admin"): Response {
  const message = error instanceof Error && (error.name === "ServiceError" || error.name === "ZodError") ? error.message : "操作失败，请稍后重试或查看 Worker 日志。";
  const status = error instanceof ServiceError ? error.status : 400;
  const safe = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back.replaceAll('"', "%22").replaceAll("'", "%27") : "/admin";
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>操作失败</title><body style="font-family:system-ui;padding:3rem;background:#07101c;color:#eff8ff"><h1>操作没有完成</h1><p>${safe}</p><p><a style="color:rgb(234,129,66)" href="${safeBack}">返回检查</a></p></body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

/** The admin form marks that it sent the phase checkboxes, so none checked clears them. */
function readSongPhases(form: FormData): Array<1 | 2 | 3> | undefined {
  if (!form.has("phase_field")) return undefined;
  return [...new Set(form.getAll("phase").map(Number))].filter((phase): phase is 1 | 2 | 3 => phase === 1 || phase === 2 || phase === 3).sort();
}

export function readTourSave(form: FormData): TourSaveInput {
  return {
    id: optional(form, "id") ?? undefined,
    expected_updated_at: optional(form, "expected_updated_at") ?? undefined,
    idempotency_key: String(form.get("idempotency_key") ?? ""),
    slug: optional(form, "slug") ?? undefined,
    name: String(form.get("name") ?? ""),
    notes: optional(form, "notes"),
    published: form.has("published"),
  };
}
