import {
  createContractedRuntimeStep,
  done,
  jsonSchemaFromContractSource,
  wait,
  type EventPayload,
  type InferStepContractInput,
  type InferStepContractOutput,
  type StepContractSourceMap,
  type StepRuntimeMetadata,
} from "../core/index.js";
import {
  driveChildWorkflow,
  type ChildWorkflowSession,
} from "../product/workflow/child-workflow.js";
import {
  authoredStepDefinition,
  type AuthoredStepDefinition,
} from "./step.js";
import {
  workflow as compileAuthoredWorkflow,
  type AuthoredWorkflow,
} from "./workflow.js";

export type AuthoredRouterRoutes = Record<
  string,
  AuthoredWorkflow<StepContractSourceMap, StepContractSourceMap>
>;

type WorkflowInputContracts<TWorkflow> =
  TWorkflow extends AuthoredWorkflow<infer TInput, StepContractSourceMap> ? TInput : never;
type WorkflowOutputContracts<TWorkflow> =
  TWorkflow extends AuthoredWorkflow<StepContractSourceMap, infer TOutput> ? TOutput : never;
export type RouterInputContracts<TRoutes extends AuthoredRouterRoutes> =
  WorkflowInputContracts<TRoutes[keyof TRoutes]>;
export type RouterOutputContracts<TRoutes extends AuthoredRouterRoutes> =
  WorkflowOutputContracts<TRoutes[keyof TRoutes]>;

export type AuthoredRouterStepInput<
  TRoutes extends AuthoredRouterRoutes,
  TInputContracts extends StepContractSourceMap = RouterInputContracts<TRoutes>,
> = {
  description?: string;
  id: string;
  input?: TInputContracts;
  label?: string;
  mapInput?(
    scope: RouterSelectionScope<TInputContracts>,
    routeId: keyof TRoutes & string,
  ): InferStepContractInput<RouterInputContracts<TRoutes>>
    | Promise<InferStepContractInput<RouterInputContracts<TRoutes>>>;
  maxRetries?: number;
  routes: TRoutes;
  select(scope: RouterSelectionScope<TInputContracts>): keyof TRoutes & string | Promise<keyof TRoutes & string>;
};

type RouterSelectionScope<TInputContracts extends StepContractSourceMap> = {
  emit(event: EventPayload): void;
  input: InferStepContractInput<TInputContracts>;
  state: Record<string, unknown>;
  step: StepRuntimeMetadata;
};

type RouterSession = {
  routeId: string;
};

type RouterDurableState = {
  routeId: string;
};

export class UnknownWorkflowRouteError extends Error {
  constructor(readonly routerId: string, readonly routeId: string, readonly availableRoutes: readonly string[]) {
    super(`step.router ${routerId} selected undeclared route ${routeId}; expected one of ${availableRoutes.join(", ")}.`);
    this.name = "UnknownWorkflowRouteError";
  }
}

export class ChangedWorkflowRouteError extends Error {
  constructor(readonly routerId: string, readonly previousRouteId: string, readonly routeId: string) {
    super(`step.router ${routerId} changed route from ${previousRouteId} to ${routeId} while resuming.`);
    this.name = "ChangedWorkflowRouteError";
  }
}

export function routerStep<
  const TRoutes extends AuthoredRouterRoutes,
  const TInputContracts extends StepContractSourceMap = RouterInputContracts<TRoutes>,
>(
  input: AuthoredRouterStepInput<TRoutes, TInputContracts>,
): AuthoredStepDefinition<TInputContracts, RouterOutputContracts<TRoutes>> {
  const routeEntries = Object.entries(input.routes);
  if (routeEntries.length < 2) throw new Error("step.router requires at least two routes.");
  const childInputContracts = compatibleContracts(routeEntries, "input") as RouterInputContracts<TRoutes>;
  const inputContracts = (input.input ?? childInputContracts) as unknown as TInputContracts;
  const outputContracts = compatibleContracts(routeEntries, "output") as RouterOutputContracts<TRoutes>;

  return authoredStepDefinition({
    description: input.description,
    execution: {
      kind: "router",
      label: input.label,
      routes: routeEntries.map(([id, child]) => ({
        childWorkflowDocumentId: child.document.id,
        id,
        label: child.definition.title,
      })),
    },
    id: input.id,
    implementation: {
      children: routeEntries.flatMap(([, child]) => child.document.nodes.map((node) => node.catalogItemId)),
      kind: "composite",
    },
    input: inputContracts,
    kind: "router",
    label: input.label,
    maxRetries: input.maxRetries,
    output: outputContracts,
  }, (createInput) => {
    const sessions = new Map<string, RouterSession>();
    const childSessions = new Map<string, ChildWorkflowSession>();
    return createContractedRuntimeStep({
      description: input.description,
      id: createInput.stepId ?? input.id,
      input: inputContracts,
      kind: "router",
      label: input.label,
      maxRetries: input.maxRetries,
      output: outputContracts,
      async run(context) {
        const scope = {
          emit: context.emit,
          input: context.input,
          state: context.state,
          step: context.step,
        };
        const sessionKey = `${context.step.runId}:${context.step.id}`;
        const stateKey = `__dromio.router.${context.step.id}`;
        const durable = routerDurableState(context.state[stateKey]);
        const spanId = `router:${context.step.id}:attempt:${context.step.attempt}`;
        emitRouterEvent(context.emit, context.step, spanId, "router.started", `Routing through ${input.label ?? input.id}.`, {
          routeIds: Object.keys(input.routes),
        });
        let routeId: string | undefined;
        try {
          routeId = await input.select(scope);
          const child = input.routes[routeId];
          if (!child) throw new UnknownWorkflowRouteError(input.id, routeId, Object.keys(input.routes));
          const previous = sessions.get(sessionKey);
          const previousRouteId = previous?.routeId ?? durable?.routeId;
          if (previousRouteId && previousRouteId !== routeId) {
            throw new ChangedWorkflowRouteError(input.id, previousRouteId, routeId);
          }
          emitRouterEvent(context.emit, context.step, spanId, "router.selected", `Selected ${routeId}.`, {
            childWorkflowId: child.document.id,
            routeId,
          });
          const workflow = compileAuthoredWorkflow({
            catalog: child.catalog.items(),
            config: child.config,
            document: child.document,
            input: child.input,
            model: createInput.model,
            output: child.output,
            use: context.use,
            workflows: child.workflows,
          });
          const outcome = await driveChildWorkflow({
            childWorkflowId: child.document.id,
            context: {
              answers: context.answers,
              hookAnswers: context.hookAnswers,
              state: context.state,
              step: context.step,
            },
            emit: context.emit,
            input: input.mapInput
              ? await input.mapInput(scope, routeId)
              : selectValues(child.input, context.input),
            itemId: routeId,
            itemKind: "router-route",
            iterationLabel: child.definition.title,
            namespace: `${context.step.id}.${routeId}`,
            parentStepId: context.step.id,
            parentTrace: {
              spanId,
              traceId: context.step.runId,
            },
            phase: "router route",
            sessions: childSessions,
            spanIdPrefix: `${spanId}:child`,
            stepIdPrefix: `${context.step.id}.${routeId}`,
            workflow,
          });
          if (outcome.status === "waiting") {
            sessions.set(sessionKey, { routeId });
            emitRouterEvent(context.emit, context.step, spanId, "router.waiting", `Waiting in ${routeId}.`, {
              childRunId: outcome.session.runId,
              childWorkflowId: child.document.id,
              routeId,
            });
            return wait({
              hooks: outcome.hooks,
              questions: outcome.questions,
              state: { [stateKey]: { routeId } satisfies RouterDurableState },
            });
          }
          sessions.delete(sessionKey);
          emitRouterEvent(context.emit, context.step, spanId, "router.completed", `Completed ${routeId}.`, {
            childRunId: outcome.session.runId,
            childWorkflowId: child.document.id,
            routeId,
          });
          return done(
            selectValues(outputContracts, outcome.session.state) as InferStepContractOutput<RouterOutputContracts<TRoutes>>,
            { [stateKey]: undefined },
          );
        } catch (error) {
          if (!(error instanceof ChangedWorkflowRouteError)) sessions.delete(sessionKey);
          emitRouterEvent(context.emit, context.step, spanId, "router.failed", `Failed ${routeId ?? "before selection"}.`, {
            error: error instanceof Error ? error.message : String(error),
            ...(routeId ? { routeId } : {}),
          }, "error");
          throw error;
        }
      },
    });
  });
}

function routerDurableState(value: unknown): RouterDurableState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<RouterDurableState>;
  if (typeof candidate.routeId !== "string") return undefined;
  return candidate as RouterDurableState;
}

function compatibleContracts(
  routes: Array<[string, AuthoredWorkflow]>,
  side: "input" | "output",
): StepContractSourceMap {
  const [firstId, first] = routes[0]!;
  const contracts = first[side];
  for (const [routeId, route] of routes.slice(1)) {
    const keys = new Set([...Object.keys(contracts), ...Object.keys(route[side])]);
    for (const key of keys) {
      const left = contracts[key];
      const right = route[side][key];
      if (!left || !right || !sameContract(left, right)) {
        throw new Error(`step.router route ${routeId} has an incompatible ${side} contract for ${key} compared with ${firstId}.`);
      }
    }
  }
  return contracts;
}

function sameContract(left: StepContractSourceMap[string], right: StepContractSourceMap[string]) {
  return JSON.stringify(jsonSchemaFromContractSource(left)) === JSON.stringify(jsonSchemaFromContractSource(right));
}

function selectValues(contracts: StepContractSourceMap, values: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(contracts).map((key) => [key, values[key]]));
}

function emitRouterEvent(
  emit: (event: EventPayload) => void,
  step: StepRuntimeMetadata,
  spanId: string,
  type: string,
  message: string,
  detail: Record<string, unknown>,
  status: "error" | "ok" | "unset" = type === "router.completed" ? "ok" : "unset",
) {
  emit({
    detail,
    message,
    stepId: step.id,
    trace: {
      attributes: { phase: "router", stepId: step.id },
      kind: "internal",
      name: type,
      parentSpanId: `step:${step.id}:attempt:${step.attempt}`,
      spanId,
      status,
      traceId: step.runId,
    },
    type,
  });
}
