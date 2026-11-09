import { describe, expect, it } from "vitest";
import { usesNativePageNavigation } from "./navigation-policy";

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";

describe("iOS Safari navigation compatibility", () => {
  it.each([
    `${iphone} Version/18.6 Mobile/15E148 Safari/604.1`,
    `${iphone.replace("18_6", "26_0")} Version/26.0 Mobile/15E148 Safari/604.1`,
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
  ])("uses document navigation for iOS Safari: %s", userAgent => {
    expect(usesNativePageNavigation(userAgent)).toBe(true);
  });

  it.each([
    "",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
    "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
    `${iphone} CriOS/140.0.0.0 Mobile/15E148 Safari/604.1`,
    `${iphone} FxiOS/140.0 Mobile/15E148 Safari/605.1.15`,
  ])("keeps the existing router policy for other browsers: %s", userAgent => {
    expect(usesNativePageNavigation(userAgent)).toBe(false);
  });
});
