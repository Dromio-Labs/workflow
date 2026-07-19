import {
  chatShellSchemaVersion,
  type ChatShellAppearance,
  ChatShellManifestSchema,
  type ChatShellControlPlane,
  type ChatShellLayoutConfig,
  type ChatShellManifest,
  type ChatShellRegistries,
  type ChatShellRuntime,
} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";

import {createMinimalChatShellManifest} from "../shared/minimalManifest";

type BackendSnapshot = {
  readonly appearance?: ChatShellAppearance;
  readonly controlPlane: ChatShellControlPlane;
  readonly layout: ChatShellLayoutConfig;
  readonly registries: ChatShellRegistries;
  readonly runtime: ChatShellRuntime;
};

export function createManifestFromBackend(snapshot: BackendSnapshot): ChatShellManifest {
  return ChatShellManifestSchema.parse({
    appearance: snapshot.appearance,
    controlPlane: snapshot.controlPlane,
    layout: snapshot.layout,
    registries: snapshot.registries,
    runtime: snapshot.runtime,
    schemaVersion: chatShellSchemaVersion,
  });
}

const baseManifest = createMinimalChatShellManifest();

export const exampleBackendSnapshot = {
  appearance: {
    ...baseManifest.appearance,
    density: "compact",
  },
  controlPlane: baseManifest.controlPlane,
  layout: baseManifest.layout,
  registries: baseManifest.registries,
  runtime: {
    conversation: {
      state: "complete",
    },
  },
} satisfies BackendSnapshot;

export const exampleManifest = createManifestFromBackend(exampleBackendSnapshot);
