/**
 * The small Markdown subset the site renders: event descriptions on public pages and
 * assistant replies in the admin chat dock, on the server and in the browser alike.
 * The source is maintainer, agent or model text, so nothing in it is trusted: every
 * character is escaped first and only the tags written here come out. Links are limited
 * to http(s). This is deliberately not a CommonMark implementation.
 *
 * Imported as `@frip-fan/core/markdown` so browser bundles take this file alone.
 */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

const link = (href: string, label: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

/** Emphasis and links inside already-escaped text that holds no code span. */
function emphasis(escaped: string): string {
  // One pass for both link forms, so a bare URL inside a Markdown link is not linked twice.
  const linked = escaped.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]*[^\s<.,;:!?。，；：！？、）)」』】"'])/g,
    (match, label: string | undefined, target: string | undefined, bare: string | undefined) =>
      bare ? link(bare, bare) : target ? link(target, label!) : match);
  // Tags produced above are skipped: their URLs may contain asterisks or underscores.
  return linked.split(/(<a [^>]*>.*?<\/a>)/g).map((part, index) => index % 2 ? part : part
    .replace(/\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![*\w])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\w])/g, "<em>$1</em>")).join("");
}

function inline(text: string): string {
  // Code spans are taken out first so their contents are never read as emphasis.
  return escapeHtml(text).split(/(`[^`\n]+`)/g)
    .map((part, index) => index % 2 ? `<code>${part.slice(1, -1)}</code>` : emphasis(part)).join("");
}

type Block =
  | { kind: "paragraph" | "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; start: number; items: string[][] }
  | { kind: "heading"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  // Held in an object: a `let` assigned inside the loop body narrows to `never` here.
  const state: { open: Block | null } = { open: null };
  const close = () => { state.open = null; };
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = /^\s*```/.test(line);
    if (fence) {
      const body: string[] = [];
      // An unclosed fence (a reply still streaming) runs to the end of the text.
      for (index++; index < lines.length && !/^\s*```\s*$/.test(lines[index]!); index++) body.push(lines[index]!);
      blocks.push({ kind: "code", text: body.join("\n") });
      close();
      continue;
    }
    if (!line.trim()) { close(); continue; }
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (heading) { blocks.push({ kind: "heading", text: heading[1]! }); close(); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ kind: "rule" }); close(); continue; }
    const bullet = /^\s*[-*+•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const current = state.open;
      if (current?.kind === "list" && current.ordered === ordered) current.items.push([bullet ? bullet[1]! : numbered![2]!]);
      else {
        state.open = { kind: "list", ordered, start: numbered ? Number(numbered[1]) : 1, items: [[bullet ? bullet[1]! : numbered![2]!]] };
        blocks.push(state.open);
      }
      continue;
    }
    const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    const kind = quote ? "quote" : "paragraph";
    const text = quote ? quote[1]! : line.trim();
    const current = state.open;
    // A plain line right under a list item continues that item, as models write it.
    if (!quote && current?.kind === "list") { current.items.at(-1)!.push(text); continue; }
    if (current && current.kind === kind) { current.lines.push(text); continue; }
    state.open = { kind, lines: [text] };
    blocks.push(state.open);
  }
  return blocks;
}

/** `heading` is the tag every heading level becomes; the page decides where it sits in its outline. */
export function renderMarkdown(source: string, options: { heading?: "h2" | "h3" | "h4" } = {}): string {
  const heading = options.heading ?? "h4";
  const joined = (parts: string[]) => parts.map(inline).join("<br>");
  return parseBlocks(source).map((block) => {
    if (block.kind === "heading") return `<${heading}>${inline(block.text)}</${heading}>`;
    if (block.kind === "code") return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    if (block.kind === "rule") return "<hr>";
    if (block.kind === "list") {
      const items = block.items.map((item) => `<li>${joined(item)}</li>`).join("");
      return block.ordered ? `<ol${block.start !== 1 ? ` start="${block.start}"` : ""}>${items}</ol>` : `<ul>${items}</ul>`;
    }
    return block.kind === "quote" ? `<blockquote>${joined(block.lines)}</blockquote>` : `<p>${joined(block.lines)}</p>`;
  }).join("");
}

function plainInline(text: string, links: "label" | "url"): string {
  return text.split(/(`[^`\n]+`)/g).map((part, index) => index % 2 ? part.slice(1, -1) : part
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, target: string) => links === "url" ? `${label} ${target}` : label)
    .replace(/\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g, "$1")
    .replace(/(?<![*\w])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![*\w])/g, "$1")).join("");
}

/**
 * The same source without its markup, for places that show plain text: calendar feeds,
 * search and page metadata. `links: "url"` keeps a link's address after its label, for
 * readers who cannot follow one otherwise.
 */
export function markdownToText(source: string, options: { links?: "label" | "url" } = {}): string {
  const plain = (text: string) => plainInline(text, options.links ?? "label");
  return parseBlocks(source).flatMap((block) => {
    if (block.kind === "rule") return [];
    if (block.kind === "heading") return [plain(block.text)];
    if (block.kind === "code") return [block.text];
    if (block.kind === "list") {
      return [block.items.map((item, index) => `${block.ordered ? `${block.start + index}.` : "・"}${block.ordered ? " " : ""}${item.map(plain).join("\n")}`).join("\n")];
    }
    return [block.lines.map(plain).join("\n")];
  }).join("\n\n");
}
