import {expect, type Locator, type Page, test} from "@playwright/test";

function isMobileProject(projectName: string) {
  return projectName.includes("mobile");
}

async function disableMotion(page: Page) {
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0ms !important;
        animation-duration: 0.001ms !important;
        scroll-behavior: auto !important;
        transition-delay: 0ms !important;
        transition-duration: 0.001ms !important;
      }
    `,
  });
}

async function expectFocusReturnsAfterEscape(trigger: Locator, menu: Locator, page: Page) {
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
}

async function expectVisibleFocusIndicator(locator: Locator, label: string) {
  const visibleFocus = await locator.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return styles.outlineStyle !== "none" || styles.boxShadow !== "none";
  });

  expect(visibleFocus, `${label} focus indicator`).toBe(true);
}

async function contrastRatio(locator: Locator) {
  return locator.evaluate((element) => {
    type Rgba = {a: number; b: number; g: number; r: number};

    function parseColor(value: string): Rgba | null {
      const normalized = value.trim();
      if (!normalized || normalized === "transparent") {
        return null;
      }

      const rgbMatch = /^rgba?\(([^)]+)\)$/.exec(normalized);
      if (rgbMatch) {
        const parts = rgbMatch[1]!.split(/[\s,\/]+/).filter(Boolean).map(Number);
        return {
          a: parts[3] ?? 1,
          b: parts[2] ?? 0,
          g: parts[1] ?? 0,
          r: parts[0] ?? 0,
        };
      }

      const srgbMatch = /^color\(srgb\s+([^/\s]+)\s+([^/\s]+)\s+([^/\s]+)(?:\s*\/\s*([^)]+))?\)$/.exec(normalized);
      if (srgbMatch) {
        return {
          a: srgbMatch[4] ? Number(srgbMatch[4]) : 1,
          b: Number(srgbMatch[3]) * 255,
          g: Number(srgbMatch[2]) * 255,
          r: Number(srgbMatch[1]) * 255,
        };
      }

      const oklchMatch = /^oklch\(([^/\s]+)\s+([^/\s]+)\s+([^/\s]+)(?:\s*\/\s*([^)]+))?\)$/.exec(normalized);
      if (oklchMatch) {
        const luminance = parseCssNumber(oklchMatch[1]!);
        const chroma = Number(oklchMatch[2]);
        const hue = (oklchMatch[3] === "none" ? 0 : Number(oklchMatch[3])) * Math.PI / 180;
        const alpha = oklchMatch[4] ? parseCssNumber(oklchMatch[4]) : 1;
        const labA = chroma * Math.cos(hue);
        const labB = chroma * Math.sin(hue);
        const l = (luminance + 0.3963377774 * labA + 0.2158037573 * labB) ** 3;
        const m = (luminance - 0.1055613458 * labA - 0.0638541728 * labB) ** 3;
        const s = (luminance - 0.0894841775 * labA - 1.2914855480 * labB) ** 3;

        return {
          a: alpha,
          b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
          g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
          r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        };
      }

      return null;
    }

    function parseCssNumber(value: string) {
      return value.endsWith("%") ? Number(value.slice(0, -1)) / 100 : Number(value);
    }

    function linearToSrgb(value: number) {
      const channel = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
      return Math.min(255, Math.max(0, channel * 255));
    }

    function composite(top: Rgba, bottom: Rgba): Rgba {
      const alpha = top.a + bottom.a * (1 - top.a);
      if (alpha === 0) {
        return {a: 0, b: 0, g: 0, r: 0};
      }

      return {
        a: alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
      };
    }

    function luminance(color: Rgba) {
      const channels = [color.r, color.g, color.b].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });

      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    }

    function ratio(foreground: Rgba, background: Rgba) {
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      const lighter = Math.max(foregroundLuminance, backgroundLuminance);
      const darker = Math.min(foregroundLuminance, backgroundLuminance);

      return (lighter + 0.05) / (darker + 0.05);
    }

    function resolvedBackground(target: Element) {
      const layers: Rgba[] = [];
      let node: Element | null = target;

      while (node) {
        const background = parseColor(window.getComputedStyle(node).backgroundColor);
        if (background && background.a > 0) {
          layers.push(background);
        }
        node = node.parentElement;
      }

      return layers.reverse().reduce((current, layer) => composite(layer, current), {a: 1, b: 255, g: 255, r: 255});
    }

    const foreground = parseColor(window.getComputedStyle(element).color);
    if (!foreground) {
      throw new Error("Unable to parse foreground color");
    }

    return ratio(foreground, resolvedBackground(element));
  });
}

async function expectReadable(locator: Locator, label: string, minimumRatio = 3) {
  await expect(locator).toBeVisible();
  const ratio = await contrastRatio(locator);
  expect.soft(ratio, `${label} contrast ratio`).toBeGreaterThanOrEqual(minimumRatio);
}

async function openSidePanelIfNeeded(page: Page) {
  const sidePanel = page.getByRole("complementary", {name: /Review|Terminal|Browser|Files|Side chat|Inspector/});
  if (await sidePanel.isVisible().catch(() => false)) {
    return;
  }

  await page.getByRole("button", {name: /^(?:Expand|Collapse) side pane$/}).click();
  await expect(sidePanel.first()).toBeVisible();
}

function sidePanelTextSample(page: Page) {
  return page
    .getByRole("complementary", {name: /Review|Terminal|Browser|Files|Side chat|Inspector/})
    .first()
    .locator("h2, h3, p, span, button")
    .filter({hasText: /\S/})
    .first();
}

test.describe("ChatShell accessibility and theme evidence", () => {
  test("exposes stable shell landmarks, live transcript semantics, and control states", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Landmark inventory is asserted once against the desktop shell.");

    await page.goto("/?variant=streaming");

    await expect(page.getByRole("navigation", {name: "Threads"})).toBeVisible();
    await expect(page.getByRole("main", {name: "Conversation"})).toBeVisible();
    await expect(page.getByRole("region", {name: "Workspace"})).toBeVisible();
    await expect(page.getByRole("complementary", {name: "Status"})).toBeVisible();

    const transcript = page.getByRole("log", {name: "Conversation transcript"});
    await expect(transcript).toHaveAttribute("aria-live", "polite");
    await expect(transcript).toHaveAttribute("aria-atomic", "false");
    await expect(page.locator("[data-live-transcript='true']")).toHaveCount(1);
    await expect(page.locator("[aria-live='polite']")).toHaveCount(1);

    const statusToggle = page.getByRole("button", {name: "Toggle status panel"});
    await expect(statusToggle).toHaveAttribute("aria-pressed", "true");
    await statusToggle.focus();
    await page.keyboard.press("Enter");
    await expect(statusToggle).toHaveAttribute("aria-pressed", "false");
    await expect(statusToggle).toBeFocused();
    await expectVisibleFocusIndicator(statusToggle, "status toggle");

    const sidePanelToggle = page.getByRole("button", {name: /^(?:Expand|Collapse) side pane$/});
    await expect(sidePanelToggle).toHaveAttribute("aria-pressed", "false");
    await sidePanelToggle.click();
    await expect(sidePanelToggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", {name: /Review|Terminal|Browser|Files|Side chat|Inspector/}).first()).toBeVisible();

    const mainPanel = page.locator("#chat-shell-conversation-panel");
    const prompt = mainPanel.getByRole("textbox", {name: "Prompt"});
    await prompt.fill("");
    await expect(mainPanel.getByRole("button", {name: "Send"})).toBeDisabled();
  });

  test("exposes error transcript as a single alert without polite streaming duplication", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Error transcript semantics are asserted once against the desktop shell.");

    await page.goto("/?variant=error");

    const transcript = page.getByRole("log", {name: "Conversation transcript"});
    await expect(transcript).toHaveAttribute("aria-live", "off");
    await expect(page.getByRole("alert")).toContainText(/interrupted|failed|retry|backend/i);
    await expect(page.locator("[role='alert']")).toHaveCount(1);
    await expect(page.locator("[aria-live='polite']")).toHaveCount(0);
    await expect(page.locator("[data-live-transcript='true']")).toHaveCount(0);
  });

  test("supports settings focus trap, header menus, side-panel menu, status collapse, and composer controls", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Desktop header/sidebar settings affordances are covered in the desktop accessibility run.");

    await page.goto("/?variant=complete");

    const branchTrigger = page.getByRole("button", {name: "Switch Git branch"});
    await branchTrigger.click();
    await expectFocusReturnsAfterEscape(branchTrigger, page.getByRole("menu").first(), page);

    const chatActionsTrigger = page.getByRole("button", {name: "Chat actions"});
    await chatActionsTrigger.click();
    const chatActionsMenu = page.locator("#chat-actions-menu-panel");
    await expect(chatActionsMenu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(chatActionsMenu).toBeHidden();
    await expect(chatActionsTrigger).toBeFocused();

    const statusPanel = page.getByRole("complementary", {name: "Status"});
    const gitToolsTrigger = statusPanel.getByRole("button", {name: "Toggle Git tools status section"});
    await expect(gitToolsTrigger).toHaveAttribute("aria-expanded", "true");
    await gitToolsTrigger.click();
    await expect(gitToolsTrigger).toHaveAttribute("aria-expanded", "false");
    await gitToolsTrigger.click();
    await expect(gitToolsTrigger).toHaveAttribute("aria-expanded", "true");

    await openSidePanelIfNeeded(page);
    const sidePanelMenuTrigger = page.getByRole("button", {name: "Open side panel tab menu"});
    await sidePanelMenuTrigger.click();
    const sidePanelMenu = page.getByRole("menu", {name: "Side panel registry"});
    await expect(sidePanelMenu).toBeVisible();
    await page.keyboard.press("End");
    await page.keyboard.press("Escape");
    await expect(sidePanelMenu).toBeHidden();
    await expect(sidePanelMenuTrigger).toBeFocused();

    const mainPanel = page.locator("#chat-shell-conversation-panel");
    const addContextTrigger = mainPanel.getByRole("button", {name: "Add context"});
    await addContextTrigger.click();
    await expectFocusReturnsAfterEscape(addContextTrigger, page.locator("#add-menu-panel"), page);

    const prompt = mainPanel.getByRole("textbox", {name: "Prompt"});
    await prompt.fill("Accessibility release evidence");
    const sendButton = mainPanel.getByRole("button", {name: "Send"});
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    await page.getByRole("button", {name: "Open settings menu"}).click();
    await page.getByRole("menuitem", {name: /Settings/}).click();

    const dialog = page.getByRole("dialog", {name: "Settings"});
    await expect(dialog).toBeVisible();
    const backButton = dialog.getByRole("button", {name: "Back to app"});
    await expect(backButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("keeps compact mobile status and side-panel access reachable", async ({page}, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), "Compact/mobile access is covered by the mobile project.");

    await page.goto("/?variant=complete");

    const statusToggle = page.getByRole("button", {name: "Toggle status panel"});
    await statusToggle.click();
    await expect(statusToggle).toHaveAttribute("aria-pressed", "false");
    await statusToggle.click();
    await expect(statusToggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", {name: "Status"})).toBeVisible();

    const sidePanelToggle = page.getByRole("button", {name: /^(?:Expand|Collapse) side pane$/});
    await sidePanelToggle.click();
    await expect(sidePanelToggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", {name: /Review|Terminal|Browser|Files|Side chat/}).first()).toBeVisible();
  });

  test("keeps custom extension surfaces labelled by their host renderer", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Renderer showcase control rail is desktop-only.");

    await page.goto("/?showcase=1");
    await page.getByRole("button", {name: "Renderers"}).click();

    await expect(page.getByRole("region", {name: "Showcase inspector"})).toBeVisible();
    await expect(page.locator(".chat-shell-showcase-terminal-icon").first()).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("button", {name: "Open side panel tab menu"})).toHaveAttribute("aria-haspopup", "menu");
  });

  test("passes practical shell-owned contrast samples in default dark and compact-light themes", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Contrast samples use the desktop shell-owned surfaces.");

    await page.goto("/?variant=complete");

    await expectReadable(page.getByTestId("workspace-title"), "default dark workspace title", 4);
    const mainPanel = page.locator("#chat-shell-conversation-panel");
    await expectReadable(mainPanel.getByRole("textbox", {name: "Prompt"}), "default dark composer prompt", 4);
    await expectReadable(page.getByRole("button", {name: "Toggle status panel"}), "default dark status toggle", 3);
    await expectReadable(page.getByRole("complementary", {name: "Status"}).getByRole("button", {name: "Toggle Git tools status section"}), "default dark status collapse", 3);
    await openSidePanelIfNeeded(page);
    await expectReadable(sidePanelTextSample(page), "default dark side-panel text", 3);

    await page.goto("/?showcase=1");
    await page.getByRole("button", {name: "Theme"}).click();
    await page.getByRole("button", {name: "compact-light"}).click();
    await expect(page.getByTestId("chat-shell-root")).toHaveAttribute("data-chat-shell-color-mode", "light");
    await expect(page.getByTestId("chat-shell-root")).toHaveAttribute("data-chat-shell-density", "compact");

    await expectReadable(page.getByTestId("workspace-title"), "compact-light workspace title", 4);
    await expectReadable(mainPanel.getByRole("textbox", {name: "Prompt"}), "compact-light composer prompt", 4);
    await expectReadable(page.getByRole("button", {name: "Toggle status panel"}), "compact-light status toggle", 3);
    await expectReadable(page.getByRole("complementary", {name: "Status"}).getByRole("button", {name: "Toggle Git tools status section"}), "compact-light status collapse", 3);
    await openSidePanelIfNeeded(page);
    await expectReadable(sidePanelTextSample(page), "compact-light side-panel text", 3);
  });

  test("does not depend on animation timing for critical interactions with reduced motion", async ({page}, testInfo) => {
    test.skip(isMobileProject(testInfo.project.name), "Reduced-motion interaction coverage runs once on desktop.");

    await page.goto("/?variant=complete");
    await disableMotion(page);

    await page.getByRole("button", {name: "Toggle status panel"}).click();
    await expect(page.getByRole("button", {name: "Toggle status panel"})).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", {name: "Toggle status panel"}).click();
    await expect(page.getByRole("complementary", {name: "Status"})).toBeVisible();

    await openSidePanelIfNeeded(page);
    await page.getByRole("button", {name: "Open side panel tab menu"}).click();
    await expect(page.getByRole("menu", {name: "Side panel registry"})).toBeVisible();

    const mainPanel = page.locator("#chat-shell-conversation-panel");
    await mainPanel.getByRole("textbox", {name: "Prompt"}).fill("No animation dependency");
    await expect(mainPanel.getByRole("button", {name: "Send"})).toBeEnabled();
  });
});
