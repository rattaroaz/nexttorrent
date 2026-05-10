import { describe, expect, it } from "vitest";

import { formatInvokeError } from "./invokeError";

describe("formatInvokeError", () => {
  it("passes through strings", () => {
    expect(formatInvokeError("bad")).toBe("bad");
  });

  it("uses Error.message", () => {
    expect(formatInvokeError(new Error("oops"))).toBe("oops");
  });

  it("reads message from plain objects", () => {
    expect(formatInvokeError({ message: "from obj" })).toBe("from obj");
  });

  it("falls back to JSON for unknown shapes", () => {
    expect(formatInvokeError({ code: 42 })).toBe('{"code":42}');
  });
});
