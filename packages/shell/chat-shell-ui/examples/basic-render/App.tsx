import {ChatShell, type ChatShellEvent} from "@dromio/chat-shell-ui";
import "@dromio/chat-shell-ui/styles.css";

import {createMinimalChatShellManifest} from "../shared/minimalManifest";

const manifest = createMinimalChatShellManifest();

function handleEvent(event: ChatShellEvent) {
  if (event.type === "composer.submit") {
    console.info("Submit prompt", event.payload.prompt);
  }
}

export function App() {
  return <ChatShell manifest={manifest} onEvent={handleEvent} />;
}
