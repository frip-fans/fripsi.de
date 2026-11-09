import { buildDailyPuzzle, isCorrect, type DailyPuzzle, type QuizMaterial, type QuizShow } from "./setlist-quiz";

/** Per-question tally across every browser that answered today. */
export interface QuizQuestionStats {
  answered: number;
  correct: number;
}

export interface QuizProgress {
  /** Choice index per question, or null where the player has not answered yet. */
  choices: Array<number | null>;
  score: number;
  answered: number;
}

interface ShowRow {
  event_slug: string;
  event_title: string;
  start_date: string;
  setlist_id: string;
}

interface EntryRow {
  setlist_id: string;
  slug: string;
  title: string;
  section: string;
}

interface SongRow {
  slug: string;
  title: string;
  performance_count: number;
}

const ENCORE_SECTIONS = new Set(["encore", "double_encore"]);

/**
 * Material for question generation.
 *
 * Shows are restricted to events with exactly one published setlist that is marked
 * complete and sourced officially or by report: "this show" has to name one setlist
 * unambiguously, and only a complete setlist makes "was not performed" a fact rather
 * than a gap in the records.
 */
export async function loadQuizMaterial(db: D1Database): Promise<QuizMaterial> {
  const shows = await db.prepare(`
    SELECT e.slug AS event_slug, e.title AS event_title, e.start_date, sl.id AS setlist_id
    FROM setlists sl
    JOIN events e ON e.id = sl.event_id
    WHERE sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL
      AND sl.completeness = 'complete' AND sl.confidence IN ('official', 'reported')
      AND (SELECT COUNT(*) FROM setlists other WHERE other.event_id = e.id AND other.published = 1) = 1
    ORDER BY e.start_date, sl.id
  `).all<ShowRow>();

  const entries = shows.results.length === 0
    ? { results: [] as EntryRow[] }
    : await db.prepare(`
      SELECT se.setlist_id, s.slug, s.title, se.section
      FROM setlist_entries se
      JOIN songs s ON s.id = se.song_id AND s.published = 1
      JOIN setlists sl ON sl.id = se.setlist_id
      JOIN events e ON e.id = sl.event_id
      WHERE sl.published = 1 AND e.published = 1 AND e.archived_at IS NULL
        AND sl.completeness = 'complete' AND sl.confidence IN ('official', 'reported')
      ORDER BY se.setlist_id, se.position
    `).all<EntryRow>();

  // A song can appear twice in one night (medley reprises); keep one entry per song and
  // let any encore appearance win, since the encore question asks where it turned up.
  const bySetlist = new Map<string, Map<string, { slug: string; title: string; encore: boolean }>>();
  for (const entry of entries.results) {
    const songs = bySetlist.get(entry.setlist_id) ?? new Map();
    const existing = songs.get(entry.slug);
    songs.set(entry.slug, {
      slug: entry.slug,
      title: entry.title,
      encore: (existing?.encore ?? false) || ENCORE_SECTIONS.has(entry.section),
    });
    bySetlist.set(entry.setlist_id, songs);
  }

  // The same count the song pages show, so a quiz answer never contradicts the site.
  const songs = await db.prepare(`
    SELECT s.slug, s.title,
      (SELECT COUNT(*)
        FROM setlist_entries se
        JOIN setlists sl ON sl.id = se.setlist_id AND sl.published = 1
        JOIN events e ON e.id = sl.event_id AND e.published = 1 AND e.archived_at IS NULL
        WHERE se.song_id = s.id) AS performance_count
    FROM songs s
    WHERE s.published = 1
    ORDER BY s.slug
  `).all<SongRow>();

  const quizShows: QuizShow[] = shows.results.map((row) => ({
    event_slug: row.event_slug,
    event_title: row.event_title,
    start_date: row.start_date,
    songs: [...(bySetlist.get(row.setlist_id)?.values() ?? [])],
  }));

  return { shows: quizShows, songs: songs.results };
}

/**
 * Today's puzzle, generated on first request and reused afterwards. Storing it keeps a
 * question index meaning the same thing for everyone even after new setlists land.
 */
export async function getOrCreatePuzzle(db: D1Database, date: string, now = new Date()): Promise<DailyPuzzle> {
  const stored = await db.prepare("SELECT questions_json FROM quiz_puzzles WHERE puzzle_date = ?")
    .bind(date).first<{ questions_json: string }>();
  if (stored) return { date, questions: JSON.parse(stored.questions_json) };

  const puzzle = buildDailyPuzzle(await loadQuizMaterial(db), date);
  // A racing request may have stored the same deterministic puzzle first; keep theirs.
  await db.prepare("INSERT OR IGNORE INTO quiz_puzzles (puzzle_date, questions_json, created_at) VALUES (?, ?, ?)")
    .bind(date, JSON.stringify(puzzle.questions), now.toISOString()).run();

  const current = await db.prepare("SELECT questions_json FROM quiz_puzzles WHERE puzzle_date = ?")
    .bind(date).first<{ questions_json: string }>();
  return { date, questions: current ? JSON.parse(current.questions_json) : puzzle.questions };
}

export async function getPuzzleStats(db: D1Database, date: string): Promise<Map<number, QuizQuestionStats>> {
  const result = await db.prepare(`
    SELECT question_index, COUNT(*) AS answered, SUM(correct) AS correct
    FROM quiz_answers WHERE puzzle_date = ? GROUP BY question_index
  `).bind(date).all<{ question_index: number; answered: number; correct: number }>();
  return new Map(result.results.map((row) => [row.question_index, { answered: row.answered, correct: row.correct ?? 0 }]));
}

export async function getPlayerProgress(db: D1Database, date: string, playerId: string, questionCount: number): Promise<QuizProgress> {
  const result = await db.prepare("SELECT question_index, choice, correct FROM quiz_answers WHERE puzzle_date = ? AND player_id = ?")
    .bind(date, playerId).all<{ question_index: number; choice: number; correct: number }>();
  const choices: Array<number | null> = Array.from({ length: questionCount }, () => null);
  let score = 0;
  for (const row of result.results) {
    if (row.question_index < questionCount) choices[row.question_index] = row.choice;
    score += row.correct;
  }
  return { choices, score, answered: result.results.filter((row) => row.question_index < questionCount).length };
}

export interface RecordedAnswer {
  correct: boolean;
  /** The stored choice, which stays the first one submitted for this question. */
  choice: number;
  stats: QuizQuestionStats;
}

/**
 * Record one answer. The first submission for a question stands: without that, a player
 * could resubmit until correct and both their score and the site-wide rate would be junk.
 */
export async function recordAnswer(
  db: D1Database,
  date: string,
  questionIndex: number,
  playerId: string,
  choice: number,
  now = new Date(),
): Promise<RecordedAnswer | null> {
  const puzzle = await getOrCreatePuzzle(db, date, now);
  const question = puzzle.questions[questionIndex];
  if (!question) return null;

  const correct = isCorrect(question, choice);
  await db.prepare(`
    INSERT OR IGNORE INTO quiz_answers (puzzle_date, question_index, player_id, choice, correct, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(date, questionIndex, playerId, choice, correct ? 1 : 0, now.toISOString()).run();

  const stored = await db.prepare(`
    SELECT choice, correct FROM quiz_answers WHERE puzzle_date = ? AND question_index = ? AND player_id = ?
  `).bind(date, questionIndex, playerId).first<{ choice: number; correct: number }>();

  const stats = (await getPuzzleStats(db, date)).get(questionIndex) ?? { answered: 0, correct: 0 };
  return { correct: (stored?.correct ?? 0) === 1, choice: stored?.choice ?? choice, stats };
}
