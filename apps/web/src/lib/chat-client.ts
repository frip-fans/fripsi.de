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

const POLL_MS = 2500;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export function setupAdminChat(): void {
  const root = document.querySelector<HTMLElement>("[data-chat]");
  if (!root || root.dataset.ready === "true") return;
  root.dataset.ready = "true";

  const log = root.querySelector<HTMLElement>('[data-role="log"]')!;
  const form = root.querySelector<HTMLFormElement>('[data-role="composer"]')!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-role="input"]')!;
  const sendButton = root.querySelector<HTMLButtonElement>('[data-role="send"]')!;
  const status = root.querySelector<HTMLElement>('[data-role="status"]')!;
  const reset = root.querySelector<HTMLButtonElement>('[data-role="reset"]')!;
  const canPublish = root.dataset.canPublish === "true";

  let sessionId: string | null = null;
  let lastTurn: string | null = null;
  let timer = 0;

  const scroll = () => log.lastElementChild?.scrollIntoView({ block: "nearest" });

  function bubble(role: "you" | "assistant" | "error", text: string): void {
    const item = document.createElement("li");
    item.className = `bubble ${role}`;
    item.textContent = text;
    log.appendChild(item);
    scroll();
  }

  function busy(on: boolean, label: string): void {
    sendButton.disabled = on;
    input.readOnly = on;
    log.setAttribute("aria-busy", String(on));
    status.textContent = label;
  }

  function stop(): void {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  }

  function endSession(message: string): void {
    stop();
    sessionId = null;
    busy(false, message);
    reset.hidden = false;
  }

  /** Carries the server's error code so callers branch on it, not on message text. */
  class ApiError extends Error {
    constructor(message: string, readonly code: string) { super(message); }
  }

  const expired = (error: unknown) => error instanceof ApiError && error.code === "chat_session_expired";

  async function api(path: string, body?: unknown, method = "POST"): Promise<Record<string, any>> {
    const response = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) throw new ApiError(data?.error?.message || "请求失败", String(data?.error?.code ?? "request_failed"));
    return data;
  }

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
      // Tell the assistant what the maintainer actually did, so its next reply is not
      // based on a guess about this proposal's state.
      if (sessionId) await submit(`维护者已在界面上${action === "publish" ? "发布" : "丢弃"}提案 ${id}。`, false);
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; });
      bubble("error", error instanceof Error ? error.message : "操作失败");
    }
  }

  function card(proposal: ProposalCard): HTMLElement {
    const item = document.createElement("li");
    item.className = "proposal";
    item.dataset.id = proposal.id;
    const rows = (proposal.fields ?? [])
      .map((field) => `<tr><th>${escapeHtml(field.label)}</th><td class="was">${escapeHtml(field.before)}</td><td>${escapeHtml(field.after)}</td></tr>`)
      .join("");
    item.innerHTML = [
      '<div class="proposal-head">',
      `<span class="tag">${escapeHtml(proposal.operation)}</span>`,
      `<strong>${escapeHtml(proposal.title ?? proposal.id)}</strong>`,
      proposal.date ? `<small>${escapeHtml(proposal.date)}</small>` : "",
      "</div>",
      rows ? `<table class="diff"><thead><tr><th></th><th>当前</th><th>提案</th></tr></thead><tbody>${rows}</tbody></table>` : "",
      proposal.warnings?.length ? `<ul class="warnings">${proposal.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "",
      '<div class="proposal-actions" data-role="actions">',
      canPublish && proposal.can_publish
        ? '<button type="button" class="button" data-act="publish">发布</button>'
        : "<small>需要 publisher 角色才能发布</small>",
      '<button type="button" class="link" data-act="discard">丢弃</button>',
      `<a class="link" href="${escapeHtml(proposal.review_path)}">完整预览</a>`,
      "</div>",
    ].join("");
    item.querySelector('[data-act="publish"]')?.addEventListener("click", () => void act(item, "publish"));
    item.querySelector('[data-act="discard"]')?.addEventListener("click", () => void act(item, "discard"));
    return item;
  }

  function render(turn: TurnPayload): void {
    if (turn.reply) bubble("assistant", turn.reply);
    for (const proposal of turn.proposals ?? []) {
      if (log.querySelector(`.proposal[data-id="${CSS.escape(proposal.id)}"]`)) continue;
      log.appendChild(card(proposal));
    }
    scroll();
  }

  async function poll(): Promise<void> {
    if (!sessionId) return;
    try {
      const turn = await api(`/api/admin/chat/${encodeURIComponent(sessionId)}`, undefined, "GET") as unknown as TurnPayload;
      if (turn.state === "running") {
        const calls = turn.tool_calls?.length ?? 0;
        busy(true, calls ? `助手正在查询数据（${calls} 次工具调用）` : "助手正在思考");
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
      render(turn);
      const until = new Date(turn.expires_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      busy(false, `会话有效至 ${until}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取失败";
      if (expired(error)) endSession(message);
      else { bubble("error", message); busy(false, "已停止"); }
    }
  }

  async function submit(text: string, echo = true): Promise<void> {
    if (echo) bubble("you", text);
    busy(true, "正在提交");
    try {
      if (!sessionId) {
        const created = await api("/api/admin/chat", { input: text });
        sessionId = String(created.session_id);
        lastTurn = null;
      } else {
        await api(`/api/admin/chat/${encodeURIComponent(sessionId)}`, { input: text });
      }
      stop();
      timer = window.setTimeout(() => void poll(), 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "提交失败";
      bubble("error", message);
      if (expired(error)) endSession(message);
      else busy(false, "未提交");
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sendButton.disabled) return;
    input.value = "";
    void submit(text);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  reset.addEventListener("click", () => {
    reset.hidden = true;
    lastTurn = null;
    busy(false, "准备就绪");
    bubble("assistant", "已开始新会话，之前的对话上下文不再保留。");
  });
  window.addEventListener("beforeunload", stop);
}
