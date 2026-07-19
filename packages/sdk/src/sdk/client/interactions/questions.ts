import type { HookRequest } from "../../core/loop/index.js";
import type { Question } from "../../product/intent/index.js";
import type { RuntimeSessionSnapshot } from "../../core/runtime/index.js";
import type {
  InteractionQuestion,
  InteractionValidationError,
  ProjectQuestionsResult,
} from "./interaction.types.js";

const questionTypes = new Set(["choice", "multi", "text", "confirm"]);

export function projectQuestions(session: RuntimeSessionSnapshot): ProjectQuestionsResult {
  const errors: InteractionValidationError[] = [];
  const questions: InteractionQuestion[] = [];
  const hooks = session.pendingHooks.filter((hook) => hook.kind === "question");
  for (const value of session.pendingQuestions) {
    if (!isQuestion(value)) {
      errors.push({
        code: "INVALID_QUESTION",
        message: "Pending question does not match the v4 Question contract.",
      });
      continue;
    }
    const matches = hooks.filter((hook) => hook.id === value.id);
    if (matches.length !== 1) {
      errors.push({
        code: "QUESTION_HOOK_MISMATCH",
        message: `Question ${value.id} must map to exactly one pending question hook.`,
        questionId: value.id,
      });
      continue;
    }
    questions.push({
      ...value,
      allowCustom: hasAllowCustom(value) ? value.allowCustom : undefined,
      hookId: matches[0]!.id,
      hookToken: matches[0]!.token,
    });
  }
  for (const hook of hooks) {
    if (!questions.some((question) => question.id === hook.id)) {
      errors.push({
        code: "UNMAPPED_QUESTION_HOOK",
        message: `Question hook ${hook.id} has no valid pending question.`,
        questionId: hook.id,
      });
    }
  }
  return { errors, questions };
}

export function validateAnswer(question: InteractionQuestion, value: unknown): InteractionValidationError | undefined {
  if (question.type === "text") {
    return typeof value === "string"
      ? undefined
      : error(question.id, "INVALID_TEXT_ANSWER", "Text answers must be strings.");
  }
  if (question.type === "confirm") {
    return typeof value === "boolean"
      ? undefined
      : error(question.id, "INVALID_CONFIRM_ANSWER", "Confirm answers must be booleans.");
  }
  if (question.type === "choice") {
    return validOption(question, value)
      ? undefined
      : error(question.id, "INVALID_CHOICE_ANSWER", "Choice answers must match one option value.");
  }
  if (!Array.isArray(value)) {
    return error(question.id, "INVALID_MULTI_ANSWER", "Multi-select answers must be arrays.");
  }
  const invalid = value.find((item) => !validOption(question, item));
  return invalid === undefined
    ? undefined
    : error(question.id, "INVALID_MULTI_ANSWER", "Multi-select answers must match option values.");
}

export function questionHook(question: InteractionQuestion): HookRequest {
  return {
    correlationId: "",
    id: question.hookId,
    input: question,
    kind: "question",
    stepId: "",
    token: question.hookToken,
  };
}

function isQuestion(value: unknown): value is Question {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const question = value as Partial<Question>;
  return typeof question.id === "string" &&
    typeof question.prompt === "string" &&
    typeof question.type === "string" &&
    questionTypes.has(question.type);
}

function hasAllowCustom(value: Question): value is Question & { allowCustom?: boolean } {
  return "allowCustom" in value;
}

function validOption(question: InteractionQuestion, value: unknown) {
  if (question.allowCustom && typeof value === "string") return true;
  return typeof value === "string" &&
    (question.options ?? []).some((option) => option.value === value);
}

function error(questionId: string, code: string, message: string): InteractionValidationError {
  return { code, message, questionId };
}
