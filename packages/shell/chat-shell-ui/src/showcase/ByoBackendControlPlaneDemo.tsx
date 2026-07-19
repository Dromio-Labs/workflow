import {useCallback, useMemo, useState} from "react";

import {ChatShell, type ChatShellEvent} from "../chat-shell";
import {
  createInitialByoBackendSnapshot,
  createManifestFromBackendSnapshot,
  handleBackendControlPlaneEvent,
  type BackendSnapshot,
} from "./byoBackendControlPlane";

export function ByoBackendControlPlaneDemo() {
  const [eventLog, setEventLog] = useState<string[]>(["byo-backend.ready"]);
  const [snapshot, setSnapshot] = useState<BackendSnapshot>(() => createInitialByoBackendSnapshot());
  const [shellFullscreen, setShellFullscreen] = useState(false);
  const manifest = useMemo(() => createManifestFromBackendSnapshot(snapshot), [snapshot]);

  const handleEvent = useCallback((event: ChatShellEvent) => {
    setSnapshot((current) => {
      const result = handleBackendControlPlaneEvent(current, event);
      setEventLog((entries) => [result.eventLogEntry, ...entries].slice(0, 8));
      return result.snapshot;
    });
  }, []);

  return (
    <main className={shellFullscreen ? "chat-shell-showcase chat-shell-showcase-fullscreen" : "chat-shell-showcase"}>
      {!shellFullscreen ? (
        <aside className="chat-shell-showcase-sidebar" aria-label="BYO backend controls">
          <div className="chat-shell-showcase-heading">
            <span>ChatShell v8</span>
            <strong>BYO backend</strong>
          </div>

          <section className="chat-shell-showcase-control">
            <h2>Event log</h2>
            <ol className="chat-shell-showcase-events" aria-label="Recent ChatShell events">
              {eventLog.map((entry, index) => (
                <li key={`${entry}-${index}`}>{entry}</li>
              ))}
            </ol>
          </section>
        </aside>
      ) : null}

      <section className="chat-shell-showcase-preview" aria-label="ChatShell BYO backend preview">
        <ChatShell
          initialFullscreen={shellFullscreen}
          manifest={manifest}
          onEvent={handleEvent}
          onFullscreenChange={setShellFullscreen}
        />
      </section>
    </main>
  );
}
