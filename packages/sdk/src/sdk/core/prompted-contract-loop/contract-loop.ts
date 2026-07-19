import {
  defineEvaluationBar,
  evaluationBarMessage,
  evaluationCompletedEvent,
  type EvaluationBar,
} from "../evaluation/index.js";
import type { EventPayload } from "../loop/index.js";
import type {
  Question,
  QuestionResolution,
  QuestionResolutionHistoryItem,
} from "../questions/index.js";
import type {
  AnswerEvaluationResult,
  PromptedContract,
  PromptedContractLoopDefinition,
  PromptedContractLoopResult,
  RunPromptedContractLoopInput,
} from "./contract-loop.types.js";

export function definePromptedContractLoop<
  const TInput,
  const TContract extends PromptedContract,
  const TAnswers extends Record<string, unknown>,
  const TLoopId extends string,
>(
  definition: PromptedContractLoopDefinition<TInput, TContract, TAnswers, TLoopId>,
): PromptedContractLoopDefinition<TInput, TContract, TAnswers, TLoopId> {
  return definition;
}

export async function runPromptedContractLoop<
  TInput,
  TContract extends PromptedContract,
  TAnswers extends Record<string, unknown>,
  TLoopId extends string,
>(
  definition: PromptedContractLoopDefinition<TInput, TContract, TAnswers, TLoopId>,
  input: RunPromptedContractLoopInput<TInput, TAnswers>,
): Promise<PromptedContractLoopResult<TContract>> {
  const startedAt = performance.now();
  const answers = { ...(input.answers ?? {}) } as TAnswers;
  const history: Record<string, QuestionResolutionHistoryItem[]> = {};
  const maxContractLoops = definition.revisionPolicy?.maxContractLoops ?? 4;
  const maxAnswerAttempts = definition.questionPolicy?.maxAnswerAttempts ?? 3;
  const emit = async (event: EventPayload) => {
    await input.onEvent?.(event);
  };
  await emit(loopEvent({
    definition,
    input,
    message: `Started ${definition.label ?? definition.id}.`,
    type: "contract.loop.started",
  }));

  let contract: TContract | undefined;
  let evaluation: EvaluationBar | undefined;
  for (let iteration = 0; iteration < maxContractLoops; iteration += 1) {
    await emit(loopEvent({
      definition,
      input,
      iteration,
      message: `Resolving ${definition.label ?? definition.id} contract.`,
      type: "contract.resolution.started",
    }));
    contract = await definition.resolveContract({
      answers,
      emit,
      input: input.input,
      iteration,
      trace: childTrace(input.trace, `contract-loop:${definition.id}:resolve:${iteration}`),
    });
    await emit(loopEvent({
      definition,
      detail: {
        contractKind: contract.kind,
        requirements: contract.requirements.map((requirement) => ({
          id: requirement.id,
          label: requirement.label,
          status: requirement.status,
          value: requirement.value,
        })),
        steps: contract.steps?.map((step) => ({
          id: step.id,
          primitive: step.primitive,
          requirementIds: step.requirementIds,
        })) ?? [],
      },
      input,
      iteration,
      message: `Resolved ${definition.label ?? definition.id} contract.`,
      type: "contract.resolved",
    }));

    evaluation = defineEvaluationBar(await definition.evaluateContract({
      answers,
      contract,
      input: input.input,
      iteration,
    }));
    if (definition.tracePolicy?.emitEvaluationBars !== false) {
      await emit(evaluationCompletedEvent({
        bar: evaluation,
        message: evaluationBarMessage(evaluation),
        trace: traceFor(input.trace, `contract-loop:${definition.id}:evaluation:${iteration}`, evaluation.label, evaluation.status === "fail" ? "error" : "ok"),
      }));
    }

    if (passes(evaluation)) {
      await emit(loopEvent({
        definition,
        detail: {
          durationMs: elapsed(startedAt),
          score: evaluation.score,
          status: evaluation.status,
        },
        input,
        iteration,
        message: `Completed ${definition.label ?? definition.id}.`,
        type: "contract.loop.completed",
      }));
      return {
        contract,
        evaluation,
        pendingQuestions: [],
        status: "completed",
      };
    }

    const questions = questionsForNextTurn(definition, answers, contract, evaluation);
    if (questions.length === 0 || !input.onQuestion) {
      await emit(loopEvent({
        definition,
        detail: {
          durationMs: elapsed(startedAt),
          questions: questions.map((question) => question.id),
          score: evaluation.score,
        },
        input,
        iteration,
        message: `${definition.label ?? definition.id} needs input.`,
        type: "contract.loop.needs_input",
      }));
      return {
        contract,
        evaluation,
        pendingQuestions: questions,
        status: "needs_input",
      };
    }

    await emit(loopEvent({
      definition,
      detail: {
        questions: questions.map((question) => ({
          id: question.id,
          options: question.options,
          prompt: question.prompt,
          title: question.title,
          type: question.type,
        })),
      },
      input,
      iteration,
      message: `${definition.label ?? definition.id} needs ${questions.length} answer${questions.length === 1 ? "" : "s"}.`,
      type: "contract.questions.requested",
    }));

    let acceptedAtLeastOne = false;
    for (const question of questions) {
      const accepted = await askUntilAccepted({
        answers,
        contract,
        definition,
        history,
        input,
        maxAnswerAttempts,
        question,
      });
      if (accepted === "cancelled") {
        return {
          contract,
          evaluation,
          message: "Contract loop cancelled by answer evaluator.",
          pendingQuestions: [question],
          status: "failed",
        };
      }
      if (!accepted) {
        return {
          contract,
          evaluation,
          pendingQuestions: [question],
          status: "needs_input",
        };
      }
      acceptedAtLeastOne = true;
    }
    if (!acceptedAtLeastOne) {
      return {
        contract,
        evaluation,
        pendingQuestions: questions,
        status: "needs_input",
      };
    }
  }

  const message = `${definition.label ?? definition.id} exceeded ${maxContractLoops} contract loops.`;
  await emit(loopEvent({
    definition,
    detail: {
      durationMs: elapsed(startedAt),
      maxContractLoops,
    },
    input,
    message,
    type: "contract.loop.failed",
  }));
  return {
    contract,
    evaluation,
    message,
    pendingQuestions: [],
    status: "failed",
  };
}

async function askUntilAccepted<
  TInput,
  TContract extends PromptedContract,
  TAnswers extends Record<string, unknown>,
  TLoopId extends string,
>(input: {
  answers: TAnswers;
  contract: TContract;
  definition: PromptedContractLoopDefinition<TInput, TContract, TAnswers, TLoopId>;
  history: Record<string, QuestionResolutionHistoryItem[]>;
  input: RunPromptedContractLoopInput<TInput, TAnswers>;
  maxAnswerAttempts: number;
  question: Question;
}) {
  for (let attempt = 0; attempt < input.maxAnswerAttempts; attempt += 1) {
    const utterance = await input.input.onQuestion?.(input.question);
    if (utterance === undefined) return false;
    const resolution = await evaluateAnswer({
      answers: input.answers,
      contract: input.contract,
      definition: input.definition,
      history: input.history[input.question.id] ?? [],
      question: input.question,
      trace: input.input.trace,
      utterance,
    });
    input.history[input.question.id] = [
      ...(input.history[input.question.id] ?? []),
      {
        resolution: resolution.resolution,
        utterance,
      },
    ];
    if (resolution.evaluation && input.definition.tracePolicy?.emitEvaluationBars !== false) {
      await input.input.onEvent?.(evaluationCompletedEvent({
        bar: resolution.evaluation,
        trace: traceFor(input.input.trace, `contract-loop:${input.definition.id}:answer:${input.question.id}:${attempt}`, resolution.evaluation.label, resolution.resolution.status === "accepted" ? "ok" : "unset"),
      }));
    }
    await input.input.onEvent?.(loopEvent({
      definition: input.definition,
      detail: {
        attempt,
        confidence: resolution.resolution.confidence,
        kind: resolution.resolution.kind,
        message: resolution.resolution.message,
        questionId: input.question.id,
        status: resolution.resolution.status,
        suggestedValue: resolution.resolution.status === "needs_input" ? resolution.resolution.suggestedValue : undefined,
      },
      input: input.input,
      iteration: attempt,
      message: resolution.resolution.message ?? `Evaluated answer for ${input.question.id}.`,
      type: "contract.answer.evaluated",
    }));
    if (resolution.resolution.status === "cancelled") return "cancelled";
    if (resolution.resolution.status === "revision") return false;
    if (resolution.resolution.status === "needs_input") continue;
    const value = resolution.resolution.normalizedValue ?? utterance;
    const nextAnswers = input.definition.mergeAnswer
      ? await input.definition.mergeAnswer({
          answers: input.answers,
          contract: input.contract,
          question: input.question,
          resolution: resolution.resolution,
          value,
        })
      : { ...input.answers, [input.question.id]: value } as TAnswers;
    Object.keys(input.answers).forEach((key) => delete input.answers[key]);
    Object.assign(input.answers, nextAnswers);
    await input.input.onEvent?.(loopEvent({
      definition: input.definition,
      detail: {
        questionId: input.question.id,
        value,
      },
      input: input.input,
      message: `Accepted answer for ${input.question.id}.`,
      type: "contract.answer.accepted",
    }));
    return true;
  }
  return false;
}

async function evaluateAnswer<
  TInput,
  TContract extends PromptedContract,
  TAnswers extends Record<string, unknown>,
  TLoopId extends string,
>(input: {
  answers: TAnswers;
  contract: TContract;
  definition: PromptedContractLoopDefinition<TInput, TContract, TAnswers, TLoopId>;
  history: QuestionResolutionHistoryItem[];
  question: Question;
  trace?: RunPromptedContractLoopInput<TInput, TAnswers>["trace"];
  utterance: unknown;
}): Promise<AnswerEvaluationResult> {
  if (!input.definition.answerEvaluator) {
    return {
      evaluation: answerEvaluationBar(input.question, {
        confidence: 1,
        kind: "answer",
        normalizedValue: input.utterance,
        status: "accepted",
      }),
      resolution: {
        confidence: 1,
        kind: "answer",
        normalizedValue: input.utterance,
        status: "accepted",
      },
    };
  }
  const result = await input.definition.answerEvaluator({
    answers: input.answers,
    contract: input.contract,
    history: input.history,
    question: input.question,
    trace: childTrace(input.trace, `contract-loop:${input.definition.id}:answer:${input.question.id}`),
    utterance: input.utterance,
  });
  if ("resolution" in result) {
    return {
      evaluation: result.evaluation ?? answerEvaluationBar(input.question, result.resolution),
      resolution: result.resolution,
    };
  }
  return {
    evaluation: answerEvaluationBar(input.question, result),
    resolution: result,
  };
}

function answerEvaluationBar<TQuestionId extends string>(
  question: Question & { id: TQuestionId },
  resolution: QuestionResolution,
): EvaluationBar<`answer:${TQuestionId}`> {
  const accepted = resolution.status === "accepted";
  const score = accepted ? resolution.confidence : Math.min(0.74, resolution.confidence);
  return defineEvaluationBar({
    gaps: accepted
      ? []
      : [{
          id: "answer-unresolved",
          message: resolution.message ?? "The answer did not resolve the active question.",
          severity: "medium",
        }],
    label: `Answer quality: ${question.title ?? question.id}`,
    message: resolution.message,
    nextAction: accepted ? "complete" : resolution.status === "cancelled" ? "cancel" : resolution.status === "revision" ? "revise" : "ask",
    questions: accepted ? [] : [question],
    risks: [],
    satisfies: [{
      id: "answer-resolves-question",
      passed: accepted,
      reason: accepted ? "The answer resolved the active question." : "The answer still needs follow-up.",
    }],
    score,
    status: accepted ? "pass" : resolution.status === "cancelled" ? "fail" : resolution.status === "revision" ? "revise" : "needs_input",
    subjectId: `answer:${question.id}`,
    threshold: 0.75,
  });
}

function questionsForNextTurn<
  TInput,
  TContract extends PromptedContract,
  TAnswers extends Record<string, unknown>,
  TLoopId extends string,
>(
  definition: PromptedContractLoopDefinition<TInput, TContract, TAnswers, TLoopId>,
  answers: TAnswers,
  contract: TContract,
  evaluation: EvaluationBar,
): Question[] {
  const explicit = definition.createQuestions?.({ answers, contract, evaluation });
  const questions = explicit ?? [
    ...(contract.questions ?? []),
    ...contract.requirements.flatMap((requirement) => requirement.question ? [requirement.question] : []),
    ...evaluation.questions.map((question) => ({
      id: question.id,
      options: question.options,
      prompt: question.prompt,
      title: question.title,
      type: question.type === "choice" || question.type === "multi" || question.type === "confirm" ? question.type : "text",
    } satisfies Question)),
  ];
  const max = definition.questionPolicy?.maxQuestionsPerTurn ?? questions.length;
  const seen = new Set<string>();
  return questions
    .filter((question) => {
      if (seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    })
    .slice(0, max);
}

function passes(evaluation: EvaluationBar) {
  return evaluation.status === "pass" && evaluation.score >= evaluation.threshold;
}

function loopEvent(input: {
  definition: { id: string; label?: string };
  detail?: unknown;
  input: { trace?: { parentSpanId?: string; spanId?: string; traceId?: string } };
  iteration?: number;
  message: string;
  type: string;
}): EventPayload {
  return {
    detail: input.detail,
    message: input.message,
    trace: traceFor(
      input.input.trace,
      `contract-loop:${input.definition.id}:${input.type}:${input.iteration ?? 0}`,
      input.definition.label ?? input.definition.id,
    ),
    type: input.type,
  };
}

function traceFor(
  trace: { parentSpanId?: string; spanId?: string; traceId?: string } | undefined,
  spanId: string,
  name: string,
  status: "unset" | "ok" | "error" = "unset",
) {
  return {
    attributes: {
      phase: "contract-loop",
    },
    name,
    parentSpanId: trace?.spanId ?? trace?.parentSpanId,
    spanId,
    status,
    traceId: trace?.traceId ?? "contract-loop",
  };
}

function childTrace(
  trace: { parentSpanId?: string; spanId?: string; traceId?: string } | undefined,
  spanId: string,
) {
  return {
    parentSpanId: trace?.spanId ?? trace?.parentSpanId,
    spanId,
    traceId: trace?.traceId,
  };
}

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
