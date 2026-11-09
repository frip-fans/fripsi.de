import { describe, expect, it } from "vitest";
import {
  buildDailyPuzzle,
  isCorrect,
  optionCount,
  QUESTIONS_PER_PUZZLE,
  type QuizMaterial,
  type QuizShow,
} from "./setlist-quiz";

const song = (slug: string, performance_count: number) => ({ slug, title: slug.toUpperCase(), performance_count });

const show = (slug: string, songs: Array<[string, boolean]>): QuizShow => ({
  event_slug: slug,
  event_title: `TOUR ${slug}`,
  start_date: "2024-05-01",
  songs: songs.map(([name, encore]) => ({ slug: name, title: name.toUpperCase(), encore })),
});

/** Enough shows and songs that every question type can be built. */
const material: QuizMaterial = {
  shows: [
    show("show-a", [["railgun", false], ["eternal", false], ["bullet", false], ["sister", false], ["moon", true]]),
    show("show-b", [["railgun", false], ["dawn", false], ["crossroads", false], ["heaven", false], ["clover", true]]),
    show("show-c", [["eternal", false], ["dawn", false], ["black", false], ["white", false], ["red", true]]),
    show("show-d", [["bullet", false], ["heaven", false], ["blue", false], ["green", false], ["violet", true]]),
  ],
  songs: [
    song("railgun", 40), song("eternal", 31), song("bullet", 24), song("sister", 18), song("moon", 14),
    song("dawn", 11), song("crossroads", 9), song("heaven", 7), song("clover", 6), song("black", 5),
    song("white", 4), song("red", 3), song("blue", 3), song("green", 3), song("violet", 3),
  ],
};

describe("daily setlist quiz", () => {
  it("builds a full puzzle and repeats it exactly for the same day", () => {
    const first = buildDailyPuzzle(material, "2026-03-14");
    const second = buildDailyPuzzle(material, "2026-03-14");
    expect(first.questions).toHaveLength(QUESTIONS_PER_PUZZLE);
    expect(second).toEqual(first);
  });

  it("asks different questions on different days", () => {
    const days = ["2026-03-14", "2026-03-15", "2026-03-16", "2026-03-17"].map((date) => JSON.stringify(buildDailyPuzzle(material, date).questions));
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it("never claims a song was absent when it is on the setlist", () => {
    const byShow = new Map(material.shows.map((entry) => [entry.event_slug, new Set(entry.songs.map((item) => item.slug))]));
    for (let day = 1; day <= 31; day += 1) {
      const { questions } = buildDailyPuzzle(material, `2026-01-${String(day).padStart(2, "0")}`);
      for (const question of questions) {
        if (question.type !== "performed") continue;
        const onSetlist = byShow.get(question.event.slug)!.has(question.song.slug);
        expect(onSetlist).toBe(question.answer === 0);
      }
    }
  });

  it("only offers encore distractors that are absent from the whole setlist", () => {
    const byShow = new Map(material.shows.map((entry) => [entry.event_slug, entry.songs]));
    for (let day = 1; day <= 31; day += 1) {
      const { questions } = buildDailyPuzzle(material, `2026-02-${String(day).padStart(2, "0")}`);
      for (const question of questions) {
        if (question.type !== "encore") continue;
        const songs = byShow.get(question.event.slug)!;
        const encoreSlugs = new Set(songs.filter((item) => item.encore).map((item) => item.slug));
        const setlistSlugs = new Set(songs.map((item) => item.slug));
        question.options.forEach((option, index) => {
          expect(index === question.answer ? encoreSlugs.has(option.slug) : !setlistSlugs.has(option.slug)).toBe(true);
        });
      }
    }
  });

  it("marks the more performed song and only pairs songs with a clear gap", () => {
    for (let day = 1; day <= 31; day += 1) {
      const { questions } = buildDailyPuzzle(material, `2026-04-${String(day).padStart(2, "0")}`);
      for (const question of questions) {
        if (question.type !== "more_performed") continue;
        const [first, second] = question.counts;
        expect(question.counts[question.answer]).toBe(Math.max(first, second));
        expect(Math.abs(first - second)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("skips question types the archive cannot support instead of inventing them", () => {
    const thin: QuizMaterial = { shows: [], songs: [song("railgun", 40), song("eternal", 12)] };
    const { questions } = buildDailyPuzzle(thin, "2026-03-14");
    expect(questions.every((question) => question.type === "more_performed")).toBe(true);
    expect(questions.length).toBeLessThan(QUESTIONS_PER_PUZZLE);
  });

  it("returns an empty puzzle rather than throwing on an empty archive", () => {
    expect(buildDailyPuzzle({ shows: [], songs: [] }, "2026-03-14").questions).toEqual([]);
  });

  it("accepts only the stored answer index", () => {
    const [question] = buildDailyPuzzle(material, "2026-03-14").questions;
    expect(isCorrect(question, question.answer)).toBe(true);
    expect(isCorrect(question, question.answer === 0 ? 1 : 0)).toBe(false);
    expect(isCorrect(question, -1)).toBe(false);
    expect(isCorrect(question, optionCount(question))).toBe(false);
    expect(isCorrect(question, 1.5)).toBe(false);
  });
});
