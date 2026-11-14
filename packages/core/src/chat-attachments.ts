import { ServiceError } from "./utils";

/** Images per message, and bytes per image as stored. Four at the cap still fit the web body limit as base64 JSON. */
export const CHAT_IMAGE_MAX = 4;
export const CHAT_IMAGE_MAX_BYTES = 1_500_000;

export type ChatImageType = "image/jpeg" | "image/png" | "image/webp";
const EXTENSIONS: Record<ChatImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** One stored attachment as recorded on its message row. */
export interface ChatAttachment { id: string; type: ChatImageType; bytes: number }
/** An image on its way in: decoded for storage, still base64 for the provider. */
export interface ChatImage extends ChatAttachment { data: Uint8Array; base64: string }

/** Private storage for chat images, one folder per session. Implemented by packages/node-runtime. */
export interface ChatMediaStore {
  put(sessionId: string, file: string, data: Uint8Array): Promise<void>;
  get(sessionId: string, file: string): Promise<Uint8Array | null>;
  removeSession(sessionId: string): Promise<void>;
}

const FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function chatAttachmentFile(attachment: Pick<ChatAttachment, "id" | "type">): string {
  return `${attachment.id}.${EXTENSIONS[attachment.type]}`;
}

/** Both parts end up in a filesystem path, so nothing but our own uuid names may pass. */
export function isChatAttachmentPath(sessionId: string, file: string): boolean {
  return SESSION_PATTERN.test(sessionId) && FILE_PATTERN.test(file);
}

export function chatAttachmentType(file: string): ChatImageType {
  return file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
}

/** The type is read from the bytes: the declared one comes from the browser and proves nothing. */
export function sniffChatImage(data: Uint8Array): ChatImageType | null {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return "image/webp";
  return null;
}

/** Validates the `images` field of a chat request: an array of base64 strings. */
export function parseChatImages(value: unknown): ChatImage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ServiceError("invalid_input", "图片格式无效", 400);
  if (value.length > CHAT_IMAGE_MAX) throw new ServiceError("invalid_input", `一条消息最多附 ${CHAT_IMAGE_MAX} 张图片`, 400);
  return value.map((entry) => {
    // Checked before decoding, so an oversized string is never expanded into memory twice.
    if (typeof entry !== "string" || !entry || entry.length > Math.ceil(CHAT_IMAGE_MAX_BYTES / 3) * 4
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry)) throw new ServiceError("invalid_input", "图片过大或格式无效", 400);
    let data: Uint8Array;
    try { data = Uint8Array.from(atob(entry), (character) => character.charCodeAt(0)); }
    catch { throw new ServiceError("invalid_input", "图片格式无效", 400); }
    const type = sniffChatImage(data);
    if (!type) throw new ServiceError("invalid_input", "只支持 JPEG、PNG 和 WebP 图片", 400);
    return { id: crypto.randomUUID(), type, bytes: data.byteLength, data, base64: entry };
  });
}

/** Reads a message row's attachments; a row written before attachments existed has none. */
export function chatAttachments(message: { attachments_json?: string | null }): ChatAttachment[] {
  if (!message.attachments_json) return [];
  try {
    const parsed = JSON.parse(message.attachments_json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is ChatAttachment =>
      typeof entry?.id === "string" && typeof entry?.type === "string" && entry.type in EXTENSIONS) : [];
  } catch { return []; }
}
