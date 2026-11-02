import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  listVersionVotes: vi.fn(),
  setVersionVote: vi.fn()
}));

vi.mock("@frip-fan/core", () => ({
  listVersionVotes: mocks.listVersionVotes,
  setVersionVote: mocks.setVersionVote
}));
vi.mock("../../../lib/env", () => ({ getEnv: () => ({ DB: mocks.db }) }));

import { GET, POST } from "./index";

const origin = "https://fripsi.de";
const voterId = "12345678-1234-4123-8123-123456789abc";
const cookie = `frip_fan_voter=${voterId}`;

function context(request: Request) {
  return { request, url: new URL(request.url) } as Parameters<typeof POST>[0];
}

function post(body: unknown, overrides: Record<string, string> = {}) {
  return POST(context(new Request(`${origin}/api/votes`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie, ...overrides },
    body: JSON.stringify(body)
  })));
}

beforeEach(() => {
  mocks.listVersionVotes.mockReset().mockResolvedValue([]);
  mocks.setVersionVote.mockReset().mockResolvedValue(true);
});

describe("public voting API", () => {
  it("initializes an anonymous cookie on GET and keeps the response private", async () => {
    const response = await GET(context(new Request(`${origin}/api/votes`)));
    const generatedId = mocks.listVersionVotes.mock.calls[0][1];
    expect(generatedId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get("set-cookie")).toContain(`frip_fan_voter=${generatedId};`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax; Secure");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual([]);
  });

  it("uses an existing valid cookie without replacing it", async () => {
    const response = await GET(context(new Request(`${origin}/api/votes`, { headers: { cookie } })));
    expect(mocks.listVersionVotes).toHaveBeenCalledWith(mocks.db, voterId);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([1, 10, null])("accepts a score of %s including cancellation", async (score) => {
    const response = await post({ versionId: "version", score });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.setVersionVote).toHaveBeenCalledWith(mocks.db, "version", voterId, score);
  });

  it.each([0, -1, 11, 1.5, "10", {}, []])("rejects invalid score %j without writing", async (score) => {
    const response = await post({ versionId: "version", score });
    expect(response.status).toBe(400);
    expect(mocks.setVersionVote).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { origin: "https://other.example" },
    { origin: "" },
    { "content-type": "text/plain" }
  ])("rejects an invalid request origin or content type: %j", async (headers) => {
    const response = await post({ versionId: "version", score: 10 }, headers);
    expect(response.status).toBe(403);
    expect(mocks.setVersionVote).not.toHaveBeenCalled();
  });

  it.each(["", "frip_fan_voter=invalid"])("requires a valid anonymous cookie: %s", async (cookieHeader) => {
    const response = await post({ versionId: "version", score: 10 }, { cookie: cookieHeader });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Cookie required" });
    expect(mocks.setVersionVote).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and incomplete bodies", async () => {
    const malformed = await POST(context(new Request(`${origin}/api/votes`, {
      method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: "{"
    })));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Invalid JSON" });
    for (const body of [null, {}, { versionId: "version" }, { versionId: "", score: 10 }, { versionId: "x".repeat(181), score: 10 }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(mocks.setVersionVote).not.toHaveBeenCalled();
  });

  it("returns 404 when the version is missing or unpublished", async () => {
    mocks.setVersionVote.mockResolvedValue(false);
    const response = await post({ versionId: "hidden", score: 10 });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
