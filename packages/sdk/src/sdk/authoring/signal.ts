import { createHash } from "node:crypto";
import {
  jsonSchemaFromContractSource,
  normalizeOperationContract,
  type InferOperationContractSource,
  type OperationContractSourceLike,
} from "../core/index.js";

export type SignalDescriptor = {
  contractFingerprint: string;
  correlationJsonSchema?: unknown;
  description?: string;
  id: string;
  payloadJsonSchema?: unknown;
  title?: string;
};

export type SignalDefinition<
  TCorrelation extends OperationContractSourceLike = OperationContractSourceLike,
  TPayload extends OperationContractSourceLike = OperationContractSourceLike,
> = {
  readonly correlation: TCorrelation;
  readonly descriptor: SignalDescriptor;
  readonly id: string;
  readonly payload: TPayload;
  parseCorrelation(value: unknown): InferOperationContractSource<TCorrelation>;
  parsePayload(value: unknown): InferOperationContractSource<TPayload>;
};

export type DefineSignalInput<
  TCorrelation extends OperationContractSourceLike,
  TPayload extends OperationContractSourceLike,
> = {
  correlation: TCorrelation;
  description?: string;
  id: string;
  payload: TPayload;
  title?: string;
};

export function defineSignal<
  const TCorrelation extends OperationContractSourceLike,
  const TPayload extends OperationContractSourceLike,
>(input: DefineSignalInput<TCorrelation, TPayload>): SignalDefinition<TCorrelation, TPayload> {
  const correlationContract = normalizeOperationContract(
    `${input.id}.correlation`,
    input.correlation,
  );
  const payloadContract = normalizeOperationContract(`${input.id}.payload`, input.payload);
  const descriptor = signalDescriptor({
    correlationJsonSchema: jsonSchemaFromContractSource(input.correlation),
    description: input.description,
    id: input.id,
    payloadJsonSchema: jsonSchemaFromContractSource(input.payload),
    title: input.title,
  });
  return {
    correlation: input.correlation,
    descriptor,
    id: input.id,
    parseCorrelation(value) {
      const result = correlationContract.safeParse(value);
      if (result.success) return result.data;
      throw signalValidationError(input.id, "correlation", result.issues);
    },
    parsePayload(value) {
      const result = payloadContract.safeParse(value);
      if (result.success) return result.data;
      throw signalValidationError(input.id, "payload", result.issues);
    },
    payload: input.payload,
  };
}

export function canonicalSignalCorrelation(value: unknown): string {
  return stableJson(value);
}

export function signalCorrelationHash(value: unknown): string {
  return createHash("sha256").update(canonicalSignalCorrelation(value)).digest("hex");
}

function signalDescriptor(
  input: Omit<SignalDescriptor, "contractFingerprint">,
): SignalDescriptor {
  return {
    ...input,
    contractFingerprint: createHash("sha256").update(stableJson({
      correlation: input.correlationJsonSchema ?? null,
      payload: input.payloadJsonSchema ?? null,
    })).digest("hex"),
  };
}

function signalValidationError(
  signalId: string,
  field: "correlation" | "payload",
  issues: Array<{ message: string; path?: PropertyKey[] }>,
) {
  const detail = issues.map((issue) =>
    issue.path?.length
      ? `${issue.path.map(String).join(".")}: ${issue.message}`
      : issue.message
  ).join("; ");
  return new Error(`Signal ${signalId} ${field} failed validation: ${detail}`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
