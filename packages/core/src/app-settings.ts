import { ServiceError } from "./utils";

/**
 * Operator-editable settings. The value is JSON so one key can carry a small record;
 * callers validate the parsed shape themselves, because a row written by an older
 * release must never crash a newer one.
 */
export interface AppSetting {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
}

export const CHAT_MODELS_SETTING = "chat.models";
/** A picker is a list to choose from, not a catalogue; the cap keeps it one glance. */
export const CHAT_MODELS_MAX = 12;

export interface ChatModelSettings {
  /** Models offered in the dock picker. Empty means "offer everything the key can reach". */
  enabled: string[];
  /** Preselected for a new session. Null means "follow the maintainer's last choice". */
  default_model: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

export const EMPTY_CHAT_MODELS: ChatModelSettings = {
  enabled: [], default_model: null, updated_at: null, updated_by: null,
};

export async function readSetting(db: D1Database, key: string): Promise<AppSetting | null> {
  return db.prepare("SELECT * FROM app_settings WHERE key = ?").bind(key).first<AppSetting>();
}

export async function writeSetting(db: D1Database, key: string, value: unknown, actorId: string,
  now = new Date()): Promise<void> {
  await db.prepare(`INSERT INTO app_settings (key,value,updated_at,updated_by) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
    .bind(key, JSON.stringify(value), now.toISOString(), actorId).run();
}

/** Model ids are opaque to us; only the shape is checked before one reaches OpenAI. */
const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function isModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_PATTERN.test(value);
}

/**
 * Reads the stored selection defensively: a malformed or hand-edited row degrades to
 * "nothing configured", which still leaves the chat usable, rather than failing the page.
 */
export async function readChatModelSettings(db: D1Database): Promise<ChatModelSettings> {
  const row = await readSetting(db, CHAT_MODELS_SETTING);
  if (!row) return EMPTY_CHAT_MODELS;
  let parsed: unknown;
  try { parsed = JSON.parse(row.value); } catch { return EMPTY_CHAT_MODELS; }
  const record = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const enabled = Array.isArray(record.enabled)
    ? [...new Set(record.enabled.filter(isModelId))].slice(0, CHAT_MODELS_MAX) : [];
  const fallback = isModelId(record.default_model) ? record.default_model : null;
  return {
    enabled,
    // A default outside the enabled list would be unreachable in the picker.
    default_model: fallback && enabled.includes(fallback) ? fallback : null,
    updated_at: row.updated_at, updated_by: row.updated_by,
  };
}

/**
 * Validates a selection against the models this API key can actually reach, so a typo or
 * a stale tab cannot store a model that every later session would fail on.
 */
export function validateChatModelSelection(enabled: string[], defaultModel: string | null,
  available: string[]): { enabled: string[]; default_model: string | null } {
  const offered = new Set(available);
  const chosen = [...new Set(enabled)];
  if (chosen.some((model) => !isModelId(model) || !offered.has(model))) {
    throw new ServiceError("invalid_model", "勾选的模型不在该 API key 可用的列表中", 400);
  }
  if (chosen.length > CHAT_MODELS_MAX) {
    throw new ServiceError("invalid_model", `最多勾选 ${CHAT_MODELS_MAX} 个模型`, 400);
  }
  // Clearing every tick clears the default with it: there is nothing left to nominate.
  const nominated = chosen.length ? defaultModel : null;
  if (nominated !== null && !chosen.includes(nominated)) {
    throw new ServiceError("invalid_model", "默认模型必须是已勾选的模型之一", 400);
  }
  return { enabled: chosen, default_model: nominated };
}
