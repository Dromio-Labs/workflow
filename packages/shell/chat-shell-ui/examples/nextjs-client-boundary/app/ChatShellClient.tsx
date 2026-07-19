"use client";

import {useCallback, useState} from "react";
import {ChatShell, type ChatShellEvent} from "@dromio/chat-shell-ui";
import {
  ChatShellManifestSchema,
  type ChatShellManifest,
} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";

export function ChatShellClient({initialManifest}: {initialManifest: ChatShellManifest}) {
  const [manifest, setManifest] = useState(() => ChatShellManifestSchema.parse(initialManifest));

  const handleEvent = useCallback(async (event: ChatShellEvent) => {
    const response = await fetch("/api/chat-shell/events", {
      body: JSON.stringify(event),
      headers: {"content-type": "application/json"},
      method: "POST",
    });

    setManifest(ChatShellManifestSchema.parse(await response.json()));
  }, []);

  return <ChatShell manifest={manifest} onEvent={handleEvent} />;
}
