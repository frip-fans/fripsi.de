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

export function dateInTimeZone(date = new Date(), timeZone = "Asia/Tokyo"): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
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
