export type SetlistSection = "main" | "encore" | "double_encore" | "opening" | "other";

export interface PasteSong { id: string; title: string; aliases?: string | null }
export interface PasteVersion { id: string; song_id: string; title: string }

export interface PastedEntry {
  line: string;
  section: SetlistSection;
  songId: string | null;
  versionId: string | null;
  /** exact: title/alias/version match; loose: the only song containing the text; none: needs a manual pick. */
  match: "exact" | "loose" | "none";
}

/** Folds width, case, spacing and dash/quote variants so "Only my Railgun" matches "only my railgun". */
export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[‐‑‒–—―ー〜~～・･'"“”‘’`´「」『』()（）［］[\]【】]/g, "")
    .replace(/-/g, "");
}

const SECTION_MARKERS: Array<[RegExp, SetlistSection]> = [
  [/^(?:-+\s*)?(?:w|double|ダブル)\s*(?:アンコール|encore|en)(?:\s*-+)?$/i, "double_encore"],
  [/^(?:-+\s*)?(?:アンコール|encore|en)(?:\s*-+)?$/i, "encore"],
  [/^(?:-+\s*)?(?:本編|本篇|main)(?:\s*-+)?$/i, "main"],
  [/^(?:-+\s*)?(?:opening|オープニング|开场)(?:\s*-+)?$/i, "opening"],
];

/** "01. sky", "M-3 sky", "EN2) sky" → "sky"; a title such as "1983-schwarzesmarken-" is tried unstripped first. */
function stripNumbering(line: string): string {
  return line.replace(/^\s*(?:m|en|e|#)?\s*-?\s*\d{1,2}\s*(?:[.)、:：]|\s-\s|\s)\s*/i, "").trim();
}

export function createSetlistMatcher(songs: PasteSong[], versions: PasteVersion[]) {
  const byVersion = new Map<string, PasteVersion>();
  for (const version of versions) {
    const key = normalizeTitle(version.title);
    if (key && !byVersion.has(key)) byVersion.set(key, version);
  }
  const bySong = new Map<string, PasteSong>();
  for (const song of songs) {
    for (const name of [song.title, ...(song.aliases ?? "").split("\n")]) {
      const key = normalizeTitle(name);
      if (key && !bySong.has(key)) bySong.set(key, song);
    }
  }
  const versionCount = new Map<string, PasteVersion[]>();
  for (const version of versions) versionCount.set(version.song_id, [...(versionCount.get(version.song_id) ?? []), version]);

  const exact = (text: string): Pick<PastedEntry, "songId" | "versionId"> | null => {
    const key = normalizeTitle(text);
    if (!key) return null;
    const song = bySong.get(key);
    if (song) {
      const only = versionCount.get(song.id);
      return { songId: song.id, versionId: only?.length === 1 ? only[0].id : null };
    }
    const version = byVersion.get(key);
    return version ? { songId: version.song_id, versionId: version.id } : null;
  };

  const loose = (text: string): string | null => {
    const key = normalizeTitle(text);
    if (key.length < 4) return null;
    const hits = songs.filter((song) => {
      const title = normalizeTitle(song.title);
      return title.includes(key) || (title.length >= 4 && key.includes(title));
    });
    return hits.length === 1 ? hits[0].id : null;
  };

  return (text: string): PastedEntry[] => {
    let section: SetlistSection = "main";
    const entries: PastedEntry[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const marker = SECTION_MARKERS.find(([pattern]) => pattern.test(line));
      if (marker) { section = marker[1]; continue; }
      const stripped = stripNumbering(line);
      const hit = exact(line) ?? (stripped !== line ? exact(stripped) : null);
      if (hit) { entries.push({ line: stripped || line, section, ...hit, match: "exact" }); continue; }
      const songId = loose(stripped || line);
      if (songId) {
        const only = versionCount.get(songId);
        entries.push({ line: stripped || line, section, songId, versionId: only?.length === 1 ? only[0].id : null, match: "loose" });
        continue;
      }
      entries.push({ line: stripped || line, section, songId: null, versionId: null, match: "none" });
    }
    return entries;
  };
}
