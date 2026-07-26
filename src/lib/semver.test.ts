import { describe, expect, it } from "vitest";

import { isVersionNewer, parseSemver } from "./semver";

describe("parseSemver", () => {
  it("parses dotted versions", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("v1.2.0")).toEqual([1, 2, 0]);
    expect(parseSemver("1.2")).toEqual([1, 2, 0]);
    expect(parseSemver("1.2.3-beta+build")).toEqual([1, 2, 3]);
  });

  it("rejects invalid input", () => {
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("abc")).toBeNull();
    expect(parseSemver("1")).toBeNull();
  });
});

describe("isVersionNewer", () => {
  it("compares strictly", () => {
    expect(isVersionNewer("1.2.0", "1.1.9")).toBe(true);
    expect(isVersionNewer("1.1.0", "1.1.0")).toBe(false);
    expect(isVersionNewer("v1.2.0", "1.1.0")).toBe(true);
    expect(isVersionNewer("1.2", "1.1.9")).toBe(true);
    expect(isVersionNewer("1.0.0", "1.0.1")).toBe(false);
  });
});
