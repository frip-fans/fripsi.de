import { afterEach, describe, expect, it, vi } from "vitest";
import { installNavigationPhaseTimings } from "./navigation-phase-timings";

const failure = new Error("parse failure");
class Parser {
  parseFromString(input: string, mime: string) {
    if (input === "fail") throw failure;
    return { input, mime, receiver: this };
  }
}
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const setup = () => {
  vi.stubGlobal("DOMParser", Parser);
  vi.stubGlobal("location", new URL("https://staging.fripsi.de/calendar"));
  const record = vi.fn();
  restore = installNavigationPhaseTimings(record);
  return record;
};

describe("opt-in HTML phase timings", () => {
  it("preserves fetch response identity, input arguments and rejection", async () => {
    const response = new Response("private body");
    const rejection = new Error("network failure");
    const implementation = vi.fn().mockResolvedValueOnce(response).mockRejectedValueOnce(rejection);
    vi.stubGlobal("fetch", implementation);
    const record = setup();
    const options = { headers: { authorization: "private header" } };
    expect(await fetch("https://staging.fripsi.de/calendar?token=private", options)).toBe(response);
    expect(implementation).toHaveBeenNthCalledWith(1, "https://staging.fripsi.de/calendar?token=private", options);
    await expect(fetch("https://staging.fripsi.de/about")).rejects.toBe(rejection);
    expect(JSON.stringify(record.mock.calls)).not.toContain("private");
    expect(record.mock.calls.map(call => call[0])).toEqual(["timing-builtins", "fetch.start", "fetch.return", "fetch.headers", "fetch.start", "fetch.return", "fetch.error"]);
  });
  it("does not record cross-origin or data URL requests and response contents", async () => {
    const response = new Response("private HTML", { headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: "data:text/html,private%20HTML" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const record = setup(); record.mockClear();
    expect(await fetch("data:text/html,private%20HTML")).toBe(response);
    expect(await fetch("https://other.example/private")).toBe(response);
    expect(await response.text()).toBe("private HTML");
    expect(record).not.toHaveBeenCalled();
  });
  it("preserves the HTML response text and records completion without its contents", async () => {
    const record = setup();
    const response = new Response("<p>private content</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
    expect(await response.text()).toBe("<p>private content</p>");
    expect(record.mock.calls.map(call => call[0])).toContain("response.text.end");
    expect(JSON.stringify(record.mock.calls)).not.toContain("private content");
    await expect(response.text()).rejects.toBeInstanceOf(TypeError);
    expect(record.mock.calls.map(call => call[0])).toContain("response.text.error");
  });
  it("leaves non-HTML reads and XML parses unrecorded", async () => {
    const record = setup(); record.mockClear();
    expect(await new Response("plain").text()).toBe("plain");
    const parser = new Parser();
    expect(parser.parseFromString("<x/>", "text/xml").receiver).toBe(parser);
    expect(record).not.toHaveBeenCalled();
  });
  it("preserves the parser receiver, arguments, returned document and thrown error", () => {
    const record = setup();
    const parser = new Parser();
    expect(parser.parseFromString("<p>test</p>", "text/html")).toEqual({ input: "<p>test</p>", mime: "text/html", receiver: parser });
    expect(() => parser.parseFromString("fail", "text/html")).toThrow(failure);
    expect(record.mock.calls.filter(call => call[0] === "html.parse.end")).toHaveLength(2);
    expect(JSON.stringify(record.mock.calls)).not.toContain("<p>test</p>");
  });
  it("restores native methods but leaves a later owner's wrapper in place", () => {
    const originalText = Response.prototype.text;
    const originalParse = Parser.prototype.parseFromString;
    setup();
    const later = vi.fn(originalParse);
    Parser.prototype.parseFromString = later;
    restore?.();
    expect(Response.prototype.text).toBe(originalText);
    expect(Parser.prototype.parseFromString).toBe(later);
    Parser.prototype.parseFromString = originalParse;
  });
});
