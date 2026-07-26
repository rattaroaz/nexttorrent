import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  UPDATE_FEED_UNAVAILABLE_MESSAGE,
  isUpdateFeedUnavailable,
} from "./updateService";

const checkMock = vi.fn();
const relaunchMock = vi.fn();
const askMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));

describe("isUpdateFeedUnavailable", () => {
  it("detects missing feed errors", () => {
    expect(
      isUpdateFeedUnavailable(
        "Could not fetch a valid release JSON from the remote",
      ),
    ).toBe(true);
    expect(isUpdateFeedUnavailable("failed to fetch endpoint")).toBe(true);
    expect(isUpdateFeedUnavailable("HTTP 404")).toBe(true);
    expect(isUpdateFeedUnavailable("asset not found")).toBe(true);
    expect(isUpdateFeedUnavailable("signature mismatch")).toBe(false);
  });
});

describe("checkForUpdatesAndApply", () => {
  beforeEach(() => {
    checkMock.mockReset();
    relaunchMock.mockReset();
    askMock.mockReset();
    vi.resetModules();
  });

  it("shows up to date when no update object", async () => {
    checkMock.mockResolvedValueOnce(null);
    const { checkForUpdatesAndApply } = await import("./updateService");
    const { getUpdateUiState } = await import("./updateUi");
    await checkForUpdatesAndApply();
    expect(checkMock).toHaveBeenCalledWith({ allowDowngrades: false });
    expect(getUpdateUiState().phase).toBe("up_to_date");
    expect(askMock).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("refuses equal or older remote versions", async () => {
    checkMock.mockResolvedValueOnce({
      version: "0.1.0",
      downloadAndInstall: vi.fn(),
    });
    const { checkForUpdatesAndApply } = await import("./updateService");
    const { getUpdateUiState } = await import("./updateUi");
    await checkForUpdatesAndApply();
    expect(getUpdateUiState().phase).toBe("up_to_date");
    expect(askMock).not.toHaveBeenCalled();
  });

  it("downloads, installs, and relaunches when user confirms", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValueOnce({
      version: "9.9.9",
      downloadAndInstall,
    });
    askMock.mockResolvedValueOnce(true);
    const { checkForUpdatesAndApply } = await import("./updateService");
    await checkForUpdatesAndApply();
    expect(downloadAndInstall).toHaveBeenCalled();
    expect(relaunchMock).toHaveBeenCalled();
  });

  it("maps missing feed errors to setup guidance", async () => {
    checkMock.mockRejectedValueOnce(
      new Error("failed to fetch: 404 not found"),
    );
    const { checkForUpdatesAndApply } = await import("./updateService");
    const { getUpdateUiState } = await import("./updateUi");
    await checkForUpdatesAndApply();
    expect(getUpdateUiState().phase).toBe("error");
    expect(getUpdateUiState().message).toBe(UPDATE_FEED_UNAVAILABLE_MESSAGE);
  });
});
