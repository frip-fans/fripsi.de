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
const root = () => ({ dataset: {} as Record<string, string>, style: { setProperty: vi.fn(), removeProperty: vi.fn() } });

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
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      matchMedia: (query: string) => query.includes("prefers-reduced-motion") ? reduced : mobile,
      getComputedStyle: vi.fn(() => ({ opacity: "0.31" })),
    }));
    vi.stubGlobal("location", new URL("https://fripsi.de/about"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("animates only visible incoming content, without resting style changes or awaiting finished", async () => {
    const { playContentEntry } = await import("./content-entry");
    playContentEntry(element(header));
    expect(header.animate).toHaveBeenCalledWith([
      { opacity: .35, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" },
    ], { duration: 240, easing: "ease-out", fill: "none" });
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

  it("keeps loading unchanged and leaves a navigation that resolves first unshaded", async () => {
    vi.useFakeTimers();
    const { setupPageEntryTransitions } = await import("./page-entry-navigation");
    setupPageEntryTransitions();
    doc.dispatchEvent(new Event("astro:page-load")); expect(header.animate).not.toHaveBeenCalled();
    const oldRoot = root(), newRoot = root();
    Object.assign(doc, { documentElement: oldRoot });
    const loader = vi.fn(async () => {});
    const event = Object.assign(new Event("astro:before-preparation"), { from: new URL("https://fripsi.de/"), to: new URL("https://fripsi.de/about"), navigationType: "push", signal: new AbortController().signal, loader });
    doc.dispatchEvent(event); expect(event.loader).toBe(loader); expect(header.animate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(155);
    doc.dispatchEvent(Object.assign(new Event("astro:before-swap"), { newDocument: { documentElement: newRoot } }));
    vi.advanceTimersByTime(500);
    expect(oldRoot.dataset).toEqual({}); expect(newRoot.dataset).toEqual({});
    expect(newRoot.style.setProperty).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event("astro:after-swap")); expect(header.animate).not.toHaveBeenCalled();
    expect(header.hidden).toBe(false); expect(header.inert).toBe(false);
  });

  it("dims a slow page navigation while it loads and hands the reveal to the incoming document", async () => {
    vi.useFakeTimers();
    const { setupPageEntryTransitions } = await import("./page-entry-navigation");
    const main = new Region();
    doc.querySelector.mockImplementation((selector: string) => selector === 'meta[name="astro-view-transitions-enabled"]' ? {} : selector === "main" ? main : null);
    setupPageEntryTransitions();
    const oldRoot = root(), newRoot = root();
    Object.assign(doc, { documentElement: oldRoot });
    doc.dispatchEvent(Object.assign(new Event("astro:before-preparation"), { from: new URL("https://fripsi.de/"), to: new URL("https://fripsi.de/about"), navigationType: "push", signal: new AbortController().signal }));
    expect(oldRoot.dataset.pageShade).toBeUndefined();
    vi.advanceTimersByTime(249);
    expect(oldRoot.dataset.pageShade).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(oldRoot.dataset.pageShade).toBe("dim");
    doc.dispatchEvent(Object.assign(new Event("astro:before-swap"), { newDocument: { documentElement: newRoot } }));
    expect(newRoot.dataset.pageShade).toBe("reveal");
    expect(newRoot.style.setProperty).toHaveBeenCalledWith("--page-shade-from", "0.31");
    doc.dispatchEvent(new Event("astro:after-swap")); expect(main.animate).not.toHaveBeenCalled();
  });

  it("drops a dim the document arrived ahead of instead of revealing from the resting value", async () => {
    vi.useFakeTimers();
    const { setupPageEntryTransitions } = await import("./page-entry-navigation");
    const main = new Region();
    doc.querySelector.mockImplementation((selector: string) => selector === 'meta[name="astro-view-transitions-enabled"]' ? {} : selector === "main" ? main : null);
    setupPageEntryTransitions();
    const oldRoot = root(), newRoot = root();
    Object.assign(doc, { documentElement: oldRoot });
    doc.dispatchEvent(Object.assign(new Event("astro:before-preparation"), { from: new URL("https://fripsi.de/"), to: new URL("https://fripsi.de/about"), navigationType: "push", signal: new AbortController().signal }));
    vi.advanceTimersByTime(250);
    expect(oldRoot.dataset.pageShade).toBe("dim");
    // The dim is up but has not painted yet, which is what a document arriving
    // on the threshold sees: darkening to rest here would run after the swap.
    window.getComputedStyle = vi.fn(() => ({ opacity: "0" })) as unknown as typeof window.getComputedStyle;
    doc.dispatchEvent(Object.assign(new Event("astro:before-swap"), { newDocument: { documentElement: newRoot } }));
    expect(newRoot.dataset.pageShade).toBeUndefined();
    expect(newRoot.style.setProperty).not.toHaveBeenCalled();
  });

  it("skips the shade under reduced motion and fades it back out when a navigation is abandoned", async () => {
    vi.useFakeTimers();
    const { setupPageEntryTransitions } = await import("./page-entry-navigation");
    const main = new Region();
    doc.querySelector.mockImplementation((selector: string) => selector === 'meta[name="astro-view-transitions-enabled"]' ? {} : selector === "main" ? main : null);
    setupPageEntryTransitions();
    const oldRoot = root();
    Object.assign(doc, { documentElement: oldRoot });
    const prepare = (signal: AbortSignal) => doc.dispatchEvent(Object.assign(new Event("astro:before-preparation"), { from: new URL("https://fripsi.de/"), to: new URL("https://fripsi.de/about"), navigationType: "push", signal }));
    reduced.matches = true; prepare(new AbortController().signal); vi.advanceTimersByTime(500);
    expect(oldRoot.dataset.pageShade).toBeUndefined();
    reduced.matches = false;
    const abandoned = new AbortController(); prepare(abandoned.signal); vi.advanceTimersByTime(250);
    expect(oldRoot.dataset.pageShade).toBe("dim");
    abandoned.abort();
    expect(oldRoot.dataset.pageShade).toBe("reveal");
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
