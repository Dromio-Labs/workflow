import type {
  EventPayload,
  TraceAttributeValue,
} from "../../core/index.js";
import {
  createOpenAiCompatibleModelWorker,
} from "./openai-compatible-worker.js";
import type {
  OpenAiCompatibleChatModelConfig,
} from "../intent/openai-compatible.js";
import {
  createOpencodeModelWorker,
  type OpencodeModelWorkerConfig,
} from "./opencode-worker.js";
import {
  createCodexCliModelWorker,
  type CodexCliModelWorkerConfig,
} from "./codex-cli-worker.js";
import type {
  ModelWorkerPort,
} from "./model-worker.js";

export type ModelWorkerTarget = {
  operation?: string;
  runId?: string;
  stepId: string;
  workflowId?: string;
};

export type ModelWorkerOption = {
  capabilities: string[];
  id: string;
  label: string;
  model?: string;
  worker: string;
};

export type ModelWorkerSelection = {
  overridden: boolean;
  requested: ModelWorkerOption;
  selected: ModelWorkerOption;
  target: ModelWorkerTarget;
};

export type ModelWorkerRef<TModelId extends string = string> = ModelWorkerOption & {
  readonly kind: "model-worker-ref";
  readonly router: ModelWorkerRouter;
  readonly id: TModelId;
};

export type ModelWorkerResolution = {
  selection?: ModelWorkerSelection;
  worker: ModelWorkerPort;
};

export type ModelWorkerResolutionContext<TContext = unknown> = {
  context?: TContext;
  onEvent?: (event: EventPayload) => void | Promise<void>;
  parentSpanId?: string;
  target: ModelWorkerTarget;
  traceId?: string;
};

export type ModelWorkerSource<TContext = unknown> =
  | ModelWorkerPort
  | ModelWorkerRef
  | ((input: ModelWorkerResolutionContext<TContext>) =>
    | ModelWorkerPort
    | ModelWorkerRef
    | Promise<ModelWorkerPort | ModelWorkerRef>);

export type ModelWorkerBackend<TConfig = unknown> = {
  create(input: {
    config?: TConfig;
    model?: string;
    modelId: string;
  }): ModelWorkerPort;
  kind?: string;
  label?: string;
};

export type ModelWorkerRoute<TWorkerId extends string = string, TConfig = unknown> = {
  capabilities?: string[];
  config?: TConfig;
  label?: string;
  model?: string;
  worker: TWorkerId;
};

export type ModelRouterConfig<
  TWorkers extends Record<string, ModelWorkerBackend>,
  TModels extends Record<string, ModelWorkerRoute<Extract<keyof TWorkers, string>>>,
> = {
  models: TModels;
  workers: TWorkers;
};

export type ModelWorkerRouter<
  TModelId extends string = string,
> = {
  describe(modelId: TModelId | string): ModelWorkerOption;
  options(): ModelWorkerOption[];
  resolve(input: {
    requested: ModelWorkerRef<TModelId> | TModelId | string;
    target: ModelWorkerTarget;
  }): ModelWorkerResolution;
  select(input: ModelWorkerTarget & {
    modelId: TModelId | string;
  }): void;
  selection(input: {
    requested: ModelWorkerRef<TModelId> | TModelId | string;
    target: ModelWorkerTarget;
  }): ModelWorkerSelection;
  use<TSelectedId extends TModelId>(modelId: TSelectedId): ModelWorkerRef<TSelectedId>;
};

export function createModelRouter<
  const TWorkers extends Record<string, ModelWorkerBackend>,
  const TModels extends Record<string, ModelWorkerRoute<Extract<keyof TWorkers, string>>>,
>(
  config: ModelRouterConfig<TWorkers, TModels>,
): ModelWorkerRouter<Extract<keyof TModels, string>> {
  type TModelId = Extract<keyof TModels, string>;
  const workerCache = new Map<string, ModelWorkerPort>();
  const overrides = new Map<string, TModelId>();

  const router: ModelWorkerRouter<TModelId> = {
    describe(modelId) {
      return describeModel(modelId as TModelId);
    },
    options() {
      return (Object.keys(config.models) as TModelId[]).map((modelId) => describeModel(modelId));
    },
    resolve(input) {
      const selection = router.selection(input);
      return {
        selection,
        worker: workerFor(selection.selected.id as TModelId),
      };
    },
    select(input) {
      const modelId = input.modelId as TModelId;
      assertModel(modelId);
      for (const key of targetStorageKeys(input)) {
        overrides.set(key, modelId);
      }
    },
    selection(input) {
      const requested = typeof input.requested === "string"
        ? describeModel(input.requested as TModelId)
        : describeModel(input.requested.id as TModelId);
      const selectedId = selectedModelId(input.target, requested.id as TModelId);
      const selected = describeModel(selectedId);
      return {
        overridden: selected.id !== requested.id,
        requested,
        selected,
        target: input.target,
      };
    },
    use(modelId) {
      const option = describeModel(modelId);
      return {
        ...option,
        kind: "model-worker-ref",
        router: router as ModelWorkerRouter,
      } as ModelWorkerRef<typeof modelId>;
    },
  };

  return router;

  function workerFor(modelId: TModelId) {
    assertModel(modelId);
    const cached = workerCache.get(modelId);
    if (cached) return cached;
    const route = config.models[modelId]!;
    const backend = config.workers[route.worker];
    if (!backend) {
      throw new Error(`Unknown model worker "${route.worker}" for model "${modelId}".`);
    }
    const worker = backend.create({
      config: route.config,
      model: route.model,
      modelId,
    });
    workerCache.set(modelId, worker);
    return worker;
  }

  function describeModel(modelId: TModelId): ModelWorkerOption {
    assertModel(modelId);
    const route = config.models[modelId]!;
    return {
      capabilities: [...(route.capabilities ?? [])],
      id: modelId,
      label: route.label ?? modelId,
      model: route.model,
      worker: route.worker,
    };
  }

  function selectedModelId(target: ModelWorkerTarget, requestedId: TModelId) {
    for (const key of targetOverrideKeys(target)) {
      const override = overrides.get(key);
      if (override) return override;
    }
    return requestedId;
  }

  function assertModel(modelId: TModelId) {
    if (!config.models[modelId]) {
      throw new Error(`Unknown model router model: ${modelId}`);
    }
  }
}

export function openAiCompatibleWorker(
  config: OpenAiCompatibleChatModelConfig = {},
): ModelWorkerBackend<OpenAiCompatibleChatModelConfig> {
  return {
    kind: "openai-compatible",
    create(input) {
      return createOpenAiCompatibleModelWorker({
        ...config,
        ...(input.config ?? {}),
        model: input.model ?? input.config?.model ?? config.model,
      });
    },
  };
}

/** @deprecated Use `step.delegate()` when OpenCode owns inference and tools. */
export function opencodeWorker(
  config: OpencodeModelWorkerConfig = {},
): ModelWorkerBackend<OpencodeModelWorkerConfig> {
  return {
    kind: "opencode",
    create(input) {
      return createOpencodeModelWorker({
        ...config,
        ...(input.config ?? {}),
        model: input.model ?? input.config?.model ?? config.model,
      });
    },
  };
}

/** @deprecated Use `step.delegate()` when Codex owns inference and tools. */
export function codexCliWorker(
  config: CodexCliModelWorkerConfig = {},
): ModelWorkerBackend<CodexCliModelWorkerConfig> {
  return {
    kind: "codex-cli",
    create(input) {
      return createCodexCliModelWorker({
        ...config,
        ...(input.config ?? {}),
        model: input.model ?? input.config?.model ?? config.model,
      });
    },
  };
}

export function modelWorkerBackend<TConfig = unknown>(
  backend: ModelWorkerBackend<TConfig>,
): ModelWorkerBackend<TConfig> {
  return backend;
}

export async function resolveModelWorkerSource<TContext>(
  source: ModelWorkerSource<TContext> | undefined,
  context: ModelWorkerResolutionContext<TContext>,
): Promise<ModelWorkerResolution> {
  if (!source) {
    throw new Error(`No model worker configured for ${formatTarget(context.target)}.`);
  }
  if (typeof source === "function") {
    return resolveModelWorkerSource(await source(context), context);
  }
  if (isModelWorkerRef(source)) {
    const resolution = source.router.resolve({
      requested: source,
      target: context.target,
    });
    await emitModelWorkerSelection(context, resolution.selection);
    return resolution;
  }
  return {
    worker: source,
  };
}

export function isModelWorkerRef(value: unknown): value is ModelWorkerRef {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { kind?: unknown }).kind === "model-worker-ref" &&
      (value as { router?: unknown }).router,
  );
}

export function describeModelWorkerSource(
  source: ModelWorkerSource | undefined,
): ModelWorkerOption | undefined {
  return isModelWorkerRef(source) ? source.router.describe(source.id) : undefined;
}

export function modelWorkerSelectedEvent(
  input: ModelWorkerSelection & {
    parentSpanId?: string;
    traceId?: string;
  },
): EventPayload {
  const operation = input.target.operation ?? "model";
  const label = input.selected.model
    ? `${input.selected.label} (${input.selected.model})`
    : input.selected.label;
  const attributes: Record<string, TraceAttributeValue> = {
    model: input.selected.model ?? "",
    modelId: input.selected.id,
    operation,
    phase: "model",
    provider: input.selected.worker,
    requestedModelId: input.requested.id,
    stepId: input.target.stepId,
  };
  if (input.target.workflowId) attributes.workflowId = input.target.workflowId;
  return {
    detail: input,
    message: `Selected ${label} for ${input.target.stepId}/${operation}.`,
    stepId: input.target.stepId,
    trace: {
      attributes,
      kind: "internal",
      name: `Select model for ${operation}`,
      parentSpanId: input.parentSpanId,
      spanId: `model-router:${input.target.stepId}:${operation}`,
      status: "ok",
      traceId: input.traceId ?? input.target.runId ?? "model-router",
    },
    type: "model.worker.selected",
  };
}

async function emitModelWorkerSelection<TContext>(
  context: ModelWorkerResolutionContext<TContext>,
  selection: ModelWorkerSelection | undefined,
) {
  if (!selection) return;
  await context.onEvent?.(modelWorkerSelectedEvent({
    ...selection,
    parentSpanId: context.parentSpanId,
    traceId: context.traceId,
  }));
}

function targetKey(target: ModelWorkerTarget) {
  return [
    target.runId ? `run:${target.runId}` : undefined,
    target.workflowId ? `workflow:${target.workflowId}` : undefined,
    `step:${target.stepId}`,
    target.operation ? `operation:${target.operation}` : undefined,
  ].filter(Boolean).join("|");
}

function targetOverrideKeys(target: ModelWorkerTarget) {
  const keys = [targetKey(target)];
  if (target.operation) {
    keys.push(targetKey({
      ...target,
      operation: undefined,
    }));
  }
  if (target.runId) {
    keys.push(targetKey({
      ...target,
      runId: undefined,
    }));
    if (target.operation) {
      keys.push(targetKey({
        ...target,
        operation: undefined,
        runId: undefined,
      }));
    }
  }
  if (target.workflowId) {
    keys.push(targetKey({
      ...target,
      workflowId: undefined,
    }));
    if (target.operation) {
      keys.push(targetKey({
        ...target,
        operation: undefined,
        workflowId: undefined,
      }));
    }
  }
  if (target.runId && target.workflowId) {
    keys.push(targetKey({
      ...target,
      runId: undefined,
      workflowId: undefined,
    }));
    if (target.operation) {
      keys.push(targetKey({
        ...target,
        operation: undefined,
        runId: undefined,
        workflowId: undefined,
      }));
    }
  }
  return [...new Set(keys)];
}

function targetStorageKeys(target: ModelWorkerTarget) {
  return [targetKey(target)];
}

function formatTarget(target: ModelWorkerTarget) {
  return target.operation
    ? `${target.stepId}/${target.operation}`
    : target.stepId;
}
