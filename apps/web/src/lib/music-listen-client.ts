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

/** The player loads only after a click, so no third-party request happens on page view. */
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
  // A server-rendered player (autoload) counts as already loaded.
  let loaded = Boolean(stage.querySelector("iframe"));

  const has = (element: HTMLElement, candidate: Provider) => Boolean(element.dataset[`${prefix(candidate)}Embed`]);
  const preferred = readProvider();
  if (preferred && has(source, preferred)) provider = preferred;

  const render = () => {
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
    if (!loaded) { frame?.remove(); load.hidden = false; return; }
    load.hidden = true;
    if (frame?.src === embed) return;
    const next = document.createElement("iframe");
    next.src = embed;
    next.title = `${provider === "apple_music" ? "Apple Music" : "YouTube"} player`;
    next.loading = "lazy";
    next.allow = provider === "apple_music"
      ? "autoplay *; encrypted-media *; fullscreen *; clipboard-write"
      : "autoplay; encrypted-media; picture-in-picture; web-share";
    if (provider === "apple_music") next.setAttribute("sandbox", "allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation");
    else next.allowFullscreen = true;
    next.referrerPolicy = "strict-origin-when-cross-origin";
    frame ? frame.replaceWith(next) : stage.appendChild(next);
  };

  load.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    loaded = true;
    render();
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
