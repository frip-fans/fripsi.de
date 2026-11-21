export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function createEventSlug(date: string, title: string, id: string): string {
  const titlePart = slugify(title);
  return `${date}-${titlePart || `event-${id.slice(-8)}`}`;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function dateInTimeZone(date = new Date(), timeZone = "Asia/Tokyo"): string {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function normalizeForDuplicate(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function assertScope(actor: { scopes: string[] }, scope: string): void {
  if (!actor.scopes.includes(scope)) {
    throw new ServiceError("forbidden", `需要权限：${scope}`, 403);
  }
}

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

// Building an Intl formatter costs far more than using one; callers reuse one per zone.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The instant at which a wall-clock date and time occur in the given zone; null for an unknown zone. */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;

  try {
    const formatter = zoneFormatter(timeZone);

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

    const instant = new Date(guess);
    return Number.isNaN(instant.valueOf()) ? null : instant;
  } catch {
    return null;
  }
}
