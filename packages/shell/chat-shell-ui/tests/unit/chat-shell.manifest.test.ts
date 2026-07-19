import {describe, expect, it} from "vitest";

import {getChatShellAppearance} from "../../src/components/shell/chatShellAppearance";
import {ChatShellManifestSchema, type ChatShellManifest} from "../../src/chat-shell-contracts";
import {mockChatShellManifest} from "../../src/chat-shell-mock-backend";

function cloneManifest(overrides: (manifest: ChatShellManifest) => void) {
  const manifest = structuredClone(mockChatShellManifest);
  overrides(manifest);
  return manifest;
}

function expectManifestIssue(overrides: (manifest: ChatShellManifest) => void, path: Array<number | string>, message: string) {
  const result = ChatShellManifestSchema.safeParse(cloneManifest(overrides));

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining(message),
        path,
      }),
    ]),
  );
}

describe("ChatShellManifestSchema", () => {
  it("requires unsupported app-picker capability when menu data is absent", () => {
    const result = ChatShellManifestSchema.parse(cloneManifest((manifest) => {
      delete manifest.registries.chrome.appPicker;
      manifest.capabilities = {
        controls: {"chrome.app-picker": {state: "unsupported"}},
      };
    }));

    expect(result.registries.chrome.appPicker).toBeUndefined();
  });

  it("rejects placeholder app-picker data for an unsupported capability", () => {
    expectManifestIssue((manifest) => {
      manifest.capabilities = {
        controls: {"chrome.app-picker": {state: "unsupported"}},
      };
    }, ["registries", "chrome", "appPicker"], "must not carry placeholder menu data");
  });

  it("parses omitted appearance and resolves default shell appearance", () => {
    const result = ChatShellManifestSchema.parse(cloneManifest((manifest) => {
      delete manifest.appearance;
    }));
    const appearance = getChatShellAppearance(result.appearance);

    expect(result.appearance).toBeUndefined();
    expect(appearance.attributes).toMatchObject({
      "data-chat-shell-color-mode": "dark",
      "data-chat-shell-density": "comfortable",
      "data-chat-shell-radius": "default",
      "data-chat-shell-type-scale": "default",
    });
    expect((appearance.viewportStyle as Record<string, string | number>)["--chat-shell-viewport-max-width"]).toBe("80rem");
  });

  it("maps every appearance token override to canonical chat shell CSS variables", () => {
    const tokens = {
      accent: "token-accent",
      accentForeground: "token-accent-foreground",
      background: "token-background",
      backgroundAlt: "token-background-alt",
      brand: "token-brand",
      border: "token-border",
      foreground: "token-foreground",
      foregroundSubtle: "token-foreground-subtle",
      inputBorderFocused: "token-input-border-focused",
      surface: "token-surface",
      surfaceHover: "token-surface-hover",
      windowBg: "token-window-bg",
      windowBorder: "token-window-border",
      windowShadow: "token-window-shadow",
    } satisfies NonNullable<NonNullable<ChatShellManifest["appearance"]>["tokens"]>;
    const appearance = getChatShellAppearance({tokens});
    const rootStyle = appearance.rootStyle as Record<string, string | number | undefined>;

    expect(rootStyle["--chat-shell-color-accent"]).toBe(tokens.accent);
    expect(rootStyle["--chat-shell-color-accent-foreground"]).toBe(tokens.accentForeground);
    expect(rootStyle["--chat-shell-color-background"]).toBe(tokens.background);
    expect(rootStyle["--chat-shell-color-background-alt"]).toBe(tokens.backgroundAlt);
    expect(rootStyle["--chat-shell-color-brand"]).toBe(tokens.brand);
    expect(rootStyle["--chat-shell-color-border"]).toBe(tokens.border);
    expect(rootStyle["--chat-shell-color-foreground"]).toBe(tokens.foreground);
    expect(rootStyle["--chat-shell-color-foreground-subtle"]).toBe(tokens.foregroundSubtle);
    expect(rootStyle["--chat-shell-color-input-border-focused"]).toBe(tokens.inputBorderFocused);
    expect(rootStyle["--chat-shell-color-surface"]).toBe(tokens.surface);
    expect(rootStyle["--chat-shell-color-surface-hover"]).toBe(tokens.surfaceHover);
    expect(rootStyle["--chat-shell-color-window-bg"]).toBe(tokens.windowBg);
    expect(rootStyle["--chat-shell-color-window-border"]).toBe(tokens.windowBorder);
    expect(rootStyle["--chat-shell-color-window-shadow"]).toBe(tokens.windowShadow);
  });

  it("rejects blank appearance CSS values", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.appearance = {
        tokens: {
          brand: "",
        },
      };
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["appearance", "tokens", "brand"],
        }),
      ]),
    );
  });

  it("rejects unknown appearance keys", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.appearance = {
        colorMode: "dark",
        themeName: "typo",
      } as never;
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["appearance"],
        }),
      ]),
    );
  });

  it("rejects a side-panel initial surface that is not registered", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.chrome.sidePanel.initialSurfaceId = "missing-surface";
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "chrome", "sidePanel", "initialSurfaceId"],
        }),
      ]),
    );
  });

  it("rejects side-panel tab menu surface ids that are not registered", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.chrome.sidePanel.tabMenuSurfaceIds = ["review", "missing-surface"];
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "chrome", "sidePanel", "tabMenuSurfaceIds", 1],
        }),
      ]),
    );
  });

  it("rejects duplicate side-panel surface ids", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.chrome.sidePanel.surfaces = [
        manifest.registries.chrome.sidePanel.surfaces[0],
        {
          ...manifest.registries.chrome.sidePanel.surfaces[1],
          surfaceId: manifest.registries.chrome.sidePanel.surfaces[0].surfaceId,
        },
      ];
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "chrome", "sidePanel", "surfaces", 1, "surfaceId"],
        }),
      ]),
    );
  });

  it("rejects duplicate side-panel tab menu surface ids", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.chrome.sidePanel.tabMenuSurfaceIds = ["review", "terminal", "review"];
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "chrome", "sidePanel", "tabMenuSurfaceIds", 2],
        }),
      ]),
    );
  });

  it("rejects a custom side-panel renderer id outside the side-panel namespace", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.chrome.sidePanel.surfaces[0] = {
        ...manifest.registries.chrome.sidePanel.surfaces[0],
        rendererId: "custom.review.renderer" as never,
      };
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "chrome", "sidePanel", "surfaces", 0, "rendererId"],
        }),
      ]),
    );
  });

  it("accepts custom side-panel renderer ids and leaves registration enforcement to render time", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.chrome.sidePanel.surfaces[0] = {
        ...manifest.registries.chrome.sidePanel.surfaces[0],
        rendererId: "side-panel.partner-review",
      };
    }));

    expect(result.success).toBe(true);
  });

  it("accepts namespaced custom icon ids in manifest icon fields", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.chrome.sidePanel.surfaces[0] = {
        ...manifest.registries.chrome.sidePanel.surfaces[0],
        icon: "custom:terminal",
      };
      manifest.registries.navActions[0] = {
        ...manifest.registries.navActions[0],
        icon: "custom:launch",
      };
    }));

    expect(result.success).toBe(true);
  });

  it("rejects custom icon ids outside the custom namespace", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.chrome.sidePanel.surfaces[0] = {
        ...manifest.registries.chrome.sidePanel.surfaces[0],
        icon: "partner:terminal" as never,
      };
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "chrome", "sidePanel", "surfaces", 0, "icon"],
        }),
      ]),
    );
  });

  it("accepts custom shell slot renderer ids in the shell namespace", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.layoutSlots = manifest.registries.layoutSlots.map((slot) => slot.region === "windowChrome"
        ? {
            ...slot,
            rendererId: "shell.partner.window-chrome",
          }
        : slot);
    }));

    expect(result.success).toBe(true);
  });

  it("rejects shell slot renderer ids outside the shell namespace", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.layoutSlots = manifest.registries.layoutSlots.map((slot) => slot.region === "windowChrome"
        ? {
            ...slot,
            rendererId: "window.partner.chrome" as never,
          }
        : slot);
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "layoutSlots", expect.any(Number), "rendererId"],
        }),
      ]),
    );
  });

  it("rejects manifests missing a visible required shell layout region", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.layoutSlots = manifest.registries.layoutSlots.map((slot) => slot.region === "composer"
        ? {
            ...slot,
            visible: false,
          }
        : slot);
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "layoutSlots"],
          message: expect.stringContaining('Shell slot region "composer" must have a visible registered slot.'),
        }),
      ]),
    );
  });

  it("accepts optional shell regions without visible slots", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.layoutSlots = manifest.registries.layoutSlots.map((slot) =>
        slot.region === "overlays" || slot.region === "sidePanel" || slot.region === "statusRail"
          ? {...slot, visible: false}
          : slot);
    }));

    expect(result.success).toBe(true);
  });

  it("rejects duplicate shell layout slot ids", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.layoutSlots = manifest.registries.layoutSlots.map((slot) => slot.region === "statusRail"
        ? {
            ...slot,
            id: manifest.registries.layoutSlots[0].id,
          }
        : slot);
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "layoutSlots", expect.any(Number), "id"],
          message: expect.stringContaining(`Shell layout slot id "${mockChatShellManifest.registries.layoutSlots[0].id}" must be unique.`),
        }),
      ]),
    );
  });

  it("rejects custom shell renderer ids with an invalid namespace format", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.layoutSlots = manifest.registries.layoutSlots.map((slot) => slot.region === "composer"
        ? {
            ...slot,
            rendererId: "shell.PartnerComposer" as never,
          }
        : slot);
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "layoutSlots", expect.any(Number), "rendererId"],
        }),
      ]),
    );
  });

  it("rejects built-in shell renderer ids used for the wrong region", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.layoutSlots = manifest.registries.layoutSlots.map((slot) => slot.region === "windowChrome"
        ? {
            ...slot,
            rendererId: "shell.sidebar",
          }
        : slot);
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "layoutSlots", expect.any(Number), "rendererId"],
        }),
      ]),
    );
  });

  it("rejects backend settings when the active section is not registered", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      manifest.registries.settings.activeSectionId = "missing-section";
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "settings", "activeSectionId"],
        }),
      ]),
    );
  });

  it("rejects backend settings choices whose value is outside their options", () => {
    const result = ChatShellManifestSchema.safeParse(cloneManifest((manifest) => {
      const destination = manifest.registries.settings.general.generalRows.find((row) => row.id === "file-open-destination");
      if (destination && destination.control === "select") {
        destination.value = "Unknown IDE";
      }
    }));

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["registries", "settings", "general", "generalRows", expect.any(Number), "value"],
        }),
      ]),
    );
  });

  it("rejects missing active control-plane workspace and thread references", () => {
    expectManifestIssue((draft) => {
      draft.controlPlane.activeWorkspaceId = "missing-workspace";
      draft.controlPlane.activeThreadId = "missing-thread";
    }, ["controlPlane", "activeWorkspaceId"], 'activeWorkspaceId "missing-workspace" must reference a workspace');

    expectManifestIssue((draft) => {
      draft.controlPlane.activeThreadId = "missing-thread";
    }, ["controlPlane", "activeThreadId"], 'activeThreadId "missing-thread" must reference a thread');
  });

  it("rejects invalid workspace thread registries in the control plane", () => {
    expectManifestIssue((draft) => {
      draft.controlPlane.workspaces[0].threadIds = [
        ...draft.controlPlane.workspaces[0].threadIds,
        "missing-thread",
      ];
    }, ["controlPlane", "workspaces", 0, "threadIds", 5], 'workspace "workspace-gomoku-ai" references missing thread "missing-thread"');

    expectManifestIssue((draft) => {
      draft.controlPlane.workspaces[1].threadIds = [
        ...draft.controlPlane.workspaces[1].threadIds,
        "thread-gomoku-board-logic",
      ];
    }, ["controlPlane", "workspaces", 1, "threadIds", 6], 'must reference a thread owned by that workspace');
  });

  it("rejects non-unique control-plane record ids", () => {
    expectManifestIssue((draft) => {
      draft.controlPlane.threads[1] = {
        ...draft.controlPlane.threads[1],
        id: draft.controlPlane.threads[0].id,
      };
    }, ["controlPlane", "threads", 1, "id"], 'thread id "thread-gomoku-board-logic" must be unique');
  });

  it("rejects inconsistent thread and conversation references", () => {
    expectManifestIssue((draft) => {
      draft.controlPlane.threads[0] = {
        ...draft.controlPlane.threads[0],
        conversationId: draft.controlPlane.conversations[1].id,
      };
    }, ["controlPlane", "threads", 0, "conversationId"], "must reference a conversation owned by that thread");

    expectManifestIssue((draft) => {
      draft.controlPlane.conversations[0] = {
        ...draft.controlPlane.conversations[0],
        threadId: "missing-thread",
      };
    }, ["controlPlane", "conversations", 0, "threadId"], 'conversation "conversation-gomoku-board-logic" references missing thread "missing-thread"');
  });

  it("rejects invalid message part references in the control plane", () => {
    expectManifestIssue((draft) => {
      draft.controlPlane.messages[0].partIds = ["missing-part"];
    }, ["controlPlane", "messages", 0, "partIds", 0], 'message "message-user-prompt" references missing message part "missing-part"');

    expectManifestIssue((draft) => {
      draft.controlPlane.messages[0].partIds = ["part-assistant-inspect"];
    }, ["controlPlane", "messages", 0, "partIds", 0], "must reference a part owned by that message");
  });

  it("rejects invalid tool-call references in the control plane", () => {
    expectManifestIssue((draft) => {
      draft.controlPlane.messageParts[2] = {
        ...draft.controlPlane.messageParts[2],
        toolCallId: "missing-tool-call",
      };
    }, ["controlPlane", "messageParts", 2, "toolCallId"], 'message part "part-tool-explored" references missing tool call "missing-tool-call"');

    expectManifestIssue((draft) => {
      draft.controlPlane.toolCalls[0] = {
        ...draft.controlPlane.toolCalls[0],
        messageId: "missing-message",
      };
    }, ["controlPlane", "toolCalls", 0, "messageId"], 'tool call "tool-explored" references missing message "missing-message"');
  });
});
