import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class Motion extends EventTarget { matches = false; }
class EntryAnimation extends EventTarget {
  id = "";
  finishedReads = 0;
  get finished(): Promise<Animation> { this.finishedReads++; throw new Error("must not wait for animation completion"); }
  cancel = vi.fn(() => this.dispatchEvent(new Event("cancel")));
}
class Region {
  isConnected = true;
  hidden = false;
  inert = false;
  dataset: Record<string, string> = {};
  children: unknown[] = [];
  attributes = new Map<string, string>();
  animations: EntryAnimation[] = [];
  style = new Proxy({}, { set() { throw new Error("must not write resting inline styles"); } });
  getBoundingClientRect() { throw new Error("must not force layout"); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  querySelector = vi.fn((_selector: string): Region | null => null);
  closest = vi.fn((_selector: string): Region | null => null);
  animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation = new EntryAnimation(); this.animations.push(animation); return animation;
  });
}
const element = (region: Region) => region as unknown as HTMLElement;

describe("bounded content entry motion", () => {
  let reduced: Motion;
  let mobile: Motion;
  let doc: EventTarget & { hidden: boolean; querySelector: ReturnType<typeof vi.fn>; querySelectorAll: ReturnType<typeof vi.fn> };
  let header: Region;
  beforeEach(() => {
    vi.resetModules(); reduced = new Motion(); mobile = new Motion(); header = new Region();
    doc = Object.assign(new EventTarget(), { hidden: false, querySelector: vi.fn((selector: string) => selector === 'meta[name="astro-view-transitions-enabled"]' ? {} : null), querySelectorAll: vi.fn(() => [header]) });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("Element", Region);
    vi.stubGlobal("window", Object.assign(new EventTarget(), { matchMedia: (query: string) => query.includes("prefers-reduced-motion") ? reduced : mobile }));
    vi.stubGlobal("location", new URL("https://fripsi.de/about"));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("animates only visible incoming content, without resting style changes or awaiting finished", async () => {
    const { playContentEntry } = await import("./content-entry");
    playContentEntry(element(header));
    expect(header.animate).toHaveBeenCalledWith([
      { opacity: .86, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" },
    ], { duration: 160, easing: "cubic-bezier(.2,.7,.2,1)", fill: "none" });
    expect(header.hidden).toBe(false); expect(header.inert).toBe(false);
    expect(header.animations[0].finishedReads).toBe(0);
    header.animations[0].dispatchEvent(new Event("finish"));
    expect(header.animations[0].cancel).toHaveBeenCalledOnce();
  });

  it("caps concurrent regions, cleans finished effects and cancels when reduced motion is enabled", async () => {
    const { playContentEntry } = await import("./content-entry");
    const regions = [header, new Region(), new Region(), new Region()];
    regions.slice(0, 3).forEach(region => playContentEntry(element(region)));
    expect(regions[0].animations[0].cancel).toHaveBeenCalledOnce();
    expect(regions[1].animations[0].cancel).not.toHaveBeenCalled();
    regions[1].animations[0].dispatchEvent(new Event("finish"));
    playContentEntry(element(regions[3]));
    expect(regions[2].animations[0].cancel).not.toHaveBeenCalled();
    reduced.matches = true; reduced.dispatchEvent(new Event("change"));
    expect(regions[2].animations[0].cancel).toHaveBeenCalledOnce();
    expect(regions[3].animations[0].cancel).toHaveBeenCalledOnce();
    playContentEntry(element(header)); expect(header.animate).toHaveBeenCalledTimes(1);
  });

  it("skips background pages, detached nodes and large accumulated result lists", async () => {
    const { playContentEntry, playResultsEntry } = await import("./content-entry");
    doc.hidden = true; playContentEntry(element(header)); doc.hidden = false;
    header.isConnected = false; playContentEntry(element(header)); header.isConnected = true;
    header.dataset.page = "2"; playResultsEntry(element(header)); delete header.dataset.page;
    const items = new Region(); items.children = Array(13).fill(null); header.querySelector.mockReturnValue(items);
    playResultsEntry(element(header)); expect(header.animate).not.toHaveBeenCalled();
  });

  it("does not animate or wrap the loader while the old page is awaiting data", async () => {
    const { setupPageEntryTransitions } = await import("./page-entry-navigation");
    setupPageEntryTransitions();
    doc.dispatchEvent(new Event("astro:page-load")); expect(header.animate).not.toHaveBeenCalled();
    const loader = vi.fn(async () => {}); const controller = new AbortController();
    const event = Object.assign(new Event("astro:before-preparation"), { from: new URL("https://fripsi.de/"), to: new URL("https://fripsi.de/about"), navigationType: "push", signal: controller.signal, loader });
    doc.dispatchEvent(event); expect(event.loader).toBe(loader); expect(header.animate).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event("astro:after-swap")); expect(header.animate).toHaveBeenCalledOnce();
    expect(header.hidden).toBe(false); expect(header.inert).toBe(false);
  });

  it("keeps music controls static and waits for their setup before entering results", async () => {
    const { setupPageEntryTransitions } = await import("./page-entry-navigation");
    const music = new Region(), form = new Region(), results = new Region();
    music.querySelector.mockImplementation(selector => selector === "[data-music-results]" ? results : form);
    doc.querySelector.mockImplementation(selector => selector === 'meta[name="astro-view-transitions-enabled"]' ? {} : selector === "[data-music-browser]" ? music : null);
    vi.stubGlobal("location", new URL("https://fripsi.de/music/songs"));
    setupPageEntryTransitions();
    doc.dispatchEvent(Object.assign(new Event("astro:before-preparation"), { from: new URL("https://fripsi.de/music/lives"), to: new URL("https://fripsi.de/music/songs"), navigationType: "push", signal: new AbortController().signal }));
    doc.dispatchEvent(new Event("astro:after-swap")); expect(results.animate).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event("astro:page-load")); expect(results.animate).toHaveBeenCalledOnce();
    expect(form.animate).not.toHaveBeenCalled(); expect(header.animate).not.toHaveBeenCalled();
  });

  it("leaves a pending responsive API batch to animate its own completed results", async () => {
    const { setupPageEntryTransitions } = await import("./page-entry-navigation");
    const music = new Region(), results = new Region(); results.attributes.set("aria-busy", "true");
    music.querySelector.mockReturnValue(results);
    doc.querySelector.mockImplementation(selector => selector === 'meta[name="astro-view-transitions-enabled"]' ? {} : selector === "[data-music-browser]" ? music : null);
    vi.stubGlobal("location", new URL("https://fripsi.de/music/releases")); setupPageEntryTransitions();
    doc.dispatchEvent(Object.assign(new Event("astro:before-preparation"), { from: new URL("https://fripsi.de/music/lives"), to: new URL("https://fripsi.de/music/releases"), navigationType: "push", signal: new AbortController().signal }));
    doc.dispatchEvent(new Event("astro:after-swap")); doc.dispatchEvent(new Event("astro:page-load"));
    expect(results.animate).not.toHaveBeenCalled();
  });

  it("enters only the calendar grid on month changes and ignores aborted preparations", async () => {
    const { setupPageEntryTransitions } = await import("./page-entry-navigation");
    const calendar = new Region(), grid = new Region();
    calendar.querySelector.mockReturnValue(grid);
    doc.querySelector.mockImplementation(selector => selector === 'meta[name="astro-view-transitions-enabled"]' ? {} : selector === "[data-calendar-shell]" ? calendar : null);
    const target = new URL("https://fripsi.de/calendar?month=2026-12"); vi.stubGlobal("location", target); setupPageEntryTransitions();
    const prepare = (signal: AbortSignal) => doc.dispatchEvent(Object.assign(new Event("astro:before-preparation"), { from: new URL("https://fripsi.de/calendar?month=2026-11"), to: target, navigationType: "push", signal }));
    const aborted = new AbortController(); aborted.abort(); prepare(aborted.signal); doc.dispatchEvent(new Event("astro:after-swap")); expect(grid.animate).not.toHaveBeenCalled();
    prepare(new AbortController().signal); doc.dispatchEvent(new Event("astro:after-swap")); expect(grid.animate).toHaveBeenCalledOnce(); expect(header.animate).not.toHaveBeenCalled();
  });

  it("preserves traversal and fragment restoration, and classifies local results separately", async () => {
    const { navigationEntryKind } = await import("./page-entry-navigation");
    const url = (path: string) => new URL(path, "https://fripsi.de");
    expect(navigationEntryKind(url("/about"), url("/calendar"), true)).toBe("none");
    expect(navigationEntryKind(url("/about"), url("/calendar#agenda-2026-11-21"))).toBe("none");
    expect(navigationEntryKind(url("/calendar"), url("/calendar"))).toBe("none");
    expect(navigationEntryKind(url("/music/lives"), url("/music/songs"))).toBe("music");
    expect(navigationEntryKind(url("/calendar?view=list&q=old"), url("/calendar?view=list&q=new"))).toBe("search");
    expect(navigationEntryKind(url("/calendar"), url("/calendar?view=list"))).toBe("page");
  });
});
