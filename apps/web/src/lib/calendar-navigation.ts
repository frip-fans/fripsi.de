export type CalendarView = "calendar" | "list";

export function calendarViewHref(params: URLSearchParams, view: CalendarView, fallbackMonth: string): string {
  const next = new URLSearchParams(params);
  const month = next.get("month");
  const year = next.get("year");
  if (view === "list" && params.get("view") !== "list" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "")) {
    next.set("year", month!.slice(0, 4));
  }
  if (view === "calendar" && params.get("view") === "list" && /^\d{4}$/.test(year ?? "")) {
    const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "") ? month! : fallbackMonth;
    next.set("month", `${year}-${selectedMonth.slice(5, 7)}`);
  }
  next.set("view", view);
  return `/calendar?${next}`;
}

export function archiveRedirectHref(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.set("view", "list");
  return `/calendar?${params}${url.hash}`;
}

export function eventListYear(requested: string | null, currentYear: string, years: readonly { year: string }[]): string {
  if (/^\d{4}$/.test(requested ?? "") && Number(requested) >= 1900 && Number(requested) <= 2100) return requested!;
  return years.find((item) => item.year === currentYear)?.year ?? years[0]?.year ?? currentYear;
}
