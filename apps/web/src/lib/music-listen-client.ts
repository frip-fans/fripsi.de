import { currentYouTubePreview, openYouTubePreview, stopYouTubePreview } from "./youtube-preview-client";

type Provider = "apple_music" | "youtube";
const PROVIDER_KEY = "music:listen:provider";
const prefix = (provider: Provider) => provider === "apple_music" ? "apple" : "youtube";

function readProvider(): Provider | null {
  try {
    const value = localStorage.getItem(PROVIDER_KEY);
    return value === "apple_music" || value === "youtube" ? value : null;
  } catch { return null; }
}
function saveProvider(provider: Provider) {
  try { localStorage.setItem(PROVIDER_KEY, provider); } catch { /* storage unavailable */ }
}

export function setupMusicListen(): void {
  const root = document.querySelector<HTMLElement>("[data-music-listen]");
  if (!root || root.dataset.listenReady) return;
  root.dataset.listenReady = "true";
  root.querySelectorAll<HTMLElement>("[data-js-only]").forEach((element) => { element.hidden = false; });
  const stage = root.querySelector<HTMLElement>("[data-listen-stage]")!;
  const load = root.querySelector<HTMLAnchorElement>("[data-listen-load]")!;
  const sources = [...root.querySelectorAll<HTMLButtonElement>("[data-listen-source]")];
  const providers = [...root.querySelectorAll<HTMLButtonElement>("[data-listen-provider]")];
  const caption = root.querySelector<HTMLAnchorElement>("[data-listen-caption]");
  let source: HTMLElement = sources[0] ?? stage;
  let provider = (root.dataset.provider as Provider);
  const returnHref = () => `${location.pathname}${location.search}#${root.id}`;
  const active = currentYouTubePreview();
  const returningSource = active && new URL(active.href, location.origin).pathname === location.pathname
    ? (sources.length ? sources : [stage]).find((item) => item.dataset.youtubeEmbed === active.embed)
    : undefined;

  const has = (element: HTMLElement, candidate: Provider) => Boolean(element.dataset[`${prefix(candidate)}Embed`]);
  const preferred = readProvider();
  if (returningSource) {
    source = returningSource;
    provider = "youtube";
  } else if (preferred && has(source, preferred)) {
    provider = preferred;
  }
  let ownsYouTubePlayer = false;
  let loaded = Boolean(returningSource || (root.dataset.autoload && (provider === "apple_music" || !active)));

  const render = (autoplay = false) => {
    root.dataset.provider = provider;
    providers.forEach((button) => {
      const candidate = button.dataset.listenProvider as Provider;
      button.setAttribute("aria-pressed", String(candidate === provider));
      button.disabled = !has(source, candidate);
    });
    sources.forEach((button) => button.setAttribute("aria-pressed", String(button === source)));
    if (caption && source.dataset.caption) {
      caption.textContent = source.dataset.caption;
      caption.href = source.dataset.captionHref ?? caption.href;
    }
    const embed = source.dataset[`${prefix(provider)}Embed`] ?? "";
    load.href = source.dataset[`${prefix(provider)}Page`] ?? load.href;
    root.querySelector("[data-listen-load-label]")!.textContent = root.dataset[`labelLoad-${provider}`.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] ?? "";
    root.querySelector("[data-listen-note]")!.textContent = root.dataset[`labelNote-${provider}`.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] ?? "";
    const frame = stage.querySelector("iframe");
    load.hidden = loaded;
    if (!loaded) { frame?.remove(); return; }
    if (provider === "youtube") {
      frame?.remove();
      openYouTubePreview({ embed, title: root.dataset.title!, href: returnHref() }, load, autoplay, stage);
      ownsYouTubePlayer = true;
      return;
    }
    if (ownsYouTubePlayer) stopYouTubePreview();
    ownsYouTubePlayer = false;
    if (frame?.src === embed) return;
    const next = document.createElement("iframe");
    next.src = embed;
    next.title = "Apple Music player";
    next.loading = "lazy";
    next.allow = "autoplay *; encrypted-media *; fullscreen *; clipboard-write";
    next.setAttribute("sandbox", "allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation");
    next.referrerPolicy = "strict-origin-when-cross-origin";
    frame ? frame.replaceWith(next) : stage.appendChild(next);
  };

  load.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    loaded = true;
    render(true);
  });
  providers.forEach((button) => button.addEventListener("click", () => {
    provider = button.dataset.listenProvider as Provider;
    saveProvider(provider);
    render();
  }));
  sources.forEach((button) => button.addEventListener("click", () => {
    source = button;
    if (!has(source, provider)) provider = provider === "apple_music" ? "youtube" : "apple_music";
    render();
  }));
  render();
}
