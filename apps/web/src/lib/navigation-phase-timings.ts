function requestPath(input: unknown): string | undefined {
  if (typeof input !== "string") return;
  try {
    const url = new URL(input, globalThis.location?.href);
    if (["http:", "https:"].includes(url.protocol) && url.origin === globalThis.location?.origin) return url.pathname;
  } catch { /* Leave unsupported inputs to the native method. */ }
}

type RecordTiming = (event: string, data?: Record<string, unknown>) => void;

// Installed only by the explicitly enabled non-production diagnostics. Forward
// the original receiver/arguments; never export HTML or change its parsing.
export function installNavigationPhaseTimings(record: RecordTiming) {
  const restores: (() => void)[] = [];
  const originalFetch = globalThis.fetch;
  const originalText = Response.prototype.text;
  const originalParse = DOMParser.prototype.parseFromString;
  const isNative = (method: typeof originalText | typeof originalParse | typeof fetch) => Function.prototype.toString.call(method).includes("[native code]");
  record("timing-builtins", { fetchNative: isNative(originalFetch), responseTextNative: isNative(originalText), domParserNative: isNative(originalParse) });
  const timedFetch = new Proxy(originalFetch, {
    apply(target, receiver, args) {
      // Deliberately do not read Request headers/body or coerce custom inputs.
      const path = requestPath(args[0]);
      if (path === undefined) return Reflect.apply(target, receiver, args);
      const started = performance.now();
      record("fetch.start", { path });
      const result: Promise<Response> = Reflect.apply(target, receiver, args);
      record("fetch.return", { path, duration: Math.round(performance.now() - started) });
      return result.then(value => {
        record("fetch.headers", { path, duration: Math.round(performance.now() - started) });
        return value;
      }, error => {
        record("fetch.error", { path, duration: Math.round(performance.now() - started) });
        throw error;
      });
    },
  });
  const text = new Proxy(originalText, {
    apply(target, receiver: Response, args) {
      if (!receiver.headers.get("content-type")?.includes("text/html")) return Reflect.apply(target, receiver, args);
      const path = receiver.url ? requestPath(receiver.url) : undefined;
      if (receiver.url && path === undefined) return Reflect.apply(target, receiver, args);
      const started = performance.now();
      record("response.text.start", { path });
      const result: Promise<string> = Reflect.apply(target, receiver, args);
      return result.then(value => {
        record("response.text.end", { path, duration: Math.round(performance.now() - started), characters: value.length });
        return value;
      }, error => {
        record("response.text.error", { path, duration: Math.round(performance.now() - started) });
        throw error;
      });
    },
  });
  const parse = new Proxy(originalParse, {
    apply(target, receiver, args) {
      if (args[1] !== "text/html" && args[1] !== "application/xhtml+xml") return Reflect.apply(target, receiver, args);
      const started = performance.now();
      record("html.parse.start", { characters: typeof args[0] === "string" ? args[0].length : undefined });
      try { return Reflect.apply(target, receiver, args); }
      finally { record("html.parse.end", { duration: Math.round(performance.now() - started) }); }
    },
  });
  try {
    globalThis.fetch = timedFetch;
    restores.push(() => { if (globalThis.fetch === timedFetch) globalThis.fetch = originalFetch; });
  } catch { record("timing-unavailable", { method: "fetch" }); }
  try {
    Response.prototype.text = text;
    restores.push(() => { if (Response.prototype.text === text) Response.prototype.text = originalText; });
  } catch { record("timing-unavailable", { method: "Response.text" }); }
  try {
    DOMParser.prototype.parseFromString = parse;
    restores.push(() => { if (DOMParser.prototype.parseFromString === parse) DOMParser.prototype.parseFromString = originalParse; });
  } catch { record("timing-unavailable", { method: "DOMParser.parseFromString" }); }
  return () => restores.forEach(restore => restore());
}
