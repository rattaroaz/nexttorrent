import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  logFrontendEvent: vi.fn().mockResolvedValue(undefined),
}));

import { runLogged, runLoggedVoid } from "./runLogged";

describe("runLogged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns result on success", async () => {
    const log = vi.fn();
    const out = await runLogged("test", log, async () => 42);
    expect(out).toEqual({ ok: true, value: 42 });
    expect(log).not.toHaveBeenCalled();
  });

  it("treats void success as ok, not failure", async () => {
    const log = vi.fn();
    const out = await runLogged("Save settings", log, async () => undefined);
    expect(out).toEqual({ ok: true, value: undefined });
    expect(log).not.toHaveBeenCalled();
  });

  it("logs and returns ok:false on failure", async () => {
    const log = vi.fn();
    const out = await runLogged("save settings", log, async () => {
      throw new Error("disk full");
    });
    expect(out).toEqual({ ok: false });
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^save settings failed: disk full corr=[0-9a-f]{8}$/,
    );
  });

  it("runLoggedVoid logs async failures", async () => {
    const log = vi.fn();
    runLoggedVoid("pause", log, async () => {
      throw "nope";
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^pause failed: nope corr=[0-9a-f]{8}$/,
    );
  });
});
