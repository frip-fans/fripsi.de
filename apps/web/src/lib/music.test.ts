import { describe, expect, it } from "vitest";
import { setlistDisplayTitle, shouldShowPerformedVersion } from "./music";

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

describe("setlistDisplayTitle", () => {
  const base = { title: null, event_title: "「Official」@東京・Hall", performance_label: "本公演" };
  it("prefers the event alias, then the setlist's own title, then tour · stop, then the official title", () => {
    expect(setlistDisplayTitle({ ...base, title: "Old title", event_alias: "Alias", event_tour_title: "Tour · 東京公演" })).toBe("Alias");
    expect(setlistDisplayTitle({ ...base, title: "Old title", event_tour_title: "Tour · 東京公演" })).toBe("Old title");
    expect(setlistDisplayTitle({ ...base, event_tour_title: "Tour · 東京公演" })).toBe("Tour · 東京公演");
    expect(setlistDisplayTitle(base)).toBe("「Official」@東京・Hall");
  });
  it("adds a non-default performance label unless the name already contains it", () => {
    expect(setlistDisplayTitle({ ...base, performance_label: "昼公演", event_alias: "Alias" })).toBe("Alias · 昼公演");
    expect(setlistDisplayTitle({ ...base, performance_label: "昼公演", event_alias: "Alias 昼公演" })).toBe("Alias 昼公演");
  });
});
