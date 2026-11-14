import { commentSourceHash } from "@frip-fan/core";

interface CommentEnv {
  COMMENT_SOURCE_SECRET?: string;
  AUTOMATION_SIGNING_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

// Without a configured secret the hashes only need to hold for this process: limits still
// work until a restart, and nothing durable depends on a guessable key.
const processSecret = crypto.randomUUID() + crypto.randomUUID();

/** Comments are only accepted from the site's own pages. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * The site is reached through Cloudflare only, which sets cf-connecting-ip itself; the
 * socket address is the tunnel's loopback and is used only where there is no proxy.
 */
export function clientAddress(request: Request, socketAddress?: string): string {
  return request.headers.get("cf-connecting-ip")?.trim() || socketAddress || "unknown";
}

export function sourceHash(env: CommentEnv, address: string): Promise<string> {
  return commentSourceHash(env.COMMENT_SOURCE_SECRET || env.AUTOMATION_SIGNING_SECRET || processSecret, address);
}

/** The challenge is on only when both keys are configured; the site key alone would lock everyone out. */
export function turnstileSiteKey(env: CommentEnv): string | null {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

/** Fails closed: an unreachable verifier must not turn the challenge into an open door. */
export async function verifyTurnstile(env: CommentEnv, token: unknown, address: string, request: typeof fetch = fetch): Promise<boolean> {
  if (!turnstileSiteKey(env)) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
    if (address !== "unknown") body.set("remoteip", address);
    const response = await request("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    return (await response.json() as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
