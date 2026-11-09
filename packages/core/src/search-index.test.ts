import { describe, expect, it } from "vitest";
import { ContentAdminService } from "./content-admin";
import { listAdminReleases } from "./music-admin-repository";
import { countSetlists, listReleases, listSongs } from "./music-repository";
import { countPublicEventSearch, parsePublicEventSearch } from "./public-event-search";
import { searchEvents } from "./repository";
import { matchEventIds, matchSetlistIds } from "./search-index";
import { createTestD1 } from "./test-d1";
import type { Actor } from "./types";

function fixture() {
  const { db, sqlite } = createTestD1();
  const event = sqlite.prepare(`INSERT INTO events (id, slug, title, start_date, timezone, category, classification, status, published, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, ?, 'completed', ?, 'now', 'now')`);
  event.run("ev_arena", "arena", "fripSide LIVE TOUR 2014-2015 FINAL", "2015-03-01", "LIVE", "专场", 1);
  event.run("ev_radio", "radio", "文化放送 A&G なすお☆THE CATCH", "2020-01-01", "MEDIA", null, 1);
  event.run("ev_hidden", "hidden", "横浜 private rehearsal", "2020-02-01", "OTHER", null, 0);
  sqlite.exec(`INSERT INTO venues (id, canonical_name, administrative_area_id, created_at, updated_at) VALUES ('ven_arena', '横浜アリーナ', 'area_jp_14', 'now', 'now');
    INSERT INTO venue_aliases (venue_id, alias) VALUES ('ven_arena', 'Yokohama Arena');
    INSERT INTO event_venues (event_id, venue_id) VALUES ('ev_arena', 'ven_arena'), ('ev_hidden', 'ven_arena');
    INSERT INTO songs (id, slug, title, normalized_title, created_at, updated_at) VALUES ('song_paradise', 'rakuen', '楽園の翼', 'rakuen', 'now', 'now');
    INSERT INTO song_aliases (id, song_id, alias, normalized_alias, created_at) VALUES ('alias_1', 'song_paradise', 'Wings of Paradise', 'wingsofparadise', 'now');
    INSERT INTO setlists (id, event_id, created_at, updated_at) VALUES ('sl_arena', 'ev_arena', 'now', 'now');
    INSERT INTO setlist_entries (id, setlist_id, position, song_id, display_title, created_at) VALUES ('se_1', 'sl_arena', 1, 'song_paradise', '楽園の翼', 'now');`);
  return { db, sqlite };
}

describe("catalogue search across scripts and languages", () => {
  it("finds events by Simplified Chinese, English and kana spellings of venues and areas", async () => {
    const { db } = fixture();
    for (const query of ["横滨", "横濱", "yokohama arena", "Kanagawa", "神奈川", "よこはま"]) {
      expect(await matchEventIds(db, query, "public"), query).toEqual(query === "よこはま" ? [] : ["ev_arena"]);
    }
    expect(await matchEventIds(db, "なすお", "public")).toEqual(["ev_radio"]);
    expect(await matchEventIds(db, "ナスオ the catch", "public")).toEqual(["ev_radio"]);
  });

  it("matches the category and live-type labels shown in every locale", async () => {
    const { db } = fixture();
    expect(await matchEventIds(db, "演唱会", "public")).toEqual(["ev_arena"]);
    expect(await matchEventIds(db, "ワンマン", "public")).toEqual(["ev_arena"]);
    expect(await matchEventIds(db, "番組", "public")).toEqual(["ev_radio"]);
  });

  it("keeps unpublished events out of public search but finds them in admin search", async () => {
    const { db } = fixture();
    expect(await countPublicEventSearch(db, parsePublicEventSearch(new URLSearchParams("q=横滨 rehearsal")))).toBe(0);
    expect((await searchEvents(db, { query: "横滨 rehearsal" })).map(event => event.id)).toEqual(["ev_hidden"]);
    expect(await countPublicEventSearch(db, parsePublicEventSearch(new URLSearchParams("q=横滨&category=LIVE")))).toBe(1);
  });

  it("finds setlists and songs by song aliases and Chinese character forms", async () => {
    const { db } = fixture();
    expect(await matchSetlistIds(db, "wings of paradise", "public")).toEqual(["sl_arena"]);
    expect(await countSetlists(db, { query: "乐园之翼" })).toBe(0);
    expect(await countSetlists(db, { query: "乐园" })).toBe(1);
    expect((await listSongs(db, { query: "乐园の翼" })).map(song => song.id)).toEqual(["song_paradise"]);
  });

  it("saves release aliases from the admin form and searches them publicly", async () => {
    const { db } = fixture();
    const service = new ContentAdminService(db);
    const actor: Actor = { id: "tester", type: "human", channel: "admin", scopes: ["music:write"] };
    const base = { title: "とある科学の超音楽集", release_type: "album", published: true, sources: [], tracks: [] };
    const created = await service.saveRelease({ ...base, aliases: ["某科学的超音乐集", "Railgun Music Chronicles"], idempotency_key: "release-alias-1" }, actor);
    expect(created.aliases).toEqual(["Railgun Music Chronicles", "某科学的超音乐集"]);
    expect((await listReleases(db, { query: "超音乐集" })).map(release => release.id)).toEqual([created.id]);
    expect((await listReleases(db, { query: "music chronicles" })).map(release => release.id)).toEqual([created.id]);
    expect((await listAdminReleases(db, "railgun")).map(release => release.id)).toEqual([created.id]);

    const kept = await service.saveRelease({ ...base, id: created.id, expected_updated_at: created.updated_at, idempotency_key: "release-alias-2" }, actor);
    expect(kept.aliases).toHaveLength(2);
    const cleared = await service.saveRelease({ ...base, id: created.id, expected_updated_at: kept.updated_at, aliases: [], idempotency_key: "release-alias-3" }, actor);
    expect(cleared.aliases).toEqual([]);
    await expect(service.saveRelease({ ...base, aliases: ["Railgun", "ＲＡＩＬＧＵＮ"], idempotency_key: "release-alias-4" }, actor)).rejects.toThrow();
  });
});
