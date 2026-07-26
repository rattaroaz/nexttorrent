import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  UPDATE_FEED_UNAVAILABLE_MESSAGE,
  isUpdateFeedUnavailable,
} from "./updateService";

const checkFeedMock = vi.fn();
const downloadInstallMock = vi.fn();
const askMock = vi.fn();

vi.mock("../ipc/client", () => ({
  updaterCheckFeed: (...args: unknown[]) => checkFeedMock(...args),
  updaterDownloadAndInstall: (...args: unknown[]) =>
    downloadInstallMock(...args),
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
    expect(isUpdateFeedUnavailable("error sending request for url")).toBe(true);
    expect(isUpdateFeedUnavailable("HTTP 404")).toBe(true);
    expect(isUpdateFeedUnavailable("asset not found")).toBe(true);
    expect(isUpdateFeedUnavailable("signature mismatch")).toBe(false);
  });
});

describe("checkForUpdatesAndApply", () => {
  beforeEach(() => {
    checkFeedMock.mockReset();
    downloadInstallMock.mockReset();
    askMock.mockReset();
    vi.resetModules();
  });

  it("shows up to date when feed status is up_to_date", async () => {
    checkFeedMock.mockResolvedValueOnce({
      status: "up_to_date",
      installedVersion: "1.1.0",
      remoteVersion: "1.1.0",
    });
    const { checkForUpdatesAndApply } = await import("./updateService");
    const { getUpdateUiState } = await import("./updateUi");
    await checkForUpdatesAndApply();
    expect(checkFeedMock).toHaveBeenCalled();
    expect(getUpdateUiState().phase).toBe("up_to_date");
    expect(askMock).not.toHaveBeenCalled();
    expect(downloadInstallMock).not.toHaveBeenCalled();
  });

  it("refuses when status is not available", async () => {
    checkFeedMock.mockResolvedValueOnce({
      status: "up_to_date",
      installedVersion: "1.1.0",
      remoteVersion: "0.1.0",
    });
    const { checkForUpdatesAndApply } = await import("./updateService");
    const { getUpdateUiState } = await import("./updateUi");
    await checkForUpdatesAndApply();
    expect(getUpdateUiState().phase).toBe("up_to_date");
    expect(askMock).not.toHaveBeenCalled();
  });

  it("downloads and installs when user confirms", async () => {
    checkFeedMock.mockResolvedValueOnce({
      status: "available",
      installedVersion: "1.0.0",
      remoteVersion: "9.9.9",
      downloadUrl: "https://example.com/setup.exe",
      signature: "sig",
    });
    askMock.mockResolvedValueOnce(true);
    downloadInstallMock.mockResolvedValueOnce(undefined);
    const { checkForUpdatesAndApply } = await import("./updateService");
    await checkForUpdatesAndApply();
    expect(downloadInstallMock).toHaveBeenCalledWith(
      "https://example.com/setup.exe",
      "sig",
      "9.9.9",
    );
  });

  it("maps missing feed errors to setup guidance", async () => {
    checkFeedMock.mockRejectedValueOnce(
      new Error("failed to fetch: 404 not found"),
    );
    const { checkForUpdatesAndApply } = await import("./updateService");
    const { getUpdateUiState } = await import("./updateUi");
    await checkForUpdatesAndApply();
    expect(getUpdateUiState().phase).toBe("error");
    expect(getUpdateUiState().message).toBe(UPDATE_FEED_UNAVAILABLE_MESSAGE);
  });
});
