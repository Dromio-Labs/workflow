import {
  evaluationBarFromCandidate,
  evaluationCompletedEvent,
} from "../../core/index.js";
import {
  ask,
  done,
  fail,
  loop,
  retry,
  createIntentRuntimeStep,
  createRuntimeStep,
  type LoopGraphProjection,
  type StepDefinition,
} from "../../core/loop/index.js";
import {
  capabilities as createCapabilities,
} from "../builder/index.js";
import type { WorkflowBuilderConfig } from "./workflow.types.js";
import type { WorkflowState, WorkflowUse } from "./workflow-state.js";

export function createWorkflowLoop<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>,
) {
  const catalog = Array.isArray(config.capabilities)
    ? createCapabilities({ items: config.capabilities })
    : config.capabilities;
  return loop<WorkflowUse<TArtifact>, { prompt: string }>({
    description: config.description,
    end: config.end,
    id: config.id ?? "workflow.builder",
    label: config.label,
    questionResolvers: config.questionResolvers,
    steps: ([
      createIntentRuntimeStep<WorkflowUse<TArtifact>, { prompt: string }>("understandRequest", {
        domain: config.domain,
      }),
      createRuntimeStep<WorkflowUse<TArtifact>, { prompt: string }>("matchCapabilities", async ({ state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!typedState.intent) {
          return fail("Intent was not resolved.");
        }
        const match = await use.capabilities.match(typedState.intent);
        if (match.questions.length > 0) {
          return ask(match.questions);
        }
        if (match.missingCapabilities.length > 0) {
          return fail(
            `No capability is available for ${match.missingCapabilities
              .map((item) => `${item.intent} (${item.label})`)
              .join(", ")}.`,
          );
        }
        return done({ plan: match.plan });
      }),
      createRuntimeStep<WorkflowUse<TArtifact>, { prompt: string }>("createArtifact", async ({ emit, state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!typedState.intent || !typedState.plan) {
          return fail("Cannot create an artifact before intent and plan are ready.");
        }
        const artifact = await use.artifact.create({
          emit,
          intent: typedState.intent,
          plan: typedState.plan,
        });
        emit({
          detail: { artifact },
          message: "Created runnable artifact.",
          type: "artifact.created",
        });
        return done({ artifact });
      }),
      createRuntimeStep<WorkflowUse<TArtifact>, { prompt: string }>("evaluateCandidate", async ({ emit, state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!typedState.intent || !typedState.plan || !typedState.artifact) {
          return fail("Cannot evaluate a candidate before intent, plan, and artifact are ready.");
        }
        if (!use.evaluateCandidate) {
          return done();
        }
        emit({
          detail: {
            artifact: typedState.artifact,
          },
          message: "Evaluating candidate artifact.",
          type: "candidate.evaluation.started",
        });
        const evaluation = await use.evaluateCandidate({
          artifact: typedState.artifact,
          emit,
          intent: typedState.intent,
          plan: typedState.plan,
        });
        emit({
          detail: { evaluation },
          message: evaluation.message ?? `Candidate evaluation score ${Math.round(evaluation.score * 100)}%.`,
          type: "candidate.evaluation.completed",
        });
        emit(evaluationCompletedEvent({
          bar: evaluationBarFromCandidate({
            evaluation,
            label: "Candidate fit",
            subjectId: "candidate.fit",
            threshold: 0.8,
          }),
        }));
        if (evaluation.nextAction === "cancel" || evaluation.status === "fail") {
          return fail(evaluation.message ?? "Candidate evaluation failed.", { candidateEvaluation: evaluation });
        }
        return done({ candidateEvaluation: evaluation });
      }),
      createRuntimeStep<WorkflowUse<TArtifact>, { prompt: string }>("checkArtifact", async ({ state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!typedState.intent || !typedState.plan || !typedState.artifact) {
          return fail("Cannot check an artifact before it is created.");
        }
        const readiness = use.checkArtifact
          ? await use.checkArtifact({
              artifact: typedState.artifact,
              intent: typedState.intent,
              plan: typedState.plan,
            })
          : { ok: true };
        if (!readiness.ok) {
          return retry(readiness.reason ?? "Artifact is not runnable.");
        }
        return done({ readiness });
      }),
      createRuntimeStep<WorkflowUse<TArtifact>, { prompt: string }>("runArtifact", async ({ emit, state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!typedState.intent || !typedState.plan || !typedState.artifact) {
          return fail("Cannot run an artifact before it is created.");
        }
        const result = use.runArtifact
          ? await use.runArtifact({
              artifact: typedState.artifact,
              emit,
              intent: typedState.intent,
              plan: typedState.plan,
            })
          : undefined;
        const runResult = result ?? { status: "completed" };
        if (runResult.status === "failed") {
          const error =
            typeof runResult.error === "string"
              ? runResult.error
              : "Artifact runner failed.";
          return fail(error, { result: runResult });
        }
        return done({ result: runResult });
      }),
    ] satisfies StepDefinition<WorkflowUse<TArtifact>, { prompt: string }>[]).map((definition) =>
      applyWorkflowBuilderStepView(config, definition)
    ),
    trigger: config.trigger,
    use: {
      artifact: { create: config.createArtifact },
      capabilities: catalog,
      checkArtifact: config.checkArtifact,
      evaluateCandidate: config.evaluateCandidate,
      runArtifact: config.runArtifact,
    },
  });
}

function applyWorkflowBuilderStepView<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>,
  definition: StepDefinition<WorkflowUse<TArtifact>, { prompt: string }>,
): StepDefinition<WorkflowUse<TArtifact>, { prompt: string }> {
  const view = config.stepView?.[definition.id];
  if (!view) return definition;
  return {
    ...definition,
    description: view.description ?? definition.description,
    label: view.label ?? definition.label,
  };
}
