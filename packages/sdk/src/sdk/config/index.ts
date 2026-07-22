import type {
  DromioBrowserApprovalMode,
  DromioBrowserFeatureGroup,
  DromioBrowserOperationId,
} from "@dromio/protocols";

/**
 * Config-as-code authoring surface (plan 34). Everything here returns plain,
 * JSON-serializable data — no I/O, no closures (except `defineWorkflow.run`,
 * which is a code reference, not config). The dromio control plane loads the
 * default export of `dromio.config.ts`, desugars it, and validates it with
 * the same zod schema as `dromio.yml` — one resolver, one error format.
 */

export interface DromioProviderSpec {
  readonly kind: "provider";
  readonly env: Readonly<Record<string, string>>;
  readonly model: string;
  readonly inputModalities?: readonly ("text" | "image" | "audio" | "video" | "file")[];
  readonly providerId: string;
  readonly type: "openai" | "codex-cli" | "claude";
}

export interface DromioModelDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly inputModalities?: readonly ("text" | "image" | "audio" | "video" | "file")[];
}

export interface DromioRegistryProviderSpec {
  readonly kind: "registry-provider";
  readonly env: Readonly<Record<string, string>>;
  readonly id: string;
  readonly models: readonly DromioModelDescriptor[];
  readonly type: "openai" | "codex-cli" | "claude";
}

export interface DromioModelRegistrySpec {
  readonly kind: "model-registry";
  readonly default: { readonly modelId: string; readonly providerId: string };
  readonly providers: readonly DromioRegistryProviderSpec[];
}

export interface DromioBrowserCapabilitySpec {
  readonly kind: "capability.browser";
  readonly approvals?: { readonly navigate?: "auto" | "required" };
  readonly driver: "brave-vnc" | "fetch";
  readonly plugins?: readonly DromioBrowserPluginSpec[];
  readonly sandbox?: "managed" | { readonly cdpUrl: string; readonly observerUrl: string };
  readonly recording?: {
    readonly format: "webm";
    readonly fps?: number;
    readonly jpegQuality?: number;
    readonly maxBytes?: number;
    readonly maxDurationMs?: number;
    readonly maxHeight?: number;
    readonly maxWidth?: number;
    readonly recoveryDirectory?: string;
  };
  readonly resources?: {
    readonly databasePath: string;
    readonly profileNamespace: string;
  };
}

export interface DromioBrowserControlPluginSpec {
  readonly allowedOrigins?: readonly string[];
  readonly kind: "browser-control";
  readonly preset: "agent-browser-parity" | "custom";
  readonly features?: Partial<Readonly<Record<DromioBrowserFeatureGroup, DromioBrowserApprovalMode>>>;
  readonly operations?: Partial<Readonly<Record<DromioBrowserOperationId, DromioBrowserApprovalMode>>>;
  readonly limits?: {
    readonly maxSessions?: number;
    readonly maxTabsPerSession?: number;
    readonly maxArtifactBytes?: number;
    readonly maxEventRecords?: number;
  };
}

export type DromioBrowserPluginSpec = DromioBrowserControlPluginSpec;

export const browserPlugin = {
  control(
    options: Omit<DromioBrowserControlPluginSpec, "kind">,
  ): DromioBrowserControlPluginSpec {
    return { ...options, kind: "browser-control" };
  },
};

export type DromioCapabilitySpec = DromioBrowserCapabilitySpec;

export interface DromioShellSpec {
  readonly kind: "shell.web";
  readonly shellId: string;
}

export interface DromioWorkflowDefinition<Input = unknown, Output = unknown> {
  readonly kind: "workflow";
  readonly approvals?: "none" | "human-confirm-writes";
  /** Defaults to `.dromio/compile/<id>.json` when emitted. */
  readonly compileArtifact?: string;
  /** Defaults to `.dromio/workflows/<id>.workflow.json` when emitted. */
  readonly document?: string;
  readonly id: string;
  /** Code-backed workflows provide a runner instead of document artifacts. */
  readonly run?: (input: Input) => Promise<Output> | Output;
  readonly title: string;
}

export interface DromioEnvironmentSpec {
  readonly approvals?: { readonly writes: "optional" | "required" };
  readonly platformUrl?: string;
  readonly runtime?: {
    readonly model: string;
    readonly provider: string;
  };
  readonly sandbox?: {
    readonly filesystem: {
      readonly mode: "local" | "bounded" | "readonly";
      readonly writable?: readonly string[];
    };
  };
  readonly storage?: Readonly<Record<string, unknown>>;
}

export interface DromioProductSpec {
  readonly architecture: {
    readonly effect_mode: "strict" | "optional" | "off";
    readonly mode: "strict" | "advisory" | "off";
    readonly source_line_limit: number;
  };
  readonly capabilities?: readonly {
    readonly id: string;
    readonly mode: "read" | "write" | "approval-gated";
  }[];
  readonly entry: {
    readonly capabilities?: string;
    readonly panels?: string;
    readonly workflows?: string;
  };
  readonly fixtures?: readonly string[];
  readonly panels?: readonly {
    readonly id: string;
    readonly kind: "json-render";
    readonly title: string;
    readonly view: Readonly<Record<string, unknown>>;
  }[];
  readonly requires: {
    readonly dromio: {
      readonly platform?: string;
      readonly product?: string;
      readonly protocol?: string;
      readonly runtime?: string;
      readonly sdk: string;
      readonly shell?: string;
    };
    readonly runtime?: {
      readonly "@effect/schema"?: string;
      readonly effect?: string;
    };
  };
  readonly version: string;
}

export type DromioDevServiceReadySpec =
  | { readonly type: "immediate" }
  | {
      readonly type: "output";
      readonly pattern: string;
      readonly exportEnv?: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly type: "http";
      readonly url: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly type: "env-file-http";
      readonly path: string;
      readonly key: string;
      readonly exportEnv?: string;
      readonly healthPath?: string;
      readonly pattern?: string;
      readonly timeoutMs?: number;
    };

export interface DromioDevServiceSpec {
  readonly label?: string;
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly dependsOn?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** Environment variable that `dromio dev` advances after an address-in-use error. */
  readonly port?: DromioDevServicePort;
  /** Human-facing guidance for environment values consumed by this service. */
  readonly envHelp?: Readonly<Record<string, DromioDevEnvironmentHelp>>;
  readonly unsetEnv?: readonly string[];
  readonly ready?: DromioDevServiceReadySpec;
}

export interface DromioDevServicePort {
  readonly env: string;
  /** First local port to try before advancing past unrelated local services. */
  readonly preferred?: number;
}

export interface DromioDevEnvironmentGeneratorSpec {
  /** Number of cryptographically secure random bytes encoded as hexadecimal. Defaults to 32. */
  readonly bytes?: number;
  readonly type: "random-hex";
}

export interface DromioDevEnvironmentHelp {
  /** Whether startup must stop when this value is absent. Defaults to true. */
  readonly required?: boolean;
  /** Explains what the value enables and why a developer might need it. */
  readonly description: string;
  /** Safe, public location where the value can be obtained. */
  readonly docsUrl?: string;
  /** Generates a local value when the developer presses Enter instead of typing one. */
  readonly generate?: DromioDevEnvironmentGeneratorSpec;
}

export interface DromioDevSpec {
  /** App-wide setup guidance rendered by `dromio dev` for matching placeholders. */
  readonly envHelp?: Readonly<Record<string, DromioDevEnvironmentHelp>>;
  readonly services: Readonly<Record<string, DromioDevServiceSpec>>;
  readonly links?: readonly { readonly label: string; readonly url: string }[];
}

export interface DromioAppDefinition {
  readonly kind: "app";
  /** Defaults to the kebab-cased name. */
  readonly id?: string;
  readonly name: string;
  readonly model?: DromioProviderSpec;
  readonly models?: DromioModelRegistrySpec;
  readonly capabilities?: readonly DromioCapabilitySpec[];
  /** Local services supervised and rendered by `dromio dev`. */
  readonly dev?: DromioDevSpec;
  /** Named deployment environments emitted as `dromio.env.<id>.yml`. */
  readonly environments?: Readonly<Record<string, DromioEnvironmentSpec>>;
  /** Product manifest fields that cannot be derived from this app definition. */
  readonly product?: DromioProductSpec;
  readonly shell?: DromioShellSpec;
  readonly workflows?: readonly DromioWorkflowDefinition[];
  /**
   * Escape hatch: a partial dromio cloud config deep-merged over the
   * desugared definition. Validated by the control plane like any config.
   */
  readonly cloud?: Readonly<Record<string, unknown>>;
}

export type DromioAppDefinitionInput = Omit<DromioAppDefinition, "kind">;

/** Defines the higher-level Dromio App configuration consumed by dev, build, and Cloud. */
export function defineApp(definition: DromioAppDefinitionInput): DromioAppDefinition {
  if (definition.model && definition.models) {
    throw new Error("defineApp accepts either model or models, not both");
  }
  return { ...definition, kind: "app" };
}

export function defineWorkflow<Input, Output>(
  workflow: Omit<DromioWorkflowDefinition<Input, Output>, "kind">,
): DromioWorkflowDefinition<Input, Output> {
  return { ...workflow, kind: "workflow" };
}

export interface OpenAiProviderOptions {
  /** Credential or environment placeholder; defaults to `${OPENAI_API_KEY}`. */
  readonly apiKey?: string;
  /** Base URL or environment placeholder; defaults to `${OPENAI_BASE_URL:-https://api.openai.com/v1}`. */
  readonly baseUrl?: string;
  readonly providerId?: string;
  /** Input types accepted by this exact model selection. Defaults to text only. */
  readonly inputModalities?: readonly ("text" | "image" | "audio" | "video" | "file")[];
}

export interface OpenAiCompatibleProviderOptions {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly id: string;
  readonly models: readonly DromioModelDescriptor[];
}

export const provider = {
  codexCli(model: string, options: { readonly providerId?: string } = {}): DromioProviderSpec {
    return {
      env: {},
      kind: "provider",
      model,
      providerId: options.providerId ?? "codex",
      type: "codex-cli",
    };
  },
  openai(model: string, options: OpenAiProviderOptions = {}): DromioProviderSpec {
    return {
      env: {
        OPENAI_API_KEY: options.apiKey ?? "${OPENAI_API_KEY}",
        OPENAI_API_MODE: "${OPENAI_API_MODE:-chat-completions}",
        OPENAI_BASE_URL: options.baseUrl ?? "${OPENAI_BASE_URL:-https://api.openai.com/v1}",
      },
      kind: "provider",
      model,
      ...(options.inputModalities ? { inputModalities: options.inputModalities } : {}),
      providerId: options.providerId ?? "openai",
      type: "openai",
    };
  },
  openaiCompatible(options: OpenAiCompatibleProviderOptions): DromioRegistryProviderSpec {
    return {
      env: {
        OPENAI_API_KEY: options.apiKey ?? "${OPENAI_API_KEY}",
        OPENAI_API_MODE: "${OPENAI_API_MODE:-chat-completions}",
        OPENAI_BASE_URL: options.baseUrl,
      },
      id: options.id,
      kind: "registry-provider",
      models: options.models,
      type: "openai",
    };
  },
};

export function modelRegistry(
  registry: Omit<DromioModelRegistrySpec, "kind">,
): DromioModelRegistrySpec {
  const identities = new Set<string>();
  for (const providerSpec of registry.providers) {
    for (const model of providerSpec.models) {
      const identity = `${providerSpec.id}\u0000${model.id}`;
      if (identities.has(identity)) {
        throw new Error(`Duplicate model registry identity: ${providerSpec.id}/${model.id}`);
      }
      identities.add(identity);
    }
  }
  const defaultModelId = registeredDefaultModelId(registry.default.modelId);
  if (!identities.has(`${registry.default.providerId}\u0000${defaultModelId}`)) {
    throw new Error(
      `Default model is not registered: ${registry.default.providerId}/${registry.default.modelId}`,
    );
  }
  return { ...registry, kind: "model-registry" };
}

function registeredDefaultModelId(modelId: string): string {
  const environmentDefault = modelId.match(/^\$\{[A-Z0-9_]+:-([^}]+)\}$/)?.[1]?.trim();
  return environmentDefault || modelId;
}

export function browser(
  options: Omit<DromioBrowserCapabilitySpec, "kind">,
): DromioBrowserCapabilitySpec {
  if (options.resources) {
    assertBrowserResourceSettings(options.resources);
  }
  const kinds = options.plugins?.map(({ kind }) => kind) ?? [];
  if (new Set(kinds).size !== kinds.length) {
    throw new Error("A browser capability cannot declare the same plugin more than once.");
  }
  return { ...options, kind: "capability.browser" };
}

function assertBrowserResourceSettings(resources: Readonly<Record<string, unknown>>): void {
  const allowedKeys = new Set(["databasePath", "profileNamespace"]);
  const unsupportedKeys = Object.keys(resources)
    .filter((key) => !allowedKeys.has(key))
    .sort();
  if (unsupportedKeys.length > 0) {
    throw new Error(
      `Browser resources only accept databasePath and profileNamespace; unsupported fields: ${unsupportedKeys.join(", ")}.`,
    );
  }
  for (const key of allowedKeys) {
    if (typeof resources[key] !== "string" || resources[key].trim().length === 0) {
      throw new Error(`Browser resources require a non-empty ${key}.`);
    }
  }
}

export function webShell(options: { readonly shellId?: string } = {}): DromioShellSpec {
  return { kind: "shell.web", shellId: options.shellId ?? "web" };
}
