interface Preview {
  embed: string;
  title: string;
  href: string;
}

let active: Preview | undefined;
let host: HTMLElement | undefined;
let stage: HTMLElement | undefined;
let trigger: HTMLElement | undefined;
let motion: Animation | undefined;
let outgoingBounds: DOMRect | undefined;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
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

function previewBounds() {
  if (reducedMotion.matches || !host || host.hidden) return;
  const bounds = host.querySelector("iframe")?.getBoundingClientRect();
  if (bounds?.width && bounds.height && bounds.bottom > 0 && bounds.top < innerHeight) return bounds;
}

function positionPreview(slot?: HTMLElement, from?: DOMRect) {
  if (!host) return;
  motion?.cancel();
  host.removeAttribute("data-resizing");
  stage = slot;
  layout.disconnect();
  host.toggleAttribute("data-inline", Boolean(stage));
  host.style.cssText = "";
  if (stage) {
    layout.observe(stage);
    layout.observe(document.body);
    positionInline();
  }
  const to = from && previewBounds();
  if (!from || !to) return;

  // Animate the visible video bounds. The floating controls sit above the video.
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(from.width - to.width) < 1 && Math.abs(from.height - to.height) < 1) return;
  const panel = host.getBoundingClientRect();
  const transformOrigin = `${to.left - panel.left}px ${to.top - panel.top}px`;
  const player = host;
  const animation = player.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`, transformOrigin },
    { transform: "none", transformOrigin },
  ], { duration: 270, easing: "cubic-bezier(.2, .75, .25, 1)" });
  motion = animation;
  player.setAttribute("data-resizing", "");
  const clear = () => {
    if (motion !== animation) return;
    motion = undefined;
    player.removeAttribute("data-resizing");
  };
  animation.addEventListener("finish", clear, { once: true });
  animation.addEventListener("cancel", clear, { once: true });
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
  positionPreview();
}

export function openYouTubePreview(preview: Preview, button?: HTMLElement, autoplay = false, slot?: HTMLElement) {
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
  const sameVideo = active?.embed === preview.embed;
  const from = sameVideo && Boolean(stage) !== Boolean(slot) ? previewBounds() : undefined;
  if (!sameVideo) {
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
  positionPreview(slot, from);
}

document.addEventListener("astro:before-swap", () => {
  outgoingBounds = stage ? previewBounds() : undefined;
});

document.addEventListener("astro:after-swap", () => {
  const from = outgoingBounds;
  outgoingBounds = undefined;
  if (!host) return;
  if (!host.isConnected || document.body.classList.contains("admin")) {
    stopYouTubePreview();
    host.remove();
    host = undefined;
    return;
  }
  // The old music section was replaced. The incoming page can dock the player again.
  if (stage) positionPreview(undefined, from);
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
