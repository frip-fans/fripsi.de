import { describe, expect, it } from "vitest";
import { readVoterId, voterCookie } from "./song-votes";

describe("anonymous voter cookie", () => {
  it("accepts only a valid generated identifier", () => {
    const id = "12345678-1234-4123-8123-123456789abc";
    expect(readVoterId(`locale=ja; frip_fan_voter=${id}`)).toBe(id);
    expect(readVoterId("frip_fan_voter=invalid")).toBeNull();
    expect(voterCookie(id, true)).toContain("HttpOnly; SameSite=Lax; Secure");
  });
});
