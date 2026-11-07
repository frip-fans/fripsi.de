import type { APIRoute } from "astro";
import { archiveRedirectHref } from "../lib/calendar-navigation";

export const GET: APIRoute = ({ url, redirect }) => redirect(archiveRedirectHref(url), 301);
