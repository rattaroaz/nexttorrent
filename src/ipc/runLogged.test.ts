import { describe, expect, it, vi } from "vitest";

import { runLogged, runLoggedVoid } from "./runLogged";

describe("runLogged", () => {
  it("returns result on success", async () => {
    const log = vi.fn();
    const out = await runLogged("test", log, async () => 42);
    expect(out).toBe(42);
    expect(log).not.toHaveBeenCalled();
  });

  it("logs and returns undefined on failure", async () => {
    const log = vi.fn();
    const out = await runLogged("save settings", log, async () => {
      throw new Error("disk full");
    });
    expect(out).toBeUndefined();
    expect(log).toHaveBeenCalledWith("save settings failed: disk full");
  });

  it("runLoggedVoid logs async failures", async () => {
    const log = vi.fn();
    runLoggedVoid("pause", log, async () => {
      throw "nope";
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveBeenCalledWith("pause failed: nope");
  });
});
