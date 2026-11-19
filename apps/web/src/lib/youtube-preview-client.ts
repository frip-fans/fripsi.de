interface Preview {
  embed: string;
  title: string;
  href: string;
}

let active: Preview | undefined;
let host: HTMLElement | undefined;
let stage: HTMLElement | undefined;
let trigger: HTMLElement | undefined;
const layout = new ResizeObserver(positionInline);

function positionInline() {
  if (!host || !stage) return;
  const rect = stage.getBoundingClientRect();
  const parent = host.offsetParent?.getBoundingClientRect();
  host.style.left = `${rect.left - (parent?.left ?? -scrollX) + stage.clientLeft}px`;
  host.style.top = `${rect.top - (parent?.top ?? -scrollY) + stage.clientTop}px`;
  host.style.width = `${stage.clientWidth}px`;
  host.style.height = `${stage.clientHeight}px`;
}

export function showYouTubeInline(slot?: HTMLElement) {
  if (!host) return;
  stage = slot;
  layout.disconnect();
  host.toggleAttribute("data-inline", Boolean(stage));
  host.style.cssText = "";
  if (stage) {
    layout.observe(stage);
    layout.observe(document.body);
    positionInline();
  }
}

export function currentYouTubePreview() {
  return active;
}

export function stopYouTubePreview() {
  if (!host) return;
  host.querySelector("iframe")?.remove();
  host.hidden = true;
  active = undefined;
  trigger = undefined;
  showYouTubeInline();
}

export function openYouTubePreview(preview: Preview, button?: HTMLElement, autoplay = false) {
  const mount = document.querySelector<HTMLElement>("[data-youtube-preview]");
  if (!mount) return;
  if (!host) {
    host = mount;
    if (!("moveBefore" in document.documentElement)) {
      // Older browsers reload a playing iframe when Astro reparents it.
      // Keep the empty shell outside the swapped body before creating the frame.
      host.removeAttribute("data-astro-transition-persist");
      document.documentElement.appendChild(host);
    }
  }
  if (active?.embed !== preview.embed) {
    const frame = document.createElement("iframe");
    const url = new URL(preview.embed);
    if (autoplay) url.searchParams.set("autoplay", "1");
    frame.src = url.href;
    frame.allow = "autoplay; encrypted-media; picture-in-picture; web-share";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    host.querySelector("iframe")?.remove();
    host.appendChild(frame);
  }
  host.querySelector("iframe")!.title = `YouTube · ${preview.title}`;
  const returnLink = host.querySelector<HTMLAnchorElement>("[data-youtube-return]")!;
  returnLink.href = preview.href;
  returnLink.setAttribute("aria-label", `${returnLink.title} · ${preview.title}`);
  host.querySelector("[data-youtube-title]")!.textContent = preview.title;
  active = preview;
  trigger = button;
  host.hidden = false;
}

document.addEventListener("astro:after-swap", () => {
  if (!host) return;
  if (!host.isConnected || document.body.classList.contains("admin")) {
    stopYouTubePreview();
    host.remove();
    host = undefined;
    return;
  }
  // The old music section was replaced. The incoming page can dock the player again.
  showYouTubeInline();
});

document.addEventListener("astro:page-load", () => {
  if (!active || !location.hash) return;
  const source = new URL(active.href, location.origin);
  if (source.pathname !== location.pathname || source.hash !== location.hash) return;
  const anchor = document.getElementById(source.hash.slice(1));
  anchor?.scrollIntoView({ behavior: "instant" });
  anchor?.focus({ preventScroll: true });
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-youtube-close]")) {
    const previousTrigger = trigger;
    stopYouTubePreview();
    if (previousTrigger?.isConnected) previousTrigger.focus();
    else document.querySelector<HTMLElement>("#main-content")?.focus();
    return;
  }
  const link = target?.closest<HTMLAnchorElement>("[data-release-youtube]");
  if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  openYouTubePreview({
    embed: link.dataset.releaseYoutube!,
    title: link.dataset.trackTitle!,
    href: `${link.dataset.trackSong}#music-preview`,
  }, link, true);
  showYouTubeInline();
  if (event.detail === 0) host?.querySelector<HTMLElement>("[data-youtube-return]")?.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && host && !host.hidden && !stage &&
    event.target instanceof Node && host.contains(event.target)) {
    host.querySelector<HTMLButtonElement>("[data-youtube-close]")?.click();
  }
});

window.addEventListener("resize", positionInline);
document.addEventListener("load", positionInline, true);
