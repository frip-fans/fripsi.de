import type { ChangePreview, SetlistChangeEntry, SetlistSnapshot } from "@frip-fan/core";
import { describe, expect, it } from "vitest";
import { changeOperationLabel, reviewRows, setlistLines } from "./change-review";

const entry = (position: number, song: string, extra: Partial<SetlistChangeEntry> = {}): SetlistChangeEntry => ({
  position, section: "main", song_id: song, song_title: song, performed_version_id: null, performed_version_title: null,
  display_title: song, medley_group: null, notes: null, ...extra,
});
const snapshot = (entries: SetlistChangeEntry[], extra: Partial<SetlistSnapshot> = {}): SetlistSnapshot => ({
  performance_label: "本公演", completeness: "partial", confidence: "unverified", notes: null, published: true, entries, sources: [], ...extra,
});
const preview = (setlist: ChangePreview["setlist"]) => ({ before: null, after: {}, setlist });

describe("setlist review", () => {
  it("names proposals by what they edit", () => {
    expect(changeOperationLabel({ operation: "create" })).toBe("新增活动");
    expect(changeOperationLabel({ operation: "create", subject_type: "setlist" })).toBe("新增歌单");
    expect(changeOperationLabel({ operation: "update", subject_type: "setlist" })).toBe("修改歌单");
    expect(changeOperationLabel({ operation: "update", subject_type: "event" })).toBe("修改活动");
  });

  it("lists every attribute of a new setlist and only the changed ones of an existing one", () => {
    const after = snapshot([entry(1, "a"), entry(2, "b")], { completeness: "complete", confidence: "official", sources: ["https://fripside.net/report"] });
    expect(reviewRows(preview({ setlist_id: null, before: null, after }))).toEqual([
      { label: "场次", before: "—", after: "本公演" },
      { label: "完整度", before: "—", after: "完整" },
      { label: "可信度", before: "—", after: "官方" },
      { label: "歌单备注", before: "—", after: "—" },
      { label: "公开", before: "—", after: "公开" },
      { label: "曲目", before: "—", after: "2 首" },
      { label: "新增来源", before: "—", after: "fripside.net/report" },
    ]);
    const before = snapshot([entry(1, "a")], { sources: ["https://fripside.net/report"] });
    expect(reviewRows(preview({ setlist_id: "s1", before, after }))).toEqual([
      { label: "完整度", before: "部分", after: "完整" },
      { label: "可信度", before: "待核实", after: "官方" },
      { label: "曲目", before: "1 首", after: "2 首" },
    ]);
    expect(reviewRows(preview({ setlist_id: "s1", before, after: before }))).toEqual([]);
  });

  it("marks songs that were added, removed or edited, but not ones that only moved", () => {
    const before = snapshot([entry(1, "a"), entry(2, "b"), entry(3, "c")]);
    const after = snapshot([entry(1, "b"), entry(2, "a"), entry(3, "d", { section: "encore", notes: "acoustic" })]);
    const lines = setlistLines({ setlist_id: "s1", before, after });
    expect(lines.before.map((line) => [line.text, line.changed])).toEqual([["a", false], ["b", false], ["c", true]]);
    expect(lines.after.map((line) => [line.text, line.changed, line.detail])).toEqual([["b", false, ""], ["a", false, ""], ["d", true, "Encore · acoustic"]]);
    // The same song twice counts twice.
    const encore = setlistLines({ setlist_id: "s1", before: snapshot([entry(1, "a")]), after: snapshot([entry(1, "a"), entry(2, "a")]) });
    expect(encore.after.map((line) => line.changed)).toEqual([false, true]);
    expect(setlistLines({ setlist_id: null, before: null, after }).after.every((line) => !line.changed)).toBe(true);
  });
});
