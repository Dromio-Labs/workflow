import type { RuntimeSessionSnapshot } from "../../core/runtime/index.js";
import type {
  CreateQuestionFlowInput,
  InteractionValidationError,
  QuestionFlow,
  QuestionFlowStage,
} from "./interaction.types.js";
import { projectQuestions, validateAnswer } from "./questions.js";

export function createQuestionFlow(input: CreateQuestionFlowInput): QuestionFlow {
  let session = input.session;
  let projected = projectQuestions(session);
  let activeId: string | undefined = projected.questions[0]?.id;
  let stage: QuestionFlowStage = "answering";
  const answers: Record<string, unknown> = {};
  const answerTokens: Record<string, string> = {};
  const submittedTokens = new Set<string>();

  const flow: QuestionFlow = {
    get activeId() {
      return activeId;
    },
    get answers() {
      return { ...answers };
    },
    get canSubmit() {
      return submitErrors().length === 0 && projected.questions.length > 0;
    },
    get errors() {
      return submitErrors();
    },
    get questions() {
      return projected.questions;
    },
    get stage() {
      return stage;
    },
    get summary() {
      return projected.questions
        .filter((question) =>
          question.id in answers &&
          answerTokens[question.id] === question.hookToken
        )
        .map((question) => ({
          label: question.title ?? question.prompt,
          questionId: question.id,
          value: answers[question.id],
        }));
    },
    activate(questionId) {
      requireQuestion(questionId);
      activeId = questionId;
    },
    answer(questionId, value) {
      const question = requireQuestion(questionId);
      if (question.type === "multi") {
        answers[questionId] = Array.isArray(value) ? value : [value];
      } else {
        answers[questionId] = value;
      }
      answerTokens[questionId] = question.hookToken;
    },
    next() {
      activeId = adjacentQuestion(1);
    },
    previous() {
      activeId = adjacentQuestion(-1);
    },
    select(questionId, value) {
      const question = requireQuestion(questionId);
      if (question.type !== "choice" && question.type !== "confirm") {
        throw new Error(`Question ${questionId} does not support select.`);
      }
      answers[questionId] = question.type === "confirm" ? Boolean(value) : value;
      answerTokens[questionId] = question.hookToken;
    },
    setCustomAnswer(questionId, value) {
      const question = requireQuestion(questionId);
      if (!question.allowCustom) {
        throw new Error(`Question ${questionId} does not allow custom answers.`);
      }
      answers[questionId] = value;
      answerTokens[questionId] = question.hookToken;
    },
    setText(questionId, value) {
      const question = requireQuestion(questionId);
      if (question.type !== "text") {
        throw new Error(`Question ${questionId} does not support text answers.`);
      }
      answers[questionId] = value;
      answerTokens[questionId] = question.hookToken;
    },
    async submit() {
      const errors = submitErrors();
      if (errors.length > 0) {
        throw new Error(errors.map((item) => item.message).join(" "));
      }
      stage = "review";
      let next: RuntimeSessionSnapshot = session;
      while (true) {
        const question = projected.questions.find((item) =>
          !submittedTokens.has(item.hookToken) &&
          answerTokens[item.id] === item.hookToken &&
          item.id in answers
        );
        if (!question) break;
        const eventOffset = session.events.length;
        next = await input.client.hooks.resume({
          token: question.hookToken,
          value: answers[question.id],
        });
        update(next);
        const stillPending = projected.questions.some((item) =>
          item.hookToken === question.hookToken
        );
        const answerAccepted = questionWasAnswered(next, eventOffset, question.id);
        if (stillPending && !answerAccepted) {
          stage = "answering";
          break;
        }
        submittedTokens.add(question.hookToken);
      }
      if (stage !== "answering") stage = "submitted";
      return next;
    },
    toggle(questionId, value) {
      const question = requireQuestion(questionId);
      if (question.type !== "multi") {
        throw new Error(`Question ${questionId} does not support toggle.`);
      }
      const current = Array.isArray(answers[questionId])
        ? answers[questionId] as string[]
        : [];
      answers[questionId] = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      answerTokens[questionId] = question.hookToken;
    },
    updateSession: update,
  };

  return flow;

  function update(next: RuntimeSessionSnapshot) {
    session = next;
    projected = projectQuestions(session);
    activeId = projected.questions.some((question) => question.id === activeId)
      ? activeId
      : projected.questions[0]?.id;
    if (session.status === "waiting" && projected.questions.length > 0) {
      stage = "answering";
    }
  }

  function requireQuestion(questionId: string) {
    const question = projected.questions.find((item) => item.id === questionId);
    if (!question) throw new Error(`Unknown question: ${questionId}`);
    return question;
  }

  function adjacentQuestion(delta: 1 | -1) {
    if (projected.questions.length === 0) return undefined;
    const current = Math.max(0, projected.questions.findIndex((item) => item.id === activeId));
    const next = (current + delta + projected.questions.length) % projected.questions.length;
    return projected.questions[next]?.id;
  }

  function submitErrors(): InteractionValidationError[] {
    const errors = [...projected.errors];
    for (const question of projected.questions) {
      if (!(question.id in answers) || answerTokens[question.id] !== question.hookToken) {
        errors.push({
          code: "MISSING_ANSWER",
          message: `Question ${question.id} has no answer.`,
          questionId: question.id,
        });
        continue;
      }
      const invalid = validateAnswer(question, answers[question.id]);
      if (invalid) errors.push(invalid);
    }
    return errors;
  }
}

function questionWasAnswered(
  session: RuntimeSessionSnapshot,
  eventOffset: number,
  questionId: string,
) {
  return session.events.slice(eventOffset).some((event) =>
    event.type === "question.answered" &&
    (event.detail as { questionId?: string } | undefined)?.questionId === questionId
  );
}
