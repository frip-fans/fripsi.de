// This site animates loading placeholders, not whole-page captures. Astro checks
// this API once at module startup; use its supported `fallback="swap"` path to
// avoid native capture/compositing stalls in WebKit and backgrounded Chromium.
// Loaded synchronously before ClientRouter, from a same-origin hashed asset so
// the production CSP needs no inline-script exception.
// An already-open tab may receive this script during an Astro DOM swap. Its
// router has already cached native support=true; changing the API underneath it
// would break its next navigation. Reload once into the new bootstrap instead.
if (document.readyState !== "loading") {
  location.reload();
} else {
  Object.defineProperty(document, "startViewTransition", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}
