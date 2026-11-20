import { setupYouTubePreviewSize } from "./youtube-preview-size";
import {
  commandMessage, embedWithPlayerApi, listeningMessage, readPlayerReport, videoIdOf, YOUTUBE_EMBED_ORIGIN, YOUTUBE_ENDED,
} from "./youtube-player-messages";

/** Fired on `document` when the queue moves the player on to another video. */
export const YOUTUBE_PREVIEW_CHANGE = "youtube-preview:change";

interface Preview {
  embed: string;
  title: string;
  href: string;
}

let active: Preview | undefined;
let host: HTMLElement | undefined;
let detachResize: (() => void) | undefined;
let stage: HTMLElement | undefined;
let trigger: HTMLElement | undefined;
let motion: Animation | undefined;
let outgoingBounds: DOMRect | undefined;
// The videos to play one after another, and which of them is playing.
let queue: Preview[] = [];
let position = 0;
// Whether the current frame's player answers messages, so it can be told to change video.
let connected = false;
let handshake: number | undefined;
// One video can report its end more than once.
let finished = false;
let advancedByQueue = false;
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
  for (const property of ["left", "top", "width", "height"]) host.style.removeProperty(property);
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
  animatePreview(host, [
    { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`, transformOrigin },
    { transform: "none", transformOrigin },
  ]);
}

function animatePreview(player: HTMLElement, frames: Keyframe[], onFinish?: () => void) {
  motion?.cancel();
  const animation = player.animate(frames, { duration: 270, easing: "cubic-bezier(.2, .75, .25, 1)", fill: "both" });
  motion = animation;
  player.setAttribute("data-resizing", "");
  const clear = () => {
    if (motion !== animation) return;
    motion = undefined;
    player.removeAttribute("data-resizing");
  };
  animation.addEventListener("finish", () => {
    if (motion !== animation) return;
    clear();
    onFinish?.();
    animation.cancel();
  }, { once: true });
  animation.addEventListener("cancel", clear, { once: true });
}

const belowViewport = "translateY(calc(100% + max(.75rem, env(safe-area-inset-bottom))))";

function closeFloatingPreview() {
  if (!host || !active) return;
  const previousTrigger = trigger;
  if (reducedMotion.matches) {
    stopYouTubePreview();
  } else {
    const transform = getComputedStyle(host).transform;
    active = undefined;
    host.inert = true;
    animatePreview(host, [{ transform }, { transform: belowViewport }], stopYouTubePreview);
  }
  if (previousTrigger?.isConnected) previousTrigger.focus();
  else document.querySelector<HTMLElement>("#main-content")?.focus();
}

function postToPlayer(message: string) {
  host?.querySelector("iframe")?.contentWindow?.postMessage(message, YOUTUBE_EMBED_ORIGIN);
}

function connectPlayer(frame: HTMLIFrameElement) {
  connected = false;
  clearInterval(handshake);
  let attempts = 0;
  // The player ignores messages until its own script has started, so ask until it answers.
  handshake = window.setInterval(() => {
    if (connected || !frame.isConnected || ++attempts > 40) clearInterval(handshake);
    else frame.contentWindow?.postMessage(listeningMessage(), YOUTUBE_EMBED_ORIGIN);
  }, 250);
}

function mountFrame(preview: Preview, autoplay: boolean) {
  const frame = document.createElement("iframe");
  frame.src = embedWithPlayerApi(preview.embed, location.origin, autoplay);
  frame.allow = "autoplay; encrypted-media; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  // Also runs when a browser reloads the frame, which starts a new player.
  frame.addEventListener("load", () => connectPlayer(frame));
  connected = false;
  finished = false;
  host!.querySelector("iframe")?.remove();
  host!.appendChild(frame);
}

function describePreview(preview: Preview) {
  host!.querySelector("iframe")!.title = `YouTube · ${preview.title}`;
  const returnLink = host!.querySelector<HTMLAnchorElement>("[data-youtube-return]")!;
  returnLink.href = preview.href;
  returnLink.setAttribute("aria-label", `${returnLink.title} · ${preview.title}`);
  host!.querySelector("[data-youtube-title]")!.textContent = preview.title;
  for (const button of host!.querySelectorAll<HTMLButtonElement>("[data-youtube-step]")) {
    button.hidden = queue.length < 2;
    button.disabled = !queue[position + Number(button.dataset.youtubeStep)];
  }
  active = preview;
}

function playQueued(next: number, automatic = false) {
  const preview = queue[next];
  const videoId = preview && videoIdOf(preview.embed);
  if (!host || !active || !videoId) return;
  position = next;
  advancedByQueue = automatic;
  // Changing the video inside the running player keeps playback allowed without a new click.
  if (connected) postToPlayer(commandMessage("loadVideoById", videoId));
  else mountFrame(preview, true);
  const from = stage ? previewBounds() : undefined;
  describePreview(preview);
  // A song page holds its own song inline. The next one floats, as it belongs to no page.
  if (stage) positionPreview(undefined, from);
  document.dispatchEvent(new CustomEvent(YOUTUBE_PREVIEW_CHANGE));
}

window.addEventListener("message", (event) => {
  const frame = host?.querySelector("iframe");
  if (!frame || event.source !== frame.contentWindow || event.origin !== YOUTUBE_EMBED_ORIGIN) return;
  const report = readPlayerReport(event.data);
  if (!report) return;
  if (!connected) {
    connected = true;
    for (const name of ["onStateChange", "onError"]) postToPlayer(commandMessage("addEventListener", name));
  }
  // A video the visitor chose stays on its error. One the queue reached is skipped.
  const over = report.error ? advancedByQueue : report.state === YOUTUBE_ENDED;
  if (!over) {
    if (report.state !== undefined) finished = false;
    return;
  }
  if (finished) return;
  finished = true;
  playQueued(position + 1, true);
});

export function currentYouTubePreview() {
  return active;
}

export function stopYouTubePreview() {
  if (!host) return;
  host.querySelector("iframe")?.remove();
  host.hidden = true;
  host.inert = false;
  active = undefined;
  trigger = undefined;
  queue = [];
  position = 0;
  connected = false;
  clearInterval(handshake);
  positionPreview();
}

/** `list` is what plays on after `preview`, which it contains. Without one, a new video plays alone. */
export function openYouTubePreview(preview: Preview, button?: HTMLElement, autoplay = false, slot?: HTMLElement, list?: Preview[]) {
  const mount = document.querySelector<HTMLElement>("[data-youtube-preview]");
  if (!mount) return;
  if (!host) {
    host = mount;
    detachResize = setupYouTubePreviewSize(host);
    if (!("moveBefore" in document.documentElement)) {
      // Older browsers reload a playing iframe when Astro reparents it.
      // Keep the empty shell outside the swapped body before creating the frame.
      host.removeAttribute("data-astro-transition-persist");
      document.documentElement.appendChild(host);
    }
  }
  const startTransform = !slot && !reducedMotion.matches
    ? host.hidden ? belowViewport : host.inert ? getComputedStyle(host).transform : undefined
    : undefined;
  const sameVideo = active?.embed === preview.embed;
  const from = sameVideo && Boolean(stage) !== Boolean(slot) ? previewBounds() : undefined;
  if (list) {
    queue = list;
    position = Math.max(0, list.indexOf(preview));
  } else if (queue[position]?.embed !== preview.embed) {
    queue = [preview];
    position = 0;
  }
  advancedByQueue = false;
  if (!sameVideo) mountFrame(preview, autoplay);
  describePreview(preview);
  trigger = button;
  host.hidden = false;
  host.inert = false;
  positionPreview(slot, from);
  if (startTransform) animatePreview(host, [{ transform: startTransform }, { transform: "none" }]);
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
    detachResize?.();
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
    closeFloatingPreview();
    return;
  }
  const step = target?.closest<HTMLButtonElement>("[data-youtube-step]");
  if (step) {
    playQueued(position + Number(step.dataset.youtubeStep));
    // The end of the queue disables the button that was just used.
    if (step.disabled) host?.querySelector<HTMLButtonElement>("[data-youtube-step]:enabled")?.focus();
    return;
  }
  const link = target?.closest<HTMLAnchorElement>("[data-track-youtube]");
  if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  // The page's playable tracks, in the order shown, play on from the one chosen.
  const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-track-youtube]")];
  const list = links.map((item) => ({
    embed: item.dataset.trackYoutube!,
    title: item.dataset.trackTitle!,
    href: `${item.dataset.trackSong}#music-preview`,
  }));
  openYouTubePreview(list[links.indexOf(link)]!, link, true, undefined, list);
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
