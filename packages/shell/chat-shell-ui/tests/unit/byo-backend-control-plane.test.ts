import {readFileSync} from "node:fs";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";

import {ChatShellManifestSchema} from "../../src/chat-shell-contracts";
import {
  createInitialByoBackendSnapshot,
  createManifestFromBackendSnapshot,
  handleBackendControlPlaneEvent,
} from "../../src/showcase/byoBackendControlPlane";

describe("BYO backend control-plane demo", () => {
  it("creates a valid initial backend-owned manifest", () => {
    const manifest = createManifestFromBackendSnapshot(createInitialByoBackendSnapshot());

    expect(ChatShellManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.runtime.conversation.state).toBe("complete");
  });

  it("reduces composer.submit into a new validated manifest snapshot", () => {
    const snapshot = createInitialByoBackendSnapshot();
    const result = handleBackendControlPlaneEvent(snapshot, {
      payload: {
        attachments: [],
        prompt: "Add a production adapter example",
      },
      type: "composer.submit",
    });

    expect(ChatShellManifestSchema.safeParse(result.manifest).success).toBe(true);
    expect(result.manifest.controlPlane.activeThreadId).toMatch(/^thread-byo-/);
    expect(result.manifest.controlPlane.threads[0].title).toBe("Add a production adapter example");
    expect(result.manifest.controlPlane.messages[0]).toMatchObject({
      role: "user",
    });
    expect(result.eventLogEntry).toContain("composer.submit");
  });

  it("keeps the BYO reducer and example free of mock backend imports", () => {
    const files = [
      "src/showcase/byoBackendControlPlane.ts",
      "src/showcase/ByoBackendControlPlaneDemo.tsx",
      "examples/byo-backend-control-plane/backend.ts",
      "examples/byo-backend-control-plane/App.tsx",
    ];

    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");

      expect(source).not.toContain("chat-shell-mock-backend");
      expect(source).not.toContain("mockChatShellManifests");
      expect(source).not.toContain("src/data/");
    }
  });
});
