import type {
  WorkflowRunArtifactRef,
} from "../../core/index.js";
import type {
  JsonObject,
  JsonValue,
} from "../../shared/json.js";

type ArtifactStorePutBase = {
  readonly kind: string;
  readonly mediaType?: string;
  readonly metadata?: JsonObject;
  readonly title?: string;
};

export type ArtifactStorePutInput = ArtifactStorePutBase & (
  | {
      readonly bytes: Uint8Array;
      readonly text?: never;
      readonly value?: never;
    }
  | {
      readonly bytes?: never;
      readonly text: string;
      readonly value?: never;
    }
  | {
      readonly bytes?: never;
      readonly text?: never;
      readonly value: JsonValue;
    }
);

export type ArtifactStoreContent = string | Uint8Array;

export type ArtifactStoreGetInput = string | WorkflowRunArtifactRef;

export type ArtifactStoreGetResult = {
  readonly content: ArtifactStoreContent;
  readonly ref: WorkflowRunArtifactRef;
};

export type ArtifactStorePort = {
  /**
   * Stores content outside run state. Text and JSON values are persisted as
   * strings; byte inputs are persisted as base64 text and decoded on get.
   */
  put(input: ArtifactStorePutInput): Promise<WorkflowRunArtifactRef>;
  get(input: ArtifactStoreGetInput): Promise<ArtifactStoreGetResult>;
};
