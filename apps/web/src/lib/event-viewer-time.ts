export interface ViewerTime {
  /** The viewer's wall-clock time, or range, in 24-hour HH:MM. */
  time: string;
  /** Whether the start falls on the day before (-1) or after (1) the event's own date. */
  dayShift: -1 | 0 | 1;
}

function wallClock(instant: Date, timeZone?: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/**
 * Converts an event's start (and end) to the viewer's zone. Returns null when the viewer's clock
 * already reads the same as the event's own, so nothing needs adding.
 */
export function viewerTime(
  event: { start: string; end?: string | null; date: string; time: string },
  timeZone?: string,
): ViewerTime | null {
  const start = new Date(event.start);
  if (Number.isNaN(start.valueOf())) return null;
  const local = wallClock(start, timeZone);
  if (local.date === event.date && local.time === event.time.slice(0, 5)) return null;
  const end = event.end ? new Date(event.end) : null;
  const time = end && !Number.isNaN(end.valueOf()) ? `${local.time}–${wallClock(end, timeZone).time}` : local.time;
  return { time, dayShift: local.date === event.date ? 0 : local.date < event.date ? -1 : 1 };
}
