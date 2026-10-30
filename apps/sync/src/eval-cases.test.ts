import { expect, it } from "vitest";
import { evaluationCases, evaluationInput, scoreEvaluation } from "./eval-cases";

function correctOutput() {
  return { cases: evaluationCases.map((test) => ({ case_id: test.case_id, decision: test.expected.decision, reason: "fixture expectation", actions: test.expected.actions.map((expected) => ({
    operation: expected.operation, target_event_id: expected.target_event_id ?? null,
    title: expected.title_includes ?? (expected.occurrence === "part:2" ? "【第2部】event" : test.title),
    category: expected.category, classification: expected.classification ?? null, start_date: expected.start_date ?? null,
    end_date: expected.end_date ?? null, start_time: expected.start_time ?? null, location_mode: expected.location_mode ?? null,
    needs_review: false, evidence_refs: [test.paragraphs[0].id], reason: "public evidence",
  })) })) };
}
it("does not reveal expected answers in the evaluation inputs", () => {
  expect(JSON.stringify(evaluationInput())).not.toContain('"expected"');
});
it("scores dates, occurrence identity and unnecessary review rather than the model's own confidence", () => {
  const output = correctOutput();
  expect(scoreEvaluation(output).passed).toBe(evaluationCases.length);
  output.cases.find((test) => test.case_id === "night-tv")!.actions[0].start_date = "2025-07-29";
  const result = scoreEvaluation(output);
  expect(result.passed).toBe(evaluationCases.length - 1);
  expect(result.cases.find((test) => test.case_id === "night-tv")?.passed).toBe(false);
});
it("rejects fabricated evidence references and duplicated case answers", () => {
  const output = correctOutput(); output.cases[0].actions[0].evidence_refs = ["invented"];
  expect(scoreEvaluation(output).cases[0].errors).toContain("evidence_refs");
  output.cases.push(output.cases[0]);
  expect(scoreEvaluation(output).cases[0].errors).toContain("missing_or_duplicate_case");
});
