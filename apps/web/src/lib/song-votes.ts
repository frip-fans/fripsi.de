export const VOTER_COOKIE = "frip_fan_voter";
const voterPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function readVoterId(header: string): string | null {
  const cookie = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${VOTER_COOKIE}=`));
  const value = cookie?.slice(VOTER_COOKIE.length + 1) ?? "";
  return voterPattern.test(value) ? value : null;
}

export function voterCookie(id: string, secure: boolean): string {
  return `${VOTER_COOKIE}=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
