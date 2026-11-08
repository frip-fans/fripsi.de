// This site animates loading placeholders, not whole-page captures. Astro checks
// this API once at module startup; use its supported `fallback="swap"` path to
// avoid native capture/compositing stalls in WebKit and backgrounded Chromium.
// Loaded synchronously before ClientRouter, from a same-origin hashed asset so
// the production CSP needs no inline-script exception.
Object.defineProperty(document, "startViewTransition", {
  value: undefined,
  configurable: true,
  writable: true,
});
