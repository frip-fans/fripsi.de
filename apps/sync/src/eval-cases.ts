import { z } from "zod";
import { instructions } from "./prompt";
import { locationModeSchema, occurrenceLabel } from "@frip-fan/core";

const action = z.object({
  operation: z.enum(["create", "update", "status_change"]), target_event_id: z.string().nullable(),
  title: z.string(), category: z.enum(["LIVE", "EVENT", "RELEASE", "MEDIA", "OTHER"]),
  classification: z.string().nullable(), start_date: z.string().nullable(), end_date: z.string().nullable(),
  start_time: z.string().nullable(), location_mode: locationModeSchema.nullable(), needs_review: z.boolean(),
  evidence_refs: z.array(z.string()).max(8), reason: z.string().max(300),
});
export const evaluationSchema = z.object({ cases: z.array(z.object({
  case_id: z.string(), decision: z.enum(["change", "ignore", "review"]), actions: z.array(action).max(3), reason: z.string().max(300),
})).max(20) });

interface ExpectedAction { operation: string; category: string; start_date?: string | null; end_date?: string | null; start_time?: string | null; location_mode?: string; target_event_id?: string; classification?: string; title_includes?: string; occurrence?: string }
export interface EvalCase {
  case_id: string; provenance: string; source_url: string; title: string; published_date: string;
  paragraphs: Array<{ id: string; text: string }>; candidates: Array<Record<string, unknown>>;
  expected: { decision: "change" | "ignore" | "review"; actions: ExpectedAction[] };
}
const p = (...texts: string[]) => texts.map((text, index) => ({ id: `p${index + 1}-${String(index + 1).padStart(12, "0")}`, text }));
const create = (category: string, date: string, time: string | null, extra: Partial<ExpectedAction> = {}): ExpectedAction => ({ operation: "create", category, start_date: date, start_time: time, ...extra });
// Condensed fact fixtures derived from public notice patterns, not complete copied articles.
export const evaluationCases: EvalCase[] = [
  { case_id: "two-parts", provenance: "official /1090598 and established separate calendar sessions", source_url: "https://fripside.net/contents/1090598", title: "infinite Resonance 4 リリースイベント", published_date: "2026-07-09",
    paragraphs: p("2026年10月18日 アニメイト大阪日本橋。第1部 開場12:30/開演13:00。第2部 開場14:30/開演15:00。"),
    candidates: [{ event_id: "existing-part-1", title: "【第1部】infinite Resonance 4 トーク＆特典お渡し会", category: "EVENT", start_date: "2026-10-18", start_time: "13:00", version: 1, source_url: "https://fripside.net/contents/1090598" }],
    expected: { decision: "change", actions: [create("EVENT", "2026-10-18", "15:00", { occurrence: "part:2", classification: "リリースイベント" })] } },
  { case_id: "night-tv", provenance: "official /964688; public calendar normalizes broadcast-day notation", source_url: "https://fripside.net/contents/964688", title: "fripSide（Vo.阿部寿世）TV出演情報", published_date: "2025-07-22",
    paragraphs: p("阿部寿世が TBS PLAYLIST に出演。放送枠は2025年7月29日 25:58〜27:08。"), candidates: [],
    expected: { decision: "change", actions: [create("MEDIA", "2025-07-30", "01:58", { classification: "TV", location_mode: "broadcast" })] } },
  { case_id: "doors-vs-start", provenance: "official /1078715; tour schedule convention", source_url: "https://fripside.net/contents/1078715", title: "fripSide Concert Tour 2026-2027", published_date: "2026-06-05",
    paragraphs: p("2027年1月11日 東京 TACHIKAWA STAGE GARDEN。開場16:30、開演17:30。"), candidates: [],
    expected: { decision: "change", actions: [create("LIVE", "2027-01-11", "17:30", { classification: "专场" })] } },
  { case_id: "postponement", provenance: "official /929331", source_url: "https://fripside.net/contents/929331", title: "ふり森公開生放送 日程変更", published_date: "2025-05-01",
    paragraphs: p("開催日は2025年5月18日から5月25日に変更。開始19:00。"), candidates: [{ event_id: "original-may18", title: "ふり森1周年 公開生放送", category: "EVENT", start_date: "2025-05-18", start_time: "19:00", status: "scheduled", version: 3 }],
    expected: { decision: "change", actions: [{ operation: "update", target_event_id: "original-may18", category: "EVENT", start_date: "2025-05-25" }] } },
  { case_id: "fc-public-broadcast", provenance: "official /1123461", source_url: "https://fripside.net/contents/1123461", title: "「freakSide生放送」製作委員会の森 第31回", published_date: "2026-10-29",
    paragraphs: p("開催日程 2026年11月24日 20:30開始予定。視聴はfreakSide会員限定。公開告知本文です。"), candidates: [],
    expected: { decision: "change", actions: [create("MEDIA", "2026-11-24", "20:30", { classification: "生放送", location_mode: "online" })] } },
  { case_id: "trip-with-program", provenance: "official /1120285 and approved parent-trip policy", source_url: "https://fripside.net/contents/1120285", title: "fripSide FAN MEETING in NARITA", published_date: "2026-10-19",
    paragraphs: p("旅行期間 2026年12月5日〜12月6日 1泊2日。DAY1夜に旅行参加者向け弾き語りミニライブ。ライブ単独参加の募集はありません。"), candidates: [],
    expected: { decision: "change", actions: [create("EVENT", "2026-12-05", null, { end_date: "2026-12-06", classification: "freakSide" })] } },
  { case_id: "unpublished-venue", provenance: "official /929331 venue disclosure policy", source_url: "https://fripside.net/contents/929331", title: "公開生放送のご案内", published_date: "2025-05-01",
    paragraphs: p("2025年5月25日19:00開催。会場は東京都内某所、当選者のみメール案内。"), candidates: [{ event_id: "past-other-event", title: "別の過去イベント", start_date: "2024-05-25", location_label: "御茶ノ水の会議室" }],
    expected: { decision: "change", actions: [create("EVENT", "2025-05-25", "19:00", { location_mode: "undisclosed" })] } },
  { case_id: "album-release", provenance: "official /1090380; calendar RELEASE is distinct from music-library edits", source_url: "https://fripside.net/contents/1090380", title: "infinite Resonance 4 発売決定", published_date: "2026-07-01",
    paragraphs: p("11th Album infinite Resonance 4 は2026年8月26日発売。"), candidates: [],
    expected: { decision: "change", actions: [create("RELEASE", "2026-08-26", null, { classification: "DISCOGRAPHY", location_mode: "none" })] } },
  { case_id: "membership-not-event", provenance: "synthetic membership-policy control using an official-site URL placeholder; not the live linked article", source_url: "https://fripside.net/contents/1123461", title: "VIPコース始動のお知らせ", published_date: "2026-10-23",
    paragraphs: p("2026年11月3日正午よりファンクラブVIPコースに切り替わります。会費と会員制度の変更です。"), candidates: [], expected: { decision: "ignore", actions: [] } },
  { case_id: "birthday-manual", provenance: "synthetic birthday-policy control based on existing OTHER entries; not the live linked article", source_url: "https://fripside.net/contents/1123461", title: "お誕生日おめでとう", published_date: "2026-10-29",
    paragraphs: p("本日はSatさんのお誕生日です。ライブや配信の告知はありません。"), candidates: [], expected: { decision: "ignore", actions: [] } },
  { case_id: "already-current", provenance: "no-op protection using /1123461", source_url: "https://fripside.net/contents/1123461", title: "製作委員会の森 第31回", published_date: "2026-10-29",
    paragraphs: p("第31回は2026年11月24日20:30開始。会員限定オンライン配信。"), candidates: [{ event_id: "already-nov24", title: "【番組】製作委員会の森 第31回", category: "MEDIA", classification: "生放送", start_date: "2026-11-24", start_time: "20:30", timezone: "Asia/Tokyo", location_mode: "online", source_url: "https://fripside.net/contents/1123461", version: 2 }], expected: { decision: "ignore", actions: [] } },
  { case_id: "obvious-template-typo", provenance: "official /774678 title, archive chain and body disagree", source_url: "https://fripside.net/contents/774678", title: "製作委員会の森 第5回放送のご案内", published_date: "2024-08-14",
    paragraphs: p("開催日程 2024年8月21日20:00。", "配信詳細欄は第4回と記載。過去放送アーカイブの先頭は第4回、その前が第3回。"), candidates: [{ event_id: "previous-episode4", title: "製作委員会の森 第4回", category: "MEDIA", start_date: "2024-07-17", start_time: "20:00", version: 1 }],
    expected: { decision: "change", actions: [create("MEDIA", "2024-08-21", "20:00", { title_includes: "第5回" })] } },
  { case_id: "unresolved-date-conflict", provenance: "synthetic mutation control: no corroborating source; not the live linked article", source_url: "https://fripside.net/contents/1123461", title: "イベントのご案内", published_date: "2026-10-29",
    paragraphs: p("開催概要：2026年11月24日。", "同じ催しの実施日：2026年11月25日。訂正や変更の説明はなく、他の資料はありません。"), candidates: [], expected: { decision: "review", actions: [] } },
  { case_id: "two-cities", provenance: "tour split pattern from /1078715", source_url: "https://fripside.net/contents/1078715", title: "fripSide Concert Tour 2026-2027", published_date: "2026-06-05",
    paragraphs: p("2026年12月26日 愛知・一宮市民会館 開演17:30。", "2027年1月11日 東京・TACHIKAWA STAGE GARDEN 開演17:30。"), candidates: [],
    expected: { decision: "change", actions: [create("LIVE", "2026-12-26", "17:30"), create("LIVE", "2027-01-11", "17:30")] } },
];

export const evaluationInstructions = `${instructions.split("【工作步骤】")[0]}
本轮是固定样例评测，无工具、无联网、无数据库写入。所有正文为带来源的压缩事实样例，candidates 是冻结的活动快照。
逐案独立决定 change/ignore/review，只使用给出的信息。change 的 actions 仅列实际应新增/修改的事项；ignore/review 时 actions=[]。
对每个 action 填齐 schema 字段，未知值用 null，evidence_refs 使用本案给出的ID。对无时刻或未公开地点的正常情况仍可创建。
输出唯一 JSON 对象 {cases:[...]}，覆盖所有 case_id。理由简短，不输出运行报告格式。`;

export function evaluationInput(cases = evaluationCases) {
  return { policy_version: "official-sync-v2", cases: cases.map(({ expected: _expected, ...input }) => input) };
}

export function scoreEvaluation(raw: unknown, cases = evaluationCases) {
  const result = evaluationSchema.parse(raw);
  const scores = cases.map((test) => {
    const found = result.cases.filter((item) => item.case_id === test.case_id);
    const errors: string[] = [];
    if (found.length !== 1) return { case_id: test.case_id, passed: false, errors: ["missing_or_duplicate_case"] };
    const actual = found[0];
    if (actual.decision !== test.expected.decision) errors.push("decision");
    if (actual.actions.length !== test.expected.actions.length) errors.push("action_count");
    const remaining = [...actual.actions];
    for (const expected of test.expected.actions) {
      const index = remaining.findIndex((item) => item.operation === expected.operation && item.category === expected.category && (expected.start_date === undefined || item.start_date === expected.start_date));
      if (index < 0) { errors.push("missing_expected_action"); continue; }
      const item = remaining.splice(index, 1)[0];
      for (const key of ["end_date", "start_time", "location_mode", "target_event_id", "classification"] as const) if (expected[key] !== undefined && item[key] !== expected[key]) errors.push(key);
      if (expected.title_includes && !item.title.normalize("NFKC").includes(expected.title_includes.normalize("NFKC"))) errors.push("title");
      if (expected.occurrence && occurrenceLabel(item.title) !== expected.occurrence) errors.push("occurrence");
      if (item.needs_review) errors.push("unnecessary_human_review");
      if (!item.evidence_refs.length || item.evidence_refs.some((id) => !test.paragraphs.some((paragraph) => paragraph.id === id))) errors.push("evidence_refs");
    }
    return { case_id: test.case_id, passed: errors.length === 0, errors: [...new Set(errors)] };
  });
  return { passed: scores.filter((score) => score.passed).length, total: scores.length, cases: scores };
}
