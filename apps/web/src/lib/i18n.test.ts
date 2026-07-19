import { describe, expect, it } from "vitest";
import { getLocale, t, translationKeys } from "./i18n";

describe("public UI i18n", () => {
  it("defaults to Simplified Chinese", () => {
    expect(getLocale(new Request("https://fripsi.de/calendar"))).toBe("zh-CN");
  });

  it("uses query language before the saved cookie", () => {
    const request = new Request("https://fripsi.de/calendar?lang=ja", {
      headers: { cookie: "frip_fan_locale=en" },
    });
    expect(getLocale(request)).toBe("ja");
  });

  it("interpolates translated UI strings", () => {
    expect(t("en", "pagination.summary", { total: 12, item: "songs", current: 1, pages: 2 }))
      .toBe("12 songs · Page 1 of 2");
    expect(t("zh-TW", "nav.calendar")).toBe("日曆");
  });

  it("does not leak CJK fallback copy into English UI", () => {
    const untranslated = translationKeys.filter((key) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t("en", key)));
    expect(untranslated).toEqual([]);
  });
});
