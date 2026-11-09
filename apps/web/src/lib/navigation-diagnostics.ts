interface Sample { at: number; event: string; [key: string]: unknown }
const STORAGE_KEY = "frip:navigation-diagnostics";

// Never export query strings, fragments, credentials, or cross-origin requests.
export function resourceSample(entry: PerformanceResourceTiming, origin: string) {
  const url = new URL(entry.name, origin);
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return null;
  return {
    path: url.pathname, type: entry.initiatorType,
    start: Math.round(entry.startTime), request: Math.round(entry.requestStart),
    firstByte: Math.round(entry.responseStart), end: Math.round(entry.responseEnd),
    duration: Math.round(entry.duration), bytes: entry.transferSize,
  };
}

export function startNavigationDiagnostics(release: string) {
  const samples: Sample[] = [];
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const add = (event: string, data: Record<string, unknown> = {}) => {
    if (signal.aborted) return;
    samples.push({ at: Math.round(performance.now()), event, ...data });
    if (samples.length > 200) samples.shift();
  };
  const labels = {
    "zh-CN": ["导航诊断", "复制记录", "关闭诊断", "复制失败，请选择下方文字复制"],
    "zh-TW": ["導覽診斷", "複製記錄", "關閉診斷", "複製失敗，請選取下方文字複製"],
    ja: ["ナビゲーション診断", "記録をコピー", "診断を終了", "コピーできません。下のテキストを選択してください"],
    en: ["Navigation diagnostics", "Copy timings", "Stop diagnostics", "Copy failed. Select and copy the text below."],
  };
  const panel = document.createElement("details");
  panel.id = "navigation-diagnostics";
  panel.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:2000;max-width:calc(100vw - 16px);padding:8px;background:#07101c;color:#fff;border:1px solid #789;border-radius:8px;font:14px/1.5 system-ui";
  const summary = document.createElement("summary");
  const copy = document.createElement("button"); copy.type = "button";
  const stop = document.createElement("button"); stop.type = "button";
  const output = document.createElement("textarea");
  output.readOnly = true; output.hidden = true; output.rows = 8;
  output.style.cssText = "display:block;width:min(320px,80vw);font-size:16px;margin-top:8px";
  // The site's textarea styles must not override the hidden fallback field.
  output.style.display = "none";
  for (const child of [summary, copy, stop, output]) panel.appendChild(child);
  const mount = () => {
    const locale = document.documentElement.lang as keyof typeof labels;
    const text = labels[locale] ?? labels.en;
    summary.textContent = text[0]; copy.textContent = text[1]; stop.textContent = text[2];
    output.setAttribute("aria-label", text[0]);
    if (!panel.isConnected) document.body.appendChild(panel);
  };
  const report = () => JSON.stringify({
    release, userAgent: navigator.userAgent, path: location.pathname,
    nativeViewTransitions: typeof document.startViewTransition === "function",
    clientRouter: !!document.querySelector('meta[name="astro-view-transitions-enabled"]'),
    samples,
  }, null, 2);
  copy.addEventListener("click", async () => {
    output.value = report();
    try { await navigator.clipboard.writeText(output.value); }
    catch {
      output.hidden = false; output.style.display = "block";
      const locale = document.documentElement.lang as keyof typeof labels;
      copy.textContent = (labels[locale] ?? labels.en)[3];
      output.focus(); output.select();
    }
  }, { signal });
  let activeUntil = 0;
  for (const name of ["pointerdown", "pointerup", "touchstart", "touchend", "click", "contextmenu"]) {
    document.addEventListener(name, event => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>("a[href]");
      const menu = document.querySelector<HTMLElement>("[data-mobile-menu]");
      // Some engines use epoch timestamps; omit that delay rather than report nonsense.
      const delay = performance.now() - event.timeStamp;
      add(name, { tag: element?.tagName, target: anchor ? new URL(anchor.href).pathname : undefined,
        menuOpen: menu instanceof HTMLDialogElement ? menu.open : menu ? !menu.hidden : false,
        dispatchDelay: delay >= 0 && delay < 60_000 ? Math.round(delay) : undefined });
      activeUntil = performance.now() + 10_000;
      setTimeout(() => add(`${name}.handled`, { prevented: event.defaultPrevented }), 0);
    }, { capture: true, passive: true, signal });
  }
  for (const name of ["astro:before-preparation", "astro:after-preparation", "astro:before-swap", "astro:after-swap", "astro:page-load"]) {
    document.addEventListener(name, () => {
      add(name, { path: location.pathname });
      if (name === "astro:after-swap" || name === "astro:page-load") mount();
      requestAnimationFrame(() => add(`raf.${name}`));
    }, { capture: true, signal });
  }
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      const data = resourceSample(entry as PerformanceResourceTiming, location.origin);
      if (data) add("resource", data);
    }
  });
  observer.observe({ type: "resource" });
  let frame = 0, previous = 0;
  const tick = (now: number) => {
    if (!document.hidden && now < activeUntil && previous && now - previous > 100) add("frame-gap", { duration: Math.round(now - previous) });
    previous = document.hidden ? 0 : now;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  stop.addEventListener("click", () => {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage is optional */ }
    lifetime.abort(); observer.disconnect(); cancelAnimationFrame(frame); panel.remove();
  }, { signal });
  mount(); add("diagnostics-start", { path: location.pathname });
}
