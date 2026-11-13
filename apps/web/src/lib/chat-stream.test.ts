import { expect, it } from "vitest";
import { foldTurnText, newTurnText, turnAnswer } from "./chat";

const delta = (item: string, text: string, content = 0) => ({
  type: "agent.session.turn.output_text.delta", item_id: item, content_index: content, delta: text,
});
const finished = (item: string, text: string, content = 0) => ({
  type: "agent.session.turn.output_text.done", item_id: item, content_index: content, text,
});

/** Shapes taken from a real gpt-6.1-sol turn: a preamble, a web search, then the answer. */
it("streams every part but keeps only the final answer", () => {
  const state = newTurnText();
  expect(foldTurnText(state, delta("msg_pre", "我"))).toEqual(["我"]);
  expect(foldTurnText(state, delta("msg_pre", "查一下"))).toEqual(["查一下"]);
  foldTurnText(state, finished("msg_pre", "我查一下。"));
  state.answers.add("msg_final");
  // A new item is separated in the live bubble so the two messages do not run together.
  expect(foldTurnText(state, delta("msg_final", "8 月 31 日"))).toEqual(["\n\n", "8 月 31 日"]);
  foldTurnText(state, finished("msg_final", "8 月 31 日那场在 17:00 开演。"));
  expect(turnAnswer(state)).toBe("8 月 31 日那场在 17:00 开演。");
});

it("prefers the authoritative done text over the deltas that built it", () => {
  const state = newTurnText();
  state.answers.add("msg_a");
  foldTurnText(state, delta("msg_a", "部分"));
  foldTurnText(state, finished("msg_a", "完整的回复文本"));
  expect(turnAnswer(state)).toBe("完整的回复文本");
});

it("keeps a final answer whose deltas were missed before the stream attached", () => {
  const state = newTurnText();
  state.answers.add("msg_a");
  foldTurnText(state, finished("msg_a", "没有收到 delta 的回复"));
  expect(turnAnswer(state)).toBe("没有收到 delta 的回复");
});

it("joins several parts of one final answer", () => {
  const state = newTurnText();
  state.answers.add("msg_a");
  foldTurnText(state, finished("msg_a", "第一段", 0));
  foldTurnText(state, finished("msg_a", "第二段", 1));
  expect(turnAnswer(state)).toBe("第一段\n\n第二段");
});

it("falls back to the last part when no item is marked as the final answer", () => {
  const state = newTurnText();
  foldTurnText(state, finished("msg_pre", "前导"));
  foldTurnText(state, finished("msg_b", "最后一段"));
  expect(turnAnswer(state)).toBe("最后一段");
});

it("ignores text events without usable payloads and reports no answer", () => {
  const state = newTurnText();
  expect(foldTurnText(state, { type: "agent.session.turn.output_text.delta", item_id: "a" })).toEqual([]);
  expect(foldTurnText(state, { type: "agent.session.turn.content_part.added" })).toEqual([]);
  expect(turnAnswer(state)).toBe("");
});
