import { assertScope, ContentAdminService, COVER_PATH_PATTERN, importOfficialCover, releaseSaveSchema, ServiceError } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { boundedFormData, htmlError, readReleaseSave } from "../../../../../lib/admin";
import { getEnv } from "../../../../../lib/env";

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    assertScope(locals.actor!, "music:write");
    const env = getEnv();
    const form = await boundedFormData(request);
    const input = releaseSaveSchema.parse(readReleaseSave(form));
    const importUrl = String(form.get("cover_import_url") ?? "").trim();
    if (form.has("cover_remove")) {
      if (importUrl) throw new ServiceError("invalid_cover", "移除封面时请清空新图片链接", 400);
      input.cover_url = null;
      input.cover_source_url = null;
    } else if (importUrl) {
      if (!input.cover_source_url) throw new ServiceError("invalid_cover", "请填写封面来源页面", 400);
      input.cover_url = await importOfficialCover(env.MEDIA, importUrl, input.cover_source_url);
    }
    if (input.cover_url && COVER_PATH_PATTERN.test(input.cover_url) && !await env.MEDIA.head(input.cover_url.slice("/media/".length))) {
      throw new ServiceError("invalid_cover", "封面文件不存在，请重新导入", 400);
    }
    const release = await new ContentAdminService(env.DB).saveRelease(input, locals.actor!, requestId);
    return Response.redirect(new URL(`/admin/music/releases/${release.id}?saved=1`, request.url), 303);
  } catch (error) {
    console.error(JSON.stringify({
      message: "admin release save failed",
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return htmlError(error, "/admin/music/releases");
  }
};
