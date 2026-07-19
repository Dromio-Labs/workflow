import type {
  TerminalQuestionOptions,
  TerminalQuestionSession,
} from "../terminal-questions.js";

type QuestionDockRequest = {
  options: TerminalQuestionOptions;
  resolve(answered: boolean): void;
  session: TerminalQuestionSession;
};

export type QuestionDockController = ReturnType<typeof createQuestionDockController>;

export function createQuestionDockController() {
  let request: QuestionDockRequest | undefined;
  let activeIndex = 0;
  const listeners = new Set<(request: QuestionDockRequest | undefined) => void>();
  const stateListeners = new Set<(state: { activeIndex: number }) => void>();
  return {
    ask(session: TerminalQuestionSession, options: TerminalQuestionOptions) {
      return new Promise<boolean>((resolve) => {
        activeIndex = 0;
        request = { options, resolve, session };
        emit();
        emitState();
      });
    },
    close() {
      request?.resolve(false);
      request = undefined;
      activeIndex = 0;
      listeners.clear();
      emitState();
      stateListeners.clear();
    },
    complete(answered: boolean) {
      const current = request;
      request = undefined;
      activeIndex = 0;
      current?.resolve(answered);
      emit();
      emitState();
    },
    current() {
      return request;
    },
    currentIndex() {
      return activeIndex;
    },
    setActiveIndex(index: number) {
      activeIndex = Math.max(0, index);
      emitState();
    },
    subscribe(listener: (request: QuestionDockRequest | undefined) => void) {
      listeners.add(listener);
      listener(request);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeState(listener: (state: { activeIndex: number }) => void) {
      stateListeners.add(listener);
      listener({ activeIndex });
      return () => {
        stateListeners.delete(listener);
      };
    },
  };

  function emit() {
    for (const listener of listeners) listener(request);
  }

  function emitState() {
    for (const listener of stateListeners) listener({ activeIndex });
  }
}
