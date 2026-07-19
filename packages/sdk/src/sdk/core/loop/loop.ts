import {
  type Domain,
  type Question,
  resolveIntent,
} from "../../product/intent/index.js";
import {
  defineEvaluationBar,
  evaluationCompletedEvent,
} from "../evaluation/index.js";
import {
  normalizeOperationContract,
  parseOperationContract,
} from "../prompted-operation/contracts.js";
import { LoopSession } from "./session.js";
import { hydrateLoopSession } from "./session/hydrate.js";
import { projectLoopGraph } from "./graph.js";
import {
  sleep,
  TIMER_HOOK_KIND,
} from "./sleep.js";
import type {
  ContractedStepOptions,
  DoneStepResult,
  EventPayload,
  LoopConfig,
  LoopHydrateOptions,
  LoopHydrationSnapshot,
  LoopGraphProjection,
  LoopStartOptions,
  CommandRunEvent,
  CommandRunEventInput,
  HookDefinition,
  StepContractRecord,
  StepContractSourceMap,
  StepDefinition,
  StepOptions,
  StepResult,
  StepState,
  WorkerItemEvent,
  WorkerItemEventInput,
} from "./loop.types.js";

export { LoopSession } from "./session.js";
export { hydrateLoopSession, UnresumableRunError } from "./session/hydrate.js";
export { InMemoryLoopStore } from "./store.js";
export { projectLoopGraph } from "./graph.js";
export { sleep, TIMER_HOOK_KIND } from "./sleep.js";

export function createHook<TInput = unknown, TOutput = unknown>(
  input: Omit<HookDefinition<TInput, TOutput>, "_output">,
): HookDefinition<TInput, TOutput> {
  return input;
}

export const hook = createHook;

export function done<TOutput = unknown>(
  output?: TOutput,
  state?: StepState,
): DoneStepResult<TOutput> {
  return { output, state, type: "done" };
}

export function ask(question: Question | Question[], state?: StepState): StepResult<never> {
  return {
    questions: Array.isArray(question) ? question : [question],
    state,
    type: "ask",
  };
}

export function retry(reason: string, state?: StepState): StepResult<never> {
  return { reason, state, type: "retry" };
}

export function goto(stepId: string, reason?: string, state?: StepState): StepResult<never> {
  return { reason, state, stepId, type: "goto" };
}

export function fail(error: string, state?: StepState): StepResult<never> {
  return { error, state, type: "fail" };
}

export function workerItemEvent(input: WorkerItemEventInput): WorkerItemEvent {
  return {
    ...input,
    message: input.message ?? String(input.preview),
  } as WorkerItemEvent;
}

export function commandEvent(input: CommandRunEventInput): CommandRunEvent {
  return {
    ...input,
    message: input.message ?? commandEventMessage(input),
  } as CommandRunEvent;
}

function commandEventMessage(input: CommandRunEventInput) {
  if (input.type === "command.started") return `Running ${input.command}.`;
  if (input.type === "command.output") return `Received output from ${input.command}.`;
  if (input.type === "command.failed") return `Failed ${input.command}.`;
  return `Ran ${input.command}.`;
}

type RuntimeStepFactory = {
  <TUse = unknown, TInput = unknown>(
    id: string,
    run: StepDefinition<TUse, TInput>["run"],
    options?: StepOptions,
  ): StepDefinition<TUse, TInput>;
  ai<TUse = unknown, TInput = unknown>(
    id: string,
    options: { run: StepDefinition<TUse, TInput>["run"] } & StepOptions,
  ): StepDefinition<TUse, TInput>;
  withContracts<
    TUse = unknown,
    TWorkflowInput = unknown,
    const TInputContracts extends StepContractSourceMap | undefined = undefined,
    const TOutputContracts extends StepContractSourceMap | undefined = undefined,
  >(
    options: ContractedStepOptions<
      TUse,
      TWorkflowInput,
      TInputContracts,
      TOutputContracts
    >,
  ): StepDefinition<TUse, TWorkflowInput>;
  intent<TUse = unknown, TInput extends { prompt?: string } = { prompt?: string }>(
    id: string,
    options: { domain: Domain } & StepOptions,
  ): StepDefinition<TUse, TInput>;
};

const runtimeStepFactory = Object.assign(
  function createStep<TUse = unknown, TInput = unknown>(
    id: string,
    run: StepDefinition<TUse, TInput>["run"],
    options: StepOptions = {},
  ): StepDefinition<TUse, TInput> {
      return {
        description: options.description,
        id,
        input: normalizeStepContracts(id, "input", options.input),
        kind: options.kind,
        label: options.label,
        maxRetries: options.maxRetries,
        models: options.models,
        output: normalizeStepContracts(id, "output", options.output),
        run,
      };
  },
  {
    ai<TUse = unknown, TInput = unknown>(
      id: string,
      options: { run: StepDefinition<TUse, TInput>["run"] } & StepOptions,
    ): StepDefinition<TUse, TInput> {
      return {
        description: options.description,
        id,
        input: normalizeStepContracts(id, "input", options.input),
        kind: options.kind ?? "ai",
        label: options.label,
        maxRetries: options.maxRetries,
        models: options.models,
        output: normalizeStepContracts(id, "output", options.output),
        run: options.run,
      };
    },
    withContracts<
      TUse = unknown,
      TWorkflowInput = unknown,
      const TInputContracts extends StepContractSourceMap | undefined = undefined,
      const TOutputContracts extends StepContractSourceMap | undefined = undefined,
    >(
      options: ContractedStepOptions<
        TUse,
        TWorkflowInput,
        TInputContracts,
        TOutputContracts
      >,
    ): StepDefinition<TUse, TWorkflowInput> {
      const input = normalizeStepContracts(options.id, "input", options.input);
      const output = normalizeStepContracts(options.id, "output", options.output);
      return {
        description: options.description,
        id: options.id,
        input,
        kind: options.kind,
        label: options.label,
        maxRetries: options.maxRetries,
        models: options.models,
        output,
        async run(context) {
          const result = await options.run({
            ...context,
            input: parseStepInput(input, context.state, context.input),
            workflowInput: context.input,
          } as Parameters<typeof options.run>[0]);
          return parseStepOutput(output, result);
        },
      };
    },
    intent<TUse = unknown, TInput extends { prompt?: string } = { prompt?: string }>(
      id: string,
      options: { domain: Domain } & StepOptions,
    ): StepDefinition<TUse, TInput> {
      return {
        description: options.description,
        id,
        input: normalizeStepContracts(id, "input", options.input),
        kind: options.kind ?? "intent",
        label: options.label,
        maxRetries: options.maxRetries,
        models: options.models,
        output: normalizeStepContracts(id, "output", options.output),
        async run(context) {
          const prompt =
            typeof context.input === "object" &&
            context.input !== null &&
            "prompt" in context.input &&
            typeof context.input.prompt === "string"
              ? context.input.prompt
              : String(context.input);
          const intent = await resolveIntent({
            answers: context.answers,
            domain: options.domain,
            onEvent: context.emit,
            prompt,
            trace: {
              parentSpanId: `step:${id}:attempt:${context.step.attempt}`,
              spanId: `model:intent:${id}:attempt:${context.step.attempt}`,
              traceId: context.step.runId,
            },
          });
          const requirementItems = intent.contract.requirements.map((requirement) => ({
            id: requirement.id,
            label: requirement.label,
            questionPrompt: requirement.question?.prompt,
            questionTitle: requirement.question?.title,
            status: requirement.status,
            type: requirement.type,
            value: requirement.value,
          }));
          const stepItems = intent.contract.steps.map((item) => ({
            id: item.id,
            intent: item.intent,
            label: item.label,
            requirementIds: item.requirementIds,
          }));
          const questionItems = intent.questions.map((question) => ({
            id: question.id,
            options: question.options,
            prompt: question.prompt,
            title: question.title,
            type: question.type,
          }));
          context.emit({
            detail: {
              contractFieldItems: requirementItems,
              contractFields: intent.contract.requirements.length,
              openQuestionItems: questionItems,
              planningStepItems: stepItems,
              questions: intent.questions.length,
              questionItems,
              requirementItems,
              requirements: intent.contract.requirements.length,
              resolvedContractFields: intent.contract.requirements.filter((requirement) => requirement.status === "satisfied").length,
              resolvedRequirements: intent.contract.requirements.filter((requirement) => requirement.status === "satisfied").length,
              stepItems,
              steps: intent.contract.steps.length,
            },
            message:
              intent.status === "resolved"
                ? "Resolved intent contract."
                : "Intent needs more input.",
            stepId: id,
            type: "intent.resolved",
          });
          context.emit(evaluationCompletedEvent({
            bar: intentClarityBar(intent.contract, intent.questions),
            trace: {
              attributes: { phase: "product-planning" },
              name: "Intent clarity",
              parentSpanId: `step:${id}:attempt:${context.step.attempt}`,
              spanId: `evaluation:intent:${id}:attempt:${context.step.attempt}`,
              status: intent.status === "resolved" ? "ok" : "unset",
              traceId: context.step.runId,
            },
          }));
          if (intent.status === "needs_input") {
            return ask(intent.questions, { intent: intent.contract });
          }
          return done({ intent: intent.contract });
        },
      };
    },
  },
) as RuntimeStepFactory;

export const createRuntimeStep: RuntimeStepFactory = runtimeStepFactory;
export const createAiRuntimeStep = runtimeStepFactory.ai;
export const createContractedRuntimeStep = runtimeStepFactory.withContracts;
export const createIntentRuntimeStep = runtimeStepFactory.intent;

function normalizeStepContracts(
  stepId: string,
  direction: "input" | "output",
  contracts: StepContractSourceMap | undefined,
): StepContractRecord | undefined {
  const entries = Object.entries(contracts ?? {});
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map(([key, source]) => [
      key,
      normalizeOperationContract(`${stepId}.${direction}.${key}`, source),
    ]),
  );
}

function parseStepInput(
  contracts: StepContractRecord | undefined,
  state: StepState,
  workflowInput: unknown,
) {
  const input: Record<string, unknown> = {};
  const entries = Object.entries(contracts ?? {});
  for (const [key, contract] of entries) {
    const source = key in state
      ? state
      : isRecord(workflowInput) && key in workflowInput
        ? workflowInput
        : undefined;
    input[key] = parseOperationContract(
      contract,
      source
        ? source[key]
        : entries.length === 1
          ? workflowInput
          : undefined,
    );
  }
  return input;
}

function parseStepOutput(
  contracts: StepContractRecord | undefined,
  result: StepResult,
): StepResult {
  if (!contracts || result.type !== "done") return result;
  if (!isRecord(result.output)) {
    throw new Error("Step output contracts require done() output to be an object.");
  }
  const output: Record<string, unknown> = { ...result.output };
  for (const [key, contract] of Object.entries(contracts)) {
    output[key] = parseOperationContract(contract, result.output[key]);
  }
  return {
    ...result,
    output,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function intentClarityBar(
  contract: {
    kind: string;
    requirements: Array<{
      id: string;
      label: string;
      question?: Question;
      required?: boolean;
      status: string;
    }>;
  },
  questions: Question[],
) {
  const required = contract.requirements.filter((requirement) => requirement.required !== false);
  const satisfied = required.filter((requirement) => requirement.status === "satisfied");
  const score = required.length === 0 ? 1 : satisfied.length / required.length;
  const status = score >= 1 ? "pass" : "needs_input";
  return defineEvaluationBar({
    gaps: required
      .filter((requirement) => requirement.status !== "satisfied")
      .map((requirement) => ({
        id: requirement.id,
        message: `${requirement.label} is ${requirement.status}.`,
        severity: "high" as const,
      })),
    label: titleCase(`${contract.kind} clarity`),
    nextAction: status === "pass" ? "complete" as const : "ask" as const,
    questions: questions.map((question) => ({
      id: question.id,
      options: question.options,
      prompt: question.prompt,
      title: question.title,
      type: question.type,
    })),
    risks: [],
    satisfies: required.map((requirement) => ({
      id: requirement.id,
      passed: requirement.status === "satisfied",
      reason: `${requirement.label} is ${requirement.status}.`,
    })),
    score,
    status,
    subjectId: `${contract.kind}.clarity`,
    threshold: 1,
  });
}

function titleCase(value: string) {
  return value.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function loop<TUse = unknown, TInput = unknown>(
  config: LoopConfig<TUse, TInput>,
) {
  return {
    id: config.id,
    graph(): LoopGraphProjection {
      return projectLoopGraph(config);
    },
    async start(input: TInput, options: LoopStartOptions = {}) {
      const session = new LoopSession(config, input, options);
      await session.resume();
      return session;
    },
    hydrate(
      snapshot: LoopHydrationSnapshot<TInput>,
      options: LoopHydrateOptions = {},
    ) {
      return hydrateLoopSession(config, snapshot, options);
    },
  };
}
