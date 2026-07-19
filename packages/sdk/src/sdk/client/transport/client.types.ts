import type {
  EventRecord,
  LoopCheckpoint,
} from "../../core/loop/index.js";
import type {
  IntentRuntime,
  RuntimeActionDescriptor,
  RuntimeActionResult,
  RuntimeRerunInput,
  RuntimeSessionSnapshot,
  RuntimeWorkflowDescriptor,
  WorkflowRunArtifactRef,
} from "../../core/runtime/index.js";

export type ArtifactUploadInput =
  | {
      readonly bytes: Uint8Array;
      readonly file?: never;
      readonly kind: string;
      readonly mediaType: string;
      readonly title?: string;
    }
  | {
      readonly bytes?: never;
      readonly file: Blob;
      readonly kind?: string;
      readonly mediaType?: never;
      readonly title?: string;
    };

export type IntentClientFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CreateIntentClientInput =
  | {
      baseUrl: string;
      fetch?: IntentClientFetch;
      headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
    }
  | {
      runtime: IntentRuntime;
    };

export type CreateRunInput = {
  answers?: Record<string, unknown>;
  input?: unknown;
  runId?: string;
  workflow: string;
};

export type ApplyClientActionInput = {
  actionKey: string;
  input?: unknown;
  sessionId: string;
};

export type IntentClient = {
  artifacts: {
    upload(input: ArtifactUploadInput): Promise<WorkflowRunArtifactRef>;
    url(artifactId: string): string;
  };
  hooks: {
    resume(input: { token: string; value: unknown }): Promise<RuntimeSessionSnapshot>;
  };
  runs: {
    create(input: CreateRunInput): Promise<{ session: RuntimeSessionSnapshot }>;
  };
  sessions: {
    actions(sessionId: string): Promise<RuntimeActionDescriptor[]>;
    applyAction(input: ApplyClientActionInput): Promise<RuntimeActionResult>;
    checkpoints(sessionId: string): Promise<Array<LoopCheckpoint<unknown>>>;
    events(sessionId: string, input?: { fromIndex?: number }): Promise<EventRecord[]>;
    get(sessionId: string): Promise<RuntimeSessionSnapshot>;
    list(): Promise<RuntimeSessionSnapshot[]>;
    rerun(input: RuntimeRerunInput): Promise<RuntimeSessionSnapshot>;
    streamEvents(sessionId: string, input?: { fromIndex?: number }): AsyncIterable<EventRecord>;
  };
  workflows: {
    list(): Promise<RuntimeWorkflowDescriptor[]>;
  };
};
