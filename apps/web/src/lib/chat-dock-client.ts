/**
 * The admin chat dock. A full page load brings the transcript server rendered in the
 * markup and restores the ephemeral bits (open, draft, scroll) from storage. Admin
 * navigation is routed after that: the dock element persists across it, so a running
 * reply, the draft and pending images carry over, and only what lives outside the dock
 * (the header launcher, the page behind the sheet) is wired up again per page.
 */
import { prepareImage, type PreparedImage } from "./chat-images-client";
import { renderChatMarkdown } from "./chat-markdown";
import { setupChatModelSettings } from "./chat-model-settings-client";

const POLL_MS = 2500;
const RAIL_QUERY = "(min-width: 1180px)";
const OPEN_KEY = "frip.chat-dock.open";
const DRAFT_KEY = "frip.chat-dock.draft";
const SCROLL_KEY = "frip.chat-dock.scroll";

interface ProposalCard {
  id: string;
  operation: string;
  title: string | null;
  date: string | null;
  warnings?: string[];
  fields?: Array<{ label: string; before: string; after: string }>;
  review_path: string;
  can_publish: boolean;
}
interface TurnPayload {
  state: "running" | "completed" | "failed";
  turn_id: string | null;
  reply: string | null;
  tool_calls?: Array<{ name: string; status: string }>;
  proposals?: ProposalCard[];
  expires_at: string;
}
interface HistoryRow {
  id: string; title: string | null; model: string; status: string;
  created_at: string; message_count: number;
}
/** The worker types in this app shadow the DOM's Element, so HTMLSelectElement is unusable. */
interface ModelPicker {
  value: string; disabled: boolean; innerHTML: string;
  options: ArrayLike<{ value: string }>;
  addEventListener(type: "change", listener: () => void): void;
}

class ApiError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function store(key: string, value: string | null): void {
  try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch { /* optional */ }
}
function read(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

const two = (value: number): string => String(value).padStart(2, "0");

/** Timestamps are stored as UTC ISO strings; the operator reads them in their own zone. */
function clock(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.valueOf())) return value.slice(11, 16);
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}

function dayClock(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.valueOf())) return value.slice(5, 16).replace("T", " ");
  return `${two(at.getMonth() + 1)}-${two(at.getDate())} ${clock(value)}`;
}

export function setupAdminChatDock(): void {
  const found = document.querySelector<HTMLElement>("[data-chat-dock]");
  if (!found || found.dataset.ready === "true") return;
  // Declared non-null so the async handlers below keep the narrowing.
  const dock: HTMLElement = found;
  dock.dataset.ready = "true";

  const root = document.documentElement;
  // The header is replaced on every routed navigation; the dock is not.
  const launcher = () => document.querySelector<HTMLElement>("[data-chat-toggle]");
  const log = dock.querySelector<HTMLElement>('[data-role="log"]')!;
  const form = dock.querySelector<HTMLFormElement>('[data-role="composer"]')!;
  const input = dock.querySelector<HTMLTextAreaElement>('[data-role="input"]')!;
  const sendButton = dock.querySelector<HTMLButtonElement>('[data-role="send"]')!;
  const attachments = dock.querySelector<HTMLElement>('[data-role="attachments"]')!;
  const fileInput = dock.querySelector<HTMLInputElement>('[data-role="file"]')!;
  const attachButton = dock.querySelector<HTMLButtonElement>('[data-role="attach"]')!;
  const dropZone = dock.querySelector<HTMLElement>('[data-role="drop"]')!;
  const imageMax = Number(form.dataset.imageMax) || 4;
  const imageBytes = Number(form.dataset.imageBytes) || 1_500_000;
  const status = dock.querySelector<HTMLElement>('[data-role="status"]')!;
  const announce = dock.querySelector<HTMLElement>('[data-role="announce"]')!;
  const expired = dock.querySelector<HTMLElement>('[data-role="expired"]')!;
  // The history dialog is a sibling of the dock, like the settings dialog: a closed
  // sheet is inert, and a modal belongs in the top layer anyway.
  const historyPanel = document.querySelector<HTMLDialogElement>("[data-chat-history-panel]")!;
  const historyList = historyPanel.querySelector<HTMLElement>('[data-role="history-list"]')!;
  const historyEmpty = historyPanel.querySelector<HTMLElement>('[data-role="history-empty"]')!;
  const model = dock.querySelector<HTMLElement>('[data-role="model"]') as unknown as ModelPicker | null;
  const canPublish = dock.dataset.canPublish === "true";

  let sessionId = dock.dataset.session || null;
  let live = dock.dataset.live === "true";
  let expiresAt = dock.dataset.expires || null;
  // The server already rendered this session's turns; without seeding this, the
  // resume poll would append the newest reply a second time.
  const rendered = [...dock.querySelectorAll<HTMLElement>("[data-turn]")];
  let lastTurn: string | null = rendered.length ? rendered[rendered.length - 1]!.dataset.turn ?? null : null;
  let timer = 0;
  let countdown = 0;
  let modelsReady = false;
  /** Poll retries left while the newest turn is one already shown. */
  let awaiting = 0;
  let viewingArchive = false;
  let source: EventSource | null = null;
  /** Images waiting in the composer. They live in memory only and do not survive a navigation. */
  let pending: PreparedImage[] = [];
  /** Images still being read or shrunk; sending waits for them. */
  let preparing = 0;

  // The server renders these in UTC because it cannot know the browser's zone.
  for (const time of dock.querySelectorAll<HTMLElement>("time[data-chat-time]")) {
    const value = time.getAttribute("datetime");
    if (value) time.textContent = clock(value);
  }

  const rail = window.matchMedia(RAIL_QUERY);
  const touchKeyboard = window.matchMedia("(hover: none) and (pointer: coarse)");
  const scrollToEnd = () => log.scrollTo({ top: log.scrollHeight });

  // ---- open / close -------------------------------------------------------

  function applyMode(): void {
    const sheet = !rail.matches;
    dock.dataset.mode = sheet ? "sheet" : "rail";
    const open = root.classList.contains("chat-dock-open");
    if (sheet && open) {
      dock.setAttribute("role", "dialog");
      dock.setAttribute("aria-modal", "true");
      setBackgroundInert(true);
      setScrollLock(true);
    } else {
      dock.setAttribute("role", "complementary");
      dock.removeAttribute("aria-modal");
      setBackgroundInert(false);
      setScrollLock(false);
    }
  }

  function setBackgroundInert(on: boolean): void {
    for (const element of document.querySelectorAll<HTMLElement>(".site-header, main, footer")) {
      element.inert = on;
    }
  }

  /**
   * Freezes the page behind the sheet. `overflow: hidden` alone does not hold on iOS
   * Safari, so the body is pinned at its current offset and the scroll position is
   * restored on close.
   */
  let lockedAt = 0;
  function setScrollLock(on: boolean): void {
    const body = document.body;
    if (on === (body.dataset.chatLocked === "true")) return;
    if (on) {
      lockedAt = window.scrollY;
      body.dataset.chatLocked = "true";
      body.style.top = `-${lockedAt}px`;
    } else {
      delete body.dataset.chatLocked;
      body.style.top = "";
      // Reading layout puts the document back at full height first: while the body is
      // still pinned the scrollable range is zero and the restore would clamp to the top.
      void body.offsetHeight;
      window.scrollTo(0, lockedAt);
    }
  }

  function setOpen(open: boolean, remember = true): void {
    root.classList.toggle("chat-dock-open", open);
    launcher()?.setAttribute("aria-expanded", String(open));
    if (remember) {
      store(OPEN_KEY, open ? "1" : "0");
      // The server reads this on the next admin page so the layout never flashes.
      document.cookie = `chat_dock_open=${open ? "1" : "0"}; path=/admin; max-age=604800; samesite=lax`;
    }
    applyMode();
    // Focus follows the operator's own toggle only. Restoring the remembered state on a
    // page load must not pull focus into the dock: that lit the composer's focus border
    // on every page and took the keyboard away from the page just opened.
    if (open) {
      // The sheet takes focus itself: landing on the close button paints a focus ring
      // on the one control nobody opened the panel to use. A restored sheet is modal, so
      // it still needs the focus inside it.
      if (remember || !rail.matches) (rail.matches ? input : dock).focus({ preventScroll: true });
      restoreScroll();
    } else {
      setBackgroundInert(false);
      setScrollLock(false);
      // Without preventScroll, returning focus to the header scrolls the page back to
      // the top and undoes the position just restored.
      if (remember) launcher()?.focus({ preventScroll: true });
    }
  }

  function restoreScroll(): void {
    const saved = Number(read(SCROLL_KEY));
    if (Number.isFinite(saved) && saved > 0) log.scrollTop = saved; else scrollToEnd();
  }

  // ---- rendering ----------------------------------------------------------

  function clearEmpty(): void {
    dock.querySelector('[data-role="empty"]')?.remove();
  }

  function bubble(role: "user" | "assistant" | "error", text: string, at = new Date().toISOString(), images: string[] = []): void {
    clearEmpty();
    const item = document.createElement("li");
    item.className = `chat-turn chat-turn-${role}`;
    if (role === "user") {
      if (images.length) {
        const strip = document.createElement("div");
        strip.className = "chat-images";
        for (const url of images) {
          const picture = document.createElement("img");
          picture.src = url;
          picture.alt = "附图";
          picture.decoding = "async";
          // A stored image opens at full size; one just sent is still only in memory.
          if (url.startsWith("/")) {
            const link = document.createElement("a");
            link.href = url; link.target = "_blank"; link.rel = "noopener";
            link.appendChild(picture);
            strip.appendChild(link);
          } else strip.appendChild(picture);
        }
        item.appendChild(strip);
      }
      if (text) {
        const body = document.createElement("div");
        body.className = "chat-bubble";
        body.textContent = text;
        item.appendChild(body);
      }
    } else {
      const label = document.createElement("p");
      label.className = "chat-turn-label";
      label.textContent = `${role === "error" ? "出错" : "助手"} · ${clock(at)}`;
      const body = document.createElement("div");
      body.className = role === "error" ? "chat-error" : "chat-prose";
      // renderChatMarkdown escapes the reply and emits only its own tags.
      if (role === "assistant") body.innerHTML = renderChatMarkdown(text);
      else body.textContent = text;
      item.appendChild(label);
      item.appendChild(body);
    }
    log.appendChild(item);
    scrollToEnd();
    if (role !== "user") announce.textContent = `${role === "error" ? "出错" : "助手已回复"}：${text.slice(0, 120)}`;
  }

  /** The bubble the stream is currently writing into, plus its live tool chips. */
  function liveTurn(): { prose: HTMLElement; tools: HTMLElement } {
    let item = log.querySelector<HTMLElement>(".chat-turn-live");
    if (!item) {
      clearEmpty();
      item = document.createElement("li");
      item.className = "chat-turn chat-turn-assistant chat-turn-live";
      const label = document.createElement("p");
      label.className = "chat-turn-label";
      label.textContent = `助手 · ${clock(new Date().toISOString())}`;
      const tools = document.createElement("p");
      tools.className = "chat-tools chat-tools-live";
      tools.hidden = true;
      const prose = document.createElement("div");
      prose.className = "chat-prose";
      item.appendChild(label);
      item.appendChild(tools);
      item.appendChild(prose);
      // The reply itself is the feedback from here on.
      log.querySelector(".chat-turn-pending")?.remove();
      log.appendChild(item);
    }
    return {
      prose: item.querySelector<HTMLElement>(".chat-prose")!,
      tools: item.querySelector<HTMLElement>(".chat-tools-live")!,
    };
  }

  /**
   * The working indicator inside the transcript, right under the message it answers.
   * The status row says the same thing, but it sits at the top of the dock, far from
   * where the operator is looking after sending. It is decorative for assistive tech:
   * the status row and aria-busy already carry the state.
   */
  function pendingTurn(label: string | null): void {
    let item = log.querySelector<HTMLElement>(".chat-turn-pending");
    if (label === null || viewingArchive || log.querySelector(".chat-turn-live")) {
      item?.remove();
      return;
    }
    if (!item) {
      item = document.createElement("li");
      item.className = "chat-turn chat-turn-pending";
      item.setAttribute("aria-hidden", "true");
      const dots = document.createElement("span");
      dots.className = "chat-pending-dots";
      for (let index = 0; index < 3; index += 1) dots.appendChild(document.createElement("i"));
      const text = document.createElement("span");
      text.className = "chat-pending-label";
      item.appendChild(dots);
      item.appendChild(text);
    }
    item.querySelector<HTMLElement>(".chat-pending-label")!.textContent = label;
    // Only scroll when it is placed: the poll relabels it every few seconds, and that
    // must not pull the transcript back down while the operator reads further up.
    if (log.lastElementChild !== item) {
      clearEmpty();
      log.appendChild(item);
      scrollToEnd();
    }
  }

  function settleLive(): void {
    const item = log.querySelector<HTMLElement>(".chat-turn-live");
    item?.classList.remove("chat-turn-live");
    item?.querySelector(".chat-tools-live")?.classList.remove("chat-tools-live");
  }

  function closeStream(): void {
    source?.close();
    source = null;
  }

  /**
   * Streams one turn. Falls back to the poll on any stream failure: the reply is
   * persisted server-side either way, so the fallback cannot lose it.
   */
  function streamTurn(): void {
    if (!sessionId) return;
    closeStream();
    const running = new Map<string, string>();
    let streamed = "";
    const stream = new EventSource(`/api/admin/chat/${encodeURIComponent(sessionId)}/stream`);
    source = stream;
    busy(true, "助手正在回复");
    stream.addEventListener("message", (event) => {
      let data: any;
      try { data = JSON.parse((event as MessageEvent).data); } catch { return; }
      if (data.type === "delta") {
        // The whole reply so far is re-rendered: a delta can close a list or a bold run.
        streamed += data.text;
        liveTurn().prose.innerHTML = renderChatMarkdown(streamed);
        scrollToEnd();
      } else if (data.type === "tool") {
        running.set(data.name, data.status);
        const tools = liveTurn().tools;
        tools.hidden = false;
        tools.textContent = `⌁ ${[...running].map(([name, status]) => status === "completed" ? name : `${name}…`).join(" · ")}`;
        busy(true, `正在调用 ${data.name}`);
        scrollToEnd();
      } else if (data.type === "done") {
        closeStream();
        const prose = liveTurn().prose;
        if (data.text) prose.innerHTML = renderChatMarkdown(data.text);
        lastTurn = data.turn_id ?? lastTurn;
        settleLive();
        announce.textContent = `助手已回复：${String(data.text ?? "").slice(0, 120)}`;
        busy(false, "");
        tickCountdown();
        void refreshProposals();
      } else if (data.type === "failed") {
        closeStream();
        settleLive();
        bubble("error", data.message || "这一轮执行失败");
        busy(false, "上一轮失败");
      }
    });
    stream.addEventListener("error", () => {
      // EventSource retries on its own; the poll is the dependable path, so stop here.
      closeStream();
      settleLive();
      stopPolling();
      // A reply is on its way; allow the poll a minute to see the new turn appear.
      awaiting = 24;
      timer = window.setTimeout(() => void poll(), 1200);
    });
  }

  /** Proposal cards come from the server's view of change_sets, not from the stream. */
  async function refreshProposals(): Promise<void> {
    if (!sessionId) return;
    try {
      const turn = await api(`/api/admin/chat/${encodeURIComponent(sessionId)}`, undefined, "GET") as unknown as TurnPayload;
      renderProposals(turn.proposals ?? []);
      setLive(true, turn.expires_at);
    } catch { /* the countdown and cards simply stay as they are */ }
  }

  function toolLine(calls: Array<{ name: string; status: string }>): void {
    if (!calls.length) return;
    const item = document.createElement("li");
    item.className = "chat-tools";
    item.textContent = `⌁ ${calls.map((call) => call.name).join(" · ")}`;
    log.appendChild(item);
  }

  function card(proposal: ProposalCard): HTMLElement {
    const item = document.createElement("li");
    item.className = "chat-proposal";
    item.dataset.id = proposal.id;
    const rows = (proposal.fields ?? []).slice(0, 3)
      .map((field) => `<tr><th scope="row">${escapeHtml(field.label)}</th><td class="was">${escapeHtml(field.before)}</td><td>${escapeHtml(field.after)}</td></tr>`)
      .join("");
    const more = (proposal.fields?.length ?? 0) - 3;
    item.innerHTML = [
      '<div class="chat-proposal-head">',
      `<span class="tag">${escapeHtml(proposal.operation)}</span>`,
      `<strong>${escapeHtml(proposal.title ?? proposal.id)}</strong>`,
      proposal.date ? `<small>${escapeHtml(proposal.date)}</small>` : "",
      "</div>",
      rows ? `<table class="chat-diff"><thead><tr><th></th><th>当前</th><th>提案</th></tr></thead><tbody>${rows}</tbody></table>` : "",
      more > 0 ? `<p class="chat-more">还有 ${more} 项差异</p>` : "",
      proposal.warnings?.length ? `<ul class="chat-warnings">${proposal.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "",
      '<div class="chat-proposal-actions" data-role="actions">',
      canPublish && proposal.can_publish
        ? '<button type="button" class="button" data-act="publish">发布</button>'
        : "<small>需要 publisher 角色</small>",
      '<button type="button" class="link" data-act="discard">丢弃</button>',
      `<a class="link" href="${escapeHtml(proposal.review_path)}">完整预览</a>`,
      "</div>",
    ].join("");
    item.querySelector('[data-act="publish"]')?.addEventListener("click", () => void act(item, "publish"));
    item.querySelector('[data-act="discard"]')?.addEventListener("click", () => void act(item, "discard"));
    return item;
  }

  function renderProposals(proposals: ProposalCard[]): void {
    for (const proposal of proposals) {
      if (log.querySelector(`.chat-proposal[data-id="${CSS.escape(proposal.id)}"]`)) continue;
      clearEmpty();
      log.appendChild(card(proposal));
    }
  }

  /**
   * A proposal can be published or discarded on the proposals page while its card sits
   * here. `pending` is every proposal of this session the server still has open; a card
   * that is not among them was decided elsewhere and must stop offering the buttons.
   */
  function settleProposals(pending: Set<string>): void {
    for (const item of log.querySelectorAll<HTMLElement>(".chat-proposal:not(.done)")) {
      if (pending.has(item.dataset.id ?? "")) continue;
      item.classList.add("done");
      const actions = item.querySelector('[data-role="actions"]');
      if (!actions) continue;
      const review = actions.querySelector("a");
      actions.textContent = "已在别处处理 ";
      if (review) actions.appendChild(review);
    }
  }

  // ---- api ----------------------------------------------------------------

  async function api(path: string, body?: unknown, method = "POST"): Promise<Record<string, any>> {
    const response = await fetch(path, {
      method, headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) throw new ApiError(data?.error?.message || "请求失败", String(data?.error?.code ?? "request_failed"));
    return data;
  }

  const sessionGone = (error: unknown) => error instanceof ApiError && error.code === "chat_session_expired";

  async function act(item: HTMLElement, action: "publish" | "discard"): Promise<void> {
    const id = item.dataset.id!;
    const buttons = item.querySelectorAll<HTMLButtonElement>("button");
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await api(`/api/admin/changes/${encodeURIComponent(id)}/${action}`,
        action === "publish" ? { idempotency_key: crypto.randomUUID() } : {});
      item.classList.add("done");
      const actions = item.querySelector('[data-role="actions"]');
      if (actions) actions.textContent = action === "publish" ? "已发布" : "已丢弃";
      announce.textContent = action === "publish" ? "提案已发布" : "提案已丢弃";
      // Tell the assistant what the maintainer actually did; it cannot see the click.
      if (sessionId && live) await submit(`维护者已在界面上${action === "publish" ? "发布" : "丢弃"}提案 ${id}。`, false);
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      bubble("error", error instanceof Error ? error.message : "操作失败");
    }
  }

  // ---- model picker -------------------------------------------------------

  function lockModel(locked: boolean): void {
    if (model) model.disabled = locked || !modelsReady;
  }

  async function loadModels(): Promise<void> {
    if (!model) return;
    try {
      const listed = await api("/api/admin/chat/models", undefined, "GET") as
        { models?: string[]; default_model?: string | null };
      const models = listed.models ?? [];
      if (!models.length) throw new Error("该 API key 没有可用模型");
      // A running session keeps its model even if the operator has since unticked it;
      // the picker must still name what the session is actually using.
      const pinned = live ? dock.dataset.lastModel : "";
      if (pinned && !models.includes(pinned)) models.unshift(pinned);
      model.innerHTML = models.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("");
      // A running session is pinned to its own model. Otherwise the operator's default
      // wins, because nominating one is how they say which model a new session should use.
      const preferred = live ? dock.dataset.lastModel : listed.default_model || dock.dataset.lastModel;
      if (preferred && models.includes(preferred)) model.value = preferred;
      modelsReady = true;
      lockModel(live);
    } catch (error) {
      model.innerHTML = '<option value="">模型列表加载失败</option>';
      status.textContent = error instanceof Error ? error.message : "模型列表加载失败";
    }
  }

  // ---- session flow -------------------------------------------------------

  function busy(on: boolean, label: string): void {
    sendButton.disabled = on;
    attachButton.disabled = on;
    input.readOnly = on;
    log.setAttribute("aria-busy", String(on));
    // Drives the indeterminate bar under the status row: a turn can run for many
    // seconds before the first token, and a static line looks like nothing is happening.
    dock.classList.toggle("chat-dock-busy", on);
    status.textContent = label;
    pendingTurn(on ? label : null);
  }

  function stopPolling(): void {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  }

  function setLive(on: boolean, expires: string | null): void {
    live = on;
    expiresAt = expires;
    expired.hidden = on || !sessionId;
    form.hidden = Boolean(sessionId) && !on;
    lockModel(on);
    tickCountdown();
  }

  function tickCountdown(): void {
    if (countdown) window.clearTimeout(countdown);
    countdown = 0;
    if (!live || !expiresAt) return;
    const left = Date.parse(expiresAt) - Date.now();
    if (left <= 0) {
      setLive(false, null);
      status.textContent = "会话已结束";
      announce.textContent = "聊天会话已结束";
      return;
    }
    const minutes = Math.ceil(left / 60_000);
    dock.classList.toggle("chat-dock-expiring", minutes <= 5);
    if (!sendButton.disabled) status.textContent = minutes <= 5 ? `会话还有 ${minutes} 分钟` : `会话有效至 ${clock(expiresAt)}`;
    countdown = window.setTimeout(tickCountdown, 30_000);
  }

  async function poll(): Promise<void> {
    if (!sessionId) return;
    try {
      const turn = await api(`/api/admin/chat/${encodeURIComponent(sessionId)}`, undefined, "GET") as unknown as TurnPayload;
      if (turn.state === "running") {
        const calls = turn.tool_calls?.length ?? 0;
        busy(true, calls ? `正在查询数据（${calls} 次工具调用）` : "助手正在思考");
        timer = window.setTimeout(() => void poll(), POLL_MS);
        return;
      }
      if (turn.state === "failed") {
        bubble("error", "这一轮执行失败，请重试或开新会话。");
        busy(false, "上一轮失败");
        return;
      }
      if (turn.turn_id && turn.turn_id === lastTurn) {
        // The newest turn is already on screen. That is only worth waiting on when a
        // reply is actually expected; otherwise this loop would spin until the session
        // expires, two provider requests at a time.
        if (awaiting > 0) {
          awaiting -= 1;
          timer = window.setTimeout(() => void poll(), POLL_MS);
        } else busy(false, "");
        return;
      }
      awaiting = 0;
      lastTurn = turn.turn_id;
      if (turn.reply) bubble("assistant", turn.reply);
      toolLine(turn.tool_calls ?? []);
      renderProposals(turn.proposals ?? []);
      busy(false, "");
      setLive(true, turn.expires_at);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取失败";
      if (sessionGone(error)) { stopPolling(); setLive(false, null); status.textContent = "会话已结束"; }
      else { bubble("error", message); busy(false, "已停止"); }
    }
  }

  async function submit(text: string, echo = true, images: PreparedImage[] = []): Promise<void> {
    if (viewingArchive) await backToCurrent();
    if (echo) bubble("user", text, undefined, images.map((image) => image.url));
    busy(true, "正在提交");
    const sent = images.length ? { images: images.map((image) => image.base64) } : {};
    try {
      if (!sessionId || !live) {
        const created = await api("/api/admin/chat", { input: text, model: model?.value ?? "", ...sent });
        sessionId = String(created.session_id);
        dock.dataset.session = sessionId;
        lastTurn = null;
        setLive(true, String(created.expires_at));
      } else {
        const accepted = await api(`/api/admin/chat/${encodeURIComponent(sessionId)}`, { input: text, ...sent });
        // Sending is activity: the idle deadline moved, so the countdown must follow it.
        if (typeof accepted.expires_at === "string") setLive(true, accepted.expires_at);
      }
      store(DRAFT_KEY, null);
      stopPolling();
      streamTurn();
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交失败";
      bubble("error", message);
      if (sessionGone(error)) setLive(false, null);
      busy(false, "未提交");
      // Typing a message again is quick; finding and attaching the same images is not.
      if (images.length && !pending.length) { pending = images; renderAttachments(); }
    }
  }

  // ---- images -------------------------------------------------------------

  function renderAttachments(): void {
    attachments.replaceChildren(...pending.map((image, index) => {
      const item = document.createElement("li");
      const picture = document.createElement("img");
      picture.src = image.url;
      picture.alt = `图片 ${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-attachment-remove";
      remove.setAttribute("aria-label", `移除图片 ${index + 1}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        pending = pending.filter((entry) => entry !== image);
        renderAttachments();
        input.focus();
      });
      item.appendChild(picture);
      item.appendChild(remove);
      return item;
    }));
    attachments.hidden = pending.length === 0;
  }

  async function addImages(files: File[]): Promise<void> {
    const room = imageMax - pending.length - preparing;
    const accepted = files.slice(0, Math.max(0, room));
    let note = files.length > accepted.length ? `一条消息最多附 ${imageMax} 张图片` : "";
    preparing += accepted.length;
    // Sequential, so the previews appear in the order the images were given.
    for (const file of accepted) {
      try { pending.push(await prepareImage(file, imageBytes)); }
      catch { note = "有图片无法读取，已跳过"; }
      preparing -= 1;
      renderAttachments();
    }
    if (note) { status.textContent = note; announce.textContent = note; }
    else if (accepted.length) announce.textContent = `已添加 ${accepted.length} 张图片`;
  }

  const imageFiles = (list: FileList | null | undefined): File[] =>
    [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
  const canAttach = () => !form.hidden && !attachButton.disabled;

  async function endSession(): Promise<void> {
    stopPolling();
    if (sessionId && live) {
      try { await api(`/api/admin/chat/${encodeURIComponent(sessionId)}`, undefined, "DELETE"); } catch { /* already gone */ }
    }
    sessionId = null;
    dock.dataset.session = "";
    lastTurn = null;
    viewingArchive = false;
    log.replaceChildren();
    bubble("assistant", "已开始新会话，之前的对话不再作为上下文。记录保留在历史里。");
    setLive(false, null);
    form.hidden = false;
    busy(false, "准备就绪");
    input.focus();
  }

  // ---- history ------------------------------------------------------------

  async function openHistory(): Promise<void> {
    historyList.replaceChildren();
    historyEmpty.hidden = false;
    historyEmpty.textContent = "加载中…";
    historyPanel.showModal();
    historyPanel.focus();
    try {
      const listed = await api("/api/admin/chat/sessions", undefined, "GET") as { sessions?: HistoryRow[] };
      const rows = (listed.sessions ?? []).filter((row) => row.message_count > 0);
      historyEmpty.hidden = rows.length > 0;
      historyEmpty.textContent = "还没有历史会话。";
      historyList.replaceChildren(...rows.map((row) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-history-row";
        button.innerHTML = [
          `<span class="chat-history-title">${escapeHtml(row.title ?? "（无标题）")}</span>`,
          `<span class="chat-history-meta">${escapeHtml(dayClock(row.created_at))} · ${row.message_count} 条`,
          `<code>${escapeHtml(row.model)}</code></span>`,
        ].join("");
        button.addEventListener("click", () => void openArchive(row.id));
        item.appendChild(button);
        return item;
      }));
    } catch (error) {
      historyEmpty.hidden = false;
      historyEmpty.textContent = error instanceof Error ? error.message : "历史加载失败";
    }
  }

  async function openArchive(id: string): Promise<void> {
    stopPolling();
    try {
      const data = await api(`/api/admin/chat/sessions/${encodeURIComponent(id)}`, undefined, "GET") as {
        session: { continuable: boolean; model: string; created_at: string };
        messages: Array<{ role: string; body: string; created_at: string; images?: string[]; tool_calls?: Array<{ name: string; status: string }> }>;
        proposals?: ProposalCard[];
      };
      viewingArchive = true;
      historyPanel.close();
      log.replaceChildren();
      for (const message of data.messages) {
        bubble(message.role === "user" ? "user" : message.role === "error" ? "error" : "assistant", message.body, message.created_at, message.images);
        toolLine(message.tool_calls ?? []);
      }
      renderProposals(data.proposals ?? []);
      dock.classList.add("chat-dock-archive");
      form.hidden = true;
      expired.hidden = false;
      status.textContent = `${data.session.model} · 已结束`;
      log.scrollTop = 0;
    } catch (error) {
      bubble("error", error instanceof Error ? error.message : "读取历史失败");
    }
  }

  /** Leaves the archive view and puts the live session's own transcript back. */
  async function backToCurrent(): Promise<void> {
    viewingArchive = false;
    dock.classList.remove("chat-dock-archive");
    try {
      const state = await api("/api/admin/chat/current", undefined, "GET") as {
        session: { id: string; expires_at: string; continuable: boolean } | null;
        messages: Array<{ role: string; body: string; created_at: string; images?: string[] }>;
        proposals?: ProposalCard[];
      };
      log.replaceChildren();
      for (const message of state.messages) {
        bubble(message.role === "user" ? "user" : message.role === "error" ? "error" : "assistant", message.body, message.created_at, message.images);
      }
      renderProposals(state.proposals ?? []);
      sessionId = state.session?.id ?? null;
      dock.dataset.session = sessionId ?? "";
      setLive(Boolean(state.session?.continuable), state.session?.expires_at ?? null);
    } catch { /* The composer still works; the next send opens a session. */ }
  }

  // ---- wiring -------------------------------------------------------------

  document.addEventListener("click", (event) => {
    if ((event.target as HTMLElement | null)?.closest?.("[data-chat-toggle]")) setOpen(!root.classList.contains("chat-dock-open"));
  });
  dock.querySelector("[data-chat-close]")?.addEventListener("click", () => setOpen(false));
  dock.querySelector("[data-chat-history]")?.addEventListener("click", () => void openHistory());
  historyPanel.querySelector("[data-chat-history-close]")?.addEventListener("click", () => historyPanel.close());
  // A click on the backdrop lands on the dialog element itself, never on its contents.
  historyPanel.addEventListener("click", (event) => { if (event.target === historyPanel) historyPanel.close(); });
  for (const button of dock.querySelectorAll("[data-chat-new]")) {
    button.addEventListener("click", () => void endSession());
  }
  for (const sample of dock.querySelectorAll<HTMLElement>("[data-chat-sample]")) {
    sample.addEventListener("click", () => { input.value = sample.textContent ?? ""; fitInput(); input.focus(); });
  }
  model?.addEventListener("change", () => {
    if (live) status.textContent = "切换模型会在下一个会话生效，请先开新会话";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if ((!text && !pending.length) || sendButton.disabled) return;
    if (preparing) { status.textContent = "图片还在处理，请稍候"; return; }
    const images = pending;
    pending = [];
    renderAttachments();
    input.value = "";
    fitInput();
    void submit(text, true, images);
  });
  attachButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = imageFiles(fileInput.files);
    fileInput.value = "";
    if (files.length) void addImages(files);
  });
  // On the whole dock, so a paste lands wherever the focus is inside it.
  dock.addEventListener("paste", (event) => {
    const files = imageFiles((event as ClipboardEvent).clipboardData?.files);
    if (!files.length || !canAttach()) return;
    // A copied image often carries a text flavour too (its file name or URL); the image wins.
    event.preventDefault();
    void addImages(files);
  });
  // dragenter and dragleave fire for every child crossed, so the overlay follows a depth count.
  let dragDepth = 0;
  const carriesFiles = (event: Event) => [...((event as DragEvent).dataTransfer?.types ?? [])].includes("Files");
  const endDrag = () => { dragDepth = 0; dropZone.hidden = true; };
  dock.addEventListener("dragenter", (event) => {
    if (!carriesFiles(event) || !canAttach()) return;
    event.preventDefault();
    dragDepth += 1;
    dropZone.hidden = false;
  });
  dock.addEventListener("dragover", (event) => {
    // Without this the browser navigates to the dropped file.
    if (carriesFiles(event)) event.preventDefault();
  });
  dock.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropZone.hidden = true;
  });
  dock.addEventListener("drop", (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    endDrag();
    const files = imageFiles((event as DragEvent).dataTransfer?.files);
    if (files.length && canAttach()) { void addImages(files); input.focus(); }
  });
  input.addEventListener("keydown", (event) => {
    // Enter while an IME is composing confirms the candidate; it must never send.
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    // Shift+Enter is the line break. On a touch keyboard Enter is one too: there the
    // send button is in reach and a stray tap on Return should not post a half message.
    if (event.shiftKey || (touchKeyboard.matches && !event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    form.requestSubmit();
  });
  /** Grows the composer with its content instead of offering a drag handle. */
  function fitInput(): void {
    input.style.height = "auto";
    // scrollHeight leaves out the border; without adding it back the box ends up a
    // couple of pixels short and shows a scrollbar on a single line.
    const wanted = input.scrollHeight + (input.offsetHeight - input.clientHeight);
    input.style.height = `${Math.min(wanted, 168)}px`;
    input.style.overflowY = wanted > 168 ? "auto" : "hidden";
  }
  input.addEventListener("input", () => { store(DRAFT_KEY, input.value); fitInput(); });
  log.addEventListener("scroll", () => store(SCROLL_KEY, String(log.scrollTop)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !rail.matches && root.classList.contains("chat-dock-open")) setOpen(false);
  });
  rail.addEventListener("change", applyMode);

  // ---- routed navigation --------------------------------------------------

  let logScroll = 0;
  document.addEventListener("astro:before-preparation", () => {
    // The sheet covers the whole page, so it would hide the one being opened.
    if (!rail.matches && root.classList.contains("chat-dock-open")) setOpen(false);
  });
  document.addEventListener("astro:before-swap", (event) => {
    // The swap takes the incoming document's root attributes. Its open class comes from
    // a cookie that can trail what this tab shows, so carry the current state over.
    event.newDocument.documentElement.classList.toggle("chat-dock-open", root.classList.contains("chat-dock-open"));
    // Moving the dock into the new body can reset the transcript's scroll offset.
    logScroll = log.scrollTop;
    // The incoming document carries a freshly rendered dock that is about to be dropped
    // in favour of this one. It still knows which proposals are open as of this request.
    const fresh = event.newDocument.querySelector<HTMLElement>("[data-chat-dock]");
    if (fresh && !viewingArchive && sessionId && fresh.dataset.session === sessionId) {
      try { settleProposals(new Set(JSON.parse(fresh.dataset.pending ?? "[]") as string[])); } catch { /* cards stay as they are */ }
    }
  });
  document.addEventListener("astro:after-swap", () => {
    if (!dock.isConnected) return;
    log.scrollTop = logScroll;
    launcher()?.setAttribute("aria-expanded", String(root.classList.contains("chat-dock-open")));
    // The page behind the sheet is new: its inert state and scroll lock start over.
    applyMode();
  });
  window.addEventListener("pagehide", () => {
    stopPolling(); closeStream(); setBackgroundInert(false); setScrollLock(false);
  });

  const draft = read(DRAFT_KEY);
  if (draft) input.value = draft;
  fitInput();
  setOpen(read(OPEN_KEY) !== "0" && root.classList.contains("chat-dock-open"), false);
  applyMode();
  setLive(live, expiresAt);
  void loadModels();
  setupChatModelSettings(() => void loadModels());
  // A turn may have completed while this page was loading, or while no tab was open.
  if (sessionId && live) timer = window.setTimeout(() => void poll(), 800);
  for (const button of dock.querySelectorAll("[data-chat-new]")) {
    button.addEventListener("click", () => closeStream());
  }
}
