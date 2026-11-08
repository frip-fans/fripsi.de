export const isMusicPath = (path: string) => /^\/music\/(lives|songs|releases)(?:\/[^/]+)?\/?$/.test(path);
export const publicSource = (url: URL) => url.origin === location.origin && (/^\/(?:events\/[^/]+|calendar)\/?$/.test(url.pathname) || isMusicPath(url.pathname));

export function setupMusicBackLink(source?: string | null) {
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-music-back]")) {
    try {
      const sourceUrl = source === undefined ? history.state?.fripSource ?? document.referrer : source;
      const referrer = sourceUrl ? new URL(sourceUrl, location.origin) : null;
      if (referrer && publicSource(referrer) && referrer.pathname !== location.pathname) {
        let target = referrer;
        const savedSource = JSON.parse(sessionStorage.getItem("music:detail-source") || "null");
        if (!source && savedSource?.destination === location.pathname) {
          const saved = new URL(savedSource.source, location.origin);
          if (publicSource(saved) && saved.pathname === referrer.pathname && saved.search === referrer.search) target = saved;
        }
        link.href = `${target.pathname}${target.search}${target.hash}`;
        const kind = target.pathname.split("/")[2];
        const labels = JSON.parse(link.dataset.sourceLabels || "{}");
        const sourceKind = target.pathname.startsWith("/events/") ? "event" : target.pathname === "/calendar" ? "calendar" : /^\/music\/[^/]+\/?$/.test(target.pathname) ? `${kind}List` : kind;
        if (labels[sourceKind]) link.querySelector("span")!.textContent = labels[sourceKind];
        return;
      }
      const listPath = link.dataset.listPath;
      const saved = sessionStorage.getItem(link.dataset.storageKey || "");
      if (!saved || !listPath) continue;
      const target = new URL(saved, location.origin);
      if (target.origin === location.origin && target.pathname === listPath) link.href = `${target.pathname}${target.search}${target.hash}`;
    } catch { /* Keep the server-rendered list fallback. */ }
  }
}
