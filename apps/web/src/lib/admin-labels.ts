import { CHANGE_OPERATION_LABELS } from "./change-review";

const ENTITY_LABELS: Record<string, string> = {
  event: "活动",
  events: "活动",
  setlist: "Setlist",
  release: "专辑",
  song: "歌曲",
  tour: "巡演",
  venue: "场馆",
  music: "音乐库",
};

const VERB_LABELS: Record<string, string> = {
  create: "新增",
  update: "修改",
  archive: "归档",
  restore: "恢复",
  import: "导入",
  bulk_import: "批量导入",
  delete: "删除",
  tour: "调整巡演归属",
};

/**
 * Audit actions are stored as machine keys (`change.publish_update`,
 * `content.setlist.update`). Reviewers read them as sentences, so known shapes are
 * spelled out; an unknown key is shown as stored rather than guessed at.
 */
export function auditActionLabel(action: string): string {
  const change = /^change\.(propose|publish)_(.+)$/.exec(action);
  if (change) {
    const operation = CHANGE_OPERATION_LABELS[change[2]!];
    if (operation) return `${change[1] === "propose" ? "提交提案" : "发布提案"} · ${operation}`;
  }
  if (action === "change.discard") return "丢弃提案";
  if (action in COMMENT_ACTION_LABELS) return COMMENT_ACTION_LABELS[action]!;
  const parts = action.replace(/^content\./, "").split(".");
  if (parts.length === 2) {
    const entity = ENTITY_LABELS[parts[0]!];
    const verb = VERB_LABELS[parts[1]!];
    if (entity && verb) return parts[1] === "tour" ? `${verb}（${entity}）` : `${verb}${entity}`;
  }
  return action;
}

const COMMENT_ACTION_LABELS: Record<string, string> = {
  "comment.hide": "隐藏留言",
  "comment.restore": "恢复留言",
  "comment.delete": "删除留言",
  "comment.block": "封禁留言来源",
  "comment.unblock": "解除来源封禁",
  "comment.settings": "修改留言屏蔽词",
};

const TARGET_LABELS: Record<string, string> = {
  event: "活动",
  change_set: "提案",
  setlist: "Setlist",
  release: "专辑",
  song: "歌曲",
  tour: "巡演",
  venue: "场馆",
  import_job: "导入任务",
  comment: "留言",
  comment_source: "留言来源",
  comment_settings: "留言设置",
};

export const AUDIT_TARGET_TYPES = Object.keys(TARGET_LABELS);

export const AUDIT_CHANNEL_LABELS: Record<string, string> = { admin: "后台", mcp: "MCP", import: "导入", system: "系统" };

export function auditTargetLabel(targetType: string): string {
  return TARGET_LABELS[targetType] ?? targetType;
}

/** Where a reviewer can open the record an audit entry touched, when the admin has a page for it. */
export function auditTargetHref(targetType: string, targetId: string | null): string | null {
  if (!targetId) return null;
  const id = encodeURIComponent(targetId);
  switch (targetType) {
    case "event": return `/admin/events/${id}`;
    case "change_set": return `/admin/changes/${id}`;
    case "setlist": return `/admin/music/setlists/${id}`;
    case "release": return `/admin/music/releases/${id}`;
    case "song": return `/admin/music/songs/${id}`;
    case "tour": return `/admin/tours/${id}`;
    case "venue": return `/admin/venues/${id}`;
    default: return null;
  }
}
