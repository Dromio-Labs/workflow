import {expect, type Page, test} from "@playwright/test";

function isMobileProject(projectName: string) {
  return projectName.includes("mobile");
}

async function waitForConversationVisualScroll(page: Page) {
  await expect(page.locator(".zc-conversation-scroll")).toHaveAttribute("data-visual-scroll-state", "settled");
}

async function alignCompletedConversationSnapshot(page: Page) {
  await page.locator(".zc-conversation-scroll").evaluate((scroller) => {
    const completedOutputTopInset = 20;
    const outputs = Array.from(scroller.querySelectorAll<HTMLElement>("[data-assistant-output='true']"));
    // Match the completed-state anchor used by the app before Playwright freezes animations.
    const completedOutput = outputs.at(-3) ?? outputs.at(-1);

    if (!completedOutput) {
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const outputRect = completedOutput.getBoundingClientRect();
    scroller.scrollTop = Math.max(0, scroller.scrollTop + outputRect.top - scrollerRect.top - completedOutputTopInset);
  });
}

async function waitForVisualAnimations(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect.poll(() => page.evaluate(() =>
    document.getAnimations().filter((animation) => animation.playState === "running").length,
  )).toBe(0);
}

async function expectSettledScreenshot(page: Page, name: string) {
  const screenshot = await page.screenshot({
    animations: "allow",
    fullPage: true,
    mask: [page.getByLabel("Version v8")],
  });
  expect(screenshot).toMatchSnapshot(name);
}

test.describe("ChatShell visual smoke", () => {
  test("renders the streaming variant and supports side-panel menu interaction", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Desktop side-panel chrome is intentionally hidden in the mobile viewport.");

    await page.goto("/?variant=streaming");

    await expect(page.getByLabel("Version v8")).toBeVisible();
    await expect(page.getByTestId("chat-shell-root-panels")).toBeVisible();
    const transcript = page.getByRole("log", {name: "Conversation transcript"});
    await expect(transcript).toHaveAttribute("aria-live", "polite");
    await expect(transcript).toHaveAttribute("aria-live", "off", {timeout: 10_000});

    await page.getByRole("button", {name: /^(?:Expand|Collapse) side pane$/}).click();
    await page.getByRole("button", {name: "Open side panel tab menu"}).click();
    await page.getByRole("menuitem", {name: /Terminal/}).click();
    await expect(page.getByRole("complementary", {name: "Terminal"})).toBeVisible();
    await waitForVisualAnimations(page);
    await expectSettledScreenshot(page, "chat-shell-streaming-terminal.png");
  });

  test("renders the complete variant", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Covered by the dedicated mobile runtime-state snapshot.");

    await page.goto("/?variant=complete");

    await expect(page.getByLabel("Version v8")).toBeVisible();
    await expect(page.getByTestId("chat-shell-root-panels")).toBeVisible();
    await waitForConversationVisualScroll(page);
    await waitForVisualAnimations(page);
    await alignCompletedConversationSnapshot(page);
    await expectSettledScreenshot(page, "chat-shell-complete.png");
  });

  test("renders empty and error runtime variants", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Covered by the dedicated mobile runtime-state snapshot.");

    await page.goto("/?variant=empty");

    await expect(page.getByLabel("Version v8")).toBeVisible();
    await expect(page.getByTestId("chat-shell-root-panels")).toBeVisible();
    await expect(page.getByText("Start a new task")).toBeVisible();
    await expect(page.getByText("Ask the assistant to inspect, edit, or explain this workspace.")).toBeVisible();
    await expect(page).toHaveScreenshot("chat-shell-empty.png", {
      fullPage: true,
      mask: [page.getByLabel("Version v8")],
    });

    await page.goto("/?variant=error");

    await expect(page.getByText("Run interrupted")).toBeVisible();
    await expect(page.getByText("The local preview command exited before returning a browser-ready URL.")).toBeVisible();
    await waitForVisualAnimations(page);
    await expectSettledScreenshot(page, "chat-shell-error.png");
  });

  test("renders showcase theme and extension renderer scenarios", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Showcase control rail snapshots are desktop-only.");

    await page.goto("/?showcase=1");

    await expect(page.getByRole("complementary", {name: "ChatShell showcase controls"})).toBeVisible();
    await page.getByRole("button", {name: "Theme"}).click();
    await page.getByRole("button", {name: "compact-light"}).click();

    await expect(page.getByTestId("chat-shell-root")).toHaveAttribute("data-chat-shell-color-mode", "light");
    await expect(page.getByTestId("chat-shell-root")).toHaveAttribute("data-chat-shell-density", "compact");
    await waitForVisualAnimations(page);
    await expectSettledScreenshot(page, "chat-shell-showcase-compact-light.png");

    await page.getByRole("button", {name: "Renderers"}).click();
    await expect(page.getByRole("region", {name: "Showcase inspector"})).toBeVisible();
    await waitForVisualAnimations(page);
    await expectSettledScreenshot(page, "chat-shell-showcase-renderers.png");
  });

  test("renders the empty runtime state on mobile", async ({page}, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), "Mobile visual coverage only runs in the mobile project.");

    await page.goto("/?variant=empty");

    await expect(page.getByLabel("Version v8")).toBeVisible();
    await expect(page.getByTestId("chat-shell-root-panels")).toBeVisible();
    await expect(page.getByText("Start a new task")).toBeVisible();
    await expect(page.getByText("Ask the assistant to inspect, edit, or explain this workspace.")).toBeVisible();
    await expect(page).toHaveScreenshot("chat-shell-empty-mobile.png", {
      fullPage: true,
      mask: [page.getByLabel("Version v8")],
    });
  });

  test("renders the showcase and BYO backend loop", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "BYO showcase control rail is covered by desktop e2e.");

    await page.goto("/?showcase=1");

    await expect(page.getByRole("complementary", {name: "ChatShell showcase controls"})).toBeVisible();
    await expect(page.getByTestId("chat-shell-root-panels")).toBeVisible();

    await page.getByRole("button", {name: "BYO backend"}).click();
    const mainPanel = page.locator("#chat-shell-conversation-panel");
    await page.getByRole("button", {name: "Toggle status panel"}).click();
    await page.getByRole("button", {name: /^(?:Expand|Collapse) side pane$/}).click();
    await mainPanel.getByRole("textbox", {name: "Prompt"}).fill("Create a backend-owned thread");
    await mainPanel.getByRole("button", {name: "Send"}).click();

    await expect(page.getByText("Create a backend-owned thread").first()).toBeVisible();
    await expect(page.getByRole("list", {name: "Recent ChatShell events"})).toContainText("composer.submit");
  });
});
