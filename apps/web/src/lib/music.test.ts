import { describe, expect, it } from "vitest";
import { shouldShowPerformedVersion } from "./music";

describe("shouldShowPerformedVersion", () => {
  it("hides a redundant version label when it matches the displayed track title", () => {
    expect(shouldShowPerformedVersion("PHASE NEXT", "PHASE NEXT")).toBe(false);
    expect(shouldShowPerformedVersion(
      "Two souls -toward the truth- -version2023-",
      "Two souls –toward the truth– -version 2023-",
    )).toBe(false);
  });

  it("shows a version label when it adds information", () => {
    expect(shouldShowPerformedVersion("only my railgun", "only my railgun -version 2024-")).toBe(true);
  });

  it("does not show a missing version title", () => {
    expect(shouldShowPerformedVersion("only my railgun", null)).toBe(false);
  });
});
