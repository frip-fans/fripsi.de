/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

import type { Actor } from "@frip-fan/core";

declare global {
  interface Env extends Pick<WebWorkerBindings, "DB" | "MEDIA"> {
    ASSETS?: WebWorkerBindings["ASSETS"];
    FRIP_RUNTIME?: "node";
    FRIP_RELEASE_SHA?: string;
    MCP_RESOURCE_URL?: string;
    MCP_AUTHORIZATION_SERVER?: string;
    MCP_AUDIENCE?: string;
    AUTOMATION_SIGNING_SECRET?: string;
    AUTOMATION_AUDIENCE?: string;
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
