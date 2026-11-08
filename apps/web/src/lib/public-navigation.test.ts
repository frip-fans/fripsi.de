import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("public navigation context", () => {
  let document: EventTarget;
  let state: Record<string, unknown>;
  let address: URL;
  const setAddress = (href: string) => {
    address = new URL(href, "https://fripsi.de");
    vi.stubGlobal("location", address);
  };
  const fire = (name: string, fields = {}) => document.dispatchEvent(Object.assign(new Event(name), fields));
  beforeEach(() => {
    vi.resetModules();
    setAddress("/music/lives");
    state = { index: 3, scrollX: 0, scrollY: 480 };
    document = Object.assign(new EventTarget(), {
      documentElement: { lang: "ja" },
      querySelector: () => null,
      querySelectorAll: () => [],
    });
    vi.stubGlobal("document", document);
    vi.stubGlobal("HTMLAnchorElement", class {});
    vi.stubGlobal("scrollY", 480);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
    vi.stubGlobal("window", { scrollTo: vi.fn() });
    vi.stubGlobal("history", {
      get state() { return state; },
      replaceState(next: Record<string, unknown>, _: string, url?: URL) {
        state = next;
        if (url) setAddress(url.href);
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Astro traversal metadata and records the committed filtered list as the detail source", async () => {
    const { replacePublicUrl } = await import("./public-navigation");
    replacePublicUrl(new URL("/music/lives?q=railgun&page=2", address));
    expect(state).toEqual({ index: 3, scrollX: 0, scrollY: 480 });
    const list = address.href;
    fire("astro:before-preparation", { to: new URL("/music/lives/live-1", address), navigationType: "push" });
    setAddress("/music/lives/live-1");
    state = { index: 4, scrollX: 0, scrollY: 0 };
    fire("astro:after-swap");
    expect(state).toEqual({ index: 4, scrollX: 0, scrollY: 0, fripSource: list });
  });

  it("does not overwrite the target history entry when popstate has already changed the address", async () => {
    const { replacePublicUrl, publicUrl } = await import("./public-navigation");
    replacePublicUrl(new URL("/music/lives?page=2", address));
    fire("astro:before-preparation", { to: new URL("/music/lives/live-1", address), navigationType: "push" });
    setAddress("/music/lives/live-1");
    state = { index: 4, scrollX: 0, scrollY: 0 };
    fire("astro:after-swap");
    fire("astro:page-load");
    setAddress("/music/lives?page=2");
    state = { index: 3, scrollX: 0, scrollY: 480, fripSource: null };
    fire("astro:before-preparation", { to: address, navigationType: "traverse" });
    expect(publicUrl()).toBe("https://fripsi.de/music/lives/live-1");
    fire("astro:after-swap");
    fire("astro:page-load");
    expect(publicUrl()).toBe(address.href);
    expect(state).toEqual({ index: 3, scrollX: 0, scrollY: 480, fripSource: null });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
