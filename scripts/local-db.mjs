#!/usr/bin/env node
// Local development database (SQLite) used by `npm run dev:web`.
//   node scripts/local-db.mjs migrate        apply pending migrations/*.sql
//   node scripts/local-db.mjs seed           load scripts/seed.sql
//   node scripts/local-db.mjs import <file>  run a generated import SQL file
// The default path matches the dev server's default (apps/web/.cache/self-hosted/site.sqlite);
// set FRIP_DB_PATH to an absolute path to use another file. Never point this at a host database:
// deployments apply migrations through ops/oci/migrate.py instead.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "..");
const dbPath = resolve(process.env.FRIP_DB_PATH || join(root, "apps/web/.cache/self-hosted/site.sqlite"));
const [command, file] = process.argv.slice(2);

function open() {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  // Same bookkeeping table and format as the hosts, so a local file can be compared with them.
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  return db;
}

function inTransaction(db, sql, after) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sql);
    after?.();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrate(db) {
  const directory = join(root, "migrations");
  const done = new Set(db.prepare("SELECT name FROM d1_migrations").all().map((row) => row.name));
  const pending = readdirSync(directory).filter((name) => name.endsWith(".sql") && !done.has(name)).sort();
  for (const name of pending) {
    inTransaction(db, readFileSync(join(directory, name), "utf8"), () => db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name));
    console.log(`Applied ${name}`);
  }
  if (!pending.length) console.log("Schema is up to date");
}

function run(db, path) {
  inTransaction(db, readFileSync(resolve(path), "utf8"));
  console.log(`Executed ${path}`);
}

const usage = "Usage: node scripts/local-db.mjs migrate | seed | import <file.sql>";
if (!["migrate", "seed", "import"].includes(command) || (command === "import" && !file)) {
  console.error(usage);
  process.exit(1);
}
const db = open();
try {
  if (command === "migrate") migrate(db);
  else run(db, command === "seed" ? join(root, "scripts/seed.sql") : file);
  console.log(`Database: ${dbPath}`);
} finally {
  db.close();
}
