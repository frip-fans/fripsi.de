import { viewerTime } from "./event-viewer-time";

// A custom element converts itself wherever it lands: first load, routed pages and fetched search results.
class EventTime extends HTMLElement {
  connectedCallback() {
    // Saved search results come back with an earlier note; rebuild it for the current zone.
    this.querySelector(".viewer-time")?.remove();
    const { start, end, date, time, viewerSame, viewerPrevious, viewerNext, viewerZone } = this.dataset;
    if (!start || !date || !time) return;
    let converted;
    try {
      converted = viewerTime({ start, end, date, time });
    } catch {
      return;
    }
    if (!converted) return;
    const label = converted.dayShift < 0 ? viewerPrevious : converted.dayShift > 0 ? viewerNext : viewerSame;
    if (!label) return;
    const note = document.createElement("span");
    note.className = "viewer-time";
    note.textContent = label.replace("{time}", converted.time);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (viewerZone && zone) note.title = viewerZone.replace("{zone}", zone);
    this.appendChild(note);
  }
}

if (!customElements.get("event-time")) customElements.define("event-time", EventTime);
