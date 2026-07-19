import {
  signalCorrelationHash,
  type SignalDefinition,
  type SignalDescriptor,
} from "../authoring/signal.js";
import type { JsonValue } from "../shared/json.js";
import type {
  Clock,
  IdGenerator,
  PublishSignalOccurrenceInput,
  PublishSignalOccurrenceResult,
  SignalOccurrenceReceipt,
  StoredSignalOccurrence,
  WorkflowRuntimeStore,
} from "./types.js";

export type SignalControlPlane = {
  getSignal(id: string): Promise<SignalDescriptor>;
  getSignalOccurrence(id: string): Promise<SignalOccurrenceReceipt>;
  listSignals(): Promise<SignalDescriptor[]>;
  publishSignalOccurrence(input: PublishSignalOccurrenceInput): Promise<PublishSignalOccurrenceResult>;
};

export function createSignalControlPlane(input: {
  authorize(input: { bearerToken?: string; capability: string }): Promise<void>;
  clock: Clock;
  error(code: string, message: string, status: number): Error;
  idGenerator: IdGenerator;
  runtimeStore: WorkflowRuntimeStore;
  signals: readonly SignalDefinition[];
}): SignalControlPlane {
  const signals = new Map(input.signals.map((signal) => [signal.id, signal]));
  return {
    async getSignal(id) {
      return requireSignal(id).descriptor;
    },
    async getSignalOccurrence(id) {
      const occurrence = await input.runtimeStore.getSignalOccurrence(id);
      if (!occurrence) {
        throw input.error(
          "SIGNAL_OCCURRENCE_NOT_FOUND",
          "Signal occurrence not found.",
          404,
        );
      }
      return publicReceipt(occurrence);
    },
    async listSignals() {
      return [...signals.values()].map((signal) => signal.descriptor);
    },
    async publishSignalOccurrence(publishInput) {
      const signal = requireSignal(publishInput.signalId);
      await input.authorize({
        bearerToken: publishInput.bearerToken,
        capability: `signal.publish:${signal.id}`,
      });
      const correlation = parseSignalValue(
        () => signal.parseCorrelation(publishInput.correlation),
      );
      const payload = parseSignalValue(() => signal.parsePayload(publishInput.payload));
      const correlationHash = signalCorrelationHash(correlation);
      const payloadHash = signalCorrelationHash(payload);
      const now = input.clock.now().toISOString();
      const result = await input.runtimeStore.putSignalOccurrence({
        correlation,
        correlationHash,
        createdAt: now,
        id: input.idGenerator.id("signal_occ"),
        idempotencyKey: publishInput.idempotencyKey,
        occurredAt: publishInput.occurredAt ?? now,
        payload,
        payloadHash,
        signalId: signal.id,
        updatedAt: now,
      });
      if (!result.created && (
        result.occurrence.correlationHash !== correlationHash
        || result.occurrence.payloadHash !== payloadHash
        || (publishInput.occurredAt !== undefined
          && result.occurrence.occurredAt !== publishInput.occurredAt)
      )) {
        throw input.error(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different signal occurrence.",
          409,
        );
      }
      return { created: result.created, receipt: publicReceipt(result.occurrence) };
    },
  };

  function requireSignal(id: string): SignalDefinition {
    const signal = signals.get(id);
    if (!signal) throw input.error("SIGNAL_NOT_FOUND", "Signal not found.", 404);
    return signal;
  }

  function parseSignalValue(parse: () => unknown): JsonValue {
    try {
      return JSON.parse(JSON.stringify(parse())) as JsonValue;
    } catch (error) {
      throw input.error(
        "SIGNAL_VALIDATION_FAILED",
        error instanceof Error ? error.message : String(error),
        422,
      );
    }
  }
}

function publicReceipt(occurrence: StoredSignalOccurrence): SignalOccurrenceReceipt {
  return {
    attempts: occurrence.attempts,
    createdAt: occurrence.createdAt,
    error: occurrence.error,
    id: occurrence.id,
    occurredAt: occurrence.occurredAt,
    signalId: occurrence.signalId,
    status: occurrence.status,
    updatedAt: occurrence.updatedAt,
  };
}
