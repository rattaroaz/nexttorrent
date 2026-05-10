import { describe, expect, it } from "vitest";

import { normalizeDialogFilePath } from "./dialogPaths";

describe("normalizeDialogFilePath", () => {
  it("returns null for null", () => {
    expect(normalizeDialogFilePath(null)).toBeNull();
  });

  it("returns string as-is", () => {
    expect(normalizeDialogFilePath("/a/b.torrent")).toBe("/a/b.torrent");
  });

  it("takes first element from array", () => {
    expect(normalizeDialogFilePath(["/first", "/second"])).toBe("/first");
  });

  it("returns null for empty array", () => {
    expect(normalizeDialogFilePath([])).toBeNull();
  });
});
