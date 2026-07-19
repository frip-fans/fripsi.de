import { describe, expect, it } from "vitest";
import { parseSources, readSongSave } from "./admin";

describe("admin source lines", () => {
  it("keeps explicit source types while remaining backwards compatible", () => {
    expect(parseSources([
      "https://fripside.net/news/1 | 官方公告 | official",
      "https://www.livefans.jp/events/1 | LiveFans | community",
      "https://example.com/source",
    ].join("\n"))).toEqual([
      { url: "https://fripside.net/news/1", label: "官方公告", source_type: "official" },
      { url: "https://www.livefans.jp/events/1", label: "LiveFans", source_type: "community" },
      { url: "https://example.com/source", label: undefined, source_type: "official" },
    ]);
  });
});

describe("song admin form", () => {
  it("reads aliases and aligned song versions", () => {
    const form = new FormData();
    form.set("idempotency_key", "admin-song-test-key");
    form.set("title", "only my railgun");
    form.set("original_artist", "fripSide");
    form.set("published", "on");
    form.set("aliases", "only my railgun\nOMR\n");
    form.append("version_id", "version-1");
    form.append("version_slug", "only-my-railgun-version-2024");
    form.append("version_title", "only my railgun -version 2024-");
    form.append("version_label", "version 2024");
    form.append("version_artist_credit", "fripSide");
    form.append("version_release_date", "2024-01-01");
    form.append("version_notes", "");
    form.append("version_published", "1");
    form.append("version_sources", "https://fripside.net/discography/1 | 官方发行页 | official");

    const result = readSongSave(form);
    expect(result.aliases).toEqual(["only my railgun", "OMR"]);
    expect(result.versions).toEqual([{
      id: "version-1",
      slug: "only-my-railgun-version-2024",
      title: "only my railgun -version 2024-",
      version_label: "version 2024",
      artist_credit: "fripSide",
      release_date: "2024-01-01",
      notes: null,
      published: true,
      sources: [{ url: "https://fripside.net/discography/1", label: "官方发行页", source_type: "official" }],
    }]);
  });
});
