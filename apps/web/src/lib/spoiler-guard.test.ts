import { describe, expect, it } from "vitest";
import { isSpoilerConcealed, readRevealedTours, setTourRevealed, spoilerToday, SPOILER_STORAGE_KEY } from "./spoiler-guard";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe("spoiler guard", () => {
  it("covers a tour through its last stop's day unless the device revealed it", () => {
    expect(isSpoilerConcealed("2027-01-11", "ir4", [], "2026-11-15")).toBe(true);
    expect(isSpoilerConcealed("2027-01-11", "ir4", [], "2027-01-11")).toBe(true);
    expect(isSpoilerConcealed("2027-01-11", "ir4", [], "2027-01-12")).toBe(false);
    expect(isSpoilerConcealed("2027-01-11", "ir4", ["ir4"], "2026-11-15")).toBe(false);
    expect(isSpoilerConcealed("2027-01-11", "ir4", ["other"], "2026-11-15")).toBe(true);
  });

  it("remembers reveals per tour and lets a tour be covered again", () => {
    const storage = memoryStorage();
    setTourRevealed(storage, "ir4", true);
    setTourRevealed(storage, "other", true);
    setTourRevealed(storage, "ir4", true);
    expect(readRevealedTours(storage)).toEqual(["other", "ir4"]);
    setTourRevealed(storage, "ir4", false);
    expect(readRevealedTours(storage)).toEqual(["other"]);
  });

  it("treats missing, malformed or blocked storage as nothing revealed", () => {
    expect(readRevealedTours(memoryStorage())).toEqual([]);
    expect(readRevealedTours(memoryStorage({ [SPOILER_STORAGE_KEY]: "{oops" }))).toEqual([]);
    expect(readRevealedTours(memoryStorage({ [SPOILER_STORAGE_KEY]: '{"ir4":true}' }))).toEqual([]);
    expect(readRevealedTours(memoryStorage({ [SPOILER_STORAGE_KEY]: '["ir4",3]' }))).toEqual(["ir4"]);
    expect(readRevealedTours({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
    const blocked = { getItem: () => null, setItem: () => { throw new Error("blocked"); } };
    expect(() => setTourRevealed(blocked, "ir4", true)).not.toThrow();
  });

  it("reads today's date in Japan", () => {
    expect(spoilerToday(new Date("2026-11-14T15:30:00Z"))).toBe("2026-11-15");
    expect(spoilerToday(new Date("2026-11-14T14:59:00Z"))).toBe("2026-11-14");
  });
});
