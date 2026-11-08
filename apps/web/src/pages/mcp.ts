import type { APIRoute } from "astro";
import { handleMcp } from "#runtime-mcp";
export const ALL: APIRoute = ({ request }) => handleMcp(request);
