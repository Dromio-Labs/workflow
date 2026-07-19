/** @jsxImportSource @opentui/solid */
import {
  useKeyboard,
} from "@opentui/solid";
import {
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type {
  Question,
} from "../../../core/index.js";
import {
  defaultTerminalQuestionAnswer,
} from "../terminal-questions.js";
import type {
  WorkflowRunStoreSnapshot,
} from "../workflow-run-store.js";
import {
  openTuiDefaultSelectedIndex,
  openTuiQuestionOptionAnswer,
  openTuiQuestionOptions,
  openTuiSelectedIndexForAnswer,
} from "../opentui-question-dock.js";
import type {
  QuestionDockController,
} from "./controller.js";
import {
  answerPreview,
  questionAllowsCustomChoice,
  questionHelp,
  questionPromptLines,
  questionTabLabel,
  questionTabWidth,
  questionTextForAnswer,
} from "./display.js";

export function QuestionDock(props: {
  controller: QuestionDockController;
  keyboardDisabled?: boolean | (() => boolean);
  onFocusNext?: (delta: -1 | 1) => void;
  promptColumns?: number;
  questionLabels?: readonly string[];
  snapshot: WorkflowRunStoreSnapshot;
}) {
  const [request, setRequest] = createSignal(props.controller.current());
  const [index, setIndex] = createSignal(0);
  const [selected, setSelected] = createSignal<number | undefined>(undefined);
  const [answers, setAnswers] = createSignal<Record<string, unknown>>({});
  const [text, setText] = createSignal("");
  onCleanup(props.controller.subscribe((next) => {
    setRequest(next);
    setQuestionIndex(0);
    setSelected(openTuiDefaultSelectedIndex(next?.session.pendingQuestions[0], next?.options));
    setAnswers({});
    setText("");
  }));

  const questions = () => request()?.session.pendingQuestions ?? props.snapshot.pendingQuestions;
  const question = () => questions()[index()];
  const questionPosition = () => Math.min(index() + 1, Math.max(questions().length, 1));
  const promptLines = () => questionPromptLines(question()?.prompt ?? "", props.promptColumns ?? 72);
  const keyboardDisabled = () =>
    typeof props.keyboardDisabled === "function" ? props.keyboardDisabled() : Boolean(props.keyboardDisabled);

  useKeyboard((event) => {
    if (keyboardDisabled()) return;
    const current = request();
    const currentQuestion = question();
    if (!current || !currentQuestion) return;
    if (event.eventType === "release") return;

    const options = openTuiQuestionOptions(currentQuestion);
    const optionCount = options.length;
    const totalChoices = Math.max(1, optionCount);
    const customChoice = questionAllowsCustomChoice(currentQuestion);
    const name = event.name;
    const sequence = event.sequence?.toLowerCase();

    if (name === "escape") {
      event.preventDefault();
      void submitDefaultsOrCancel();
      return;
    }
    if (name === "tab" && props.onFocusNext) {
      event.preventDefault();
      event.stopPropagation();
      props.onFocusNext(event.shift ? -1 : 1);
      return;
    }
    if (name === "tab" || name === "right") {
      event.preventDefault();
      moveQuestion(1);
      return;
    }
    if (name === "left") {
      event.preventDefault();
      moveQuestion(-1);
      return;
    }
    if (name === "up") {
      event.preventDefault();
      setSelected((value) => value === undefined ? totalChoices - 1 : (value - 1 + totalChoices) % totalChoices);
      return;
    }
    if (name === "down") {
      event.preventDefault();
      setSelected((value) => value === undefined ? 0 : (value + 1) % totalChoices);
      return;
    }
    if (currentQuestion.type === "text" || customChoice) {
      const digit = Number(name);
      if (customChoice && !Number.isNaN(digit) && digit >= 1 && digit <= optionCount) {
        event.preventDefault();
        setSelected(digit - 1);
        setText("");
        setAnswerToSelectedOption(currentQuestion, digit - 1);
        return;
      }
      if (name === "backspace") {
        event.preventDefault();
        setText((value) => value.slice(0, -1));
        return;
      }
      if (name === "return" && event.ctrl) {
        event.preventDefault();
        setText((value) => `${value}\n`);
        return;
      }
      if (name === "return") {
        event.preventDefault();
        if (customChoice && !text().trim()) {
          if (!setAnswerToSelectedOption(currentQuestion) && !(currentQuestion.id in answers())) return;
        } else {
          const value = text().trim();
          if (!value) {
            const fallback = defaultTerminalQuestionAnswer(currentQuestion, current.options);
            if (typeof fallback !== "string" || !fallback.trim()) return;
            setAnswer(currentQuestion.id, fallback);
          } else {
            setAnswer(currentQuestion.id, text());
          }
        }
        void submitOrNext();
        return;
      }
      if (event.sequence === "/") return;
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        if (customChoice) {
          setSelected(undefined);
          clearAnswer(currentQuestion.id);
        }
        setText((value) => value + event.sequence);
      }
      return;
    }
    if (currentQuestion.type === "confirm") {
      if (sequence === "y") {
        event.preventDefault();
        setAnswer(currentQuestion.id, true);
        void submitOrNext();
        return;
      }
      if (sequence === "n") {
        event.preventDefault();
        setAnswer(currentQuestion.id, false);
        void submitOrNext();
        return;
      }
    }

    const digit = Number(name);
    if (!Number.isNaN(digit) && digit >= 1 && digit <= optionCount) {
      event.preventDefault();
      setSelected(digit - 1);
      if (customChoice) {
        setText("");
        setAnswerToSelectedOption(currentQuestion, digit - 1);
        return;
      }
      selectCurrentOption(currentQuestion, digit - 1);
      return;
    }
    if (currentQuestion.type === "multi" && name === "return") {
      event.preventDefault();
      void submitOrNext();
      return;
    }
    if (name === "return" || name === "space") {
      event.preventDefault();
      if (customChoice) {
        if (!text().trim() && !setAnswerToSelectedOption(currentQuestion)) return;
        void submitOrNext();
        return;
      }
      const selectedIndex = selected();
      if (selectedIndex === undefined) return;
      selectCurrentOption(currentQuestion, selectedIndex);
    }
  });

  return (
    <Show
      when={question()}
      fallback={<StatusDock snapshot={props.snapshot} />}
    >
      {(currentQuestion) => (
        <box
          backgroundColor="#0f1724"
          border={["top", "right", "bottom", "left"]}
          borderColor="#273244"
          flexDirection="column"
          flexShrink={0}
          paddingBottom={1}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
        >
          <QuestionDockTabs
            activeIndex={index()}
            labels={props.questionLabels}
            onSelect={(next) => {
              setQuestionIndex(next);
              const item = questions()[next];
              setSelected(openTuiSelectedIndexForAnswer(item, answers()[item?.id ?? ""], request()?.options));
              setText(questionTextForAnswer(item, answers()[item?.id ?? ""]));
            }}
            questions={questions()}
          />
          <box flexDirection="row" flexShrink={0} height={1} marginTop={1}>
            <text fg="#fbbf24" height={1} truncate={true} width={18}>
              Question {questionPosition()} of {questions().length}
            </text>
            <text fg="#fbbf24" flexGrow={1} height={1} truncate={true}>
              · {questionTabLabel(currentQuestion(), index(), props.questionLabels)}
            </text>
          </box>
          <box flexDirection="column" flexShrink={0} marginTop={1}>
            <For each={promptLines()}>
              {(line) => (
                <text fg="#d9e2f2" height={1} truncate={true}>
                  {line}
                </text>
              )}
            </For>
          </box>
          <Show when={currentQuestion().type === "text"}>
            <QuestionTextInput text={text()} placeholder="Type your answer..." />
          </Show>
          <Show when={currentQuestion().type !== "text"}>
            <box flexDirection="column" flexShrink={0} marginTop={1}>
              <For each={openTuiQuestionOptions(currentQuestion())}>
                {(option, optionIndex) => {
                  const picked = () => isPicked(currentQuestion(), option.value);
                  return (
                    <box flexDirection="column" flexShrink={0}>
                      <box flexDirection="row" height={1}>
                        <text fg="#7d8aa2" height={1} width={8}>
                          {optionIndex() === 0 ? "Choose" : ""}
                        </text>
                        <text
                          fg={selected() === optionIndex() ? "#5eead4" : picked() ? "#86efac" : "#d9e2f2"}
                          flexGrow={1}
                          height={1}
                          truncate={true}
                        >
                          {optionIndex() + 1}. {currentQuestion().type === "multi" ? `[${picked() ? "x" : " "}] ` : ""}{option.label}{option.recommended ? " (recommended)" : ""}
                        </text>
                      </box>
                      <Show when={option.description}>
                        {(description) => (
                          <box flexDirection="row" height={1}>
                            <text fg="#7d8aa2" height={1} width={8}> </text>
                            <text fg="#7d8aa2" flexGrow={1} height={1} truncate={true}>
                              {description()}
                            </text>
                          </box>
                        )}
                      </Show>
                    </box>
                  );
                }}
              </For>
            </box>
            <Show when={questionAllowsCustomChoice(currentQuestion())}>
              <QuestionTextInput text={text()} placeholder="Or type your own answer..." />
            </Show>
            <text fg="#7d8aa2" flexShrink={0} height={1} truncate={true}>
              {questionHelp(currentQuestion())}
            </text>
          </Show>
          <box border={["top"]} borderColor="#273244" flexDirection="row" flexShrink={0} height={1} marginTop={1}>
            <text fg="#7d8aa2" flexGrow={1} height={1} truncate={true}>
              {props.onFocusNext ? keyboardDisabled() ? "tab pane" : "thread focus · tab pane" : "⇆ tab"}    ↑↓ select    enter confirm    esc dismiss
            </text>
            <text fg="#7d8aa2" height={1} width={2}>  </text>
          </box>
        </box>
      )}
    </Show>
  );

  function moveQuestion(delta: number) {
    const list = questions();
    if (list.length === 0) return;
    const next = (index() + delta + list.length) % list.length;
    setQuestionIndex(next);
    setSelected(openTuiSelectedIndexForAnswer(list[next], answers()[list[next]?.id ?? ""], request()?.options));
    setText(questionTextForAnswer(list[next], answers()[list[next]?.id ?? ""]));
  }

  function setQuestionIndex(next: number) {
    setIndex(next);
    props.controller.setActiveIndex(next);
  }

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function clearAnswer(questionId: string) {
    setAnswers((current) => {
      if (!(questionId in current)) return current;
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  }

  function isPicked(currentQuestion: Question, value: unknown) {
    const answer = answers()[currentQuestion.id];
    return Array.isArray(answer) ? answer.includes(value) : answer === value;
  }

  function selectCurrentOption(currentQuestion: Question, optionIndex: number) {
    const value = openTuiQuestionOptionAnswer(currentQuestion, optionIndex);
    if (value === undefined) {
      const fallback = defaultTerminalQuestionAnswer(currentQuestion, request()?.options);
      if (fallback !== undefined) {
        setAnswer(currentQuestion.id, fallback);
        void submitOrNext();
      }
      return;
    }
    if (currentQuestion.type === "multi") {
      const previous = answers()[currentQuestion.id];
      const current = Array.isArray(previous) ? previous : [];
      setAnswer(currentQuestion.id, current.some((item) => Object.is(item, value))
        ? current.filter((item) => !Object.is(item, value))
        : [...current, value]);
      return;
    }
    setAnswer(currentQuestion.id, value);
    void submitOrNext();
  }

  function setAnswerToSelectedOption(currentQuestion: Question, optionIndex = selected()) {
    const value = openTuiQuestionOptionAnswer(currentQuestion, optionIndex);
    if (value === undefined) return false;
    setAnswer(currentQuestion.id, value);
    return true;
  }

  async function submitOrNext() {
    const current = request();
    if (!current) return;
    const list = questions();
    const currentQuestion = list[index()];
    if (!currentQuestion) return;
    const next = index() + 1;
    if (next < list.length) {
      setQuestionIndex(next);
      setSelected(openTuiSelectedIndexForAnswer(list[next], answers()[list[next]?.id ?? ""], current.options));
      setText(questionTextForAnswer(list[next], answers()[list[next]?.id ?? ""]));
      return;
    }
    const allAnswers = { ...answers() };
    for (const item of list) {
      if (!(item.id in allAnswers)) {
        const fallback = defaultTerminalQuestionAnswer(item, current.options);
        if (fallback !== undefined) allAnswers[item.id] = fallback;
      }
    }
    for (const item of list) {
      if (!(item.id in allAnswers)) return;
    }
    for (const item of list) {
      await current.session.answer({
        questionId: item.id,
        value: allAnswers[item.id],
      });
    }
    props.controller.complete(true);
  }

  async function submitDefaultsOrCancel() {
    const current = request();
    if (!current) return;
    const list = questions();
    const allAnswers = { ...answers() };
    for (const item of list) {
      if (item.id in allAnswers) continue;
      const fallback = defaultTerminalQuestionAnswer(item, current.options);
      if (fallback === undefined) {
        props.controller.complete(false);
        return;
      }
      allAnswers[item.id] = fallback;
    }
    for (const item of list) {
      await current.session.answer({
        questionId: item.id,
        value: allAnswers[item.id],
      });
    }
    props.controller.complete(true);
  }
}

function QuestionDockTabs(props: {
  activeIndex: number;
  labels?: readonly string[];
  onSelect(index: number): void;
  questions: readonly Question[];
}) {
  return (
    <box border={["bottom"]} borderColor="#273244" flexDirection="row" flexShrink={0} height={2}>
      <For each={props.questions.slice(0, 7)}>
        {(item, itemIndex) => {
          const active = () => itemIndex() === props.activeIndex;
          return (
            <box
              backgroundColor={active() ? "#3b2a5f" : undefined}
              flexShrink={0}
              height={1}
              onMouseUp={() => props.onSelect(itemIndex())}
              paddingLeft={1}
              paddingRight={1}
              width={questionTabWidth(item, itemIndex(), props.labels)}
            >
              <text fg={active() ? "#d9e2f2" : "#96a0b8"} height={1} truncate={true}>
                {questionTabLabel(item, itemIndex(), props.labels)}
              </text>
            </box>
          );
        }}
      </For>
      <text fg="#7d8aa2" flexGrow={1} height={1} truncate={true}> </text>
    </box>
  );
}

function QuestionTextInput(props: {
  placeholder: string;
  text: string;
}) {
  return (
    <box flexDirection="row" flexShrink={0} height={1} marginTop={1}>
      <text fg="#5eead4" height={1} width={3}>›</text>
      <text fg={props.text ? "#d9e2f2" : "#7d8aa2"} flexGrow={1} height={1} truncate={true}>
        {answerPreview(props.text) || props.placeholder}
      </text>
    </box>
  );
}

function StatusDock(props: { snapshot: WorkflowRunStoreSnapshot }) {
  return (
    <box
      border={["top"]}
      borderColor="#273244"
      flexShrink={0}
      paddingLeft={1}
      paddingTop={1}
    >
      <text fg="#7d8aa2">
        {props.snapshot.currentStep
          ? `Current: ${props.snapshot.currentStep.label} · ${props.snapshot.status}`
          : `Status: ${props.snapshot.status}`}
      </text>
    </box>
  );
}
