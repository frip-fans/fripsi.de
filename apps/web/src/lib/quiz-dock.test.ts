import { describe, expect, it } from "vitest";
import { clampBottom, parsePosition, snapSide } from "./quiz-dock";

describe("quiz dock position", () => {
  it("snaps to the side of the mascot's centre", () => {
    expect(snapSide(100, 390)).toBe("left");
    expect(snapSide(300, 390)).toBe("right");
  });
  it("keeps the dock on screen", () => {
    expect(clampBottom(-40, 70, 844)).toBe(8);
    expect(clampBottom(2000, 70, 844)).toBe(766);
    expect(clampBottom(120.6, 70, 844)).toBe(121);
    expect(clampBottom(50, 900, 600)).toBe(8);
  });
  it("accepts only well-formed stored positions", () => {
    expect(parsePosition('{"side":"left","bottom":120}')).toEqual({ side: "left", bottom: 120 });
    expect(parsePosition('{"side":"up","bottom":1}')).toBeNull();
    expect(parsePosition('{"side":"right","bottom":"x"}')).toBeNull();
    expect(parsePosition("not json")).toBeNull();
    expect(parsePosition(null)).toBeNull();
  });
});
