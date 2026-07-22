import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import type {ChatShellControlPlane, ChatShellRuntime} from "../contracts/chatShellManifest";
import {
  buildControlPlaneConversationStream,
  CONTROL_PLANE_STREAM_TOKENS_PER_SECOND,
  projectModelStreamEvents,
} from "./controlPlaneConversation";
import {
  createStreamMapperState,
  initialConversationState,
  mapModelStreamEvent,
  type ModelStreamEvent,
  projectStreamEvent,
  type ConversationState,
} from "../packages/chatshell-response-protocol";

type SimulatedControlPlaneTokenStreamOptions = {
  controlPlane: ChatShellControlPlane;
  enabled?: boolean;
  state?: ChatShellRuntime["conversation"]["state"];
  threadId?: string;
};

export function useSimulatedControlPlaneTokenStream(options: SimulatedControlPlaneTokenStreamOptions) {
  const enabled = options.enabled ?? true;
  const conversationState = enabled ? options.state ?? "streaming" : "complete";
  const events = useMemo(
    () => buildControlPlaneConversationStream(options.controlPlane, options.threadId),
    [options.controlPlane, options.threadId],
  );
  const eventsRef = useRef<ModelStreamEvent[]>(events);
  const cursorRef = useRef(0);
  const mapperStateRef = useRef(createStreamMapperState());
  const [state, setState] = useState<ConversationState>(() => getInitialState(events, conversationState));
  const stateRef = useRef<ConversationState>(state);
  const [isStreaming, setIsStreaming] = useState(enabled && conversationState === "streaming");

  const replay = useCallback(() => {
    cursorRef.current = 0;
    mapperStateRef.current = createStreamMapperState();
    const nextState = getInitialState(eventsRef.current, conversationState);
    stateRef.current = nextState;
    setState(nextState);
    setIsStreaming(enabled && conversationState === "streaming");
  }, [conversationState, enabled]);

  useEffect(() => {
    eventsRef.current = events;
    cursorRef.current = 0;
    mapperStateRef.current = createStreamMapperState();
    const nextState = getInitialState(events, conversationState);
    stateRef.current = nextState;
    setState(nextState);
    setIsStreaming(enabled && conversationState === "streaming");
  }, [events, conversationState, enabled]);

  useEffect(() => {
    if (!isStreaming) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      let next = eventsRef.current[cursorRef.current];

      if (!next) {
        setIsStreaming(false);
        return;
      }

      let projected = stateRef.current;

      while (next && next.kind !== "text_delta") {
        for (const uiEvent of mapModelStreamEvent(next, mapperStateRef.current)) {
          projected = projectStreamEvent(projected, uiEvent);
        }
        cursorRef.current += 1;
        next = eventsRef.current[cursorRef.current];
      }

      if (next?.kind === "text_delta") {
        for (const uiEvent of mapModelStreamEvent(next, mapperStateRef.current)) {
          projected = projectStreamEvent(projected, uiEvent);
        }
        cursorRef.current += 1;
      }

      stateRef.current = projected;
      setState(projected);
    }, 1000 / CONTROL_PLANE_STREAM_TOKENS_PER_SECOND);

    return () => window.clearInterval(interval);
  }, [isStreaming]);

  return {
    isStreaming,
    replay,
    state,
    tokensPerSecond: CONTROL_PLANE_STREAM_TOKENS_PER_SECOND,
  };
}

function getInitialState(events: ModelStreamEvent[], conversationState: ChatShellRuntime["conversation"]["state"]) {
  if (conversationState === "complete") {
    return projectModelStreamEvents(events);
  }

  if (conversationState === "error") {
    return projectModelStreamEvents(events.slice(0, 18));
  }

  return initialConversationState;
}
