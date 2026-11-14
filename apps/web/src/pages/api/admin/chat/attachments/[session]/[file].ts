import { chatAttachmentType } from "@frip-fan/core";
import type { APIRoute } from "astro";
import { chatAttachment } from "../../../../../../lib/chat";
import { jsonError } from "../../../chat";

// Chat images are private to the maintainer who sent them; this is the only way to read one.
export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const data = await chatAttachment(locals.actor!, params.session!, params.file!);
    // The worker typings in this app do not list a typed array as a body; the runtime takes one.
    return new Response(data as unknown as BodyInit, {
      headers: {
        "content-type": chatAttachmentType(params.file!),
        "content-length": String(data.byteLength),
        // The name is a fresh uuid per upload, so the bytes behind a URL never change.
        "cache-control": "private, max-age=86400, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  } catch (error) { return jsonError(error); }
};
