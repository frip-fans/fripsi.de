import { describe, expect, it } from "vitest";
import { buildSearchText, foldSearchText, matchesSearch, searchMatcher, searchTerms } from "./search-text";

describe("locale-tolerant search text", () => {
  it("folds width, case, kana and punctuation", () => {
    expect(foldSearchText("ＬＥＶＥＬ５-judgelight-")).toBe("level5judgelight");
    expect(foldSearchText("プール・バケーション")).toBe(foldSearchText("ぷーるばけーしょん"));
    expect(foldSearchText("ｱﾆﾒｲﾄ")).toBe(foldSearchText("アニメイト"));
    expect(foldSearchText("せな★せな@Surprise!!")).toBe("せなせなsurprise");
  });

  it("folds Japanese, Traditional and Simplified character forms to one key", () => {
    for (const [japanese, chinese] of [["横浜アリーナ", "横滨"], ["日本武道館", "日本武道馆"], ["東京", "东京"], ["沖縄", "冲绳"], ["臺灣", "台湾"], ["楽園の翼", "乐园"]]) {
      expect(matchesSearch([japanese], chinese)).toBe(true);
    }
    expect(foldSearchText("東京")).toBe(foldSearchText("東京".normalize("NFKC")));
  });

  it("requires every term but never matches one term across two fields", () => {
    expect(matchesSearch(["横浜アリーナ", "fripSide"], "横滨 fripside")).toBe(true);
    expect(matchesSearch(["横浜アリーナ", "fripSide"], "横滨 angela")).toBe(false);
    expect(matchesSearch(["only my", "railgun"], "myrailgun")).toBe(false);
    expect(matchesSearch(["only my railgun"], "myrailgun")).toBe(true);
  });

  it("matches everything for a blank query and nothing for a symbols-only query", () => {
    const text = buildSearchText(["anything"]);
    expect(searchMatcher("   ")(text)).toBe(true);
    expect(searchMatcher("%")(text)).toBe(false);
    expect(searchTerms("★ 横浜 ★ 横濱")).toEqual(["横滨"]);
  });
});
