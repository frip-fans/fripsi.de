import { ServiceError } from "@frip-fan/core";
import { z } from "zod";

export function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data }
  };
}

export function failure(error: unknown) {
  const known = error instanceof ServiceError;
  const validation = error instanceof z.ZodError;
  const payload = {
    error: {
      code: known ? error.code : validation ? "invalid_tool_input" : "internal_error",
      message: known ? error.message : validation ? "参数不符合工具 schema，请修正列出的字段后重试" : "工具执行失败",
      ...(validation ? { fields: error.issues.map((issue) => ({ path: issue.path.map(String).join("."), code: issue.code })) } : {}),
      ...(known && error.details ? { details: error.details } : {})
    }
  };
  return { ...result(payload), isError: true };
}
