import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SEARCH_URL = "https://www.livefans.jp/search/artist/5610";
const OUTPUT_PATH = path.resolve("data/research/livefans-fripside-setlists.json");
const HEADERS = {
  "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
  "accept-language": "ja",
};

function decodeEntities(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function cleanText(value = "") {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[\u00a0\s]+/g, " ")
    .trim();
}

function inputValue(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...html.matchAll(new RegExp(`<input[^>]+name=["']${escapedName}["'][^>]+value=["']([^"']*)["'][^>]*>`, "gi"))];
  return cleanText(matches.map((match) => match[1]).find(Boolean) ?? "");
}

function parseTracks(html) {
  const blockStart = html.indexOf('<div class="setBlock');
  if (blockStart < 0) return [];

  const disclaimerStart = html.indexOf("※サイトの性質上", blockStart);
  const block = html.slice(blockStart, disclaimerStart > blockStart ? disclaimerStart : undefined);
  const rows = [];

  for (const match of block.matchAll(/<td class=["']pcsl(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)) {
    const position = Number(match[1]);
    const row = match[2];
    const titleBlock = row.match(/<div class=["']ttl["']>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const linkedTitle = titleBlock.match(/<a[^>]+href=["']\/songs\/\d+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const memo = cleanText(titleBlock.match(/<p class=["']memo["']>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const artistCredit = cleanText(titleBlock.match(/<span>([\s\S]*?)<\/span>/i)?.[1] ?? "")
      .replace(/^（|）$/g, "")
      .trim();
    const sectionNote = cleanText(row.match(/<div class=["']cmt before["']>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const title = cleanText(linkedTitle ?? titleBlock.replace(/<p class=["']memo["']>[\s\S]*?<\/p>/gi, ""));

    if (title) rows.push({ position, title, memo, artistCredit, sectionNote });
  }

  return rows.sort((a, b) => a.position - b.position);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function discoverEventIds() {
  const ids = new Set();

  for (let page = 1; page <= 7; page += 1) {
    const pathname = page === 1 ? SEARCH_URL : `${SEARCH_URL}/page:${page}`;
    const url = `${pathname}?setlist=on&sort=e1&year=before`;
    const html = await fetchText(url);
    for (const match of html.matchAll(/href=["'](?:https:\/\/www\.livefans\.jp)?\/events\/(\d+)["']/g)) {
      ids.add(match[1]);
    }
  }

  return [...ids];
}

async function main() {
  const eventIds = await discoverEventIds();
  const events = [];
  const failures = [];

  for (const [index, eventId] of eventIds.entries()) {
    const sourceUrl = `https://www.livefans.jp/events/${eventId}`;
    try {
      const html = await fetchText(sourceUrl);
      const date = inputValue(html, "data[event][holding_date]").replaceAll("/", "-");
      const artistNames = [...html.matchAll(/name=["']data\[event\]\[artist_name_\d+\]["'][^>]+value=["']([^"']*)["']/gi)]
        .map((match) => cleanText(match[1]));
      const tracks = parseTracks(html);

      if (date >= "2022-04-24" && artistNames.some((artist) => /fripSide/i.test(artist)) && tracks.length > 0) {
        events.push({
          eventId,
          date,
          title: inputValue(html, "data[event][live_name]") || inputValue(html, "data[event][tour]") || inputValue(html, "data[event][title]"),
          tour: inputValue(html, "data[event][tour]"),
          venue: inputValue(html, "data[event][place_name]"),
          artists: artistNames,
          sourceUrl,
          tracks,
        });
      }
    } catch (error) {
      failures.push({ eventId, sourceUrl, error: String(error) });
    }

    if ((index + 1) % 20 === 0) console.log(`已检查 ${index + 1}/${eventIds.length} 个页面`);
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId));
  const payload = {
    generatedAt: new Date().toISOString(),
    source: `${SEARCH_URL}?setlist=on&sort=e1&year=before`,
    disclaimer: "LiveFans 的公演与歌单内容由用户投稿，导入时应标记为 reported。",
    discoveredPageCount: eventIds.length,
    matchedPhase3EraCount: events.length,
    events,
    failures,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`写入 ${OUTPUT_PATH}`);
  console.log(`第三期时期歌单：${events.length} 场；失败：${failures.length} 场`);
}

await main();
