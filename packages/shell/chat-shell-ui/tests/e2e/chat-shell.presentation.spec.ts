import {expect, test, type Locator, type Page} from "@playwright/test";

function isMobileProject(projectName: string) {
  return projectName.includes("mobile");
}

test.describe("ChatShell presentation Dev Mode", () => {
  test("contains fullscreen scrolling inside the shell", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Desktop window chrome exposes the fullscreen control.");

    await page.goto("/?variant=complete");
    await page.getByRole("button", {name: "Toggle fullscreen"}).click();

    const shell = page.getByTestId("chat-shell-root");
    await expect(shell).toHaveClass(/chat-shell-layout-fullscreen/);
    await expect.poll(() => page.locator(".chat-shell-viewport-fullscreen").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.height === window.innerHeight && bounds.width === window.innerWidth;
    })).toBe(true);
    const metrics = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-testid='chat-shell-root']");
      const viewport = document.querySelector<HTMLElement>(".chat-shell-viewport-fullscreen");
      const scrollingElement = document.scrollingElement;
      if (!root || !viewport || !scrollingElement) throw new Error("Fullscreen shell geometry was unavailable.");
      const rootBounds = root.getBoundingClientRect();
      const viewportBounds = viewport.getBoundingClientRect();
      return {
        documentClientHeight: scrollingElement.clientHeight,
        documentScrollHeight: scrollingElement.scrollHeight,
        rootBounds: {height: rootBounds.height, width: rootBounds.width, x: rootBounds.x, y: rootBounds.y},
        viewportBounds: {height: viewportBounds.height, width: viewportBounds.width},
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth,
      };
    });

    expect(metrics.documentScrollHeight).toBe(metrics.documentClientHeight);
    expect(metrics.rootBounds).toEqual({
      height: metrics.windowHeight,
      width: metrics.windowWidth,
      x: 0,
      y: 0,
    });
    expect(metrics.viewportBounds).toEqual({
      height: metrics.windowHeight,
      width: metrics.windowWidth,
    });
  });

  test("edits, restores, previews, and validates the production patch", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Desktop interaction proof has the full window chrome.");

    await page.goto("/?variant=complete&devtools=1");
    const launcher = page.getByRole("button", {name: "Toggle Dev Mode controls"});
    await expectMainPanelBottomLeft(launcher, page);
    await launcher.click();
    await expectPanelAboveLauncher(
      page.getByRole("region", {name: "Dev Mode controls"}),
      launcher,
    );
    await expect(page.locator("[data-shell-inventory-control-id]")).toHaveCount(20);
    await expect(page.getByRole("button", {name: "Reset draft"})).toBeVisible();

    const status = page.getByRole("button", {name: "Toggle status panel"});
    await expect(status).toBeVisible();
    expect(await status.evaluate((element) =>
      getComputedStyle(element.closest("[data-shell-control-id]") ?? element).outlineColor,
    )).toBe("rgb(255, 69, 58)");
    await expect(page.locator('[data-shell-control-id="chrome.status"]')).toHaveAttribute(
      "data-shell-control-label",
      "Status panel",
    );

    await status.press("Enter");
    await expect(page.locator('[data-shell-control-id="chrome.status"]')).toHaveAttribute("data-shell-devtools-result", "hidden");
    await page.getByRole("group", {name: "Status panel draft override"}).getByRole("button", {name: "Inherit"}).click();
    await expect(page.locator('[data-shell-control-id="chrome.status"]')).toHaveAttribute("data-shell-devtools-result", "shown");
    await status.press("Enter");
    await page.getByRole("button", {name: "Reset draft"}).click();
    await expect(page.locator('[data-shell-control-id="chrome.status"]')).toHaveAttribute("data-shell-devtools-result", "shown");

    await status.click({modifiers: ["Shift"]});
    await page.getByRole("button", {name: /^(?:Expand|Collapse) side pane$/}).click({modifiers: ["Shift"]});
    await page.getByRole("button", {name: "Hide selected (2)"}).click();
    await expect(page.locator('[data-shell-control-id="chrome.status"]')).toHaveAttribute("data-shell-devtools-result", "hidden");
    await expect(page.locator('[data-shell-control-id="chrome.side-panel"]')).toHaveAttribute("data-shell-devtools-result", "hidden");

    await page.getByRole("button", {exact: true, name: "Preview"}).click();
    await expect(page.locator('[data-shell-dev-mode="preview"]')).toBeVisible();
    await expect(page.getByLabel("Hidden components")).toHaveCount(0);
    await launcher.click();
    await page.getByRole("button", {name: "Back to edit"}).click();

    await page.getByRole("button", {exact: true, name: "Export"}).click();
    const exportPanel = page.getByRole("region", {name: "Presentation export"});
    await expect(exportPanel).toHaveClass(/hero-overlay-scrollbar/);
    expect(await exportPanel.evaluate((element) => {
      const styles = getComputedStyle(element);
      return styles.opacity === "1" && styles.backgroundColor !== "transparent";
    })).toBe(true);
    await expect(page.getByRole("textbox", {exact: true, name: "Presentation JSON"}))
      .toHaveClass(/hero-overlay-scrollbar/);
    const exported = await page.getByRole("textbox", {exact: true, name: "Presentation JSON"}).inputValue();
    expect(JSON.parse(exported)).toMatchObject({
      controls: {
        "chrome.side-panel": {visibility: "hidden"},
        "chrome.status": {visibility: "hidden"},
      },
      schemaVersion: "chat-shell-presentation.v1",
    });

    await page.getByRole("textbox", {exact: true, name: "Import presentation JSON"}).fill("not json");
    await page.getByRole("button", {name: "Apply imported JSON"}).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("keeps the editor toolbar usable at the mobile viewport", async ({page}, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), "Mobile-only responsive proof.");

    await page.goto("/?variant=empty&devtools=1");
    const launcher = page.getByRole("button", {name: "Toggle Dev Mode controls"});
    await expectMainPanelBottomLeft(launcher, page);
    await launcher.click();

    await expectPanelAboveLauncher(
      page.getByRole("region", {name: "Dev Mode controls"}),
      launcher,
    );
    await expect(page.getByText("Dev Mode", {exact: true})).toBeVisible();
    await expect(page.getByRole("button", {exact: true, name: "Preview"})).toBeVisible();
    await expect(page.getByRole("button", {exact: true, name: "Export"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Done"})).toBeVisible();
  });

  test("keeps a host-required control locked in the visual editor", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Desktop window chrome exposes the locked terminal control.");

    await page.goto("/?variant=complete&devtools=1&lock=terminal");
    await page.getByRole("button", {name: "Toggle Dev Mode controls"}).click();

    const terminal = page.locator('[data-shell-control-id="chrome.terminal"]');
    await expect(terminal).toHaveAttribute("data-shell-control-required", "true");
    await terminal.getByRole("button", {name: "Toggle terminal"}).click();
    await expect(terminal).toBeVisible();
    await expect(page.getByRole("button", {name: "Restore Terminal"})).toHaveCount(0);
  });
});

async function expectMainPanelBottomLeft(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const mainPanelBox = await page.getByTestId("chat-shell-main-panel").boundingBox();
  const viewport = page.viewportSize();
  if (!box || !mainPanelBox || !viewport) {
    throw new Error("Expected the Dev Mode launcher and main panel geometry.");
  }
  expect(box.x).toBeCloseTo(Math.max(16, Math.round(mainPanelBox.x + 16)), 0);
  expect(viewport.height - box.y - box.height).toBeCloseTo(16, 0);
}

async function expectPanelAboveLauncher(panel: Locator, launcher: Locator) {
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  const launcherBox = await launcher.boundingBox();
  if (!panelBox || !launcherBox) {
    throw new Error("Expected Dev Mode launcher and panel geometry.");
  }
  expect(panelBox.x).toBeCloseTo(launcherBox.x, 0);
  expect(launcherBox.y - panelBox.y - panelBox.height).toBeGreaterThanOrEqual(8);
}
