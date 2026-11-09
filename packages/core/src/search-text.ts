import { CJK_VARIANT_SOURCE, CJK_VARIANT_TARGET } from "./cjk-variants";

/**
 * Locale-tolerant text matching shared by every search box (server and browser).
 *
 * Both the searched text and the query are folded the same way:
 * NFKC (full-width ↔ half-width, compatibility forms) → lower case → katakana → hiragana
 * → Japanese / Traditional / Simplified Chinese character variants → one Simplified form,
 * and whitespace, punctuation and symbols are dropped. So 「横滨」 finds 「横浜アリーナ」,
 * 「ＬＥＶＥＬ５」 finds 「LEVEL5」 and 「せなせな」 finds 「せな★せな」.
 */

let variants: Map<string, string> | undefined;
function variantMap(): Map<string, string> {
  if (!variants) {
    const source = [...CJK_VARIANT_SOURCE];
    const target = [...CJK_VARIANT_TARGET];
    variants = new Map(source.map((char, index) => [char, target[index]!]));
  }
  return variants;
}

const DROPPED = /[\s\p{P}\p{S}]+/gu;
/** Folded fields and terms contain no whitespace, so a space keeps a term from matching across two fields (and is safe in HTML attributes). */
const FIELD_SEPARATOR = " ";

export function foldSearchText(value: string): string {
  const map = variantMap();
  let folded = "";
  for (const char of value.normalize("NFKC").toLowerCase()) {
    const code = char.codePointAt(0)!;
    folded += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : map.get(char) ?? char;
  }
  return folded.replace(DROPPED, "");
}

/** Fold each field and join them into one matchable string. */
export function buildSearchText(fields: Iterable<string | null | undefined>): string {
  const parts: string[] = [];
  for (const field of fields) {
    if (!field) continue;
    const folded = foldSearchText(field);
    if (folded) parts.push(folded);
  }
  return parts.join(FIELD_SEPARATOR);
}

/** Split a query on whitespace into folded terms; terms that fold to nothing (only symbols) are ignored. */
export function searchTerms(query: string): string[] {
  return [...new Set(query.split(/\s+/).map(foldSearchText).filter(Boolean))];
}

/** Every term must appear in the folded text. No terms matches everything. */
export function matchesSearchTerms(searchText: string, terms: readonly string[]): boolean {
  return terms.every(term => searchText.includes(term));
}

/**
 * Predicate over folded search text. A blank query matches everything; a query made only of
 * symbols (e.g. "%") has nothing searchable and matches nothing.
 */
export function searchMatcher(query: string): (searchText: string) => boolean {
  if (!query.trim()) return () => true;
  const terms = searchTerms(query);
  return terms.length ? searchText => matchesSearchTerms(searchText, terms) : () => false;
}

export function matchesSearch(fields: Iterable<string | null | undefined>, query: string): boolean {
  return searchMatcher(query)(buildSearchText(fields));
}

/** Words people use for each event category in the site's languages, so 「演唱会」 or 「ライブ」 finds Live events. */
export const EVENT_CATEGORY_SEARCH_TERMS: Record<string, readonly string[]> = {
  LIVE: ["Live", "ライブ", "演出", "演唱会", "公演", "现场"],
  EVENT: ["Event", "イベント", "活动"],
  RELEASE: ["Release", "リリース", "発売", "发售", "发行"],
  MEDIA: ["Media", "メディア", "媒体", "番組", "节目"],
  OTHER: ["Other", "その他", "其他"],
};

/** Labels the site shows for the two live classifications in every locale. */
export const LIVE_CLASSIFICATION_SEARCH_TERMS: Record<string, readonly string[]> = {
  专场: ["专场", "单独公演", "単独公演", "ワンマン", "Solo concert", "Solo show"],
  拼盘: ["拼盘", "节庆", "合同イベント", "フェス", "Festival", "Joint event", "Joint show"],
};

export function eventLabelSearchTerms(category: string | null | undefined, classification: string | null | undefined): string[] {
  return [
    ...(category ? EVENT_CATEGORY_SEARCH_TERMS[category] ?? [] : []),
    ...(classification ? LIVE_CLASSIFICATION_SEARCH_TERMS[classification] ?? [] : []),
  ];
}
