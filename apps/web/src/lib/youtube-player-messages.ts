/**
 * The message protocol of an embedded YouTube player (`enablejsapi=1`). Speaking it
 * directly keeps YouTube's API script out of our pages and out of the CSP.
 */
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
export const YOUTUBE_ENDED = 0;

const envelope = (message: Record<string, unknown>) => JSON.stringify({ ...message, id: 1, channel: "widget" });

/** Asks the player to start reporting to this window. It answers once it is ready. */
export const listeningMessage = () => envelope({ event: "listening" });

export const commandMessage = (func: string, ...args: unknown[]) => envelope({ event: "command", func, args });

export function embedWithPlayerApi(embed: string, origin: string, autoplay: boolean): string {
  const url = new URL(embed);
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("origin", origin);
  if (autoplay) url.searchParams.set("autoplay", "1");
  return url.href;
}

export function videoIdOf(embed: string): string | undefined {
  try {
    const id = new URL(embed).pathname.split("/").pop();
    return id && /^[\w-]{11}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}

export type PlayerReport = { state?: number; error?: boolean };

/** Reads a message posted by the player; `undefined` when it is not one. */
export function readPlayerReport(data: unknown): PlayerReport | undefined {
  if (typeof data !== "string") return undefined;
  let message: { event?: unknown; info?: unknown };
  try { message = JSON.parse(data); } catch { return undefined; }
  if (!message || typeof message !== "object" || typeof message.event !== "string") return undefined;
  if (message.event === "onError") return { error: true };
  const info = message.info;
  const state = message.event === "onStateChange" ? info
    : info && typeof info === "object" ? (info as { playerState?: unknown }).playerState : undefined;
  return typeof state === "number" ? { state } : {};
}
