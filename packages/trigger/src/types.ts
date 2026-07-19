import type { DromioJsonObject, DromioTriggerOccurrenceV1 } from "@dromio/protocols";

export interface TriggerDefinition {
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly type: DromioTriggerOccurrenceV1["type"];
  readonly enabled: boolean;
  readonly target: TriggerTarget;
  readonly config: DromioJsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface TriggerTarget {
  readonly sourceType: "thread_turn" | "workflow" | "task";
  readonly sourceIdTemplate: string;
  readonly queue?: string;
  readonly priority?: number;
  readonly concurrencyKeyTemplate?: string;
}

export interface TriggerDispatchReceipt {
  readonly occurrence: DromioTriggerOccurrenceV1;
  readonly runId: string;
  readonly replayed: boolean;
}

export interface TriggerStore {
  putDefinition(definition: TriggerDefinition): Promise<void>;
  getDefinition(id: string): Promise<TriggerDefinition | undefined>;
  getReceipt(tenantId: string, applicationId: string, idempotencyKey: string): Promise<TriggerDispatchReceipt | undefined>;
  putOccurrenceAndReceipt(occurrence: DromioTriggerOccurrenceV1, receipt: TriggerDispatchReceipt): Promise<void>;
}

export interface ExecutionDispatchPort {
  enqueue(input: {
    readonly tenantId: string;
    readonly applicationId: string;
    readonly sourceType: TriggerTarget["sourceType"];
    readonly sourceId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly requestId: string;
    readonly commandId: string;
    readonly queue?: string;
    readonly priority?: number;
    readonly concurrencyKey?: string;
    readonly payload?: DromioJsonObject;
  }): Promise<{ readonly id: string }>;
}

export class MemoryTriggerStore implements TriggerStore {
  private readonly definitions = new Map<string, TriggerDefinition>();
  private readonly receipts = new Map<string, TriggerDispatchReceipt>();

  async putDefinition(definition: TriggerDefinition): Promise<void> { this.definitions.set(definition.id, structuredClone(definition)); }
  async getDefinition(id: string): Promise<TriggerDefinition | undefined> { return structuredClone(this.definitions.get(id)); }
  async getReceipt(tenantId: string, applicationId: string, key: string): Promise<TriggerDispatchReceipt | undefined> { return structuredClone(this.receipts.get(`${tenantId}\u0000${applicationId}\u0000${key}`)); }
  async putOccurrenceAndReceipt(occurrence: DromioTriggerOccurrenceV1, receipt: TriggerDispatchReceipt): Promise<void> { this.receipts.set(`${occurrence.tenantId}\u0000${occurrence.applicationId}\u0000${occurrence.idempotencyKey}`, structuredClone(receipt)); }
}
