import type { EventChannelInput, EventVenueInput, LocationMode } from "./schema";
import type { AdministrativeArea, EventChannel, EventRecord, EventVenue, VenueRecord } from "./types";
import { makeId } from "./utils";

interface AreaRow extends Omit<AdministrativeArea, "codes"> {}
interface AreaCodeRow { administrative_area_id: string; scheme: string; code: string }

export interface PreparedVenueLink {
  venue_id: string;
  new_venue: EventVenueInput | null;
  role: EventVenueInput["role"];
  position: number;
  display_name_snapshot: string | null;
}

export interface PreparedChannel extends EventChannelInput {
  id: string;
}

export interface PreparedEventLocation {
  location_mode: LocationMode;
  location_note: string | null;
  venues: PreparedVenueLink[];
  channels: PreparedChannel[];
}

function cleanNullable(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export function prepareEventLocation(input: {
  location_mode: LocationMode;
  location_note?: string | null;
  venues: EventVenueInput[];
  channels: EventChannelInput[];
}): PreparedEventLocation {
  return {
    location_mode: input.location_mode,
    location_note: cleanNullable(input.location_note),
    venues: input.venues.map((venue) => ({
      venue_id: venue.venue_id ?? makeId("ven"),
      new_venue: venue.venue_id ? null : venue,
      role: venue.role,
      position: venue.position,
      display_name_snapshot: cleanNullable(venue.display_name_snapshot) ?? cleanNullable(venue.canonical_name),
    })),
    channels: input.channels.map((channel) => ({ ...channel, id: makeId("chn") })),
  };
}

export function replaceEventLocationStatements(
  db: D1Database,
  eventId: string,
  location: PreparedEventLocation,
  now: string,
  conditionSql: string,
  conditionBindings: unknown[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM event_venues WHERE event_id = ? AND ${conditionSql}`)
      .bind(eventId, ...conditionBindings),
    db.prepare(`DELETE FROM event_channels WHERE event_id = ? AND ${conditionSql}`)
      .bind(eventId, ...conditionBindings),
  ];

  for (const link of location.venues) {
    if (link.new_venue) {
      const venue = link.new_venue;
      statements.push(db.prepare(`INSERT INTO venues (
        id, canonical_name, administrative_area_id, address_text, latitude, longitude,
        coordinate_precision, coordinate_source, coordinates_verified_at, status, created_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ? WHERE ${conditionSql}`)
        .bind(
          link.venue_id, venue.canonical_name, cleanNullable(venue.administrative_area_id), cleanNullable(venue.address_text),
          venue.latitude ?? null, venue.longitude ?? null, venue.coordinate_precision ?? null,
          cleanNullable(venue.coordinate_source), venue.latitude == null ? null : now, now, now,
          ...conditionBindings,
        ));
      statements.push(db.prepare(`INSERT INTO venue_aliases (venue_id, alias)
        SELECT ?, ? WHERE ${conditionSql}`)
        .bind(link.venue_id, venue.canonical_name, ...conditionBindings));
    }
    statements.push(db.prepare(`INSERT INTO event_venues (
      event_id, venue_id, role, position, display_name_snapshot
    ) SELECT ?, ?, ?, ?, ? WHERE ${conditionSql}`)
      .bind(eventId, link.venue_id, link.role, link.position, link.display_name_snapshot, ...conditionBindings));
  }

  for (const channel of location.channels) {
    statements.push(db.prepare(`INSERT INTO event_channels (
      id, event_id, channel_type, name, url, position
    ) SELECT ?, ?, ?, ?, ?, ? WHERE ${conditionSql}`)
      .bind(channel.id, eventId, channel.channel_type, channel.name, channel.url ?? null, channel.position, ...conditionBindings));
  }
  return statements;
}

function chunks<T>(values: T[], size = 80): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function physicalLocationLabel(event: Pick<EventRecord, "venues" | "area_label" | "location_note">): string | null {
  const venueNames = event.venues.map((venue) => venue.display_name_snapshot ?? venue.canonical_name);
  if (venueNames.length) return [venueNames.join(" / "), event.area_label].filter(Boolean).join(" · ");
  return event.location_note;
}

function setLocationLabels(event: EventRecord): void {
  const venueNames = event.venues.map((venue) => venue.display_name_snapshot ?? venue.canonical_name);
  const areaNames = [...new Set(event.venues.map((venue) => venue.area_name).filter((value): value is string => Boolean(value)))];
  const channelNames = event.channels.map((channel) => channel.name);
  event.venue_label = venueNames.length ? venueNames.join(" / ") : null;
  event.area_label = areaNames.length ? areaNames.join(" / ") : null;
  const physical = [event.venue_label, event.area_label].filter(Boolean).join(" · ");
  const remote = channelNames.join(" / ");
  if (event.location_mode === "physical" || event.location_mode === "multiple") event.location_label = physical || event.location_note;
  else if (event.location_mode === "online" || event.location_mode === "broadcast") event.location_label = remote || event.location_note;
  else if (event.location_mode === "hybrid") event.location_label = [physical, remote].filter(Boolean).join(" / ") || event.location_note;
  else event.location_label = event.location_note;
}

export async function hydrateEventLocations(db: D1Database, events: EventRecord[]): Promise<EventRecord[]> {
  if (!events.length) return events;
  const byId = new Map(events.map((event) => {
    event.venues = [];
    event.channels = [];
    return [event.id, event];
  }));

  for (const ids of chunks(events.map((event) => event.id))) {
    const placeholders = ids.map(() => "?").join(",");
    const [venueResult, channelResult] = await Promise.all([
      db.prepare(`SELECT ev.event_id, ev.role, ev.position, ev.display_name_snapshot,
        v.id, v.canonical_name, v.administrative_area_id, v.address_text, v.latitude, v.longitude,
        v.coordinate_precision, v.coordinate_source, v.coordinates_verified_at, v.status,
        v.created_at, v.updated_at, a.name_local AS area_name, a.country_code
        FROM event_venues ev
        JOIN venues v ON v.id = ev.venue_id
        LEFT JOIN administrative_areas a ON a.id = v.administrative_area_id
        WHERE ev.event_id IN (${placeholders})
        ORDER BY ev.event_id, ev.position, ev.venue_id`).bind(...ids).all<EventVenue & { event_id: string }>(),
      db.prepare(`SELECT id, event_id, channel_type, name, url, position
        FROM event_channels WHERE event_id IN (${placeholders})
        ORDER BY event_id, position, id`).bind(...ids).all<EventChannel>(),
    ]);
    for (const venue of venueResult.results) byId.get(venue.event_id)?.venues.push(venue);
    for (const channel of channelResult.results) byId.get(channel.event_id)?.channels.push(channel);
  }
  for (const event of events) setLocationLabels(event);
  return events;
}

export async function listAdministrativeAreas(db: D1Database): Promise<AdministrativeArea[]> {
  const [areas, codes] = await Promise.all([
    db.prepare(`SELECT id, country_code, level, parent_id, name_local, name_ja, name_zh, name_en
      FROM administrative_areas WHERE valid_to IS NULL ORDER BY country_code, level, name_local`)
      .all<AreaRow>(),
    db.prepare("SELECT administrative_area_id, scheme, code FROM administrative_area_codes ORDER BY scheme, code")
      .all<AreaCodeRow>(),
  ]);
  const codesByArea = new Map<string, Array<{ scheme: string; code: string }>>();
  for (const code of codes.results) {
    const list = codesByArea.get(code.administrative_area_id) ?? [];
    list.push({ scheme: code.scheme, code: code.code });
    codesByArea.set(code.administrative_area_id, list);
  }
  return areas.results.map((area) => ({ ...area, codes: codesByArea.get(area.id) ?? [] }));
}

export async function listVenues(db: D1Database, limit = 1000): Promise<VenueRecord[]> {
  const result = await db.prepare(`SELECT v.*, a.name_local AS area_name, a.country_code
    FROM venues v LEFT JOIN administrative_areas a ON a.id = v.administrative_area_id
    ORDER BY v.canonical_name COLLATE NOCASE, v.id LIMIT ?`)
    .bind(Math.max(1, Math.min(limit, 2000))).all<VenueRecord>();
  return result.results;
}
