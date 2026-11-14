/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { Actor, ChatMediaStore } from "@frip-fan/core";

declare global {
  // DB and MEDIA keep the D1/R2 interface shapes; packages/node-runtime implements them with SQLite and a local directory.
  interface Env {
    DB: D1Database;
    MEDIA: R2Bucket;
    CHAT_MEDIA: ChatMediaStore;
    FRIP_RELEASE_SHA?: string;
    MCP_RESOURCE_URL?: string;
    MCP_AUTHORIZATION_SERVER?: string;
    MCP_AUDIENCE?: string;
    AUTOMATION_SIGNING_SECRET?: string;
    AUTOMATION_AUDIENCE?: string;
    MCP_ENDPOINT_URL?: string;
    OPENAI_API_KEY?: string;
    CHAT_ENABLED?: string;
    BACKUP_STATUS_FILE?: string;
    SITE_URL?: string;
    APP_ENV?: string;
    MAP_TILE_URL?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    ADMIN_PUBLISHERS?: string;
    DEV_AUTH_BYPASS?: string;
    DEV_ACTOR?: string;
    COMMENT_SOURCE_SECRET?: string;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
  }

  namespace App {
    interface Locals {
      actor?: Actor;
    }
  }
}

export {};
