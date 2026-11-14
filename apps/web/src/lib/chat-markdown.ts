/**
 * Renders the Markdown an assistant reply uses into HTML for the chat dock, on the
 * server and in the browser alike. The reply is model output, so nothing in it is
 * trusted: every character is escaped first and only the tags written here come out.
 * Links are limited to http(s). This is a deliberately small subset (what chat replies
 * actually contain), not a CommonMark implementation.
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
  | { kind: "raw"; html: string };

export function renderChatMarkdown(source: string): string {
  const blocks: Block[] = [];
  let open: Block | null = null;
  const close = () => { open = null; };
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = /^\s*```/.test(line);
    if (fence) {
      const body: string[] = [];
      // An unclosed fence (a reply still streaming) runs to the end of the text.
      for (index++; index < lines.length && !/^\s*```\s*$/.test(lines[index]!); index++) body.push(lines[index]!);
      blocks.push({ kind: "raw", html: `<pre><code>${escapeHtml(body.join("\n"))}</code></pre>` });
      close();
      continue;
    }
    if (!line.trim()) { close(); continue; }
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (heading) { blocks.push({ kind: "raw", html: `<h4>${inline(heading[1]!)}</h4>` }); close(); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ kind: "raw", html: "<hr>" }); close(); continue; }
    const bullet = /^\s*[-*+•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const current: Block | null = open;
      if (current?.kind === "list" && current.ordered === ordered) current.items.push([bullet ? bullet[1]! : numbered![2]!]);
      else {
        open = { kind: "list", ordered, start: numbered ? Number(numbered[1]) : 1, items: [[bullet ? bullet[1]! : numbered![2]!]] };
        blocks.push(open);
      }
      continue;
    }
    const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    const kind = quote ? "quote" : "paragraph";
    const text = quote ? quote[1]! : line.trim();
    const current: Block | null = open;
    // A plain line right under a list item continues that item, as models write it.
    if (!quote && current?.kind === "list") { current.items.at(-1)!.push(text); continue; }
    if (current && current.kind === kind) { (current as { lines: string[] }).lines.push(text); continue; }
    open = { kind, lines: [text] };
    blocks.push(open);
  }
  const joined = (parts: string[]) => parts.map(inline).join("<br>");
  return blocks.map((block) => {
    if (block.kind === "raw") return block.html;
    if (block.kind === "list") {
      const items = block.items.map((item) => `<li>${joined(item)}</li>`).join("");
      return block.ordered ? `<ol${block.start !== 1 ? ` start="${block.start}"` : ""}>${items}</ol>` : `<ul>${items}</ul>`;
    }
    return block.kind === "quote" ? `<blockquote>${joined(block.lines)}</blockquote>` : `<p>${joined(block.lines)}</p>`;
  }).join("");
}
