import {useCallback, useState} from "react";

import {ChatShell, type ChatShellEvent} from "@dromio/chat-shell-ui";
import "@dromio/chat-shell-ui/styles.css";
import {
  createInitialByoBackendSnapshot,
  createManifestFromBackendSnapshot,
  handleBackendControlPlaneEvent,
  type BackendSnapshot,
} from "./backend";

export function App() {
  const [snapshot, setSnapshot] = useState<BackendSnapshot>(() => createInitialByoBackendSnapshot());
  const manifest = createManifestFromBackendSnapshot(snapshot);

  const handleEvent = useCallback((event: ChatShellEvent) => {
    setSnapshot((current) => handleBackendControlPlaneEvent(current, event).snapshot);
  }, []);

  return <ChatShell manifest={manifest} onEvent={handleEvent} />;
}
