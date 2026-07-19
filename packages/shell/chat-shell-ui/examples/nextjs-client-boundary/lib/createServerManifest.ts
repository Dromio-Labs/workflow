import {createMinimalChatShellManifest} from "../../shared/minimalManifest";

export async function createServerManifest() {
  return createMinimalChatShellManifest({
    runtime: {conversation: {state: "complete"}},
  });
}
