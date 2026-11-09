import { openDatabase } from "@frip-fan/node-runtime";
import { scheduledTick, type SyncEnv } from "./index";

async function main() {
  if (process.env.SYNC_ENABLED !== "true" && process.env.SYNC_EVAL_ENABLED !== "true" && process.env.BARK_ENABLED !== "true") {
    console.log("Official sync is disabled"); return;
  }
  if (!process.env.FRIP_DB_PATH) throw new Error("sync_database_path_missing");
  const store = openDatabase(process.env.FRIP_DB_PATH);
  const env = { ...process.env, DB: store.db } as SyncEnv;
  try { await scheduledTick(env); }
  finally { store.close(); }
}
main().catch(() => { console.error("Official sync tick failed; see sanitized sync logs"); process.exitCode = 1; });
