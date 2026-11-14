/** Loads a comment thread, posts new comments and replies, and keeps the form usable by keyboard. */
interface Comment { id: number; name: string; body: string; created_at: string; replies?: Comment[] }
interface Page { comments: Comment[]; next_before: number | null; total: number }
interface Turnstile {
  render(target: HTMLElement, options: Record<string, unknown>): string;
  reset(widget: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

const NAME_KEY = "frip:comment-name";
const ERROR_LABELS: Record<string, string> = {
  invalid_name: "errorName", invalid_body: "errorBody", rate_limited: "errorRateLimited", duplicate: "errorDuplicate",
  rejected: "errorRejected", busy: "errorBusy", verification_failed: "errorVerification", invalid_parent: "errorParent",
};
let turnstileScript: Promise<void> | undefined;

function loadTurnstile(): Promise<void> {
  turnstileScript ??= new Promise((resolve, reject) => {
    if (window.turnstile) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { turnstileScript = undefined; reject(new Error("turnstile unavailable")); };
    document.head.appendChild(script);
  });
  return turnstileScript;
}

/** A steady colour per nickname, so a thread is easier to follow without accounts. */
function hue(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) % 360;
  return hash;
}

function mount(root: HTMLElement): void {
  const thread = root.dataset.thread!;
  const locale = root.dataset.locale || "zh-CN";
  const siteKey = root.dataset.turnstileKey || "";
  const labels = JSON.parse(root.dataset.labels || "{}") as Record<string, string>;
  const label = (key: string, values: Record<string, string | number> = {}) =>
    (labels[key] ?? "").replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const form = find<HTMLFormElement>("[data-comment-form]");
  const nameInput = form.elements.namedItem("name") as HTMLInputElement;
  const bodyInput = form.elements.namedItem("body") as HTMLTextAreaElement;
  const honeypot = form.elements.namedItem("website") as HTMLInputElement;
  const submit = find<HTMLButtonElement>("[data-comment-submit]");
  const status = find("[data-comment-status]");
  const remaining = find("[data-comment-remaining]");
  const replyTarget = find("[data-reply-target]");
  const replyLabel = find("[data-reply-label]");
  const list = find<HTMLOListElement>("[data-comment-list]");
  const empty = find("[data-comments-empty]");
  const failed = find("[data-comments-error]");
  const loading = find("[data-comments-loading]");
  const more = find<HTMLButtonElement>("[data-comments-more]");
  const count = find("[data-comments-count]");
  const template = find<HTMLTemplateElement>("[data-comment-template]");
  const challenge = find("[data-turnstile]");
  form.hidden = false;

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const absolute = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const exact = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const when = (iso: string) => {
    const date = new Date(iso), seconds = Math.round((date.valueOf() - Date.now()) / 1000);
    if (seconds > -60) return relative.format(0, "second");
    if (seconds > -3600) return relative.format(Math.ceil(seconds / 60), "minute");
    if (seconds > -86_400) return relative.format(Math.ceil(seconds / 3600), "hour");
    if (seconds > -7 * 86_400) return relative.format(Math.ceil(seconds / 86_400), "day");
    return absolute.format(date);
  };

  let total = 0, cursor: number | null = null, replyTo: number | null = null, busy = false, started = false;
  let token = "", widget: string | undefined, waiting: ((value: string) => void) | undefined;

  const setTotal = (value: number) => {
    total = value;
    count.textContent = total > 0 ? String(total) : "";
    count.hidden = total === 0;
    empty.hidden = total > 0 || list.childElementCount > 0;
  };

  const render = (comment: Comment, parentId: number | null): HTMLLIElement => {
    const item = template.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
    item.id = `comment-${comment.id}`;
    const avatar = item.querySelector<HTMLElement>(".comment-avatar")!;
    avatar.textContent = [...comment.name][0]?.toUpperCase() ?? "";
    avatar.style.setProperty("--comment-hue", String(hue(comment.name)));
    item.querySelector(".comment-name")!.textContent = comment.name;
    const time = item.querySelector("time")!;
    time.dateTime = comment.created_at;
    time.textContent = when(comment.created_at);
    time.title = exact.format(new Date(comment.created_at));
    // Comment text is only ever inserted as text, never as markup.
    item.querySelector(".comment-body")!.textContent = comment.body;
    const reply = item.querySelector<HTMLButtonElement>("[data-reply]")!;
    reply.addEventListener("click", () => startReply(parentId ?? comment.id, comment.name));
    const replies = item.querySelector<HTMLOListElement>(".comment-replies")!;
    if (parentId !== null) replies.remove();
    else for (const child of comment.replies ?? []) replies.appendChild(render(child, comment.id));
    return item;
  };

  const startReply = (id: number, name: string) => {
    replyTo = id;
    replyLabel.textContent = label("replyingTo", { name });
    replyTarget.hidden = false;
    form.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    (nameInput.value.trim() ? bodyInput : nameInput).focus({ preventScroll: true });
  };
  const endReply = () => { replyTo = null; replyTarget.hidden = true; };
  find<HTMLButtonElement>("[data-reply-cancel]").addEventListener("click", () => { endReply(); bodyInput.focus(); });

  const load = async () => {
    loading.hidden = false; failed.hidden = true; more.hidden = true;
    try {
      const query = new URLSearchParams({ thread });
      if (cursor !== null) query.set("before", String(cursor));
      const response = await fetch(`/api/comments?${query}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      const page = await response.json() as Page;
      for (const comment of page.comments) {
        if (!root.querySelector(`#comment-${comment.id}`)) list.appendChild(render(comment, null));
      }
      cursor = page.next_before;
      more.hidden = cursor === null;
      setTotal(page.total);
    } catch {
      failed.hidden = false;
    } finally {
      loading.hidden = true;
    }
  };
  more.addEventListener("click", () => void load());
  find<HTMLButtonElement>("[data-comments-retry]").addEventListener("click", () => void load());

  // The counter only appears once the limit is in sight.
  const updateRemaining = () => {
    const used = [...bodyInput.value].length;
    remaining.textContent = `${used}/${bodyInput.maxLength}`;
    remaining.hidden = used < bodyInput.maxLength * .8;
  };
  bodyInput.addEventListener("input", updateRemaining);
  try { nameInput.value = localStorage.getItem(NAME_KEY) ?? ""; } catch { /* remembering the nickname is optional */ }
  updateRemaining();

  const prepareChallenge = async () => {
    if (!siteKey || widget !== undefined) return;
    await loadTurnstile();
    if (widget !== undefined || !challenge.isConnected) return;
    widget = window.turnstile!.render(challenge, {
      sitekey: siteKey, theme: "dark", appearance: "interaction-only", language: locale.toLowerCase(),
      callback: (value: string) => { token = value; waiting?.(value); waiting = undefined; },
      "expired-callback": () => { token = ""; },
      "error-callback": () => { token = ""; waiting?.(""); waiting = undefined; },
    });
  };
  const challengeToken = async (): Promise<string> => {
    if (!siteKey) return "";
    await prepareChallenge();
    if (token) return token;
    return new Promise((resolve) => {
      waiting = resolve;
      setTimeout(() => { if (waiting === resolve) { waiting = undefined; resolve(""); } }, 30_000);
    });
  };
  form.addEventListener("focusin", () => { void prepareChallenge().catch(() => undefined); }, { once: true });

  const fail = (code: string) => {
    status.textContent = label(ERROR_LABELS[code] ?? "errorGeneric");
    status.classList.add("is-error");
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    status.classList.remove("is-error");
    const name = nameInput.value.trim(), body = bodyInput.value.trim();
    if (!name) { fail("invalid_name"); nameInput.focus(); return; }
    if (!body) { fail("invalid_body"); bodyInput.focus(); return; }
    busy = true; submit.disabled = true;
    status.textContent = label("submitting");
    try {
      let turnstile_token = "";
      if (siteKey) {
        try { turnstile_token = await challengeToken(); } catch { turnstile_token = ""; }
        if (!turnstile_token) { fail("verification_failed"); return; }
      }
      const response = await fetch("/api/comments", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ thread, name, body, parent_id: replyTo, website: honeypot.value, turnstile_token }),
      });
      const result = await response.json().catch(() => ({})) as { comment?: Comment & { parent_id: number | null } | null; error?: string };
      if (!response.ok) { fail(result.error ?? "generic"); return; }
      try { localStorage.setItem(NAME_KEY, name); } catch { /* optional */ }
      const comment = result.comment;
      if (comment) {
        const parent = comment.parent_id === null ? null : root.querySelector(`#comment-${comment.parent_id} > .comment-replies`);
        const item = render(comment, parent ? comment.parent_id : null);
        if (parent) parent.appendChild(item); else list.insertBefore(item, list.firstChild);
        setTotal(total + 1);
        item.classList.add("is-new");
        item.scrollIntoView({ block: "nearest" });
      }
      bodyInput.value = "";
      updateRemaining();
      endReply();
      status.textContent = label("posted");
    } catch {
      fail("generic");
    } finally {
      busy = false; submit.disabled = false;
      // A challenge token is single-use, whether the post went through or not.
      if (widget !== undefined) { token = ""; window.turnstile?.reset(widget); }
    }
  });

  // Threads sit below the fold; read them only when a visitor gets near.
  const begin = () => { if (!started) { started = true; void load(); } };
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); begin(); }
    }, { rootMargin: "600px 0px" });
    observer.observe(root);
  } else begin();
}

export function setupComments(): void {
  for (const root of document.querySelectorAll<HTMLElement>("[data-comments]")) {
    if (root.dataset.commentsReady) continue;
    root.dataset.commentsReady = "true";
    mount(root);
  }
}
