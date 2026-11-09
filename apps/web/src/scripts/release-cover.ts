let coverObserver: IntersectionObserver | undefined;
const coverRequestedAt = new WeakMap<HTMLImageElement, number>();
/** Loads faster than this come from the browser cache, so they skip the first-load fade. */
export const CACHED_COVER_MS = 120;

function showCover(image: HTMLImageElement, cached: boolean): void {
  if (cached) image.dataset.coverCached = "true";
  image.dataset.coverLoaded = "true";
}

function loadCover(image: HTMLImageElement): void {
  const url = image.dataset.coverSrc;
  if (!url) return;
  delete image.dataset.coverSrc;
  image.hidden = false;
  coverRequestedAt.set(image, performance.now());
  image.src = url;
  // Memory-cached images are complete synchronously once src is set.
  if (image.complete && image.naturalWidth > 0) showCover(image, true);
}

function setupReleaseCover(image: HTMLImageElement): void {
  if (!image.dataset.coverBound) {
    image.dataset.coverBound = "true";
    image.addEventListener("load", () => {
      if (image.dataset.coverLoaded) return;
      const requestedAt = coverRequestedAt.get(image);
      showCover(image, requestedAt !== undefined && performance.now() - requestedAt < CACHED_COVER_MS);
    });
    image.addEventListener("error", () => { image.hidden = true; });
  }
  if (image.dataset.coverSrc) {
    if (typeof IntersectionObserver === "undefined") {
      loadCover(image);
      return;
    }
    coverObserver ??= new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const image = entry.target.querySelector<HTMLImageElement>("[data-release-cover-image]");
        if (image) loadCover(image);
      }
    }, { rootMargin: "200px 0px" });
    // Observe the sized wrapper: the deferred image stays hidden until requested.
    coverObserver.observe(image.parentElement!);
  } else if (image.complete) {
    if (image.naturalWidth > 0) image.dataset.coverLoaded = "true";
    else image.hidden = true;
  }
}

export function setupReleaseCovers(root: ParentNode = document): void {
  // Drop covers removed by filtering or client navigation before observing new ones.
  coverObserver?.disconnect();
  root.querySelectorAll<HTMLImageElement>("[data-release-cover-image]").forEach((image) => {
    setupReleaseCover(image);
  });
}

export function createReleaseCover(url: string | null, alt: string): HTMLElement {
  const cover = document.createElement("span");
  cover.className = "release-cover";
  cover.setAttribute("role", "img");
  cover.setAttribute("aria-label", alt);
  const placeholder = document.createElement("span");
  placeholder.className = "release-cover-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.textContent = "♫";
  cover.appendChild(placeholder);
  if (url) {
    const image = document.createElement("img");
    image.alt = "";
    image.width = image.height = 480;
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.dataset.releaseCoverImage = "";
    image.dataset.coverSrc = url;
    image.hidden = true;
    cover.appendChild(image);
    setupReleaseCover(image);
  }
  return cover;
}
