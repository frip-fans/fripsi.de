/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./test-d1";
import { computeTourMatrix, type TourMatrixEntryInput, type TourMatrixShowInput } from "./tour-matrix";
import { getEventTourContext, getPublicTourPage, listTours } from "./tours";

const show = (id: string, date: string, setlist: string | null, completeness: TourMatrixShowInput["completeness"] = "complete", label = "本公演"): TourMatrixShowInput => ({
  event_id: id, event_slug: id, start_date: date, start_time: null, stop_label: `${id}公演`,
  setlist_id: setlist, performance_label: setlist ? label : null, completeness: setlist ? completeness : null,
});
const entries = (setlist: string, songs: string[]): TourMatrixEntryInput[] => songs.map((song, index) => ({
  setlist_id: setlist, song_id: song, song_slug: song, song_title: song.toUpperCase(), position: index + 1, section: "main",
}));

describe("tour matrix", () => {
  it("orders songs by their usual slot and tells known-absent from unknown and missing", () => {
    const matrix = computeTourMatrix(
      [show("osaka", "2026-02-01", "s2", "partial"), show("tokyo", "2026-01-01", "s1"), show("nagoya", "2026-03-01", null), show("fukuoka", "2026-04-01", "s3")],
      [...entries("s1", ["a", "b", "c", "d"]), ...entries("s2", ["a", "d"]), ...entries("s3", ["a", "c", "e", "d"])],
    );
    expect(matrix.columns.map(column => column.event_id)).toEqual(["tokyo", "osaka", "nagoya", "fukuoka"]);
    expect(matrix.rows.map(row => row.song_id)).toEqual(["a", "b", "c", "e", "d"]);
    const cells = Object.fromEntries(matrix.rows.map(row => [row.song_id, row.cells.map(cell => cell.state === "sung" ? cell.position : cell.state)]));
    expect(cells.b).toEqual([2, "unknown", "missing", "absent"]);
    expect(cells.d).toEqual([4, 2, "missing", 4]);
    expect([matrix.stop_count, matrix.setlist_count, matrix.complete_count]).toEqual([4, 3, 2]);
  });

  it("counts fixed, rotating and one-off songs from complete setlists only", () => {
    const matrix = computeTourMatrix(
      [show("t1", "2026-01-01", "s1"), show("t2", "2026-01-02", "s2"), show("t3", "2026-01-03", "s3"), show("t4", "2026-01-04", "s4", "partial")],
      [...entries("s1", ["a", "b", "x"]), ...entries("s2", ["a", "b"]), ...entries("s3", ["a", "c"]), ...entries("s4", ["c", "y"])],
    );
    const kinds = Object.fromEntries(matrix.rows.map(row => [row.song_id, row.kind]));
    // "a" misses nothing complete; "y" was only seen at the partial show but still counts as one-off.
    expect(kinds).toEqual({ a: "fixed", b: "rotating", c: "rotating", x: "once", y: "once" });
    expect(matrix.stats).toEqual({ fixed: 1, rotating: 2, once: 2 });
  });

  it("describes each show as changes against the songs most complete shows share", () => {
    const matrix = computeTourMatrix(
      [show("t1", "2026-01-01", "s1"), show("t2", "2026-01-02", "s2"), show("t3", "2026-01-03", "s3"), show("t4", "2026-01-04", "s4", "partial")],
      [...entries("s1", ["a", "b", "x"]), ...entries("s2", ["a", "b"]), ...entries("s3", ["a", "c"]), ...entries("s4", ["c"])],
    );
    expect(matrix.baseline.map(song => song.song_id)).toEqual(["a", "b"]);
    const changes = matrix.changes.map(change => [change.added.map(song => song.song_id), change.dropped.map(song => song.song_id)]);
    // The partial show can't prove a+b were dropped, so only its additions are listed.
    expect(changes).toEqual([[["x"], []], [[], []], [["c"], ["b"]], [["c"], []]]);
  });

  it("gives day and night shows of one stop separate columns that share a stop number", () => {
    const matrix = computeTourMatrix(
      [show("tokyo", "2026-01-01", "night", "complete", "夜公演"), show("tokyo", "2026-01-01", "day", "complete", "昼公演"), show("osaka", "2026-01-05", "s3")],
      [...entries("day", ["a"]), ...entries("night", ["b"]), ...entries("s3", ["a"])],
    );
    expect(matrix.columns.map(column => [column.performance_label, column.stop_number])).toEqual([["昼公演", 1], ["夜公演", 1], ["本公演", 2]]);
    expect(matrix.stop_count).toBe(2);
  });

  it("treats shows from today on without a setlist as upcoming, not missing", () => {
    const matrix = computeTourMatrix(
      [show("past", "2026-11-01", null), show("done", "2026-11-05", "s1"), show("tonight", "2026-11-13", null), show("later", "2026-12-01", null)],
      entries("s1", ["a"]),
      "2026-11-13",
    );
    expect(matrix.columns.map(column => column.upcoming)).toEqual([false, false, true, true]);
    expect(matrix.rows[0].cells.map(cell => cell.state)).toEqual(["missing", "sung", "upcoming", "upcoming"]);
    // Without a date, nothing is assumed to be in the future.
    expect(computeTourMatrix([show("later", "2099-01-01", null)], []).columns[0].upcoming).toBe(false);
  });

  it("withholds the fixed / rotating split with fewer than two complete setlists", () => {
    const matrix = computeTourMatrix([show("t1", "2026-01-01", "s1"), show("t2", "2026-01-02", "s2", "partial")], [...entries("s1", ["a"]), ...entries("s2", ["a"])]);
    expect(matrix.stats).toBeNull();
    expect(matrix.rows[0].kind).toBeNull();
  });
});

describe("public tour queries", () => {
  function seed(sqlite: import("node:sqlite").DatabaseSync) {
    sqlite.exec(`
      INSERT INTO tours (id, slug, name, published, created_at, updated_at) VALUES
        ('t1', 'tour-one', 'Tour One', 1, 'now', 'now'), ('t2', 'hidden', 'Hidden', 0, 'now', 'now');
      INSERT INTO songs (id, slug, title, normalized_title, created_at, updated_at) VALUES
        ('a', 'song-a', 'Song A', 'song a', 'now', 'now'), ('b', 'song-b', 'Song B', 'song b', 'now', 'now');
    `);
    const events: Array<[string, string, string, number]> = [["e1", "2026-01-01", "t1", 1], ["e2", "2026-01-03", "t1", 1], ["e3", "2026-01-05", "t1", 1], ["e4", "2026-01-07", "t1", 0], ["e5", "2026-01-02", "t2", 1]];
    for (const [id, date, tour, published] of events) {
      sqlite.prepare(`INSERT INTO events (id, slug, title, start_date, timezone, category, location_mode, status, published, version, created_at, updated_at, tour_id, tour_stop)
        VALUES (?, ?, ?, ?, 'Asia/Tokyo', 'LIVE', 'physical', 'completed', ?, 1, 'now', 'now', ?, ?)`).run(id, `slug-${id}`, `Official ${id}`, date, published, tour, `Stop ${id}`);
    }
    sqlite.exec(`
      INSERT INTO setlists (id, event_id, performance_label, completeness, published, created_at, updated_at) VALUES
        ('day', 'e1', '昼公演', 'complete', 1, 'now', 'now'), ('night', 'e1', '夜公演', 'complete', 1, 'now', 'now'),
        ('s2', 'e2', '本公演', 'partial', 1, 'now', 'now'), ('s2-draft', 'e2', 'draft', 'complete', 0, 'now', 'now');
      INSERT INTO setlist_entries (id, setlist_id, position, song_id, display_title, created_at) VALUES
        ('1', 'day', 1, 'a', 'Song A', 'now'), ('2', 'night', 1, 'a', 'Song A', 'now'), ('3', 'night', 2, 'b', 'Song B', 'now'),
        ('4', 's2', 1, 'b', 'Song B', 'now'), ('5', 's2-draft', 1, 'a', 'Song A', 'now');
    `);
  }

  it("builds the matrix from published stops and setlists only", async () => {
    const { db, sqlite } = createTestD1();
    try {
      seed(sqlite);
      const page = await getPublicTourPage(db, "tour-one");
      expect(page?.matrix.columns.map(column => [column.event_id, column.performance_label, column.stop_label])).toEqual([
        ["e1", "昼公演", "Stop e1"], ["e1", "夜公演", "Stop e1"], ["e2", "本公演", "Stop e2"], ["e3", null, "Stop e3"],
      ]);
      expect(page?.matrix.rows.map(row => row.song_slug)).toEqual(["song-a", "song-b"]);
      expect([page?.stop_count, page?.setlist_stop_count]).toEqual([3, 2]);
      expect((await listTours(db, { publicOnly: true }))[0].setlist_stop_count).toBe(2);
      expect(await getPublicTourPage(db, "hidden")).toBeNull();
    } finally { sqlite.close(); }
  });

  it("places an event within its published tour", async () => {
    const { db, sqlite } = createTestD1();
    try {
      seed(sqlite);
      const context = await getEventTourContext(db, "e2");
      expect(context).toMatchObject({ slug: "tour-one", name: "Tour One", stop_number: 2, stop_count: 3 });
      expect(context?.previous?.slug).toBe("slug-e1");
      expect(context?.next?.slug).toBe("slug-e3");
      expect((await getEventTourContext(db, "e1"))?.previous).toBeNull();
      expect(await getEventTourContext(db, "e4")).toBeNull();
      expect(await getEventTourContext(db, "e5")).toBeNull();
    } finally { sqlite.close(); }
  });
});
