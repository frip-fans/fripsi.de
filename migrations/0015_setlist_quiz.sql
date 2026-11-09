-- Daily setlist quiz. A day's questions are generated once and then stored, so every
-- player answers the same five and per-question statistics stay comparable.
CREATE TABLE quiz_puzzles (
  puzzle_date TEXT PRIMARY KEY,
  questions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(puzzle_date) = 10)
);

-- One row per browser per question. `player_id` is an anonymous cookie, so this limits
-- repeat answers within a browser and nothing more; it is not a per-person guarantee.
CREATE TABLE quiz_answers (
  puzzle_date TEXT NOT NULL REFERENCES quiz_puzzles(puzzle_date) ON DELETE CASCADE,
  question_index INTEGER NOT NULL CHECK (question_index >= 0),
  player_id TEXT NOT NULL,
  choice INTEGER NOT NULL CHECK (choice >= 0),
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (puzzle_date, question_index, player_id)
);

CREATE INDEX quiz_answers_player ON quiz_answers (player_id, puzzle_date);
