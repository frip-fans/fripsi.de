import { listVersionVotes, setVersionVote } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";
import { readVoterId, voterCookie } from "../../../lib/song-votes";

const headers = { "cache-control": "private, no-store" };

export const GET: APIRoute = async ({ request, url }) => {
  const existing = readVoterId(request.headers.get("cookie") ?? "");
  const voterId = existing ?? crypto.randomUUID();
  const votes = await listVersionVotes(getEnv().DB, voterId);
  return Response.json(votes, { headers: { ...headers, ...(!existing ? { "set-cookie": voterCookie(voterId, url.protocol === "https:") } : {}) } });
};

export const POST: APIRoute = async ({ request, url }) => {
  if (request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Invalid request" }, { status: 403, headers });
  }
  const voterId = readVoterId(request.headers.get("cookie") ?? "");
  if (!voterId) return Response.json({ error: "Cookie required" }, { status: 400, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || !("versionId" in body) || !("score" in body)) return Response.json({ error: "Invalid request" }, { status: 400, headers });
  const { versionId, score } = body as { versionId: unknown; score: unknown };
  if (typeof versionId !== "string" || versionId.length === 0 || versionId.length > 180 ||
      !(score === null || (typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 10))) {
    return Response.json({ error: "Invalid vote" }, { status: 400, headers });
  }
  const found = await setVersionVote(getEnv().DB, versionId, voterId, score as number | null);
  return found ? Response.json({ ok: true }, { headers }) : Response.json({ error: "Not found" }, { status: 404, headers });
};
