import { describe, expect, it } from "vitest";
import { auditActionLabel, auditTargetHref, auditTargetLabel } from "./admin-labels";

describe("auditActionLabel", () => {
  it("spells out proposal actions with their operation", () => {
    expect(auditActionLabel("change.propose_create")).toBe("提交提案 · 新增活动");
    expect(auditActionLabel("change.publish_status_change")).toBe("发布提案 · 变更状态");
    expect(auditActionLabel("change.discard")).toBe("丢弃提案");
  });

  it("reads entity actions with or without the content prefix", () => {
    expect(auditActionLabel("event.update")).toBe("修改活动");
    expect(auditActionLabel("content.setlist.create")).toBe("新增Setlist");
    expect(auditActionLabel("content.events.bulk_import")).toBe("批量导入活动");
    expect(auditActionLabel("content.event.tour")).toBe("调整巡演归属（活动）");
  });

  it("keeps a key it does not know", () => {
    expect(auditActionLabel("change.propose_unknown")).toBe("change.propose_unknown");
    expect(auditActionLabel("system.vacuum")).toBe("system.vacuum");
  });
});

describe("audit targets", () => {
  it("links only record types the admin can open", () => {
    expect(auditTargetHref("event", "evt_1")).toBe("/admin/events/evt_1");
    expect(auditTargetHref("change_set", "chg_1")).toBe("/admin/changes/chg_1");
    expect(auditTargetHref("import_job", "job_1")).toBeNull();
    expect(auditTargetHref("event", null)).toBeNull();
  });

  it("falls back to the stored type", () => {
    expect(auditTargetLabel("setlist")).toBe("Setlist");
    expect(auditTargetLabel("webhook")).toBe("webhook");
  });
});
