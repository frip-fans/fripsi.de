import type { EventDraft, EventPatch, SourceInput } from "@frip-fan/core";

function optional(form: FormData, key: string): string | null {
  const value = String(form.get(key) ?? "").trim();
  return value || null;
}

export function parseSources(value: string): SourceInput[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [url, label] = line.split(/\s*\|\s*/, 2);
    return { url, label: label || undefined, source_type: "official" };
  });
}

export function readEventForm(form: FormData): EventDraft {
  return {
    slug: optional(form, "slug") ?? undefined,
    title: String(form.get("title") ?? ""),
    start_date: String(form.get("start_date") ?? ""),
    end_date: optional(form, "end_date"),
    start_time: optional(form, "start_time"),
    end_time: optional(form, "end_time"),
    timezone: optional(form, "timezone") ?? "Asia/Tokyo",
    category: String(form.get("category") ?? "OTHER") as EventDraft["category"],
    classification: optional(form, "classification"),
    venue: optional(form, "venue"),
    region: optional(form, "region"),
    remark: optional(form, "remark"),
    status: String(form.get("status") ?? "scheduled") as EventDraft["status"],
    sources: parseSources(String(form.get("sources") ?? ""))
  };
}

export function readEventPatch(form: FormData): EventPatch {
  const event = readEventForm(form);
  return event;
}

export function htmlError(error: unknown, back = "/admin"): Response {
  const message = error instanceof Error && (error.name === "ServiceError" || error.name === "ZodError") ? error.message : "操作失败，请稍后重试或查看 Worker 日志。";
  const safe = message.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back.replaceAll('"', "%22").replaceAll("'", "%27") : "/admin";
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>操作失败</title><body style="font-family:system-ui;padding:3rem;background:#07101c;color:#eff8ff"><h1>操作没有完成</h1><p>${safe}</p><p><a style="color:rgb(234,129,66)" href="${safeBack}">返回检查</a></p></body></html>`, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
