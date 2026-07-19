import {fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, it, vi} from "vitest";

import {ChatShell, defineChatShellExtension, type ChatShellEvent} from "../../src/chat-shell";
import {ChatShellManifestSchema, type ChatShellManifest} from "../../src/chat-shell-contracts";
import {mockChatShellManifest, mockChatShellManifests} from "../../src/chat-shell-mock-backend";
import {DemoChatShell} from "../../src/showcase/DemoChatShell";
import {formatDurationLabel} from "../../src/components/projection/ProjectedConversationParts";

function createOpenSidePanelManifest(overrides?: (manifest: ChatShellManifest) => void) {
  const manifest = structuredClone(mockChatShellManifest);

  manifest.layout.sidePanel.defaultOpen = true;
  manifest.registries.chrome.sidePanel.initialSurfaceId = "review";

  overrides?.(manifest);

  return ChatShellManifestSchema.parse(manifest);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatShell interactions", () => {
  it("formats completed work durations in readable seconds, minutes, and hours", () => {
    expect(formatDurationLabel(38_000)).toBe("Worked for 38 seconds");
    expect(formatDurationLabel(65_000)).toBe("Worked for 1 minute 5 seconds");
    expect(formatDurationLabel(3_726_000)).toBe("Worked for 1 hour 2 minutes 6 seconds");
  });

  it("renders failed progress without a completed treatment", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.status.sections = [
        {
          id: "progress",
          rows: [
            {
              icon: "x",
              id: "capture",
              kind: "progress",
              label: "Screenshot failed",
              status: "failed",
            },
          ],
          title: "Progress",
        },
      ];
    });

    render(<ChatShell manifest={manifest} />);
    const row = screen.getByText("Screenshot failed").closest("[data-progress-status]");
    expect(row).toHaveAttribute("data-progress-status", "failed");
    expect(screen.getByText("Screenshot failed")).not.toHaveClass("line-through");
  });

  it("retains an image and prompt when upload fails, then clears them after retry", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const onEvent = vi.fn(async (event: ChatShellEvent) => {
      if (event.type !== "composer.submit") return;
      attempts += 1;
      if (attempts === 1) throw new Error("Image upload failed. Try again.");
    });

    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);
    const prompt = screen.getByRole("textbox", {name: "Prompt"});
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("Expected composer file input.");
    const image = new File([new Uint8Array([1, 2, 3])], "retry.png", {
      type: ["image", "png"].join("/"),
    });

    await user.type(prompt, "What is in this image?");
    fireEvent.change(fileInput, {target: {files: [image]}});
    await user.click(screen.getByRole("button", {name: "Send"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Image upload failed. Try again.");
    expect(prompt).toHaveValue("What is in this image?");
    expect(screen.getByRole("img", {name: "retry.png"})).toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Send"}));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(prompt).toHaveValue(""));
    expect(screen.queryByRole("img", {name: "retry.png"})).not.toBeInTheDocument();
  });

  it("renders streaming backend snapshots immediately without timer advancement by default", () => {
    const manifest = createOpenSidePanelManifest();

    render(<ChatShell manifest={manifest} />);

    expect(screen.getByText(/Built a standalone browser Gomoku game/)).toBeInTheDocument();
    expect(screen.getAllByText("Working").length).toBeGreaterThan(0);
  });

  it("replaces Send with an interrupt action while the conversation is streaming", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.composer.interruptAction = {
        icon: "stop",
        id: "dromio.interrupt",
        label: "Stop active turn",
      };
    });

    render(<ChatShell manifest={manifest} onEvent={onEvent} />);

    expect(screen.queryByRole("button", {name: "Send"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Stop active turn"}));
    expect(onEvent).toHaveBeenCalledWith({
      actionId: "dromio.interrupt",
      surface: "composer",
      type: "action.trigger",
    });
  });

  it("collapses and expands the Working disclosure from its header", async () => {
    const user = userEvent.setup();
    const manifest = createOpenSidePanelManifest();

    render(<ChatShell manifest={manifest} />);

    const trigger = screen.getAllByRole("button", {name: "Working"})[0];
    if (!trigger) {
      throw new Error("Expected a Working disclosure trigger.");
    }
    const section = trigger.closest('[data-slot="collapsible"]');
    const content = section?.querySelector('[data-slot="collapsible-content"]');
    if (!content) {
      throw new Error("Expected Working disclosure content.");
    }

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(content).toHaveAttribute("aria-hidden", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(content).toHaveAttribute("data-state", "closed");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(content).toHaveAttribute("aria-hidden", "false");
    expect(content).toHaveAttribute("data-state", "open");
  });

  it("keeps simulated control-plane token streaming source-local to demos", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const manifest = createOpenSidePanelManifest();

    render(<DemoChatShell manifest={manifest} simulateStreaming />);

    expect(setIntervalSpy).toHaveBeenCalled();
    expect(screen.queryByText(/Built a standalone browser Gomoku game/)).not.toBeInTheDocument();
  });

  it("applies custom appearance attributes and CSS variables to the shell root", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.appearance = {
        colorMode: "light",
        density: "compact",
        radius: {
          frame: "6px",
          mode: "sharp",
        },
        shell: {
          viewportHeight: "560px",
          viewportMaxWidth: "72rem",
        },
        tokens: {
          brand: "#ff3366",
          windowBg: "rgba(255, 255, 255, 0.92)",
        },
        typography: {
          fontFamily: "Inter, sans-serif",
          scale: "large",
        },
      };
    });

    render(<ChatShell manifest={manifest} />);

    const root = screen.getByTestId("chat-shell-root");

    expect(root).toHaveAttribute("data-chat-shell-color-mode", "light");
    expect(root).toHaveAttribute("data-chat-shell-density", "compact");
    expect(root).toHaveAttribute("data-chat-shell-radius", "sharp");
    expect(root).toHaveAttribute("data-chat-shell-type-scale", "large");
    expect(root.style.getPropertyValue("--chat-shell-density-scale")).toBe("0.92");
    expect(root.style.getPropertyValue("--color-brand")).toBe("#ff3366");
    expect(root.style.getPropertyValue("--color-window-bg")).toBe("rgba(255, 255, 255, 0.92)");
    expect(root.style.getPropertyValue("--chat-shell-font-family")).toBe("Inter, sans-serif");
    expect(root.querySelector(".chat-shell-main-gutter")).toBeInTheDocument();
  });

  it("exposes stable landmark names and a single transcript live region for streaming and error states", () => {
    render(<ChatShell manifest={createOpenSidePanelManifest()} />);

    expect(screen.getByRole("navigation", {name: "Threads"})).toBeInTheDocument();
    expect(screen.getByRole("main", {name: "Conversation"})).toBeInTheDocument();
    expect(screen.getByRole("region", {name: "Workspace"})).toBeInTheDocument();
    expect(screen.getByRole("complementary", {name: "Status"})).toBeInTheDocument();
    expect(screen.getByRole("complementary", {name: "Review"})).toBeInTheDocument();

    const transcript = screen.getByRole("log", {name: "Conversation transcript"});
    expect(transcript).toHaveAttribute("aria-live", "polite");
    expect(transcript).toHaveAttribute("aria-atomic", "false");
    expect(document.querySelectorAll("[data-live-transcript='true']")).toHaveLength(1);
    expect(document.querySelectorAll("[aria-live='polite']")).toHaveLength(1);

    const sendButton = screen.getByRole("button", {name: "Send"});
    expect(sendButton).toBeDisabled();
    expect(screen.getByRole("button", {name: "Toggle status panel"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {name: "Collapse side pane"})).toHaveAttribute("aria-pressed", "true");
  });

  it("exposes error state as a single alert without streaming live announcements", () => {
    render(<ChatShell manifest={mockChatShellManifests.error} />);

    expect(screen.getByRole("log", {name: "Conversation transcript"})).toHaveAttribute("aria-live", "off");
    expect(screen.getByRole("alert")).toHaveTextContent(/Run interrupted/);
    expect(document.querySelectorAll("[role='alert']")).toHaveLength(1);
    expect(document.querySelectorAll("[aria-live='polite']")).toHaveLength(0);
    expect(document.querySelectorAll("[data-live-transcript='true']")).toHaveLength(0);
  });

  it("emits sidePanel.select when selecting from the side-panel tab menu", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();

    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);

    await user.click(screen.getByRole("button", {name: "Open side panel tab menu"}));
    await user.click(await screen.findByRole("menuitem", {name: /Terminal/}));

    expect(onEvent).toHaveBeenCalledWith({surfaceId: "terminal", type: "sidePanel.select"});
  });

  it("emits menu.select for composer menu choices with the backend menu item payload", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest();
    const expectedItem = manifest.registries.composer.addMenu.sections[0].items.find((item) => item.id === "goal");

    render(<ChatShell manifest={manifest} onEvent={onEvent} />);

    await user.click(screen.getByRole("button", {name: "Add context"}));
    await user.click(await screen.findByRole("menuitem", {name: /Goal/}));

    expect(onEvent).toHaveBeenCalledWith({
      item: expectedItem,
      menuId: "add-menu",
      type: "menu.select",
    });
  });

  it("emits sidePanel.close and sidePanel.open from the visible side-panel toggle", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();

    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);

    await user.click(screen.getByRole("button", {name: "Collapse side pane"}));
    await user.click(screen.getByRole("button", {name: "Expand side pane"}));

    expect(onEvent).toHaveBeenCalledWith({surfaceId: "review", type: "sidePanel.close"});
    expect(onEvent).toHaveBeenCalledWith({surfaceId: "review", type: "sidePanel.open"});
  });

  it("collapses the open side panel from its active surface tab", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();

    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);

    await user.click(screen.getByRole("button", {name: "Collapse Review side panel"}));

    expect(onEvent).toHaveBeenCalledWith({surfaceId: "review", type: "sidePanel.close"});
    expect(screen.queryByRole("complementary", {name: "Review"})).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Expand side pane"})).toHaveAttribute("aria-pressed", "false");
  });

  it("emits settings open, menu select, settings change, and close events from settings interactions", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest();
    const settingsItem = manifest.registries.user.settingsMenu.sections[1].items.find((item) => item.id === "settings");

    render(<ChatShell manifest={manifest} onEvent={onEvent} />);

    await user.click(screen.getByRole("button", {name: "Open settings menu"}));
    await user.click(await screen.findByRole("menuitem", {name: /Settings/}));

    expect(onEvent).toHaveBeenCalledWith({
      item: settingsItem,
      menuId: "user-settings-menu",
      type: "menu.select",
    });
    expect(onEvent).toHaveBeenCalledWith({open: true, type: "settings.open"});

    const dialog = await screen.findByRole("dialog", {name: "Settings"});
    await user.click(within(dialog).getByRole("button", {name: /For everyday work/}));
    await user.click(within(dialog).getByRole("button", {name: "Profile"}));
    await user.click(within(dialog).getByRole("button", {name: "Back to app"}));

    expect(onEvent).toHaveBeenCalledWith({settingId: "workModeId", type: "settings.change", value: "everyday"});
    expect(onEvent).toHaveBeenCalledWith({settingId: "activeSectionId", type: "settings.change", value: "profile"});
    expect(onEvent).toHaveBeenCalledWith({open: false, type: "settings.close"});
  });

  it("renders a registered custom side-panel renderer for the manifest surface", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.chrome.sidePanel.initialSurfaceId = "custom-inspector";
      draft.registries.chrome.sidePanel.surfaces = [
        {
          content: {
            body: "Custom inspection body",
            title: "Custom Inspector",
          },
          icon: "target",
          label: "Inspector",
          rendererId: "side-panel.inspector",
          surfaceId: "custom-inspector",
          surfaceKind: "inspector",
        },
        ...draft.registries.chrome.sidePanel.surfaces,
      ];
      draft.registries.chrome.sidePanel.tabMenuSurfaceIds = ["custom-inspector", "review", "terminal"];
    });

    render(
      <ChatShell
        manifest={manifest}
        renderers={{
          sidePanel: {
            "side-panel.inspector": ({surface}) => (
              <section aria-label="Custom inspector renderer">
                <h2>{surface.content.title}</h2>
                <p>{surface.content.body}</p>
              </section>
            ),
          },
        }}
      />,
    );

    expect(screen.getByRole("region", {name: "Custom inspector renderer"})).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Custom Inspector"})).toBeInTheDocument();
    expect(screen.getByText("Custom inspection body")).toBeInTheDocument();
  });

  it("renders a registered custom shell slot renderer and can wrap the default slot", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.layoutSlots = draft.registries.layoutSlots.map((slot) => slot.region === "windowChrome"
        ? {
            ...slot,
            rendererId: "shell.partner.window-chrome",
          }
        : slot);
    });

    render(
      <ChatShell
        manifest={manifest}
        renderers={{
          shell: {
            "shell.partner.window-chrome": ({helpers, layout, slot}) => (
              <div data-compact={String(layout.compact)} data-testid="custom-window-chrome" data-slot={slot.id}>
                {helpers.renderDefault()}
              </div>
            ),
          },
        }}
      />,
    );

    expect(screen.getByTestId("custom-window-chrome")).toHaveAttribute("data-slot", "window-chrome-default");
    expect(screen.getByRole("button", {name: "Toggle status panel"})).toBeInTheDocument();
  });

  it("throws when a manifest references an unregistered custom shell slot renderer", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.layoutSlots = draft.registries.layoutSlots.map((slot) => slot.region === "windowChrome"
        ? {
            ...slot,
            rendererId: "shell.partner.missing-window-chrome",
          }
        : slot);
    });

    expect(() => render(<ChatShell manifest={manifest} />)).toThrow(/unregistered renderer "shell\.partner\.missing-window-chrome"/);
  });

  it("renders custom icon overrides for backend icon names", () => {
    render(
      <ChatShell
        manifest={createOpenSidePanelManifest()}
        renderers={{
          icons: {
            terminal: ({className, name}) => (
              <span aria-hidden="true" className={className} data-icon-name={name} data-testid="custom-terminal-icon" />
            ),
          },
        }}
      />,
    );

    expect(screen.getAllByTestId("custom-terminal-icon").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("custom-terminal-icon")[0]).toHaveAttribute("data-icon-name", "terminal");
  });

  it("consumes extension-registered panels, shell slots, icons, and slot actions", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest();
    const extension = defineChatShellExtension({
      icons: {
        "custom:terminal": ({className, name}) => (
          <span aria-hidden="true" className={className} data-icon-name={name} data-testid="extension-terminal-icon" />
        ),
      },
      shell: {
        slots: [
          {
            order: -1,
            region: "windowChrome",
            renderer: ({actions, helpers}) => (
              <div data-testid="extension-window-chrome">
                {helpers.renderDefault()}
                <button type="button" onClick={() => actions.selectSidePanelSurface("buyer-terminal")}>Open buyer terminal</button>
                <button type="button" onClick={() => actions.toggleStatus()}>Toggle status from slot</button>
                <button type="button" onClick={() => void actions.submitComposer({attachments: [], prompt: "slot prompt"})}>Submit from slot</button>
              </div>
            ),
            rendererId: "shell.partner.window-chrome",
          },
        ],
      },
      sidePanel: {
        initialSurfaceId: "buyer-terminal",
        surfaces: [
          {
            content: {
              body: "Extension terminal body",
              title: "Buyer Terminal",
            },
            icon: "custom:terminal",
            label: "Buyer Terminal",
            renderer: ({surface}) => (
              <section aria-label="Extension terminal panel">
                <h2>{surface.content.title}</h2>
                <p>{surface.content.body}</p>
              </section>
            ),
            rendererId: "side-panel.buyer-terminal",
            surfaceId: "buyer-terminal",
            surfaceKind: "terminal",
          },
        ],
        tabMenuSurfaceIds: ["buyer-terminal"],
      },
    });

    render(<ChatShell extensions={extension} manifest={manifest} onEvent={onEvent} />);

    expect(screen.getByTestId("extension-window-chrome")).toBeInTheDocument();
    expect(screen.getByRole("region", {name: "Extension terminal panel"})).toBeInTheDocument();
    expect(screen.getByRole("heading", {name: "Buyer Terminal"})).toBeInTheDocument();
    expect(screen.getAllByTestId("extension-terminal-icon")[0]).toHaveAttribute("data-icon-name", "custom:terminal");
    expect(screen.getByRole("button", {name: "Toggle status panel"})).toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Open buyer terminal"}));
    await user.click(screen.getByRole("button", {name: "Toggle status from slot"}));
    await user.click(screen.getByRole("button", {name: "Submit from slot"}));

    expect(onEvent).toHaveBeenCalledWith({surfaceId: "buyer-terminal", type: "sidePanel.select"});
    expect(onEvent).toHaveBeenCalledWith({open: expect.any(Boolean), type: "status.toggle"});
    expect(onEvent).toHaveBeenCalledWith({
      payload: {
        attachments: [],
        prompt: "slot prompt",
      },
      type: "composer.submit",
    });
  });

  it("emits public shell events from header, sidebar, status, task, and fullscreen controls", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest();
    const inactiveTask = manifest.controlPlane.threads.find((thread) => thread.id !== manifest.controlPlane.activeThreadId)!;

    render(<ChatShell manifest={manifest} onEvent={onEvent} />);

    await user.click(screen.getByRole("button", {name: "Toggle terminal"}));
    await user.click(within(screen.getByRole("complementary", {name: "Status"})).getByRole("button", {name: /Changes/}));
    await user.click(screen.getByText(inactiveTask.title).closest("button")!);
    await user.click(screen.getByRole("button", {name: "Toggle status panel"}));
    await user.click(screen.getByRole("button", {name: "Toggle sidebar"}));
    await user.click(screen.getByRole("button", {name: "Toggle fullscreen"}));

    expect(onEvent).toHaveBeenCalledWith({actionId: "terminal.toggle", surface: "windowChrome", type: "action.trigger"});
    expect(onEvent).toHaveBeenCalledWith({collapsed: true, type: "sidebar.toggle"});
    expect(onEvent).toHaveBeenCalledWith({open: false, type: "status.toggle"});
    expect(onEvent).toHaveBeenCalledWith({statusId: "changes", type: "status.select"});
    expect(onEvent).toHaveBeenCalledWith({taskId: inactiveTask.id, type: "task.select"});
    expect(onEvent).toHaveBeenCalledWith({fullscreen: true, type: "window.fullscreen.toggle"});
  });

  it("collapses and expands status sections from their visible triggers", async () => {
    const user = userEvent.setup();

    render(<ChatShell manifest={createOpenSidePanelManifest()} />);

    const statusPanel = screen.getByRole("complementary", {name: "Status"});
    const trigger = within(statusPanel).getByRole("button", {name: "Toggle Git tools status section"});
    const contentId = trigger.getAttribute("aria-controls");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(contentId).toBeTruthy();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(contentId!)).toHaveAttribute("hidden");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(contentId!)).not.toHaveAttribute("hidden");
  });

  it("keeps compact shell status access reachable from the chrome controls", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: query.includes("max-width"),
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.layout.statusPanel.defaultOpen = false;
    });

    try {
      render(<ChatShell manifest={manifest} onEvent={onEvent} />);

      const statusToggle = screen.getByRole("button", {name: "Toggle status panel"});
      await user.click(statusToggle);

      expect(onEvent).toHaveBeenCalledWith({surfaceId: "review", type: "sidePanel.close"});
      expect(onEvent).toHaveBeenCalledWith({open: true, type: "status.toggle"});
      expect(statusToggle).toHaveAttribute("aria-pressed", "true");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("emits side-panel and generic panel resize events after a completed side-panel drag", async () => {
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const getBoundingClientRect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 620,
      height: 620,
      left: 0,
      right: 900,
      top: 0,
      width: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);

    fireEvent.pointerDown(screen.getByRole("button", {name: "Resize side options panel"}), {
      clientX: 520,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, {clientX: 500});
    fireEvent.pointerUp(document);

    expect(getBoundingClientRect).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith({surfaceId: "review", type: "sidePanel.resize", width: 400});
    expect(onEvent).toHaveBeenCalledWith({panelId: "sidePanel", type: "panel.resize", width: 400});
  });

  it("supports keyboard selection from the window branch menu", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest();
    const expectedItem = manifest.registries.chrome.branchMenu.sections[0].items.find((item) => item.id === "feat-gomoku");

    render(<ChatShell manifest={manifest} onEvent={onEvent} />);

    const trigger = screen.getByRole("button", {name: "Switch Git branch"});
    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute("id", "branch-menu-panel");
    const items = within(menu).getAllByRole("menuitem");

    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(menu, {key: "ArrowDown"});
    await user.keyboard("{Enter}");

    expect(onEvent).toHaveBeenCalledWith({
      item: expectedItem,
      menuId: "branch-menu",
      type: "menu.select",
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders a static branch label when branch switching is unavailable", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.chrome.branch = "local";
      draft.registries.chrome.branchMenu.sections = [];
    });

    render(<ChatShell manifest={manifest} />);

    expect(screen.queryByRole("button", {name: "Switch Git branch"})).not.toBeInTheDocument();
    expect(screen.getByLabelText("Git branch: local")).toBeInTheDocument();
  });

  it("emits composer.submit with the prompt payload", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();

    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);

    fireEvent.change(screen.getByRole("textbox", {name: "Prompt"}), {
      target: {
        value: "Ship the adapter",
      },
    });
    const sendButton = screen.getByRole("button", {name: "Send"});

    await waitFor(() => expect(sendButton).toBeEnabled());
    await user.click(sendButton);

    expect(onEvent).toHaveBeenCalledWith({
      payload: {
        attachments: [],
        prompt: "Ship the adapter",
      },
      type: "composer.submit",
    });
  });

  it("supports arrow-key roving and Escape close in the side-panel tab menu", async () => {
    const user = userEvent.setup();

    render(<ChatShell manifest={createOpenSidePanelManifest()} />);

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", {name: "Open side panel tab menu"});
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-controls", "side-panel-tab-menu");

    await user.click(trigger);

    const menu = await screen.findByRole("menu", {name: "Side panel registry"});
    expect(menu).toHaveAttribute("id", "side-panel-tab-menu");
    const items = within(menu).getAllByRole("menuitem");

    await waitFor(() => expect(items[0]).toHaveFocus());

    fireEvent.keyDown(menu, {key: "ArrowDown"});
    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(menu, {key: "End"});
    expect(items.at(-1)).toHaveFocus();

    fireEvent.keyDown(menu, {key: "Escape"});
    expect(screen.queryByRole("menu", {name: "Side panel registry"})).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("selects the focused side-panel menu item from the keyboard", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();

    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);

    await user.click(screen.getByRole("button", {name: "Open side panel tab menu"}));

    const menu = await screen.findByRole("menu", {name: "Side panel registry"});
    const items = within(menu).getAllByRole("menuitem");

    await waitFor(() => expect(items[0]).toHaveFocus());
    fireEvent.keyDown(menu, {key: "ArrowDown"});
    fireEvent.keyDown(menu, {key: "ArrowDown"});
    await user.keyboard("{Enter}");

    expect(onEvent).toHaveBeenCalledWith({surfaceId: "browser", type: "sidePanel.select"});
    expect(screen.queryByRole("menu", {name: "Side panel registry"})).not.toBeInTheDocument();
  });

  it("returns focus to the shared dropdown trigger after Escape closes a composer menu", async () => {
    const user = userEvent.setup();

    render(<ChatShell manifest={createOpenSidePanelManifest()} />);

    const trigger = screen.getByRole("button", {name: "Add context"});

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-controls", "add-menu-panel");

    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute("id", "add-menu-panel");

    fireEvent.keyDown(menu, {key: "Escape"});

    await waitFor(() => expect(menu).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("includes the right-clicked thread id in context-menu events", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest();
    const task = manifest.controlPlane.threads[1];
    if (!task) throw new Error("Expected a thread fixture.");

    render(<ChatShell manifest={manifest} onEvent={onEvent} />);
    fireEvent.contextMenu(
      screen.getByRole("button", {name: `${task.title}${task.timeLabel ?? ""}`}),
    );
    await user.click(await screen.findByRole("menuitem", {name: "Pin chat"}));

    expect(onEvent).toHaveBeenCalledWith({
      item: expect.objectContaining({id: "pin-chat", value: task.id}),
      menuId: "thread-context-menu",
      type: "menu.select",
    });
  });

  it("opens workspace actions and emits workspace new-chat events", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest();
    const workspace = manifest.controlPlane.workspaces[0];
    if (!workspace) throw new Error("Expected a workspace fixture.");

    render(<ChatShell manifest={manifest} onEvent={onEvent} />);
    const workspaceToggle = screen.getByRole("button", {
      name: `Toggle ${workspace.name} workspace`,
    });
    const workspaceRow = workspaceToggle.closest("li");
    if (!workspaceRow) throw new Error("Expected a workspace row.");

    await user.click(within(workspaceRow).getByRole("button", {name: "Workspace actions"}));
    await user.click(await screen.findByRole("menuitem", {name: "Pin project"}));

    expect(onEvent).toHaveBeenCalledWith({
      item: expect.objectContaining({id: "pin-project", value: workspace.id}),
      menuId: "workspace-context-menu",
      type: "menu.select",
    });

    await user.click(within(workspaceRow).getByRole("button", {name: "New chat in workspace"}));
    expect(onEvent).toHaveBeenCalledWith({
      actionId: `workspace.${workspace.id}.task.new`,
      surface: "sidebar",
      type: "action.trigger",
    });
  });

  it("captures the shell-web panel shortcuts by physical key code", () => {
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);

    const left = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyB",
      key: "b",
      metaKey: true,
    });
    fireEvent(window, left);

    expect(left.defaultPrevented).toBe(true);
    expect(onEvent).toHaveBeenCalledWith({
      collapsed: true,
      type: "sidebar.toggle",
    });

    const right = new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      cancelable: true,
      code: "KeyB",
      key: "∫",
      metaKey: true,
    });
    fireEvent(window, right);

    expect(right.defaultPrevented).toBe(true);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "sidePanel.close",
    }));
  });

  it("uses Control+N for web new chat and focuses the composer", async () => {
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);
    expect(screen.getByText("⌃N")).toBeInTheDocument();

    const browserReserved = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyN",
      key: "n",
      metaKey: true,
    });
    fireEvent(window, browserReserved);
    expect(browserReserved.defaultPrevented).toBe(false);

    const shellNewChat = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyN",
      ctrlKey: true,
      key: "n",
    });
    fireEvent(window, shellNewChat);

    expect(shellNewChat.defaultPrevented).toBe(true);
    expect(onEvent).toHaveBeenCalledWith({
      actionId: "new-chat",
      surface: "keyboard",
      type: "action.trigger",
    });
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveFocus());
  });

  it("leaves shell shortcuts to an open modal dialog", () => {
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    render(<ChatShell manifest={createOpenSidePanelManifest()} onEvent={onEvent} />);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);

    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyB",
      key: "b",
      metaKey: true,
    });
    fireEvent(window, shortcut);

    expect(shortcut.defaultPrevented).toBe(false);
    expect(onEvent).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("hides workspace actions when the workspace menu has no commands", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.sidebar.contextMenus.workspace.sections = [];
    });

    render(<ChatShell manifest={manifest} />);
    const workspace = manifest.controlPlane.workspaces[0];
    if (!workspace) throw new Error("Expected a workspace fixture.");
    const workspaceToggle = screen.getByRole("button", {
      name: `Toggle ${workspace.name} workspace`,
    });
    const workspaceRow = workspaceToggle.closest("li");
    if (!workspaceRow) throw new Error("Expected a workspace row.");

    expect(screen.queryByRole("button", {name: "Workspace actions"})).not.toBeInTheDocument();
    expect(within(workspaceRow).getByRole("button", {name: "New chat in workspace"})).toBeInTheDocument();
  });

  it("shows the blue dot only for threads explicitly marked unread", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.controlPlane.threads.forEach((thread) => {
        thread.active = true;
        thread.unread = false;
      });
      const unreadThread = draft.controlPlane.threads[1];
      if (!unreadThread) throw new Error("Expected an unread thread fixture.");
      unreadThread.unread = true;
    });

    const {container} = render(<ChatShell manifest={manifest} />);

    expect(container.querySelectorAll("[data-unread-indicator]")).toHaveLength(1);
  });

  it("shimmers a title only while its generated replacement is pending", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      const active = draft.controlPlane.threads.find((thread) => thread.active);
      if (!active) throw new Error("Expected an active thread fixture.");
      active.titleGenerating = true;
    });

    render(<ChatShell manifest={manifest} />);

    expect(screen.getAllByText(manifest.controlPlane.threads.find((thread) => thread.active)?.title ?? "")[0])
      .toHaveAttribute("data-title-generating", "true");
    expect(screen.getByTestId("workspace-title").querySelector("[data-title-generating='true']"))
      .not.toBeNull();
  });

  it("exposes pin and archive as thread-row quick actions", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = createOpenSidePanelManifest();
    const task = manifest.controlPlane.threads[1];
    if (!task) throw new Error("Expected a thread fixture.");

    render(<ChatShell manifest={manifest} onEvent={onEvent} />);
    const taskButton = screen.getByRole("button", {
      name: `${task.title}${task.timeLabel ?? ""}`,
    });
    const taskRow = taskButton.closest("li");
    if (!taskRow) throw new Error("Expected a thread row.");

    await user.click(within(taskRow).getByRole("button", {name: "Pin chat"}));
    await user.click(within(taskRow).getByRole("button", {name: "Archive chat"}));

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      item: expect.objectContaining({id: "pin-chat", value: task.id}),
      menuId: "thread-context-menu",
      type: "menu.select",
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      item: expect.objectContaining({id: "archive-chat", value: task.id}),
      menuId: "thread-context-menu",
      type: "menu.select",
    });
  });

  it("moves pinned threads into a top-level Pinned section", () => {
    const manifest = createOpenSidePanelManifest();
    const task = manifest.controlPlane.threads[1];
    if (!task) throw new Error("Expected a thread fixture.");
    task.pinnedAt = "2026-01-01T00:00:00.000Z";

    render(<ChatShell manifest={ChatShellManifestSchema.parse(manifest)} />);

    const pinned = screen.getByRole("region", {name: "Pinned"});
    expect(within(pinned).getByRole("button", {name: `${task.title}${task.timeLabel ?? ""}`})).toBeInTheDocument();
    const unpin = within(pinned).getByRole("button", {name: "Unpin chat"});
    expect(unpin).toBeInTheDocument();
    expect(unpin.querySelector("svg")).toHaveAttribute("overflow", "visible");
    expect(screen.getAllByRole("button", {name: `${task.title}${task.timeLabel ?? ""}`})).toHaveLength(1);
  });

  it("labels the pinned thread context action as Unpin", async () => {
    const user = userEvent.setup();
    const manifest = createOpenSidePanelManifest();
    const task = manifest.controlPlane.threads[1];
    if (!task) throw new Error("Expected a thread fixture.");
    task.pinnedAt = "2026-01-01T00:00:00.000Z";

    render(<ChatShell manifest={ChatShellManifestSchema.parse(manifest)} />);
    fireEvent.contextMenu(screen.getByRole("button", {name: `${task.title}${task.timeLabel ?? ""}`}));

    expect(await screen.findByRole("menuitem", {name: "Unpin chat"})).toBeInTheDocument();
    await user.keyboard("{Escape}");
  });

  it("moves focus into settings and traps Tab navigation while settings is open", async () => {
    const user = userEvent.setup();

    render(<ChatShell manifest={createOpenSidePanelManifest()} />);

    await user.click(screen.getByRole("button", {name: "Open settings menu"}));
    await user.click(await screen.findByRole("menuitem", {name: /Settings/}));

    const dialog = await screen.findByRole("dialog", {name: "Settings"});
    const backButton = within(dialog).getByRole("button", {name: "Back to app"});
    await waitFor(() => expect(backButton).toHaveFocus());

    const focusableControls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    const firstButton = focusableControls[0];
    const lastControl = focusableControls.at(-1);

    firstButton.focus();
    fireEvent.keyDown(document, {key: "Tab", shiftKey: true});

    expect(lastControl).toHaveFocus();

    fireEvent.keyDown(document, {key: "Escape"});
    await waitFor(() => expect(screen.queryByRole("dialog", {name: "Settings"})).not.toBeInTheDocument());
  });
});
