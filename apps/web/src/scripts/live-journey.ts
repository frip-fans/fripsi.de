import L, { type CircleMarker, type LatLngExpression, type Map as LeafletMap } from "leaflet";

interface JourneyStop {
  event_id: string;
  slug: string;
  title: string;
  start_date: string;
  start_time: string | null;
  category: string;
  classification: string | null;
  status: string;
  venue_id: string;
  venue_name: string;
  area_name: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  coordinate_precision: "venue" | "area";
  position: number;
}

interface JourneyPayload {
  range: { from: string | null; to: string | null };
  summary: { stops: number; events: number; venues: number; countries: number; exact_stops: number; approximate_stops: number };
  stops: JourneyStop[];
}

const root = document.querySelector<HTMLElement>("[data-live-journey]");

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function dateLabel(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(`${value}T00:00:00Z`));
}

function greatCircle(from: JourneyStop, to: JourneyStop, steps = 36): LatLngExpression[] {
  const radians = Math.PI / 180;
  const degrees = 180 / Math.PI;
  const lat1 = from.latitude * radians;
  const lon1 = from.longitude * radians;
  const lat2 = to.latitude * radians;
  const lon2 = to.longitude * radians;
  const delta = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  ));
  if (delta < 0.00001) return [[from.latitude, from.longitude], [to.latitude, to.longitude]];
  const points: Array<[number, number]> = [];
  let previousLongitude = from.longitude;
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const a = Math.sin((1 - fraction) * delta) / Math.sin(delta);
    const b = Math.sin(fraction * delta) / Math.sin(delta);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    const latitude = Math.atan2(z, Math.sqrt(x * x + y * y)) * degrees;
    let longitude = Math.atan2(y, x) * degrees;
    while (longitude - previousLongitude > 180) longitude -= 360;
    while (longitude - previousLongitude < -180) longitude += 360;
    previousLongitude = longitude;
    points.push([latitude, longitude]);
  }
  return points;
}

function samePoint(left: JourneyStop, right: JourneyStop): boolean {
  return Math.abs(left.latitude - right.latitude) < 0.00001
    && Math.abs(left.longitude - right.longitude) < 0.00001;
}

function classificationMatches(stop: JourneyStop, filter: string): boolean {
  if (filter === "solo") return stop.classification === "专场";
  if (filter === "festival") return stop.classification === "拼盘";
  return true;
}

async function initialize(): Promise<void> {
  if (!root) return;
  const container = root;
  const required = <T>(selector: string): T => {
    const element = container.querySelector(selector);
    if (!element) throw new Error(`Missing Live Journey element: ${selector}`);
    return element as T;
  };
  const locale = container.dataset.locale || "zh-CN";
  const mapElement = required<HTMLElement>("[data-journey-map]");
  const range = required<HTMLInputElement>("[data-journey-range]");
  const playButton = required<HTMLButtonElement>("[data-journey-play]");
  const speed = required<HTMLSelectElement>("[data-journey-speed]");
  const filter = required<HTMLSelectElement>("[data-journey-filter]");
  const currentDate = required<HTMLElement>("[data-current-date]");
  const currentTitle = required<HTMLAnchorElement>("[data-current-title]");
  const currentVenue = required<HTMLElement>("[data-current-venue]");
  const currentPrecision = required<HTMLElement>("[data-current-precision]");
  const timelineStart = required<HTMLElement>("[data-timeline-start]");
  const timelineEnd = required<HTMLElement>("[data-timeline-end]");
  const progress = required<HTMLElement>("[data-journey-progress]");
  const empty = required<HTMLElement>("[data-journey-empty]");
  const stats = container.querySelectorAll<HTMLElement>("[data-summary-field]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const response = await fetch("/api/journey", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Journey API returned ${response.status}`);
  const payload = await response.json() as JourneyPayload;
  let stops = payload.stops;
  let timer: number | undefined;
  let currentIndex = Math.max(0, stops.length - 1);

  stats.forEach((element) => {
    const field = element.dataset.summaryField as keyof JourneyPayload["summary"] | undefined;
    if (field) element.textContent = String(payload.summary[field]);
  });

  const map: LeafletMap = L.map(mapElement, {
    center: [34.8, 137.5], zoom: 4, minZoom: 2, maxZoom: 16,
    worldCopyJump: true, preferCanvas: true, zoomControl: true,
  });
  L.tileLayer(container.dataset.tileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const venueLayer = L.layerGroup().addTo(map);
  const activeLayer = L.layerGroup().addTo(map);
  const venueMarkers = new Map<string, CircleMarker>();

  function stopPopup(stop: JourneyStop): string {
    return `<strong>${escapeHtml(stop.venue_name)}</strong><br>${escapeHtml(stop.area_name ?? "")}
      <br><a href="/events/${encodeURIComponent(stop.slug)}">${escapeHtml(stop.title)}</a>
      <br><small>${escapeHtml(dateLabel(stop.start_date, locale))}</small>`;
  }

  function rebuildVenueMarkers(): void {
    venueLayer.clearLayers();
    venueMarkers.clear();
    const latestByVenue = new Map<string, JourneyStop>();
    for (const stop of stops) latestByVenue.set(stop.venue_id, stop);
    for (const stop of latestByVenue.values()) {
      const exact = stop.coordinate_precision === "venue";
      const marker = L.circleMarker([stop.latitude, stop.longitude], {
        radius: exact ? 5 : 7,
        color: exact ? "#f3a26f" : "#91a9bd",
        fillColor: exact ? "#ea8142" : "#07101c",
        fillOpacity: exact ? 0.72 : 0.32,
        weight: exact ? 1.5 : 2,
        dashArray: exact ? undefined : "3 3",
      }).bindPopup(stopPopup(stop));
      marker.addTo(venueLayer);
      venueMarkers.set(stop.venue_id, marker);
    }
  }

  function stopPlayback(): void {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    playButton.dataset.playing = "false";
    playButton.setAttribute("aria-pressed", "false");
    playButton.querySelector("span")!.textContent = container.dataset.playLabel || "Play";
  }

  function render(index: number, focus = false): void {
    if (!stops.length) return;
    currentIndex = Math.max(0, Math.min(index, stops.length - 1));
    const stop = stops[currentIndex];
    range.value = String(currentIndex);
    progress.textContent = `${currentIndex + 1} / ${stops.length}`;
    currentDate.textContent = dateLabel(stop.start_date, locale);
    currentTitle.textContent = stop.title;
    currentTitle.href = `/events/${encodeURIComponent(stop.slug)}`;
    currentVenue.textContent = [stop.venue_name, stop.area_name].filter(Boolean).join(" · ");
    currentPrecision.textContent = stop.coordinate_precision === "venue"
      ? (container.dataset.exactLabel || "Exact venue")
      : (container.dataset.approximateLabel || "Approximate area");
    currentPrecision.dataset.precision = stop.coordinate_precision;

    routeLayer.clearLayers();
    for (let routeIndex = 1; routeIndex <= currentIndex; routeIndex += 1) {
      const previous = stops[routeIndex - 1];
      const next = stops[routeIndex];
      if (samePoint(previous, next)) continue;
      const age = currentIndex - routeIndex;
      L.polyline(greatCircle(previous, next), {
        color: "#ea8142", weight: age < 8 ? 2.8 : 1.4,
        opacity: Math.max(0.18, 0.92 - age * 0.018),
        lineCap: "round", lineJoin: "round",
      }).addTo(routeLayer);
    }

    activeLayer.clearLayers();
    L.marker([stop.latitude, stop.longitude], {
      interactive: false,
      icon: L.divIcon({
        className: "journey-active-marker",
        html: '<span aria-hidden="true">✦</span>',
        iconSize: [34, 34], iconAnchor: [17, 17],
      }),
    }).addTo(activeLayer);
    venueMarkers.get(stop.venue_id)?.bringToFront();
    if (focus) {
      const previous = stops[Math.max(0, currentIndex - 1)];
      const countryChanged = previous.country_code !== stop.country_code;
      map.flyTo([stop.latitude, stop.longitude], countryChanged ? 4 : 6, {
        animate: !reducedMotion.matches, duration: reducedMotion.matches ? 0 : 0.85,
      });
    }
  }

  function applyFilter(): void {
    stopPlayback();
    stops = payload.stops.filter((stop) => classificationMatches(stop, filter.value));
    empty.hidden = stops.length > 0;
    mapElement.hidden = stops.length === 0;
    range.disabled = stops.length === 0;
    playButton.disabled = stops.length < 2;
    range.min = "0";
    range.max = String(Math.max(0, stops.length - 1));
    range.value = range.max;
    timelineStart.textContent = stops[0]?.start_date.slice(0, 4) ?? "—";
    timelineEnd.textContent = stops.at(-1)?.start_date.slice(0, 4) ?? "—";
    rebuildVenueMarkers();
    if (stops.length) {
      const bounds = L.latLngBounds(stops.map((stop) => [stop.latitude, stop.longitude] as LatLngExpression));
      map.fitBounds(bounds, { padding: [34, 34], maxZoom: 6, animate: false });
      render(stops.length - 1);
    }
  }

  playButton.addEventListener("click", () => {
    if (timer !== undefined) { stopPlayback(); return; }
    if (currentIndex >= stops.length - 1) render(0, true);
    playButton.dataset.playing = "true";
    playButton.setAttribute("aria-pressed", "true");
    playButton.querySelector("span")!.textContent = container.dataset.pauseLabel || "Pause";
    timer = window.setInterval(() => {
      if (currentIndex >= stops.length - 1) { stopPlayback(); return; }
      render(currentIndex + 1, true);
    }, Number(speed.value));
  });
  range.addEventListener("input", () => { stopPlayback(); render(Number(range.value), false); });
  range.addEventListener("change", () => render(Number(range.value), true));
  speed.addEventListener("change", () => { if (timer !== undefined) { stopPlayback(); playButton.click(); } });
  filter.addEventListener("change", applyFilter);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlayback(); });

  applyFilter();
  container.dataset.ready = "true";
}

initialize().catch((error) => {
  console.error("Live Journey failed", error);
  if (root) {
    root.dataset.error = "true";
    const empty = root.querySelector<HTMLElement>("[data-journey-empty]");
    if (empty) { empty.hidden = false; empty.textContent = root.dataset.errorLabel || "Unable to load map data."; }
  }
});
