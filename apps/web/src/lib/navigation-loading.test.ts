import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class Region {
  hidden = true;
  inert = false;
  dataset: Record<string, string> = {};
  style = { setProperty: vi.fn() };
  attributes = new Map<string, string>();
  section: Region | null = null;
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getBoundingClientRect() { return { top: 160, bottom: 80 }; }
  querySelector() { return this.section; }
}

describe("navigation loading feedback", () => {
  let doc: EventTarget;
  let overlay: Region;
  let main: Region;
  let section: Region;
  const fire = (name: string) => doc.dispatchEvent(new Event(name));
  const prepare = (path = "/music/songs", loader: () => Promise<void> = async () => {}) => {
    const controller = new AbortController();
    const event = Object.assign(new Event("astro:before-preparation", { cancelable: true }), {
      to: new URL(path, "https://fripsi.de"), signal: controller.signal, loader,
    });
    doc.dispatchEvent(event);
    return { event, controller };
  };
  beforeEach(async () => {
    vi.resetModules();
    overlay = new Region(); main = new Region(); section = new Region(); main.section = section;
    doc = Object.assign(new EventTarget(), {
      querySelector: (selector: string) => selector === "main" ? main : selector === "[data-navigation-loading]" ? overlay : null,
    });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("innerHeight", 844);
    await import("./navigation-loading");
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("allows the explicit diagnostic control to skip feedback while keeping the loader unchanged", () => {
    Object.assign(doc, { documentElement: { dataset: { navigationFeedback: "off" } } });
    const loader = vi.fn(async () => {});
    const { event } = prepare("/calendar", loader);
    expect(event.loader).toBe(loader);
    expect(overlay.hidden).toBe(true);
    expect(main.inert).toBe(false);
    expect(main.getAttribute("aria-busy")).toBeNull();
    expect(section.inert).toBe(false);
  });

  it("shows synchronously before loading and restores interactivity without waiting for an animation", () => {
    main.setAttribute("aria-busy", "false");
    prepare();
    expect(overlay.hidden).toBe(false);
    expect(main.getAttribute("aria-busy")).toBe("true");
    expect(section.inert).toBe(true);
    expect(main.inert).toBe(false); // tabs remain outside the obscured section
    fire("astro:before-swap");
    expect(overlay.hidden).toBe(true);
    expect(main.getAttribute("aria-busy")).toBe("false");
    expect(section.inert).toBe(false);
    expect(section.getAttribute("data-navigation-obscured")).toBeNull();
  });

  it("cleans up when the loader rejects", async () => {
    const { event } = prepare("/calendar", async () => { throw new Error("offline"); });
    expect(overlay.dataset.kind).toBe("calendar");
    expect(main.inert).toBe(true);
    await expect(event.loader()).rejects.toThrow("offline");
    expect(overlay.hidden).toBe(true);
    expect(main.inert).toBe(false);
    expect(main.getAttribute("aria-busy")).toBeNull();
  });

  it("does not let a late rejected request clear feedback for a newer navigation", async () => {
    let rejectFirst!: (reason: Error) => void;
    const first = prepare("/music/songs", () => new Promise((_, reject) => { rejectFirst = reject; }));
    const pending = first.event.loader();
    first.controller.abort();
    expect(overlay.hidden).toBe(true);
    const second = prepare("/calendar");
    rejectFirst(new Error("aborted"));
    await expect(pending).rejects.toThrow("aborted");
    expect(overlay.hidden).toBe(false);
    expect(overlay.dataset.kind).toBe("calendar");
    second.controller.abort();
    expect(overlay.hidden).toBe(true);
    expect(main.inert).toBe(false);
    expect(section.inert).toBe(false);
  });

  it("restores the page when another listener cancels navigation before the loader runs", async () => {
    doc.addEventListener("astro:before-preparation", event => event.preventDefault());
    prepare();
    await Promise.resolve();
    expect(overlay.hidden).toBe(true);
    expect(main.getAttribute("aria-busy")).toBeNull();
    expect(section.inert).toBe(false);
  });

  it("cleans up a loader that delegates to native navigation and a restored page", async () => {
    const { event } = prepare("/events/demo");
    expect(overlay.dataset.kind).toBe("detail");
    event.preventDefault();
    await event.loader();
    expect(overlay.hidden).toBe(true);
    prepare();
    window.dispatchEvent(new Event("pageshow"));
    expect(overlay.hidden).toBe(true);
    expect(section.inert).toBe(false);
  });
});
