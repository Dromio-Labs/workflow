import type { DromioJsonObject, DromioTriggerOccurrenceV1 } from "@dromio/protocols";
import type { ExecutionDispatchPort, TriggerDefinition, TriggerDispatchReceipt, TriggerStore } from "./types.js";

export class TriggerError extends Error {
  constructor(readonly code: "not_found" | "disabled" | "type_mismatch", message: string) {
    super(message);
    this.name = "TriggerError";
  }
}

export class TriggerService {
  constructor(private readonly options: {
    readonly store: TriggerStore;
    readonly execution: ExecutionDispatchPort;
    readonly now?: () => string;
    readonly createId?: () => string;
  }) {}

  async define(input: Omit<TriggerDefinition, "createdAt" | "updatedAt" | "version">): Promise<TriggerDefinition> {
    const previous = await this.options.store.getDefinition(input.id);
    const now = this.now();
    const definition: TriggerDefinition = {
      ...input,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      version: (previous?.version ?? 0) + 1,
    };
    await this.options.store.putDefinition(definition);
    return definition;
  }

  async occur(input: {
    readonly triggerId: string;
    readonly type: DromioTriggerOccurrenceV1["type"];
    readonly tenantId: string;
    readonly applicationId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly requestId: string;
    readonly commandId: string;
    readonly payload: DromioJsonObject;
  }): Promise<TriggerDispatchReceipt> {
    const replay = await this.options.store.getReceipt(input.tenantId, input.applicationId, input.idempotencyKey);
    if (replay) return { ...replay, replayed: true };
    const definition = await this.options.store.getDefinition(input.triggerId);
    if (!definition || definition.tenantId !== input.tenantId || definition.applicationId !== input.applicationId) throw new TriggerError("not_found", `Trigger ${input.triggerId} was not found.`);
    if (!definition.enabled) throw new TriggerError("disabled", `Trigger ${input.triggerId} is disabled.`);
    if (definition.type !== input.type) throw new TriggerError("type_mismatch", `Trigger ${input.triggerId} does not accept ${input.type} occurrences.`);

    const occurrence: DromioTriggerOccurrenceV1 = {
      schemaVersion: "dromio.trigger-occurrence.v1",
      id: this.options.createId?.() ?? `occurrence_${crypto.randomUUID()}`,
      type: input.type,
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      triggerId: input.triggerId,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      requestId: input.requestId,
      commandId: input.commandId,
      occurredAt: this.now(),
      payload: input.payload,
    };
    const run = await this.options.execution.enqueue({
      tenantId: input.tenantId,
      applicationId: input.applicationId,
      sourceType: definition.target.sourceType,
      sourceId: render(definition.target.sourceIdTemplate, input.payload),
      idempotencyKey: `${input.triggerId}:${input.idempotencyKey}`,
      correlationId: input.correlationId,
      requestId: input.requestId,
      commandId: input.commandId,
      ...(definition.target.queue ? { queue: definition.target.queue } : {}),
      ...(definition.target.priority !== undefined ? { priority: definition.target.priority } : {}),
      ...(definition.target.concurrencyKeyTemplate ? { concurrencyKey: render(definition.target.concurrencyKeyTemplate, input.payload) } : {}),
      payload: input.payload,
    });
    const receipt = { occurrence, runId: run.id, replayed: false };
    await this.options.store.putOccurrenceAndReceipt(occurrence, receipt);
    return receipt;
  }

  private now(): string { return this.options.now?.() ?? new Date().toISOString(); }
}

function render(template: string, payload: DromioJsonObject): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => {
    const value = payload[key];
    if (typeof value !== "string" && typeof value !== "number") throw new TriggerError("type_mismatch", `Template field ${key} must be a string or number.`);
    return String(value);
  });
}
