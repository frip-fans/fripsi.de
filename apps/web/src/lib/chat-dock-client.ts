/**
 * The admin chat dock. Admin pages have client-side routing disabled, so this module
 * never tries to keep state alive across navigations: the transcript arrives server
 * rendered in the markup and only ephemeral bits (open, draft, scroll) are restored.
 */
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

function clock(value: string): string {
  return value.slice(11, 16);
}

export function setupAdminChatDock(): void {
  const found = document.querySelector<HTMLElement>("[data-chat-dock]");
  if (!found || found.dataset.ready === "true") return;
  // Declared non-null so the async handlers below keep the narrowing.
  const dock: HTMLElement = found;
  dock.dataset.ready = "true";

  const root = document.documentElement;
  const launcher = document.querySelector<HTMLElement>("[data-chat-toggle]");
  const log = dock.querySelector<HTMLElement>('[data-role="log"]')!;
  const form = dock.querySelector<HTMLFormElement>('[data-role="composer"]')!;
  const input = dock.querySelector<HTMLTextAreaElement>('[data-role="input"]')!;
  const sendButton = dock.querySelector<HTMLButtonElement>('[data-role="send"]')!;
  const status = dock.querySelector<HTMLElement>('[data-role="status"]')!;
  const announce = dock.querySelector<HTMLElement>('[data-role="announce"]')!;
  const expired = dock.querySelector<HTMLElement>('[data-role="expired"]')!;
  const historyPanel = dock.querySelector<HTMLElement>("[data-chat-history-panel]")!;
  const historyList = dock.querySelector<HTMLElement>('[data-role="history-list"]')!;
  const historyEmpty = dock.querySelector<HTMLElement>('[data-role="history-empty"]')!;
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
  let viewingArchive = false;

  const rail = window.matchMedia(RAIL_QUERY);
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
    } else {
      dock.setAttribute("role", "complementary");
      dock.removeAttribute("aria-modal");
      setBackgroundInert(false);
    }
  }

  function setBackgroundInert(on: boolean): void {
    for (const element of document.querySelectorAll<HTMLElement>(".site-header, main, footer")) {
      element.inert = on;
    }
  }

  function setOpen(open: boolean, remember = true): void {
    root.classList.toggle("chat-dock-open", open);
    launcher?.setAttribute("aria-expanded", String(open));
    if (remember) {
      store(OPEN_KEY, open ? "1" : "0");
      // The server reads this on the next admin page so the layout never flashes.
      document.cookie = `chat_dock_open=${open ? "1" : "0"}; path=/admin; max-age=604800; samesite=lax`;
    }
    applyMode();
    if (open) {
      (rail.matches ? input : dock.querySelector<HTMLElement>("[data-chat-close]"))?.focus();
      restoreScroll();
    } else {
      setBackgroundInert(false);
      launcher?.focus();
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

  function bubble(role: "user" | "assistant" | "error", text: string, at = new Date().toISOString()): void {
    clearEmpty();
    const item = document.createElement("li");
    item.className = `chat-turn chat-turn-${role}`;
    if (role === "user") {
      const body = document.createElement("div");
      body.className = "chat-bubble";
      body.textContent = text;
      item.appendChild(body);
    } else {
      const label = document.createElement("p");
      label.className = "chat-turn-label";
      label.textContent = `${role === "error" ? "出错" : "助手"} · ${clock(at)}`;
      const body = document.createElement("div");
      body.className = role === "error" ? "chat-error" : "chat-prose";
      body.textContent = text;
      item.appendChild(label);
      item.appendChild(body);
    }
    log.appendChild(item);
    scrollToEnd();
    if (role !== "user") announce.textContent = `${role === "error" ? "出错" : "助手已回复"}：${text.slice(0, 120)}`;
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
      const listed = await api("/api/admin/chat/models", undefined, "GET") as { models?: string[] };
      const models = listed.models ?? [];
      if (!models.length) throw new Error("该 API key 没有可用模型");
      model.innerHTML = models.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("");
      const preferred = dock.dataset.lastModel;
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
    input.readOnly = on;
    log.setAttribute("aria-busy", String(on));
    status.textContent = label;
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
        timer = window.setTimeout(() => void poll(), POLL_MS);
        return;
      }
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

  async function submit(text: string, echo = true): Promise<void> {
    if (viewingArchive) await backToCurrent();
    if (echo) bubble("user", text);
    busy(true, "正在提交");
    try {
      if (!sessionId || !live) {
        const created = await api("/api/admin/chat", { input: text, model: model?.value ?? "" });
        sessionId = String(created.session_id);
        dock.dataset.session = sessionId;
        lastTurn = null;
        setLive(true, String(created.expires_at));
      } else {
        await api(`/api/admin/chat/${encodeURIComponent(sessionId)}`, { input: text });
      }
      store(DRAFT_KEY, null);
      stopPolling();
      timer = window.setTimeout(() => void poll(), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交失败";
      bubble("error", message);
      if (sessionGone(error)) setLive(false, null);
      busy(false, "未提交");
    }
  }

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

  async function toggleHistory(): Promise<void> {
    const open = historyPanel.hidden;
    historyPanel.hidden = !open;
    dock.querySelector("[data-chat-history]")?.setAttribute("aria-expanded", String(open));
    if (!open) return;
    try {
      const listed = await api("/api/admin/chat/sessions", undefined, "GET") as { sessions?: HistoryRow[] };
      const rows = (listed.sessions ?? []).filter((row) => row.message_count > 0);
      historyEmpty.hidden = rows.length > 0;
      historyList.replaceChildren(...rows.map((row) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-history-row";
        button.innerHTML = [
          `<span class="chat-history-title">${escapeHtml(row.title ?? "（无标题）")}</span>`,
          `<span class="chat-history-meta">${escapeHtml(row.created_at.slice(5, 16).replace("T", " "))} · ${row.message_count} 条`,
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
        messages: Array<{ role: string; body: string; created_at: string; tool_calls?: Array<{ name: string; status: string }> }>;
        proposals?: ProposalCard[];
      };
      viewingArchive = true;
      historyPanel.hidden = true;
      log.replaceChildren();
      for (const message of data.messages) {
        bubble(message.role === "user" ? "user" : message.role === "error" ? "error" : "assistant", message.body, message.created_at);
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
        messages: Array<{ role: string; body: string; created_at: string }>;
        proposals?: ProposalCard[];
      };
      log.replaceChildren();
      for (const message of state.messages) {
        bubble(message.role === "user" ? "user" : message.role === "error" ? "error" : "assistant", message.body, message.created_at);
      }
      renderProposals(state.proposals ?? []);
      sessionId = state.session?.id ?? null;
      dock.dataset.session = sessionId ?? "";
      setLive(Boolean(state.session?.continuable), state.session?.expires_at ?? null);
    } catch { /* The composer still works; the next send opens a session. */ }
  }

  // ---- wiring -------------------------------------------------------------

  launcher?.addEventListener("click", () => setOpen(!root.classList.contains("chat-dock-open")));
  dock.querySelector("[data-chat-close]")?.addEventListener("click", () => setOpen(false));
  dock.querySelector("[data-chat-history]")?.addEventListener("click", () => void toggleHistory());
  for (const button of dock.querySelectorAll("[data-chat-new]")) {
    button.addEventListener("click", () => void endSession());
  }
  for (const sample of dock.querySelectorAll<HTMLElement>("[data-chat-sample]")) {
    sample.addEventListener("click", () => { input.value = sample.textContent ?? ""; input.focus(); });
  }
  model?.addEventListener("change", () => {
    if (live) status.textContent = "切换模型会在下一个会话生效，请先开新会话";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sendButton.disabled) return;
    input.value = "";
    void submit(text);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
  });
  input.addEventListener("input", () => store(DRAFT_KEY, input.value));
  log.addEventListener("scroll", () => store(SCROLL_KEY, String(log.scrollTop)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !rail.matches && root.classList.contains("chat-dock-open")) setOpen(false);
  });
  rail.addEventListener("change", applyMode);
  window.addEventListener("pagehide", () => { stopPolling(); setBackgroundInert(false); });

  const draft = read(DRAFT_KEY);
  if (draft) input.value = draft;
  setOpen(read(OPEN_KEY) !== "0" && root.classList.contains("chat-dock-open"), false);
  applyMode();
  setLive(live, expiresAt);
  void loadModels();
  // A turn may have completed while this page was loading, or while no tab was open.
  if (sessionId && live) timer = window.setTimeout(() => void poll(), 800);
}
