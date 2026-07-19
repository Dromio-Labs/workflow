import type {ChatShellProps} from "../chat-shell";
import {ChatShell} from "../components/shell/ChatShell";
import {useSimulatedControlPlaneTokenStream} from "../runtime/useSimulatedControlPlaneTokenStream";

export type DemoChatShellProps = ChatShellProps & {
  readonly simulateStreaming?: boolean;
};

export function DemoChatShell({manifest, simulateStreaming = false, ...props}: DemoChatShellProps) {
  const activeThreadId = manifest.controlPlane.activeThreadId;
  const runtimeState = manifest.runtime.conversation.state;
  const simulatedConversation = useSimulatedControlPlaneTokenStream({
    controlPlane: manifest.controlPlane,
    enabled: simulateStreaming,
    state: runtimeState,
    threadId: activeThreadId,
  });

  return (
    <ChatShell
      {...props}
      manifest={manifest}
      conversationStateOverride={simulateStreaming
        ? {
            isStreaming: simulatedConversation.isStreaming,
            state: simulatedConversation.state,
          }
        : undefined}
    />
  );
}
