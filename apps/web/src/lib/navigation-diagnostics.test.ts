import { describe, expect, it } from "vitest";
import { resourceSample } from "./navigation-diagnostics";
const sample = (name: string) => ({ name, initiatorType: "fetch", startTime: 100, requestStart: 101, responseStart: 250, responseEnd: 260, duration: 160, transferSize: 1000 }) as PerformanceResourceTiming;
describe("navigation timing export", () => {
  it("exports phases without URL credentials, query values or fragments", () => {
    const result = resourceSample(sample("https://user:secret@staging.fripsi.de/calendar?token=secret#private"), "https://staging.fripsi.de");
    expect(result).toEqual({ path: "/calendar", type: "fetch", start: 100, request: 101, firstByte: 250, end: 260, duration: 160, bytes: 1000 });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("does not export resources from other origins or inline content", () => {
    expect(resourceSample(sample("https://other.example/private"), "https://staging.fripsi.de")).toBeNull();
    expect(resourceSample(sample("data:text/plain,secret"), "https://staging.fripsi.de")).toBeNull();
  });
});
