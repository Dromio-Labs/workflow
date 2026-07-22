import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import type {ChatShellControlPlane, ChatShellRuntime} from "../contracts/chatShellManifest";
import {buildMockConversationStream, STREAM_TOKENS_PER_SECOND} from "../data/mockConversation";
import {
  createStreamMapperState,
  initialConversationState,
  mapModelStreamEvent,
  type ModelStreamEvent,
  projectStreamEvent,
  type ConversationState,
} from "../packages/chatshell-response-protocol";

type MockTokenStreamOptions = {
  controlPlane: ChatShellControlPlane;
  state?: ChatShellRuntime["conversation"]["state"];
  threadId?: string;
};

export function useMockTokenStream(options: MockTokenStreamOptions) {
  const conversationState = options.state ?? "streaming";
  const events = useMemo(
    () => buildMockConversationStream(options.controlPlane, options.threadId),
    [options.controlPlane, options.threadId],
  );
  const eventsRef = useRef<ModelStreamEvent[]>(events);
  const cursorRef = useRef(0);
  const mapperStateRef = useRef(createStreamMapperState());
  const [state, setState] = useState<ConversationState>(() => getInitialState(events, conversationState));
  const stateRef = useRef<ConversationState>(state);
  const [isStreaming, setIsStreaming] = useState(conversationState === "streaming");

  const replay = useCallback(() => {
    cursorRef.current = 0;
    mapperStateRef.current = createStreamMapperState();
    const nextState = getInitialState(eventsRef.current, conversationState);
    stateRef.current = nextState;
    setState(nextState);
    setIsStreaming(conversationState === "streaming");
  }, [conversationState]);

  useEffect(() => {
    eventsRef.current = events;
    cursorRef.current = 0;
    mapperStateRef.current = createStreamMapperState();
    const nextState = getInitialState(events, conversationState);
    stateRef.current = nextState;
    setState(nextState);
    setIsStreaming(conversationState === "streaming");
  }, [events, conversationState]);

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
    }, 1000 / STREAM_TOKENS_PER_SECOND);

    return () => window.clearInterval(interval);
  }, [isStreaming]);

  return {
    isStreaming,
    replay,
    state,
    tokensPerSecond: STREAM_TOKENS_PER_SECOND,
  };
}

function getInitialState(events: ModelStreamEvent[], conversationState: ChatShellRuntime["conversation"]["state"]) {
  if (conversationState === "complete") {
    return projectEvents(events);
  }

  if (conversationState === "error") {
    return projectEvents(events.slice(0, 18));
  }

  return initialConversationState;
}

function projectEvents(events: ModelStreamEvent[]) {
  const mapperState = createStreamMapperState();
  let projected: ConversationState = initialConversationState;

  for (const event of events) {
    for (const uiEvent of mapModelStreamEvent(event, mapperState)) {
      projected = projectStreamEvent(projected, uiEvent);
    }
  }

  return projected;
}
