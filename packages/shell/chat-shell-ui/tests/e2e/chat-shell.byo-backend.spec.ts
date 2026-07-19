import {expect, test} from "@playwright/test";

function isMobileProject(projectName: string) {
  return projectName.includes("mobile");
}

test.describe("ChatShell BYO backend demo", () => {
  test("runs the direct backend control-plane route and replaces manifest state after composer submit", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Direct BYO backend control rail is covered by desktop e2e.");

    await page.goto("/?demo=byo-backend");

    await expect(page.getByRole("complementary", {name: "BYO backend controls"})).toBeVisible();
    await expect(page.getByRole("region", {name: "ChatShell BYO backend preview"})).toBeVisible();
    await expect(page.getByRole("list", {name: "Recent ChatShell events"})).toContainText("byo-backend.ready");
    await expect(page.getByRole("log", {name: "Conversation transcript"})).toContainText(
      "This initial transcript is owned by the BYO backend demo",
    );

    const prompt = "Create a durable backend-owned manifest";
    const mainPanel = page.locator("#chat-shell-conversation-panel");

    await page.getByRole("button", {name: "Toggle status panel"}).click();
    await page.getByRole("button", {name: /^(?:Expand|Collapse) side pane$/}).click();
    await mainPanel.getByRole("textbox", {name: "Prompt"}).fill(prompt);
    await mainPanel.getByRole("button", {name: "Send"}).click();

    await expect(page.getByRole("list", {name: "Recent ChatShell events"})).toContainText(
      `composer.submit "${prompt}"`,
    );
    await expect(page.getByRole("log", {name: "Conversation transcript"})).toContainText(prompt);
    await expect(page.getByRole("log", {name: "Conversation transcript"})).toContainText(
      "The host backend accepted composer.submit and created a new control-plane snapshot.",
    );
    await expect(page.getByRole("button", {name: prompt})).toHaveAttribute("aria-current", "page");
  });
});
