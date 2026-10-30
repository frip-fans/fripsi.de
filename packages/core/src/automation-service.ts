import { ChangeService } from "./change-service";
import { actionKey, applyAction, type ActionOutcome } from "./official-publish";
import { actionSchema, type SyncAction } from "./official-sync-schema";
import { eventDraftSchema } from "./schema";
import { verifyEvidence, readOfficialArticle, officialArticleUrl, evidenceParagraphs, sourceDateCandidates, type OfficialArticle } from "./official-source";
import { getChangeSet, getChangeSetByKey } from "./repository";
import { automationSubject } from "./automation-auth";
import type { Actor, ChangePreview, ChangeSet } from "./types";
import { assertScope, nowIso, ServiceError } from "./utils";
import { canonicalClassification, policyExclusion, SYNC_TOOL_LIMIT, sameActivityTitle, sourceStartTimes, normalizeBroadcastTime, normalizeClockNotation } from "./sync-policy";

type ArticleReader = (url: string, refresh?: boolean) => Promise<OfficialArticle>;
export type ProposalOutcome = Omit<ActionOutcome, "status"> & {
  status: ActionOutcome["status"] | "proposed" | "ignored";
  change_set_id?: string; next_action?: string;
};

async function digest(preview: ChangePreview): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(preview)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class AutomationService {
  constructor(private readonly db: D1Database, private readonly verify: typeof verifyEvidence = verifyEvidence,
    private readonly reader: ArticleReader = (url, refresh) => readOfficialArticle(db, url, refresh)) {}

  private async authorize(actor: Actor, publish = false): Promise<string> {
    assertScope(actor, "events:draft");
    if (!actor.automation_run_id || actor.id !== automationSubject || actor.type !== "ai" || actor.channel !== "mcp") throw new ServiceError("forbidden", "需要专用自动同步身份", 403);
    const run = await this.db.prepare("SELECT status, auto_publish, created_at FROM official_sync_runs WHERE id = ?")
      .bind(actor.automation_run_id).first<{ status: string; auto_publish: number; created_at: string }>();
    if (!run || !["starting", "running"].includes(run.status) || Date.now() - Date.parse(run.created_at) >= 3_600_000) {
      throw new ServiceError("inactive_run", "自动同步任务已结束或过期", 403);
    }
    if (publish) {
      assertScope(actor, "events:auto_publish");
      if (run.auto_publish !== 1) throw new ServiceError("forbidden", "当前任务未授权自动发布", 403);
    }
    return actor.automation_run_id;
  }

  async countTool(actor: Actor): Promise<string> {
    const runId = await this.authorize(actor);
    const result = await this.db.prepare(`UPDATE official_sync_runs SET tool_calls=tool_calls+1,
      stop_requested=CASE WHEN tool_calls>=? THEN 1 ELSE stop_requested END WHERE id=? AND tool_calls<?`)
      .bind(SYNC_TOOL_LIMIT - 1, runId, SYNC_TOOL_LIMIT).run();
    if (!result.meta.changes) throw new ServiceError("tool_budget_exceeded", "本次工具调用已到上限，停止新操作", 429);
    return runId;
  }

  async readSource(url: string, actor: Actor, refresh = false) {
    const runId = await this.countTool(actor), article = await this.reader(officialArticleUrl(url), refresh);
    await this.db.prepare("INSERT INTO official_sync_run_sources (run_id,url,content_hash) VALUES (?,?,?) ON CONFLICT(run_id,url) DO UPDATE SET content_hash=excluded.content_hash")
      .bind(runId, article.url, article.content_hash).run();
    return { source_url: article.url, source_revision: article.content_hash, title: article.title, published_date: article.published_date,
      content_type: "untrusted_public_article", paragraphs: article.paragraphs };
  }

  private async prepareAction(action: SyncAction, actor: Actor, refresh: boolean): Promise<{ action: SyncAction; verifiedRefs: boolean; excluded: string | null; reviewReason?: string }> {
    const run = await this.db.prepare("SELECT policy_version FROM official_sync_runs WHERE id=?").bind(actor.automation_run_id!).first<{ policy_version: string }>();
    if (run?.policy_version === "official-sync-v2" && !action.evidence_refs.length) {
      throw new ServiceError("source_evidence_required", "先 sources.read，再使用返回的 source_revision 与 evidence_refs；不要自行拼接引文", 400,
        { next_action: "sources.read", source_url: action.source_url });
    }
    if (!action.evidence_refs.length) return { action, verifiedRefs: false, excluded: action.operation === "create" && action.event.category === "OTHER" ? "manual_calendar_category" : null };
    const article = await this.reader(officialArticleUrl(action.source_url), refresh);
    const selected = evidenceParagraphs(article, action.source_revision, action.evidence_refs);
    const quote = selected.map((part) => part.text).join("\n"), text = `${article.title}\n${quote}`;
    const fullText = `${article.title}\n${article.paragraphs.map((part) => part.text).join("\n")}`;
    const category = action.operation === "create" ? action.event.category : action.operation === "update" ? action.patch.category : undefined;
    const excluded = category ? policyExclusion(category, article.title, fullText) : null;
    if (excluded) return { action, verifiedRefs: true, excluded };
    const fields = action.operation === "create" ? action.event : action.operation === "update" ? action.patch : null;
    let reviewReason = action.needs_review ? "常规模型仍不确定，独立复核" : undefined;
    if (action.operation === "status_change" || (action.operation === "update" && ["start_date", "end_date", "start_time", "end_time", "venues"].some((key) => key in action.patch))) reviewReason = "日期、时刻、场馆或状态的关键变更，自动独立复核";
    const titleEpisode = article.title.match(/第(\d+)回/);
    const detailEpisode = article.paragraphs.find((part) => part.section === "配信詳細" && /第\d+回/.test(part.text))?.text.match(/第(\d+)回/);
    if (titleEpisode && detailEpisode && titleEpisode[1] !== detailEpisode[1]) reviewReason = "官网标题与正文期数不一致，结合归档链自动复核";
    if (fields) {
      const dateEvidence = selected.filter((part) => !/募集期間|申込期間|応募期間|受付期間|当落発表/.test(part.section ?? "")
        && !(/募集|応募|締切|当落/.test(part.text) && !/開催日程|開催日時|旅行期間|放送日時|開演|発売日/.test(part.text))).map((part) => part.text).join("\n");
      const dates = sourceDateCandidates(dateEvidence, article.published_date, article.title);
      if (sourceDateCandidates(dateEvidence, article.published_date, article.title, false).size > 1 && !fields.end_date && !/Tour|ツアー|巡演|第?[1-9一二三四五六七八九]部|DAY\s*\d/i.test(fullText)) reviewReason = "所选证据包含多个可能的活动日期，自动复核日期角色";
      if (!dates.size && ["MEDIA", "RELEASE"].includes(category ?? "") && /公開しました|公開されました|公開中|掲載されました|掲載中|本日発売|配信開始/.test(quote) && article.published_date) dates.add(article.published_date);
      for (const key of ["start_date", "end_date"] as const) if (fields[key] && !dates.has(fields[key]!)) {
        throw new ServiceError("date_evidence_missing", `${key} 未被所选段落支持，请重新选取活动日期段落；深夜25点按次日换算`, 400, { field: key, next_action: "repair_evidence" });
      }
      for (const key of ["start_time", "end_time"] as const) if (fields[key]) {
        const possible = [...normalizeClockNotation(quote).matchAll(/\b(\d{1,2}):([0-5]\d)\b/g)].map((match) => `${String(Number(match[1]) % 24).padStart(2,"0")}:${match[2]}`);
        if (!possible.includes(fields[key]!)) throw new ServiceError("time_evidence_missing", `${key} 未被证据支持，请区分開場和開演，并使用实际当地时刻`, 400);
      }
      const starts = sourceStartTimes(selected.map((part) => `${part.section ?? ""}\n${part.text}`).join("\n"), fields.title ?? article.title);
      if (fields.start_time && starts.length === 1) {
        const rawDates = [...sourceDateCandidates(dateEvidence, article.published_date, article.title, false)];
        const normalized = normalizeBroadcastTime(rawDates[0] ?? fields.start_date ?? article.published_date ?? "2000-01-01", starts[0]);
        if (fields.start_time !== normalized.time) throw new ServiceError("start_time_role_mismatch", "start_time 应使用開演/開始时刻而非開場或结束时间，请按证据修正", 400, { expected_time: normalized.time, next_action: "repair_fields" });
        if (fields.start_date && rawDates.length === 1 && Number(starts[0].split(":")[0]) >= 24 && fields.start_date !== normalized.date) throw new ServiceError("broadcast_day_mismatch", "深夜24点以后的时刻属于次日，请修正实际日期", 400, { expected_date: normalized.date, expected_time: normalized.time });
      }
      if (fields.venues) for (const venue of fields.venues) if (venue.canonical_name && !text.normalize("NFKC").replace(/\s+/g, "").toLowerCase().includes(venue.canonical_name.normalize("NFKC").replace(/\s+/g, "").toLowerCase())) {
        throw new ServiceError("venue_evidence_missing", "所选证据没有场馆名称，请增加场馆所在段落；未公开场馆不猜测", 400);
      }
    }
    if (action.operation === "status_change") {
      const expressions = { cancelled: /中止|キャンセル/, postponed: /延期|変更|振替/, scheduled: /開催|実施|再開|振替/, completed: /終了|開催しました|実施しました|放送しました|公開しました/ };
      if (!expressions[action.status].test(text)) throw new ServiceError("status_evidence_missing", "状态变更缺少对应官方表述，请查阅相关段落", 400);
    }
    let normalized: SyncAction = { ...action, source_url: article.url, evidence_quote: quote.slice(0, 8000), evidence_refs: selected.map((part) => part.id) };
    if (normalized.operation === "create") normalized = { ...normalized, event: { ...normalized.event, classification: canonicalClassification(normalized.event.category, normalized.event.classification), sources: normalized.event.sources.map((source) => ({ ...source, url: officialArticleUrl(source.url) })) } };
    return { action: normalized, verifiedRefs: true, excluded: null, reviewReason };
  }

  async propose(raw: unknown, actor: Actor): Promise<ProposalOutcome> {
    const runId = await this.countTool(actor);
    const prepared = await this.prepareAction(actionSchema.parse(raw), actor, false), action = prepared.action;
    if (prepared.excluded) return { status: "ignored", code: prepared.excluded, next_action: "continue" };
    const count = await this.db.prepare("SELECT COUNT(*) AS n FROM official_sync_changes WHERE run_id = ?").bind(runId).first<{ n: number }>();
    if ((count?.n ?? 0) >= 20) {
      const existing = await getChangeSetByKey(this.db, await actionKey(action));
      const linked = existing && await this.db.prepare("SELECT change_id FROM official_sync_changes WHERE run_id = ? AND change_id = ?")
        .bind(runId, existing.id).first();
      if (!linked) throw new ServiceError("run_limit", "每次自动同步最多处理 20 条变更", 409);
    }
    const outcome = await applyAction(this.db, action, [action.source_url], false, this.verify, actor);
    if (!outcome.change_id || outcome.status === "unchanged" || outcome.status === "blocked") return outcome;
    await this.db.prepare(`INSERT OR IGNORE INTO official_sync_changes (run_id, change_id, action_json, created_at)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM official_sync_changes WHERE run_id = ?) < 20`)
      .bind(runId, outcome.change_id, JSON.stringify(action), nowIso(), runId).run();
    const linked = await this.db.prepare("SELECT change_id FROM official_sync_changes WHERE run_id = ? AND change_id = ?")
      .bind(runId, outcome.change_id).first();
    if (!linked) throw new ServiceError("run_limit", "自动同步变更数量已达上限", 409);
    const previous = await this.db.prepare("SELECT action_json FROM official_sync_changes WHERE run_id=? AND change_id=?").bind(runId, outcome.change_id).first<{ action_json: string }>();
    if (previous && previous.action_json !== JSON.stringify(action)) {
      await this.db.batch([
        this.db.prepare("UPDATE official_sync_changes SET action_json=?,preview_digest=NULL WHERE run_id=? AND change_id=?")
          .bind(JSON.stringify(action), runId, outcome.change_id),
        this.db.prepare(`INSERT INTO audit_logs (id,actor_id,actor_type,channel,action,target_type,target_id,request_id,before_json,after_json,metadata_json,created_at)
          VALUES (?,?,?,'mcp','automation.evidence_corrected','change_set',?,?,?,?,?,?)`)
          .bind(crypto.randomUUID(), actor.id, actor.type, outcome.change_id, crypto.randomUUID(), previous.action_json, JSON.stringify(action), JSON.stringify({ run_id: runId, role: actor.automation_role ?? "primary" }), nowIso()),
      ]);
    }
    return { ...outcome, status: "proposed", change_set_id: outcome.change_id,
      next_action: outcome.code === "preview_warning" || outcome.code === "normalized_duplicate" ? "inspect_candidates_then_preview" : "changes.preview" };
  }

  async preview(changeId: string, actor: Actor) {
    const runId = await this.countTool(actor);
    await this.requireLinked(runId, changeId, actor);
    const preview = await new ChangeService(this.db).preview(changeId, actor);
    const previewDigest = await digest(preview);
    await this.db.prepare("UPDATE official_sync_changes SET preview_digest = ? WHERE run_id = ? AND change_id = ?")
      .bind(previewDigest, runId, changeId).run();
    return { ...preview, preview_digest: previewDigest, next_action: preview.warnings.length ? "resolve_warning_or_request_review" : "changes.publish_automatic" };
  }

  private async requireLinked(runId: string, changeId: string, actor: Actor) {
    const link = await this.db.prepare("SELECT action_json, preview_digest FROM official_sync_changes WHERE run_id = ? AND change_id = ?")
      .bind(runId, changeId).first<{ action_json: string; preview_digest: string | null }>();
    const change = await getChangeSet(this.db, changeId);
    if (!link || !change || change.created_by !== actor.id || !["create", "update", "status_change"].includes(change.operation)) {
      throw new ServiceError("forbidden", "只能处理当前自动同步任务关联的活动变更", 403);
    }
    return { link, change };
  }

  async publish(changeId: string, previewDigest: string, actor: Actor): Promise<ActionOutcome> {
    await this.countTool(actor);
    const runId = await this.authorize(actor, true);
    const { link, change } = await this.requireLinked(runId, changeId, actor);
    if (!link.preview_digest || previewDigest !== link.preview_digest) throw new ServiceError("preview_required", "必须先预览本次变更", 409);
    if (change.status !== "published") {
      const current = await new ChangeService(this.db).preview(changeId, actor);
      if (await digest(current) !== previewDigest) throw new ServiceError("preview_changed", "资料已变化，请重新查询和预览", 409);
    }
    if (change.status === "published") return { status: "unchanged", change_id: change.id };
    const prepared = await this.prepareAction(actionSchema.parse(JSON.parse(link.action_json)), actor, true), action = prepared.action;
    if (prepared.excluded) return { status: "blocked", change_id: changeId, code: prepared.excluded };
    if (prepared.reviewReason && actor.automation_role !== "review") {
      await this.db.prepare("INSERT INTO official_sync_reviews (run_id,change_id,reason,status) VALUES (?,?,?,'queued') ON CONFLICT(run_id,change_id) DO UPDATE SET reason=excluded.reason,status='queued'")
        .bind(runId, changeId, prepared.reviewReason).run();
      return { status: "review", change_id: changeId, code: "automatic_review_queued" };
    }
    const outcome = await applyAction(this.db, action, [action.source_url], true, prepared.verifiedRefs ? async () => true : this.verify, actor, change);
    if (outcome.status === "published" || outcome.status === "unchanged") await this.db.prepare("UPDATE official_sync_reviews SET status='resolved' WHERE run_id=? AND change_id=?").bind(runId, changeId).run();
    if (outcome.status === "published" || outcome.status === "unchanged") await this.db.prepare("UPDATE official_sync_source_reviews SET status='resolved' WHERE run_id=? AND source_url=?").bind(runId, action.source_url).run();
    if (outcome.status === "published" && action.operation === "create") {
      // Clean up only the bot's clearly equivalent, unpublished drafts. Never revise a published event here.
      const pending = await this.db.prepare("SELECT * FROM change_sets WHERE operation='create' AND status='proposed' AND created_by=? AND source_url=? LIMIT 30")
        .bind(actor.id, action.source_url).all<ChangeSet>();
      for (const candidate of pending.results) {
        const parsed = eventDraftSchema.safeParse(JSON.parse(candidate.payload_json).event);
        if (!parsed.success) continue;
        const other = parsed.data;
        if (other.category !== action.event.category || other.location_mode !== action.event.location_mode || other.start_date !== action.event.start_date
          || (other.end_date ?? other.start_date) !== (action.event.end_date ?? action.event.start_date)
          || (other.start_time ?? null) !== (action.event.start_time ?? null) || !sameActivityTitle(other.title, action.event.title)) continue;
        const names = (venues: typeof other.venues) => venues.map((venue) => (venue.canonical_name || venue.display_name_snapshot || venue.venue_id || "").normalize("NFKC").replace(/\s+/g,""));
        const left = names(other.venues), right = names(action.event.venues);
        if (left.length && right.length && !left.some((name) => right.includes(name))) continue;
        await new ChangeService(this.db).discard(candidate.id, actor);
        await this.db.prepare("UPDATE official_sync_reviews SET status='resolved' WHERE change_id=?").bind(candidate.id).run();
      }
    }
    return outcome;
  }

  async inspect(changeId: string, actor: Actor) {
    const runId = await this.countTool(actor), { link, change } = await this.requireLinked(runId, changeId, actor);
    return { change_set_id: change.id, status: change.status, action: JSON.parse(link.action_json), next_action: "sources.read" };
  }

  async requestReview(changeId: string, reason: string, actor: Actor) {
    const runId = await this.countTool(actor); await this.requireLinked(runId, changeId, actor);
    const status = actor.automation_role === "review" ? "unresolved" : "queued";
    await this.db.prepare("INSERT INTO official_sync_reviews (run_id,change_id,reason,status) VALUES (?,?,?,?) ON CONFLICT(run_id,change_id) DO UPDATE SET reason=excluded.reason,status=excluded.status")
      .bind(runId, changeId, reason.slice(0, 1000), status).run();
    return { change_set_id: changeId, status: status === "queued" ? "review_queued" : "pending_information", next_action: "continue", message: status === "queued" ? "将由 Sol 自动复核，继续处理其他公告" : "自动复核仍缺少可靠信息，等待新的官方资料或后台处理" };
  }

  async requestSourceReview(url: string, reason: string, actor: Actor) {
    const runId = await this.countTool(actor), source = await this.reader(officialArticleUrl(url));
    const status = actor.automation_role === "review" ? "unresolved" : "queued";
    await this.db.prepare("INSERT INTO official_sync_source_reviews (run_id,source_url,reason,status) VALUES (?,?,?,?) ON CONFLICT(run_id,source_url) DO UPDATE SET reason=excluded.reason,status=excluded.status")
      .bind(runId, source.url, reason.slice(0, 1000), status).run();
    return { source_url: source.url, status: status === "queued" ? "review_queued" : "pending_information", next_action: "continue" };
  }

  async discard(changeId: string, actor: Actor) {
    const runId = await this.countTool(actor); await this.requireLinked(runId, changeId, actor);
    const change = await new ChangeService(this.db).discard(changeId, actor);
    await this.db.prepare("UPDATE official_sync_reviews SET status='resolved' WHERE run_id=? AND change_id=?").bind(runId, changeId).run();
    return { change_set_id: change.id, status: change.status };
  }
}
