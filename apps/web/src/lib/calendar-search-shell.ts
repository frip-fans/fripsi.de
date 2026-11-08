import { setupCalendar } from "./event-calendar-client";
import { setupEventSearch } from "./event-search-client";
function setupShell() {
  setupCalendar();
  setupEventSearch();
}
document.addEventListener("astro:page-load", setupShell);
setupShell();
