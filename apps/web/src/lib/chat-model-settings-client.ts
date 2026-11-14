/**
 * The model picker's settings dialog. The provider's list runs to hundreds of ids —
 * embeddings, speech, old snapshots — so the operator ticks the few worth offering and
 * nominates one as the default for a new session.
 */
interface SettingsPayload {
  available: string[];
  enabled: string[];
  default_model: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

async function api(method: string, body?: unknown): Promise<SettingsPayload> {
  const response = await fetch("/api/admin/chat/model-settings", {
    method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(data?.error?.message || "请求失败");
  return data as SettingsPayload;
}

export function setupChatModelSettings(onSaved: () => void): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-chat-settings]");
  const openButton = document.querySelector<HTMLElement>("[data-chat-settings-open]");
  if (!dialog || !openButton || dialog.dataset.ready === "true") return;
  dialog.dataset.ready = "true";
  // The cap is the server's; the markup carries it so the two cannot drift apart.
  const MAX = Number(dialog.dataset.max) || 12;

  const list = dialog.querySelector<HTMLElement>('[data-role="settings-list"]')!;
  const filter = dialog.querySelector<HTMLInputElement>('[data-role="settings-filter"]')!;
  const status = dialog.querySelector<HTMLElement>('[data-role="settings-status"]')!;
  const count = dialog.querySelector<HTMLElement>('[data-role="settings-count"]')!;
  const save = dialog.querySelector<HTMLButtonElement>("[data-chat-settings-save]")!;

  // Held outside the DOM so filtering never drops a tick that is scrolled out of view.
  let available: string[] = [];
  let enabled = new Set<string>();
  let fallback: string | null = null;
  let loaded = false;

  function rows(): string {
    const needle = filter.value.trim().toLowerCase();
    // Ticked models stay on top: they are the list the operator is actually curating.
    const ordered = [...available].sort((left, right) => {
      const ranked = Number(enabled.has(right)) - Number(enabled.has(left));
      return ranked !== 0 ? ranked : left.localeCompare(right);
    });
    const shown = needle ? ordered.filter((model) => model.toLowerCase().includes(needle)) : ordered;
    if (!shown.length) return '<li class="chat-settings-none">没有匹配的模型。</li>';
    return shown.map((model) => {
      const ticked = enabled.has(model);
      const isDefault = fallback === model;
      return `<li class="chat-settings-row${ticked ? " is-enabled" : ""}">
        <label class="chat-settings-pick">
          <input type="checkbox" data-model="${escapeHtml(model)}"${ticked ? " checked" : ""} />
          <code>${escapeHtml(model)}</code>
        </label>
        <label class="chat-settings-default">
          <input type="radio" name="chat-default-model" data-default="${escapeHtml(model)}"
            ${isDefault ? " checked" : ""}${ticked ? "" : " disabled"} />
          <span>默认</span>
        </label>
      </li>`;
    }).join("");
  }

  function render(): void {
    list.innerHTML = rows();
    count.textContent = `已勾选 ${enabled.size} / ${MAX}`;
    save.disabled = !loaded;
  }

  async function load(): Promise<void> {
    status.hidden = false;
    status.textContent = "加载中…";
    try {
      const data = await api("GET");
      available = data.available ?? [];
      enabled = new Set(data.enabled ?? []);
      fallback = data.default_model ?? null;
      loaded = true;
      status.textContent = data.enabled?.length
        ? `共 ${available.length} 个可用模型${data.updated_at ? ` · 上次修改 ${data.updated_at.slice(0, 10)}` : ""}`
        : `共 ${available.length} 个可用模型 · 还没有勾选，侧栏当前列出全部`;
      render();
    } catch (error) {
      loaded = false;
      status.textContent = error instanceof Error ? error.message : "加载失败";
      list.innerHTML = "";
      save.disabled = true;
    }
  }

  list.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.model) {
      const model = target.dataset.model;
      if (target.checked) {
        if (enabled.size >= MAX) {
          target.checked = false;
          status.textContent = `最多勾选 ${MAX} 个模型`;
          return;
        }
        enabled.add(model);
      } else {
        enabled.delete(model);
        // A default that is no longer offered would be unreachable in the picker.
        if (fallback === model) fallback = null;
      }
      render();
    } else if (target.dataset.default) {
      fallback = target.dataset.default;
      render();
    }
  });

  filter.addEventListener("input", () => render());

  save.addEventListener("click", async () => {
    save.disabled = true;
    status.textContent = "保存中…";
    try {
      const data = await api("POST", { enabled: [...enabled], default_model: fallback });
      enabled = new Set(data.enabled ?? []);
      fallback = data.default_model ?? null;
      status.textContent = "已保存";
      render();
      onSaved();
      dialog.close();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "保存失败";
      save.disabled = false;
    }
  });

  for (const button of dialog.querySelectorAll("[data-chat-settings-close]")) {
    button.addEventListener("click", () => dialog.close());
  }
  // A click on the backdrop lands on the dialog element itself, never on its contents.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  openButton.addEventListener("click", () => {
    dialog.showModal();
    filter.value = "";
    // Typing to narrow the list is the first thing anyone does with a few hundred ids.
    filter.focus();
    void load();
  });
}
