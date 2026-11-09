import { dateInTimeZone } from "@frip-fan/core";

/**
 * Anonymous player identity. Clearing cookies or switching device starts a new player,
 * so this limits repeat answers within one browser and is not a per-person guarantee.
 */
export const PLAYER_COOKIE = "frip_fan_quiz_player";

const playerPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function readPlayerId(header: string): string | null {
  const cookie = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${PLAYER_COOKIE}=`));
  const value = cookie?.slice(PLAYER_COOKIE.length + 1) ?? "";
  return playerPattern.test(value) ? value : null;
}

export function playerCookie(id: string, secure: boolean): string {
  return `${PLAYER_COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * The puzzle day, fixed to the band's local time so the same five questions are "today"
 * for everyone regardless of where they are reading from.
 */
export function puzzleDate(now = new Date()): string {
  return dateInTimeZone(now, "Asia/Tokyo");
}
