export function setupReleaseCovers(root: ParentNode = document): void {
  root.querySelectorAll<HTMLImageElement>("[data-release-cover-image]").forEach((image) => {
    if (image.dataset.coverBound) return;
    image.dataset.coverBound = "true";
    image.addEventListener("error", () => { image.hidden = true; });
    if (image.complete && image.naturalWidth === 0) image.hidden = true;
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
    image.addEventListener("error", () => { image.hidden = true; });
    image.src = url;
    cover.appendChild(image);
  }
  return cover;
}
