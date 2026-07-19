import {describe, expect, it, vi} from "vitest";
import {render, screen, within} from "@testing-library/react";
import {createElement} from "react";
import userEvent from "@testing-library/user-event";

import {ChatShell} from "../../src/chat-shell";
import {ChatShellManifestSchema} from "../../src/chat-shell-contracts";
import {mockChatShellManifest} from "../../src/chat-shell-mock-backend";
import {
  chatShellPresentationSchemaVersion,
  ShellControlIdSchema,
  ShellPresentationPatchSchema,
} from "../../src/contracts/chatShellPresentation";
import {resolveShellControlState} from "../../src/components/presentation/resolveShellPresentation";
import {shellControlCatalog} from "../../src/components/presentation/shellControlCatalog";

const policy = {
  defaultVisibility: "auto",
  userConfigurable: true,
} as const;

describe("ChatShell presentation contracts", () => {
  it("keeps the authoring catalog exhaustive with the public control schema", () => {
    expect(Object.keys(shellControlCatalog).sort()).toEqual(
      [...ShellControlIdSchema.options].sort(),
    );
  });

  it("round-trips a sparse versioned patch", () => {
    const patch = ShellPresentationPatchSchema.parse({
      controls: {
        "chrome.app-picker": {visibility: "hidden"},
        "chrome.status": {visibility: "visible"},
      },
      schemaVersion: chatShellPresentationSchemaVersion,
    });

    expect(ShellPresentationPatchSchema.parse(JSON.parse(JSON.stringify(patch)))).toEqual(patch);
  });

  it("rejects unknown control ids and versions", () => {
    expect(() => ShellPresentationPatchSchema.parse({
      controls: {"chrome.unknown": {visibility: "hidden"}},
      schemaVersion: chatShellPresentationSchemaVersion,
    })).toThrow();
    expect(() => ShellPresentationPatchSchema.parse({
      controls: {},
      schemaVersion: "chat-shell-presentation.v2",
    })).toThrow();
  });
});

describe("resolveShellControlState", () => {
  it.each([
    {
      expected: {state: "hidden"},
      input: {capability: {state: "unsupported"} as const, contentAvailable: true},
      name: "unsupported capability",
    },
    {
      expected: {state: "hidden"},
      input: {capability: {state: "available"} as const, contentAvailable: false},
      name: "automatic visibility without content",
    },
    {
      expected: {state: "visible"},
      input: {capability: {state: "available"} as const, contentAvailable: true},
      name: "automatic visibility with content",
    },
  ])("resolves $name", ({expected, input}) => {
    expect(resolveShellControlState({
      ...input,
      controlId: "chrome.status",
      policy,
    })).toEqual(expected);
  });

  it("always hides unsupported controls", () => {
    expect(resolveShellControlState({
      capability: {state: "unsupported"},
      contentAvailable: true,
      controlId: "chrome.app-picker",
      patch: {
        controls: {"chrome.app-picker": {visibility: "visible"}},
        schemaVersion: chatShellPresentationSchemaVersion,
      },
      policy,
    })).toEqual({state: "hidden"});
  });

  it("uses content for automatic visibility", () => {
    expect(resolveShellControlState({
      capability: {state: "available"},
      contentAvailable: false,
      controlId: "chrome.status",
      policy,
    })).toEqual({state: "hidden"});
  });

  it("allows an explicit product patch and permitted preference", () => {
    expect(resolveShellControlState({
      capability: {state: "available"},
      contentAvailable: true,
      controlId: "chrome.status",
      patch: {
        controls: {"chrome.status": {visibility: "visible"}},
        schemaVersion: chatShellPresentationSchemaVersion,
      },
      policy,
      preferences: {controls: {"chrome.status": "hidden"}},
    })).toEqual({state: "hidden"});
  });

  it("keeps required controls visible", () => {
    expect(resolveShellControlState({
      capability: {state: "available"},
      contentAvailable: false,
      controlId: "chrome.status",
      policy: {...policy, required: true},
      preferences: {controls: {"chrome.status": "hidden"}},
    })).toEqual({state: "visible"});
  });

  it("preserves a temporary-unavailability reason", () => {
    expect(resolveShellControlState({
      capability: {reason: "Runtime reconnecting", state: "temporarily-unavailable"},
      contentAvailable: true,
      controlId: "chrome.terminal",
      policy: {...policy, defaultVisibility: "visible"},
    })).toEqual({reason: "Runtime reconnecting", state: "disabled"});
  });
});

describe("ChatShell presentation rendering", () => {
  it("removes unsupported and product-hidden controls from the production tree", () => {
    const sourceManifest = structuredClone(mockChatShellManifest);
    delete sourceManifest.registries.chrome.appPicker;
    const manifest = ChatShellManifestSchema.parse({
      ...sourceManifest,
      capabilities: {
        controls: {
          "chrome.app-picker": {state: "unsupported"},
          "chrome.terminal": {state: "unsupported"},
        },
      },
    });
    const {container} = render(createElement(ChatShell, {
      manifest,
      presentation: {
          controls: {
            "chrome.side-panel": {visibility: "hidden"},
            "chrome.status": {visibility: "hidden"},
          },
          schemaVersion: chatShellPresentationSchemaVersion,
      },
    }));

    expect(screen.queryByRole("button", {name: "Choose app"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Toggle terminal"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Toggle status panel"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button", {name: "Expand side pane"})).not.toBeInTheDocument();
    for (const controlId of [
      "chrome.app-picker",
      "chrome.side-panel",
      "chrome.status",
      "chrome.terminal",
    ]) {
      expect(container.querySelector(`[data-shell-control-id="${controlId}"]`)).toBeNull();
    }
  });

  it("renders temporary unavailability as a disabled control with a reason", () => {
    const manifest = ChatShellManifestSchema.parse({
      ...structuredClone(mockChatShellManifest),
      capabilities: {
        controls: {
          "chrome.terminal": {
            reason: "Runtime reconnecting",
            state: "temporarily-unavailable",
          },
        },
      },
    });

    render(createElement(ChatShell, {manifest}));

    expect(screen.getByRole("button", {name: "Toggle terminal"})).toMatchObject({
      disabled: true,
      title: "Runtime reconnecting",
    });
  });

  it("renders a one-model catalog as a read-only indicator", () => {
    const source = structuredClone(mockChatShellManifest);
    const manifest = ChatShellManifestSchema.parse({
      ...source,
      registries: {
        ...source.registries,
        composer: {
          ...source.registries.composer,
          model: "Fast",
          modelMenu: {id: "model-menu-readonly", sections: []},
        },
      },
    });

    render(createElement(ChatShell, {manifest}));

    expect(screen.getAllByLabelText("Model: Fast")).toHaveLength(2);
    expect(screen.queryByRole("button", {name: "Fast"})).not.toBeInTheDocument();
  });

  it("removes non-window controls through the same production resolver", () => {
    const hiddenControlIds = [
      "chrome.branch",
      "chrome.workspace",
      "composer.context",
      "composer.model",
      "sidebar.user",
      "status-rail",
    ] as const;
    const {container} = render(createElement(ChatShell, {
      manifest: mockChatShellManifest,
      presentation: {
        controls: Object.fromEntries(hiddenControlIds.map((controlId) => [
          controlId,
          {visibility: "hidden" as const},
        ])),
        schemaVersion: chatShellPresentationSchemaVersion,
      },
    }));

    for (const controlId of hiddenControlIds) {
      expect(container.querySelector(`[data-shell-control-id="${controlId}"]`)).toBeNull();
    }
  });

  it("keeps a host-required control locked in Dev Mode", async () => {
    const user = userEvent.setup();
    const {container} = render(createElement(ChatShell, {
      devtools: {enabled: true, initiallyOpen: true},
      manifest: mockChatShellManifest,
      presentationPolicy: {
        controls: {
          "chrome.terminal": {
            defaultVisibility: "visible",
            required: true,
            userConfigurable: false,
          },
        },
      },
    }));

    await user.click(screen.getByRole("button", {name: "Toggle terminal"}));

    expect(screen.getByRole("button", {name: "Toggle terminal"})).toBeInTheDocument();
    expect(container.querySelector('[data-shell-control-id="chrome.terminal"]')).toHaveAttribute(
      "data-shell-control-required",
      "true",
    );
    expect(within(screen.getByRole("group", {name: "Terminal draft override"}))
      .getByRole("button", {name: "Hide"})).toBeDisabled();
  });

  it("visually edits, inherits, multi-hides, and previews the production patch", async () => {
    const user = userEvent.setup();
    const {container} = render(createElement(ChatShell, {
      devtools: {enabled: true},
      manifest: mockChatShellManifest,
    }));

    await user.click(screen.getByRole("button", {name: "Toggle Dev Mode controls"}));
    await user.click(screen.getByRole("button", {name: "Toggle status panel"}));

    expect(container.querySelector('[data-shell-control-id="chrome.status"]')).toHaveAttribute(
      "data-shell-devtools-result",
      "hidden",
    );
    await user.click(within(screen.getByRole("group", {name: "Status panel draft override"}))
      .getByRole("button", {name: "Inherit"}));
    expect(container.querySelector('[data-shell-control-id="chrome.status"]')).toHaveAttribute(
      "data-shell-devtools-result",
      "shown",
    );

    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", {name: "Toggle status panel"}));
    await user.click(screen.getByRole("button", {name: "Expand side pane"}));
    await user.keyboard("{/Shift}");
    await user.click(screen.getByRole("button", {name: "Hide selected (2)"}));

    expect(container.querySelector('[data-shell-control-id="chrome.status"]')).toHaveAttribute("data-shell-devtools-result", "hidden");
    expect(container.querySelector('[data-shell-control-id="chrome.side-panel"]')).toHaveAttribute("data-shell-devtools-result", "hidden");
    await user.click(screen.getByRole("button", {name: "Preview"}));
    expect(container.querySelector('[data-shell-dev-mode="preview"]')).not.toBeNull();
    expect(screen.queryByRole("group", {name: /draft override/})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Toggle Dev Mode controls"}));
    await user.click(screen.getByRole("button", {name: "Back to edit"}));
    expect(screen.getByRole("button", {name: "Reset draft"})).toBeInTheDocument();
  });

  it("rejects invalid imported presentation JSON with an actionable error", async () => {
    const user = userEvent.setup();
    render(createElement(ChatShell, {
      devtools: {enabled: true, initiallyOpen: true},
      manifest: mockChatShellManifest,
    }));

    await user.click(screen.getByRole("button", {name: "Export"}));
    await user.type(screen.getByRole("textbox", {name: "Import presentation JSON"}), "not json");
    await user.click(screen.getByRole("button", {name: "Apply imported JSON"}));

    expect(screen.getByRole("alert")).toHaveTextContent(/Unexpected token|JSON/);
  });

  it("separates baseline, draft, and result while keeping hidden controls on the authoring canvas", async () => {
    const user = userEvent.setup();
    const {container} = render(createElement(ChatShell, {
      devtools: {enabled: true, initiallyOpen: true},
      manifest: mockChatShellManifest,
      presentation: {
        controls: {
          "chrome.app-picker": {visibility: "hidden"},
          "chrome.side-panel": {visibility: "hidden"},
          "chrome.status": {visibility: "hidden"},
          "chrome.terminal": {visibility: "hidden"},
        },
        schemaVersion: chatShellPresentationSchemaVersion,
      },
    }));

    expect(screen.getByRole("region", {name: "Component inventory"})).toBeInTheDocument();
    expect(screen.getByText(/^Configured but hidden/)).toBeInTheDocument();
    const terminalGroup = screen.getByRole("group", {name: "Terminal draft override"});
    expect(within(terminalGroup).getByRole("button", {name: "Inherit"})).toHaveAttribute("aria-pressed", "true");
    expect(terminalGroup.parentElement).toHaveTextContent("Base: hidden");
    expect(terminalGroup.parentElement).toHaveTextContent("Result: hidden");
    expect(container.querySelector('[data-shell-control-id="chrome.terminal"]')).toHaveAttribute("data-shell-devtools-result", "hidden");
    await user.click(within(terminalGroup).getByRole("button", {name: "Show"}));
    expect(container.querySelector('[data-shell-control-id="chrome.terminal"]')).toHaveAttribute("data-shell-devtools-result", "shown");
    await user.click(screen.getByRole("button", {name: "Reset draft"}));
    expect(container.querySelector('[data-shell-control-id="chrome.terminal"]')).toHaveAttribute("data-shell-devtools-result", "hidden");
    expect(screen.getByText("composer.speed")).toBeInTheDocument();
  });

  it("copies the validated JSON export", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {writeText},
    });
    render(createElement(ChatShell, {
      devtools: {enabled: true, initiallyOpen: true},
      manifest: mockChatShellManifest,
    }));

    await user.click(screen.getByRole("button", {name: "Export"}));
    await user.click(screen.getByRole("button", {name: "Copy JSON"}));

    const copied = writeText.mock.calls[0]?.[0];
    expect(ShellPresentationPatchSchema.parse(JSON.parse(copied ?? ""))).toEqual({
      controls: {},
      schemaVersion: chatShellPresentationSchemaVersion,
    });
  });
});
