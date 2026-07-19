import {lazy, Suspense, useCallback, useEffect, useState} from "react";

import {ChatShell, type ChatShellEvent} from "./chat-shell";
import type {ChatShellManifest, ShellPresentationPolicy} from "./chat-shell-contracts";
import {ByoBackendControlPlaneDemo} from "./showcase/ByoBackendControlPlaneDemo";
import {DemoChatShell} from "./showcase/DemoChatShell";

const ChatShellShowcase = lazy(async () => {
  const module = await import("./showcase/ChatShellShowcase");
  return {default: module.ChatShellShowcase};
});

export function App() {
  const params = new URLSearchParams(window.location.search);
  const isByoBackendDemo = params.get("demo") === "byo-backend";
  const shouldShowShowcase = !isByoBackendDemo && params.get("showcase") === "1";
  const presentationDevToolsEnabled = import.meta.env.DEV && params.get("devtools") === "1";
  const presentationPolicy = import.meta.env.DEV && params.get("lock") === "terminal"
    ? {
        controls: {
          "chrome.terminal": {
            defaultVisibility: "visible",
            required: true,
            userConfigurable: false,
          },
        },
      } satisfies ShellPresentationPolicy
    : undefined;
  const [manifest, setManifest] = useState<ChatShellManifest | null>(null);
  const [simulateStreaming, setSimulateStreaming] = useState(false);
  const [shellFullscreen, setShellFullscreen] = useState(false);
  const handleEvent = useCallback((event: ChatShellEvent) => {
    if (event.type === "composer.submit") {
      console.info("Mock backend received composer.submit", event.payload);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadManifest() {
      if (isByoBackendDemo || shouldShowShowcase) {
        return;
      }

      const {mockChatShellManifests} = await import("./chat-shell-mock-backend");
      const variantName = new URLSearchParams(window.location.search).get("variant");
      const selectedVariantName = variantName && variantName in mockChatShellManifests
        ? variantName as keyof typeof mockChatShellManifests
        : "default";
      const nextManifest = mockChatShellManifests[selectedVariantName];

      if (!cancelled) {
        setManifest(nextManifest);
        setSimulateStreaming(selectedVariantName === "default" || selectedVariantName === "streaming");
      }
    }

    void loadManifest();

    return () => {
      cancelled = true;
    };
  }, [isByoBackendDemo, shouldShowShowcase]);

  if (isByoBackendDemo) {
    return (
      <>
        <ByoBackendControlPlaneDemo />
        <div className="chat-shell-version-label" aria-label="Version v8">
          v8
        </div>
      </>
    );
  }

  if (shouldShowShowcase) {
    return (
      <>
        <Suspense fallback={null}>
          <ChatShellShowcase initialMode="stock" />
        </Suspense>
        <div className="chat-shell-version-label" aria-label="Version v8">
          v8
        </div>
      </>
    );
  }

  return (
    <>
      <main className={shellFullscreen ? "v1-stage v1-stage-fullscreen" : "v1-stage"}>
        {manifest ? (
          simulateStreaming ? (
            <DemoChatShell
              devtools={{enabled: presentationDevToolsEnabled}}
              initialFullscreen={shellFullscreen}
              manifest={manifest}
              onEvent={handleEvent}
              onFullscreenChange={setShellFullscreen}
              presentationPolicy={presentationPolicy}
              simulateStreaming
            />
          ) : (
            <ChatShell
              devtools={{enabled: presentationDevToolsEnabled}}
              initialFullscreen={shellFullscreen}
              manifest={manifest}
              onEvent={handleEvent}
              onFullscreenChange={setShellFullscreen}
              presentationPolicy={presentationPolicy}
            />
          )
        ) : null}
      </main>
      <div className="chat-shell-version-label" aria-label="Version v8">
        v8
      </div>
    </>
  );
}
