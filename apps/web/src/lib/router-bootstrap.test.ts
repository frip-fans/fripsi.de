import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const script = readFileSync(new URL("../scripts/router-bootstrap.js", import.meta.url), "utf8");

describe("router bootstrap during version upgrades", () => {
  it("selects swap before the router initializes in a new document", () => {
    const document = { readyState: "loading", startViewTransition: vi.fn() };
    const reload = vi.fn();
    runInNewContext(script, { document, location: { reload } });
    expect(document.startViewTransition).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });
  it("reloads an existing router instead of invalidating its cached native capability", () => {
    const native = vi.fn();
    const document = { readyState: "complete", startViewTransition: native };
    const reload = vi.fn();
    runInNewContext(script, { document, location: { reload } });
    expect(document.startViewTransition).toBe(native);
    expect(reload).toHaveBeenCalledOnce();
  });
});
