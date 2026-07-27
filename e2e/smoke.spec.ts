import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("add magnet flow", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Nexttorrent")).toBeVisible();

    await page.getByTestId("toolbar-add-torrent").click();
    await expect(page.getByTestId("magnet-input")).toBeVisible();
    const magnet =
      "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await page.getByTestId("magnet-input").fill(magnet);
    await page.getByTestId("add-magnet-submit").click();

    await expect
      .poll(async () =>
        page.evaluate(() => window.__NEXTTORRENT_E2E__?.magnetCalls() ?? []),
      )
      .toContain(magnet);
  });

  test("view logs panel", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("toolbar-view-logs").click();
    await expect(page.getByTestId("logs-side-panel")).toBeVisible();
    await expect(page.getByTestId("logs-level-select")).toBeVisible();
    await expect(page.getByTestId("logs-copy-ai-brief")).toBeVisible();
    await expect(page.getByTestId("logs-export-ai")).toBeVisible();
    await page.getByTestId("logs-level-select").selectOption("warn");
    await page.getByTestId("logs-panel-close").click();
    await expect(page.getByTestId("logs-side-panel")).not.toBeVisible();
  });

  test("settings save", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("toolbar-settings").click();
    await expect(page.getByTestId("settings-theme-select")).toBeVisible();
    await page.getByTestId("settings-theme-select").selectOption("dark");
    await page.getByTestId("settings-save").click();

    await expect
      .poll(async () =>
        page.evaluate(() => window.__NEXTTORRENT_E2E__?.saveCalls() ?? []),
      )
      .toEqual(
        expect.arrayContaining([expect.objectContaining({ theme: "dark" })]),
      );
  });
});

declare global {
  interface Window {
    __NEXTTORRENT_E2E__?: {
      magnetCalls: () => string[];
      saveCalls: () => { theme: string }[];
    };
  }
}
