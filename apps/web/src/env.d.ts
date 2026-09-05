/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { Actor } from "@frip-fan/core";

declare global {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    SITE_URL?: string;
    APP_ENV?: string;
    MAP_TILE_URL?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    ADMIN_PUBLISHERS?: string;
    DEV_AUTH_BYPASS?: string;
    DEV_ACTOR?: string;
  }

  namespace App {
    interface Locals {
      actor?: Actor;
    }
  }
}

export {};
