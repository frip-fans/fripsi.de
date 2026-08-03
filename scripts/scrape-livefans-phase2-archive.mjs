import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SEARCH_URL = "https://www.livefans.jp/search/artist/5610";
const [
  START_DATE = "2017-01-01",
  END_DATE = "2022-04-24",
  outputPath = "data/research/livefans-fripside-phase2-archive.json",
] = process.argv.slice(2);
const OUTPUT_PATH = path.resolve(outputPath);
const HEADERS = {
  "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
  "accept-language": "ja",
};

function decodeEntities(value = "") {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function cleanText(value = "") {
  return decodeEntities(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
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

  return rows.sort((left, right) => left.position - right.position);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function discoverEventIds() {
  const ids = new Set();
  for (let page = 1; page <= 20; page += 1) {
    const pathname = page === 1 ? SEARCH_URL : `${SEARCH_URL}/page:${page}`;
    const html = await fetchText(`${pathname}?sort=e1&year=before`);
    const pageIds = [...new Set([...html.matchAll(/href=["'](?:https:\/\/www\.livefans\.jp)?\/events\/(\d+)["']/g)]
      .map((match) => match[1]))];
    if (pageIds.length === 0) break;
    pageIds.forEach((id) => ids.add(id));
  }
  return [...ids];
}

async function inspectEvent(eventId) {
  const sourceUrl = `https://www.livefans.jp/events/${eventId}`;
  const html = await fetchText(sourceUrl);
  const date = inputValue(html, "data[event][holding_date]").replaceAll("/", "-");
  if (date < START_DATE || date > END_DATE) return null;
  const artists = [...new Set([...html.matchAll(/name=["']data\[event\]\[artist_name_\d+\]["'][^>]+value=["']([^"']*)["']/gi)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean))];
  if (!artists.some((artist) => /^fripSide$/i.test(artist))) return null;

  return {
    eventId,
    date,
    startTime: inputValue(html, "data[event][holding_time]").slice(0, 5),
    openTime: "",
    title: inputValue(html, "data[event][live_name]") || inputValue(html, "data[event][title]"),
    tour: inputValue(html, "data[event][tour]"),
    venue: inputValue(html, "data[event][place_name]"),
    prefecture: inputValue(html, "data[event][prefecture_name]"),
    artists,
    sourceUrl,
    tracks: parseTracks(html),
  };
}

async function main() {
  const ids = await discoverEventIds();
  const events = [];
  const failures = [];
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const index = cursor;
      cursor += 1;
      const eventId = ids[index];
      try {
        const event = await inspectEvent(eventId);
        if (event) events.push(event);
      } catch (error) {
        failures.push({ eventId, sourceUrl: `https://www.livefans.jp/events/${eventId}`, error: String(error) });
      }
      if ((index + 1) % 20 === 0) console.log(`已检查 ${index + 1}/${ids.length} 个页面`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  events.sort((left, right) => left.date.localeCompare(right.date) || left.eventId.localeCompare(right.eventId));
  const payload = {
    generatedAt: new Date().toISOString(),
    source: `${SEARCH_URL}?sort=e1&year=before`,
    range: { start: START_DATE, end: END_DATE },
    disclaimer: "LiveFans 的公演与歌单内容由用户投稿；活动事实需尽量与官方资料交叉核对，歌单按 reported 处理。",
    discoveredEventCount: ids.length,
    matchedEventCount: events.length,
    matchedSetlistCount: events.filter((event) => event.tracks.length > 0).length,
    events,
    failures,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`写入 ${OUTPUT_PATH}`);
  console.log(`匹配演出 ${events.length} 场；含歌单 ${payload.matchedSetlistCount} 场；失败 ${failures.length} 场`);
}

await main();
