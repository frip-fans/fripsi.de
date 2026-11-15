/**
 * Admin pages navigate through Astro's client router, so the header, the chat dock and
 * whatever the operator is doing in them survive a page change. This module covers the
 * two things the router does not do the way admin needs:
 *
 * - Anything outside /admin (the public site, a CSV download) is an ordinary page load.
 * - A POST form is sent here instead of by the router. A save that succeeds routes to the
 *   page it redirects to; one that fails reports the reason over the form that is still on
 *   screen, where the router would replace the page (and the input) with the error document.
 */
import { navigate } from "astro:transitions/client";

const ADMIN_PATH = /^\/admin(?:\/|$)/;
type Submitter = HTMLButtonElement | HTMLInputElement;

let installed = false;

export function setupAdminNavigation(): void {
  if (installed || !document.body.classList.contains("admin")) return;
  installed = true;
  document.addEventListener("astro:before-preparation", (event) => {
    // Preventing it hands the navigation to the browser before anything is fetched.
    if (!ADMIN_PATH.test(event.to.pathname)) event.preventDefault();
  });
  capViewportScale();
  // A routed navigation brings the incoming page's own viewport tag.
  document.addEventListener("astro:after-swap", capViewportScale);
  // <html> outlives every swap, and it sits between the form (whose own handlers may
  // cancel the submit) and the document, where the router would otherwise take it.
  document.documentElement.addEventListener("submit", onSubmit);
}

/**
 * iOS zooms the page when a focused field is under 16px. Capping the scale stops that
 * there while pinch zoom keeps working (iOS ignores the cap for gestures); other browsers
 * would lose pinch zoom, so they are left alone. Done here rather than inline in the head
 * because the site's CSP only runs same-origin script files.
 */
function capViewportScale(): void {
  if (!/iP(hone|ad|od)/.test(navigator.userAgent) && !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return;
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport && !viewport.content.includes("maximum-scale")) viewport.content += ", maximum-scale=1";
}

function onSubmit(event: SubmitEvent): void {
  const form = event.target as HTMLFormElement | null;
  if (!form || form.tagName !== "FORM" || event.defaultPrevented || form.hasAttribute("data-astro-reload")) return;
  const submitter = event.submitter as Submitter | null;
  const method = (submitter?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get").toLowerCase();
  // GET forms are filters: the router turns them into a query string and navigates.
  if (method !== "post") return;
  const action = new URL(submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? location.href, location.href);
  if (action.origin !== location.origin) return;
  event.preventDefault();
  const question = form.dataset.confirm;
  if (question && !confirm(question)) return;
  if (form.dataset.submitting === "true") return;
  void post(form, submitter, action);
}

async function post(form: HTMLFormElement, submitter: Submitter | null, action: URL): Promise<void> {
  // Read before anything is disabled: a disabled control is left out of the submission.
  const data = new FormData(form, submitter);
  const body = form.getAttribute("enctype") === "multipart/form-data"
    ? data : new URLSearchParams(data as unknown as Record<string, string>);
  const buttons = ([...form.elements] as Submitter[])
    .filter((control) => control.type === "submit" && !control.disabled);
  form.dataset.submitting = "true";
  form.setAttribute("aria-busy", "true");
  for (const button of buttons) button.disabled = true;
  dismissError();
  const fail = (title: string, detail: string) => {
    delete form.dataset.submitting;
    form.removeAttribute("aria-busy");
    for (const button of buttons) button.disabled = false;
    // Lets a page script undo what it did when the submit began.
    form.dispatchEvent(new CustomEvent("admin:submit-failed"));
    showError(title, detail);
  };
  let response: Response;
  try {
    response = await fetch(action, { method: "POST", body, headers: { accept: "text/html" } });
  } catch {
    fail("没有提交成功", "网络中断，或登录已过期。页面上的内容还在：恢复连接或在新标签页重新登录后，可以直接再提交一次。");
    return;
  }
  if (response.ok && response.redirected && new URL(response.url).origin === location.origin) {
    // The swap replaces this form, so there is nothing to unlock afterwards.
    await navigate(response.url);
    return;
  }
  if (response.ok) {
    // Every admin endpoint redirects after a write; anything else is shown by the browser.
    location.assign(location.href);
    return;
  }
  const reason = await errorText(response);
  fail(reason.title, reason.detail);
}

/** The endpoints answer a failed write with a small standalone document (see htmlError). */
async function errorText(response: Response): Promise<{ title: string; detail: string }> {
  const fallback = { title: "操作没有完成", detail: `服务器返回了 HTTP ${response.status}。` };
  try {
    if (!(response.headers.get("content-type") ?? "").includes("text/html")) return fallback;
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const detail = page.querySelector("body p")?.textContent?.trim();
    return detail ? { title: page.querySelector("h1")?.textContent?.trim() || fallback.title, detail } : fallback;
  } catch { return fallback; }
}

function dismissError(): void {
  document.querySelector("[data-admin-error]")?.remove();
}

/** Lives in <body>, so the next page change clears it along with the page it was about. */
function showError(title: string, detail: string): void {
  dismissError();
  const box = document.createElement("div");
  box.className = "admin-error";
  box.dataset.adminError = "";
  box.setAttribute("role", "alert");
  const text = document.createElement("p");
  const heading = document.createElement("strong");
  heading.textContent = title;
  // appendChild throughout: the worker types in this app shadow the DOM's append().
  text.appendChild(heading);
  text.appendChild(document.createTextNode(detail));
  const close = document.createElement("button");
  close.type = "button";
  close.className = "admin-error-close";
  close.setAttribute("aria-label", "关闭");
  close.textContent = "×";
  close.addEventListener("click", dismissError);
  box.appendChild(text);
  box.appendChild(close);
  document.body.appendChild(box);
}
