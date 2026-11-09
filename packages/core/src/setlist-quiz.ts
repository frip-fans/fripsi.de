/**
 * Daily setlist quiz: deterministic question generation from the archive.
 *
 * Every player gets the same five questions on a given day, so a puzzle is built once
 * from a date seed and then stored. Questions carry structured facts rather than
 * sentences; each locale renders its own wording from those facts.
 *
 * Two data rules keep the answers honest:
 *  - "Was this song performed at this show?" only uses setlists marked complete, because
 *    a missing entry in a partial setlist means "not recorded", not "not performed".
 *  - "Which song was performed more?" uses the same performance count the song pages show,
 *    so an answer never contradicts a number the player can look up on the site.
 */

/** A show usable for questions that need to know a setlist is exhaustive. */
export interface QuizShow {
  event_slug: string;
  event_title: string;
  start_date: string;
  songs: Array<{ slug: string; title: string; encore: boolean }>;
}

/** A song with the site-wide performance count shown on song pages. */
export interface QuizSong {
  slug: string;
  title: string;
  performance_count: number;
}

export interface QuizMaterial {
  /** Complete, trusted setlists only. */
  shows: QuizShow[];
  /** Published songs, for distractors and count comparisons. */
  songs: QuizSong[];
}

export interface QuizChoice {
  slug: string;
  title: string;
}

interface QuizQuestionBase {
  /** Index of the correct entry in `options`. */
  answer: number;
}

/** Was this song on that night's setlist? Options are yes/no. */
export interface PerformedQuestion extends QuizQuestionBase {
  type: "performed";
  event: { slug: string; title: string; date: string };
  song: QuizChoice;
}

/** Which of these songs was in that night's encore? */
export interface EncoreQuestion extends QuizQuestionBase {
  type: "encore";
  event: { slug: string; title: string; date: string };
  options: QuizChoice[];
}

/** Which song has been performed more often across the archive? */
export interface MorePerformedQuestion extends QuizQuestionBase {
  type: "more_performed";
  options: QuizChoice[];
  /** Revealed with the result so the player can check the claim. */
  counts: number[];
}

export type QuizQuestion = PerformedQuestion | EncoreQuestion | MorePerformedQuestion;

export interface DailyPuzzle {
  /** Local puzzle day, `YYYY-MM-DD`. */
  date: string;
  questions: QuizQuestion[];
}

export const QUESTIONS_PER_PUZZLE = 5;

/** Fixed shape of a day's puzzle: easy opener, one show question, a harder close. */
const QUESTION_PLAN: QuizQuestion["type"][] = ["more_performed", "performed", "encore", "performed", "more_performed"];

/** Distractors and comparisons ignore songs the archive barely knows. */
const MIN_PERFORMANCES_FOR_COMPARISON = 3;

/**
 * A pair is only asked when one song clearly leads: the archive is incomplete in places,
 * and a one-performance gap would make the "right" answer a coin flip.
 */
const MIN_COUNT_GAP = 2;
const MIN_COUNT_RATIO = 1.25;

/** A show needs enough songs that excluding the setlist still leaves real distractors. */
const MIN_SONGS_PER_SHOW = 5;

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, stable across runtimes, good enough to shuffle a quiz. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(random() * items.length)];
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function toChoice(song: { slug: string; title: string }): QuizChoice {
  return { slug: song.slug, title: song.title };
}

function buildPerformed(material: QuizMaterial, random: () => number, usedShows: Set<string>): PerformedQuestion | null {
  const shows = material.shows.filter((show) => !usedShows.has(show.event_slug) && show.songs.length >= MIN_SONGS_PER_SHOW);
  const show = pick(shows, random);
  if (!show) return null;

  // Half the questions should answer "no", or players learn to always answer yes.
  const askPerformed = random() < 0.5;
  if (askPerformed) {
    const song = pick(show.songs, random);
    if (!song) return null;
    usedShows.add(show.event_slug);
    return {
      type: "performed",
      event: { slug: show.event_slug, title: show.event_title, date: show.start_date },
      song: toChoice(song),
      answer: 0,
    };
  }

  // A believable "no" is a song the band really plays, just not that night.
  const onSetlist = new Set(show.songs.map((song) => song.slug));
  const candidates = material.songs.filter(
    (song) => !onSetlist.has(song.slug) && song.performance_count >= MIN_PERFORMANCES_FOR_COMPARISON,
  );
  const song = pick(candidates, random);
  if (!song) return null;
  usedShows.add(show.event_slug);
  return {
    type: "performed",
    event: { slug: show.event_slug, title: show.event_title, date: show.start_date },
    song: toChoice(song),
    answer: 1,
  };
}

function buildEncore(material: QuizMaterial, random: () => number, usedShows: Set<string>): EncoreQuestion | null {
  const shows = material.shows.filter(
    (show) => !usedShows.has(show.event_slug) && show.songs.some((song) => song.encore) && show.songs.length >= MIN_SONGS_PER_SHOW,
  );
  const show = pick(shows, random);
  if (!show) return null;

  const encore = pick(show.songs.filter((song) => song.encore), random);
  if (!encore) return null;

  // Distractors must be absent from the whole setlist, not just the encore, so that
  // "it was in the main set" can never make a wrong option technically true.
  const onSetlist = new Set(show.songs.map((song) => song.slug));
  const candidates = material.songs.filter(
    (song) => !onSetlist.has(song.slug) && song.performance_count >= MIN_PERFORMANCES_FOR_COMPARISON,
  );
  if (candidates.length < 3) return null;

  const options = shuffle([toChoice(encore), ...shuffle(candidates, random).slice(0, 3).map(toChoice)], random);
  usedShows.add(show.event_slug);
  return {
    type: "encore",
    event: { slug: show.event_slug, title: show.event_title, date: show.start_date },
    options,
    answer: options.findIndex((option) => option.slug === encore.slug),
  };
}

function buildMorePerformed(material: QuizMaterial, random: () => number, usedPairs: Set<string>): MorePerformedQuestion | null {
  const pool = material.songs.filter((song) => song.performance_count >= MIN_PERFORMANCES_FOR_COMPARISON);
  if (pool.length < 2) return null;

  // Sampling pairs beats enumerating them: the catalog is large and most pairs are valid.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const first = pick(pool, random);
    const second = pick(pool, random);
    if (!first || !second || first.slug === second.slug) continue;

    const high = Math.max(first.performance_count, second.performance_count);
    const low = Math.min(first.performance_count, second.performance_count);
    if (high - low < MIN_COUNT_GAP || high < low * MIN_COUNT_RATIO) continue;

    const key = [first.slug, second.slug].sort().join("|");
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);

    const options = shuffle([first, second], random);
    return {
      type: "more_performed",
      options: options.map(toChoice),
      counts: options.map((song) => song.performance_count),
      answer: options[0].performance_count > options[1].performance_count ? 0 : 1,
    };
  }
  return null;
}

/**
 * Build the puzzle for one day. The same date and material always produce the same
 * questions, so every player sees the same five and answers stay comparable.
 * Types that the archive cannot support are skipped rather than faked, so a thin
 * archive yields a shorter puzzle instead of a wrong one.
 */
export function buildDailyPuzzle(material: QuizMaterial, date: string): DailyPuzzle {
  const random = createRandom(hashSeed(`frip-fan-quiz:${date}`));
  const usedShows = new Set<string>();
  const usedPairs = new Set<string>();
  const questions: QuizQuestion[] = [];

  for (const type of QUESTION_PLAN) {
    const question =
      type === "performed"
        ? buildPerformed(material, random, usedShows)
        : type === "encore"
          ? buildEncore(material, random, usedShows)
          : buildMorePerformed(material, random, usedPairs);
    if (question) questions.push(question);
  }

  return { date, questions };
}

/** Options a player can choose from, so the API can validate a submission. */
export function optionCount(question: QuizQuestion): number {
  return question.type === "performed" ? 2 : question.options.length;
}

export function isCorrect(question: QuizQuestion, choice: number): boolean {
  return Number.isInteger(choice) && choice >= 0 && choice < optionCount(question) && choice === question.answer;
}
