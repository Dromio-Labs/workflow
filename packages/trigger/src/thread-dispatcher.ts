import type { ExecutionService } from "@dromio/execution";
import type { DromioJsonObject, DromioJsonValue } from "@dromio/protocols";
import type { ThreadStore } from "@dromio/thread-service";
import type { TriggerService } from "./service.js";

export class ThreadExecutionDispatcher {
	constructor(
		private readonly options: {
			readonly store: ThreadStore;
			readonly triggers: TriggerService;
			readonly execution: ExecutionService;
			readonly admission?: ThreadExecutionAdmissionPort;
			readonly now?: () => string;
		},
	) {}
	async dispatchPending(limit = 100): Promise<number> {
		let count = 0;
		for (const entry of await this.options.store.readOutbox(
			limit,
			"execution.commands",
		)) {
			await this.dispatch(entry.payload);
			await this.options.store.markOutboxPublished(
				entry.id,
				this.options.now?.() ?? new Date().toISOString(),
			);
			count += 1;
		}
		return count;
	}
	private async dispatch(payload: DromioJsonObject): Promise<void> {
		const operation = string(payload.operation, "operation");
		const tenantId = string(payload.tenantId, "tenantId");
		const applicationId = string(payload.applicationId, "applicationId");
		const threadId = string(payload.threadId, "threadId");
		const turnId = string(payload.turnId, "turnId");
		if (operation === "execute_thread_turn") {
			const modelSelection = optionalRecord(payload.modelSelection, "modelSelection");
			await this.options.admission?.authorize({ tenantId, applicationId });
			const triggerId = `${tenantId}:${applicationId}:chat`;
			await this.options.triggers.define({
				id: triggerId,
				tenantId,
				applicationId,
				type: "chat",
				enabled: true,
				target: {
					sourceType: "thread_turn",
					sourceIdTemplate: "{turnId}",
					concurrencyKeyTemplate: "{threadId}",
				},
				config: {},
			});
			await this.options.triggers.occur({
				triggerId,
				type: "chat",
				tenantId,
				applicationId,
				idempotencyKey: string(payload.commandId, "commandId"),
				correlationId: string(payload.correlationId, "correlationId"),
				requestId: string(payload.requestId, "requestId"),
				commandId: string(payload.commandId, "commandId"),
				payload: {
					threadId,
					turnId,
					...(modelSelection ? { modelSelection } : {}),
				},
			});
			return;
		}
		const run = (await this.options.execution.listRuns()).find(
			(value) =>
				value.payload?.threadId === threadId &&
				value.payload?.turnId === turnId &&
				!["completed", "failed", "cancelled"].includes(value.status),
		);
		if (!run) return;
		if (operation === "cancel_thread_turn") {
			await this.options.execution.cancel(run.id);
			return;
		}
		if (operation === "resume_thread_turn") {
			await this.options.execution.resume(
				run.id,
				string(payload.interactionId, "interactionId"),
			);
			return;
		}
		if (operation === "steer_thread_turn") {
			await this.options.execution.signal(run.id, {
				commandId: string(payload.commandId, "commandId"),
				type: "steer",
				payload: record(payload.payload, "payload"),
			});
			return;
		}
		throw new Error(`Unsupported execution operation ${operation}.`);
	}
}
function string(value: DromioJsonValue | undefined, name: string): string {
	if (typeof value !== "string" || !value)
		throw new Error(`Execution command is missing ${name}.`);
	return value;
}
function record(
	value: DromioJsonValue | undefined,
	name: string,
): DromioJsonObject {
	if (!isRecord(value))
		throw new Error(`Execution command is missing ${name}.`);
	return value;
}
function optionalRecord(
	value: DromioJsonValue | undefined,
	name: string,
): DromioJsonObject | undefined {
	return value === undefined ? undefined : record(value, name);
}
function isRecord(
	value: DromioJsonValue | undefined,
): value is DromioJsonObject {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
export interface ThreadExecutionAdmissionPort {
	authorize(scope: {
		readonly tenantId: string;
		readonly applicationId: string;
	}): Promise<void>;
}
