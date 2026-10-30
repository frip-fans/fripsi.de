/// <reference types="node" />
import { expect, it } from "vitest";
import { createTestD1 } from "../../../packages/core/src/test-d1";
import { Budget, estimateUsage } from "./budget";

it("accounts for cached tokens and search calls using an explicit estimate", () => {
  expect(estimateUsage("gpt-6-luna", { input_tokens: 922873, output_tokens: 14440, total_tokens: 937313, input_tokens_details: { cached_tokens: 840099 } }, 3)).toBeCloseTo(0.05389839, 8);
});
it("reserves before starting and does not count cumulative usage twice", async () => {
  const { db, sqlite } = createTestD1();
  try {
    const budget = new Budget(db, "test", 0.1);
    expect(await budget.reserve("primary", "gpt-6-luna", 0.05)).toBe(true);
    expect(await budget.reserve("review", "gpt-6.1-sol", 0.2)).toBe(false);
    await budget.attach("primary", "sess_one");
    const progress = { state: "completed" as const, turn_id: "turn_1", usage: { input_tokens: 100000, output_tokens: 20000, total_tokens: 120000 }, tools: { web_search_calls: 1, mcp_calls: [], history_complete: true } };
    await budget.record("sess_one", "gpt-6-luna", progress); await budget.record("sess_one", "gpt-6-luna", progress);
    await budget.close("primary");
    expect(await budget.exposure()).toBeCloseTo(0.03);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM official_sync_usage").get()).toMatchObject({ n: 1 });
  } finally { sqlite.close(); }
});
