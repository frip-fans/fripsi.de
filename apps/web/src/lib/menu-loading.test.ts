import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMenuLoading } from "./menu-loading";

class Region extends EventTarget {
  hidden = false;
  textContent = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  closest() { return this; }
}
class Link extends Region {
  target = "";
  constructor(readonly href: string) { super(); }
  get url() { return new URL(this.href, "https://fripsi.de"); }
  get origin() { return this.url.origin; }
  get pathname() { return this.url.pathname; }
  get search() { return this.url.search; }
}
class Menu extends Region {
  links = [new Link("/calendar"), new Link("/music/lives")];
  status = new Region();
  contains(link: Link) { return this.links.includes(link); }
  querySelector() { return this.status; }
}

describe("menu request feedback", () => {
  let menu: Menu, doc: EventTarget, lifetime: AbortController;
  let clear: () => void;
  const prepare = (link: Link, loader: () => Promise<void> = async () => {}) => {
    const controller = new AbortController();
    const event = Object.assign(new Event("astro:before-preparation", { cancelable: true }), {
      sourceElement: link, signal: controller.signal, loader,
    });
    doc.dispatchEvent(event);
    return { controller, event };
  };
  const click = (link: Link, extra = {}) => {
    const event = Object.assign(new Event("click", { cancelable: true }), { button: 0, ...extra });
    Object.defineProperty(event, "target", { value: link });
    menu.dispatchEvent(event);
    return event;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    menu = new Menu(); menu.dataset.loadingLabel = "Loading…";
    doc = new EventTarget(); lifetime = new AbortController();
    vi.stubGlobal("Element", Region);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("location", new URL("https://fripsi.de/about"));
    clear = setupMenuLoading(menu as unknown as HTMLElement, lifetime.signal);
  });
  afterEach(() => { lifetime.abort(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("marks the requested item immediately and keeps feedback until the new page is swapped", () => {
    prepare(menu.links[0]);
    expect(menu.links[0].getAttribute("data-menu-loading")).toBe("");
    expect(menu.links[0].getAttribute("aria-busy")).toBe("true");
    expect(menu.links[1].hasAttribute("data-menu-loading")).toBe(false);
    expect(menu.status.textContent).toBe("Loading…");
    doc.dispatchEvent(new Event("astro:before-swap"));
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(true);
    doc.dispatchEvent(new Event("astro:after-swap"));
    expect(menu.links[0].hasAttribute("aria-busy")).toBe(false);
    expect(menu.status.textContent).toBe("");
  });

  it("only marks the matching navigation region when desktop and mobile are both mounted", () => {
    const desktop = new Menu(), desktopLifetime = new AbortController();
    desktop.dataset.loadingLabel = "Loading…";
    setupMenuLoading(desktop as unknown as HTMLElement, desktopLifetime.signal);
    try {
      const request = prepare(desktop.links[0]);
      expect(desktop.links[0].hasAttribute("data-menu-loading")).toBe(true);
      expect(desktop.status.textContent).toBe("Loading…");
      expect(menu.links.some(link => link.hasAttribute("data-menu-loading"))).toBe(false);
      expect(menu.status.textContent).toBe("");
      request.controller.abort();
      expect(desktop.links[0].hasAttribute("data-menu-loading")).toBe(false);
    } finally { desktopLifetime.abort(); }
  });

  it("cleans rejected and aborted navigations", async () => {
    const failed = prepare(menu.links[0], async () => { throw Error("offline"); });
    await expect(failed.event.loader()).rejects.toThrow("offline");
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(false);
    const aborted = prepare(menu.links[0]); aborted.controller.abort();
    expect(menu.links[0].hasAttribute("aria-busy")).toBe(false);
  });

  it("moves request feedback to a newer target without letting a late failure clear it", async () => {
    let reject!: (error: Error) => void;
    const first = prepare(menu.links[0], () => new Promise((_, fail) => { reject = fail; }));
    const pending = first.event.loader();
    prepare(menu.links[1]);
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(false);
    reject(Error("cancelled old request"));
    await expect(pending).rejects.toThrow("cancelled old request");
    first.controller.abort();
    expect(menu.links[1].hasAttribute("data-menu-loading")).toBe(true);
    expect(menu.status.textContent).toBe("Loading…");
  });

  it("does not retain feedback after another listener cancels preparation", async () => {
    doc.addEventListener("astro:before-preparation", event => event.preventDefault());
    prepare(menu.links[0]); await Promise.resolve();
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(false);
  });

  it("supports ordinary page loads and clears a cancelled native load after its timeout", async () => {
    click(menu.links[0]); await Promise.resolve();
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(false);
  });

  it("ignores modified clicks, downloads, new tabs and the current document", async () => {
    click(menu.links[0], { ctrlKey: true });
    menu.links[0].target = "_blank"; click(menu.links[0]); menu.links[0].target = "";
    menu.links[0].setAttribute("download", ""); click(menu.links[0]);
    const current = new Link("/about#footer"); menu.links.push(current); click(current);
    await Promise.resolve();
    expect(menu.links.some(link => link.hasAttribute("data-menu-loading"))).toBe(false);
  });

  it("leaves client-router prevented clicks to the real preparation event", async () => {
    const event = click(menu.links[0]); event.preventDefault(); await Promise.resolve();
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(false);
    prepare(menu.links[0]);
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(true);
  });

  it.each(["pageshow", "pagehide", "close", "dispose"])("cleans up on %s", reason => {
    prepare(menu.links[0]);
    if (reason === "close") clear();
    else if (reason === "dispose") lifetime.abort();
    else window.dispatchEvent(new Event(reason));
    expect(menu.links[0].hasAttribute("data-menu-loading")).toBe(false);
    expect(menu.status.textContent).toBe("");
  });
});
