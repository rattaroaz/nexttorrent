import { describe, expect, it } from "vitest";

/** Mirrors lightweight client-side checks; authoritative validation is on the Rust side. */
function clientMagnetPreflight(raw: string): boolean {
  const s = raw.trim();
  return s.startsWith("magnet:?") && s.length <= 16 * 1024;
}

describe("magnet IPC client preflight", () => {
  it("accepts typical magnet prefix", () => {
    expect(
      clientMagnetPreflight(
        "magnet:?xt=urn:btih:cab507494d02ebb1178b38f2e9d7be299c86b862",
      ),
    ).toBe(true);
  });

  it("rejects plain HTTP URLs", () => {
    expect(clientMagnetPreflight("https://example.com/file.torrent")).toBe(
      false,
    );
  });
});
