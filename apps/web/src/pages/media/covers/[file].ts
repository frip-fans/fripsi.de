import type { APIRoute } from "astro";
import { coverResponse } from "../../../lib/cover-response";
import { getEnv } from "../../../lib/env";

export const GET: APIRoute = ({ request, params }) => coverResponse(request, params.file, getEnv().MEDIA);
export const HEAD = GET;
