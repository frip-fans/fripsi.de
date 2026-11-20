import { describe, expect, it } from "vitest";
import { commandMessage, embedWithPlayerApi, listeningMessage, readPlayerReport, videoIdOf } from "./youtube-player-messages";

describe("YouTube player messages", () => {
  it("adds the player API to an embed URL without changing the video", () => {
    const url = new URL(embedWithPlayerApi("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1", "https://fripsi.de", true));
    expect(url.pathname).toBe("/embed/dQw4w9WgXcQ");
    expect(Object.fromEntries(url.searchParams)).toEqual({ rel: "0", playsinline: "1", enablejsapi: "1", origin: "https://fripsi.de", autoplay: "1" });
    expect(embedWithPlayerApi("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "https://fripsi.de", false)).not.toContain("autoplay");
  });

  it("reads the video id from an embed URL", () => {
    expect(videoIdOf("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0")).toBe("dQw4w9WgXcQ");
    expect(videoIdOf("https://www.youtube-nocookie.com/embed/")).toBeUndefined();
    expect(videoIdOf("not a url")).toBeUndefined();
  });

  it("builds the messages the player expects", () => {
    expect(JSON.parse(listeningMessage())).toEqual({ event: "listening", id: 1, channel: "widget" });
    expect(JSON.parse(commandMessage("loadVideoById", "dQw4w9WgXcQ")))
      .toEqual({ event: "command", func: "loadVideoById", args: ["dQw4w9WgXcQ"], id: 1, channel: "widget" });
  });

  it("reads the playback state from either kind of state message", () => {
    expect(readPlayerReport(JSON.stringify({ event: "onStateChange", info: 0 }))).toEqual({ state: 0 });
    expect(readPlayerReport(JSON.stringify({ event: "infoDelivery", info: { playerState: 1, currentTime: 3 } }))).toEqual({ state: 1 });
    expect(readPlayerReport(JSON.stringify({ event: "infoDelivery", info: { currentTime: 3 } }))).toEqual({});
    expect(readPlayerReport(JSON.stringify({ event: "onReady", info: null }))).toEqual({});
    expect(readPlayerReport(JSON.stringify({ event: "onError", info: 150 }))).toEqual({ error: true });
  });

  it("ignores messages that are not from the player protocol", () => {
    expect(readPlayerReport({ event: "onStateChange", info: 0 })).toBeUndefined();
    expect(readPlayerReport("not json")).toBeUndefined();
    expect(readPlayerReport("null")).toBeUndefined();
    expect(readPlayerReport(JSON.stringify({ info: 0 }))).toBeUndefined();
  });
});
