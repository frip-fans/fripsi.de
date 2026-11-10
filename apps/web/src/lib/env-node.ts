import { resolve } from "node:path";
import process from "node:process";
import { openDatabase, localMedia } from "@frip-fan/node-runtime";

let cached: Env | undefined;
export function getRuntimeEnv(): Env {
  if (cached) return cached;
  const data = resolve(process.env.FRIP_DATA_DIR || ".cache/self-hosted");
  const store = openDatabase(resolve(process.env.FRIP_DB_PATH || `${data}/site.sqlite`));
  const appEnv = process.env.APP_ENV || "production";
  const development = appEnv === "development" && process.env.NODE_ENV !== "production";
  cached = {
    DB: store.db,
    FRIP_RELEASE_SHA: process.env.FRIP_RELEASE_SHA,
    MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL,
    MCP_AUTHORIZATION_SERVER: process.env.MCP_AUTHORIZATION_SERVER,
    MCP_AUDIENCE: process.env.MCP_AUDIENCE,
    AUTOMATION_SIGNING_SECRET: process.env.AUTOMATION_SIGNING_SECRET,
    AUTOMATION_AUDIENCE: process.env.AUTOMATION_AUDIENCE,
    MCP_ENDPOINT_URL: process.env.MCP_ENDPOINT_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    CHAT_ENABLED: process.env.CHAT_ENABLED,
    CHAT_MODEL: process.env.CHAT_MODEL,
    CHAT_BUDGET_USD: process.env.CHAT_BUDGET_USD,
    MEDIA: localMedia(resolve(process.env.FRIP_MEDIA_DIR || `${data}/media`)),
    SITE_URL: process.env.SITE_URL || "http://localhost:4326",
    APP_ENV: appEnv,
    ACCESS_TEAM_DOMAIN: process.env.ACCESS_TEAM_DOMAIN,
    ACCESS_AUD: process.env.ACCESS_AUD,
    ADMIN_PUBLISHERS: process.env.ADMIN_PUBLISHERS,
    DEV_AUTH_BYPASS: development ? process.env.DEV_AUTH_BYPASS : "false",
    DEV_ACTOR: process.env.DEV_ACTOR,
    MAP_TILE_URL: process.env.MAP_TILE_URL,
  } as Env;
  return cached;
}
