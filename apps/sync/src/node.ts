import { openDatabase } from "@frip-fan/node-runtime";
import { tick, type SyncEnv } from "./index";
import { safeTickNotifications } from "./notifications";

async function main() {
  if (process.env.SYNC_ENABLED !== "true" && process.env.SYNC_EVAL_ENABLED !== "true" && process.env.BARK_ENABLED !== "true") {
    console.log("Official sync is disabled"); return;
  }
  if (!process.env.FRIP_DB_PATH) throw new Error("sync_database_path_missing");
  const store = openDatabase(process.env.FRIP_DB_PATH);
  const env = { ...process.env, DB: store.db } as SyncEnv;
  try {
    await safeTickNotifications(env);
    try { await tick(env); }
    finally { await safeTickNotifications(env); }
  } finally { store.close(); }
}
main().catch(() => { console.error("Official sync tick failed; see sanitized sync logs"); process.exitCode = 1; });
