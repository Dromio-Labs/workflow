import {render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";

import {ChatShell, type ChatShellIconRendererProps} from "../../src/chat-shell";
import {ChatShellManifestSchema, type ChatShellManifest} from "../../src/chat-shell-contracts";
import {mockChatShellManifest} from "../../src/chat-shell-mock-backend";

function createOpenSidePanelManifest(overrides?: (manifest: ChatShellManifest) => void) {
  const manifest = structuredClone(mockChatShellManifest);

  manifest.layout.sidePanel.defaultOpen = true;
  manifest.registries.chrome.sidePanel.initialSurfaceId = "review";

  overrides?.(manifest);

  return ChatShellManifestSchema.parse(manifest);
}

function suppressExpectedRenderErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

function TestIcon({className, name}: ChatShellIconRendererProps) {
  return <span aria-hidden="true" className={className} data-icon-name={name} data-testid={`icon-${name}`} />;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatShell renderer registration", () => {
  it("allows a custom shell slot renderer to fully replace the default slot content", () => {
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
            "shell.partner.window-chrome": ({slot}) => (
              <header aria-label="Partner chrome replacement" data-slot-id={slot.id}>
                Partner chrome
              </header>
            ),
          },
        }}
      />,
    );

    expect(screen.getByLabelText("Partner chrome replacement")).toHaveAttribute("data-slot-id", "window-chrome-default");
    expect(screen.queryByRole("button", {name: "Toggle status panel"})).not.toBeInTheDocument();
  });

  it("throws a helpful error when a manifest references an unregistered custom side-panel renderer", () => {
    suppressExpectedRenderErrors();
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.chrome.sidePanel.initialSurfaceId = "partner-review";
      draft.registries.chrome.sidePanel.surfaces = [
        {
          content: {
            body: "Partner review body",
            title: "Partner Review",
          },
          icon: "target",
          label: "Partner Review",
          rendererId: "side-panel.partner-review",
          surfaceId: "partner-review",
          surfaceKind: "review",
        },
      ];
      draft.registries.chrome.sidePanel.tabMenuSurfaceIds = ["partner-review"];
    });

    expect(() => render(<ChatShell manifest={manifest} />)).toThrow(
      'Side panel surface "partner-review" references unregistered renderer "side-panel.partner-review".',
    );
  });

  it("preserves renderer-thrown side-panel errors instead of reporting them as missing registrations", () => {
    suppressExpectedRenderErrors();
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.chrome.sidePanel.initialSurfaceId = "partner-review";
      draft.registries.chrome.sidePanel.surfaces = [
        {
          content: {
            body: "Partner review body",
            title: "Partner Review",
          },
          icon: "target",
          label: "Partner Review",
          rendererId: "side-panel.partner-review",
          surfaceId: "partner-review",
          surfaceKind: "review",
        },
      ];
      draft.registries.chrome.sidePanel.tabMenuSurfaceIds = ["partner-review"];
    });

    let thrownError: unknown;

    try {
      render(
        <ChatShell
          manifest={manifest}
          renderers={{
            sidePanel: {
              "side-panel.partner-review": () => {
                throw new Error("Partner review renderer failed");
              },
            },
          }}
        />,
      );
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe("Partner review renderer failed");
    expect((thrownError as Error).message).not.toMatch(/unregistered renderer/);
  });

  it("uses icon overrides for built-in and custom backend icon ids", () => {
    const manifest = createOpenSidePanelManifest((draft) => {
      draft.registries.navActions[0] = {
        ...draft.registries.navActions[0],
        icon: "custom:launch",
      };
      draft.registries.chrome.sidePanel.surfaces = draft.registries.chrome.sidePanel.surfaces.map((surface) => surface.surfaceId === "review"
        ? {
            ...surface,
            icon: "custom:review",
          }
        : surface);
      draft.registries.status.sections[0].rows[0] = {
        ...draft.registries.status.sections[0].rows[0],
        icon: "terminal",
      };
    });

    render(
      <ChatShell
        manifest={manifest}
        renderers={{
          icons: {
            "custom:launch": TestIcon,
            "custom:review": TestIcon,
            terminal: TestIcon,
          },
        }}
      />,
    );

    expect(screen.getAllByTestId("icon-custom:launch").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("icon-custom:review").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("icon-terminal").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("icon-custom:launch")[0]).toHaveAttribute("data-icon-name", "custom:launch");
    expect(screen.getAllByTestId("icon-custom:review")[0]).toHaveAttribute("data-icon-name", "custom:review");
    expect(screen.getAllByTestId("icon-terminal")[0]).toHaveAttribute("data-icon-name", "terminal");
  });
});
