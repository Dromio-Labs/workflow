import type {
  TerminalQuestion,
  TerminalQuestionOptions,
} from "./terminal-questions.js";
import {
  defaultTerminalQuestionAnswer,
} from "./terminal-questions.js";

export type OpenTuiQuestionOption = {
  description?: string;
  label: string;
  recommended?: boolean;
  value: unknown;
};

export function openTuiQuestionOptions(question: TerminalQuestion): OpenTuiQuestionOption[] {
  if (question.type === "confirm") {
    return [
      { label: "Yes", value: true },
      { label: "No", value: false },
    ];
  }
  return question.options ?? [];
}

export function openTuiDefaultSelectedIndex(
  question: TerminalQuestion | undefined,
  options: TerminalQuestionOptions = {},
) {
  if (!question) return undefined;
  const defaultAnswer = defaultTerminalQuestionAnswer(question, options);
  if (defaultAnswer === undefined) {
    return defaultRecommendedQuestionOptionIndex(question)
      ?? (question.type === "choice" && question.allowCustom ? undefined : 0);
  }
  const defaultValues = Array.isArray(defaultAnswer) ? defaultAnswer : [defaultAnswer];
  const index = openTuiQuestionOptions(question).findIndex((option) =>
    defaultValues.some((value) => Object.is(value, option.value))
  );
  if (index >= 0) return index;
  return defaultRecommendedQuestionOptionIndex(question)
    ?? (question.type === "choice" && question.allowCustom ? undefined : 0);
}

export function openTuiSelectedIndexForAnswer(
  question: TerminalQuestion | undefined,
  answer: unknown,
  options: TerminalQuestionOptions = {},
) {
  if (!question || answer === undefined) return openTuiDefaultSelectedIndex(question, options);
  const values = Array.isArray(answer) ? answer : [answer];
  const index = openTuiQuestionOptions(question).findIndex((option) =>
    values.some((value) => Object.is(value, option.value))
  );
  return index >= 0 ? index : openTuiDefaultSelectedIndex(question, options);
}

export function openTuiQuestionOptionAnswer(
  question: TerminalQuestion,
  optionIndex: number | undefined,
) {
  if (optionIndex === undefined) return undefined;
  return openTuiQuestionOptions(question)[optionIndex]?.value;
}

function defaultRecommendedQuestionOptionIndex(question: TerminalQuestion) {
  const index = openTuiQuestionOptions(question).findIndex((option) => option.recommended === true);
  return index >= 0 ? index : undefined;
}
