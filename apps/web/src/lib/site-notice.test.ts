import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SITE_NOTICE_MAX_AGE_SECONDS,
  serializeOfficialSiteNoticeCookie,
} from "./site-notice";

describe("official site notice persistence", () => {
  it("keeps an acknowledgement for one year", () => {
    expect(OFFICIAL_SITE_NOTICE_MAX_AGE_SECONDS).toBe(31_536_000);
    expect(serializeOfficialSiteNoticeCookie(false)).toBe(
      "frip_fan_official_notice=yes; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  it("marks the cookie secure on HTTPS", () => {
    expect(serializeOfficialSiteNoticeCookie(true)).toBe(
      "frip_fan_official_notice=yes; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
  });
});
