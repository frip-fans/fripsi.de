import { listSetlistsForYear } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { getEnv } from "../../../lib/env";

export const GET: APIRoute = async ({ request }) => {
  const year = new URL(request.url).searchParams.get("year") ?? "";
  if (!/^\d{4}$/.test(year)) {
    return Response.json({ error: "invalid_year" }, { status: 400 });
  }

  try {
    const setlists = await listSetlistsForYear(getEnv().DB, year);
    return Response.json(
      { year, setlists },
      {
        headers: {
          "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    console.error(JSON.stringify({
      message: "public setlist year query failed",
      year,
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json({ error: "setlist_query_failed" }, { status: 500 });
  }
};
