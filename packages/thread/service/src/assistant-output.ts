import type { DromioMessageItem, DromioThreadItemV1 } from "@dromio/protocols";
import { appendText } from "./content.js";
import { ThreadServiceError } from "./errors.js";
import { assertExecutionFence } from "./execution-fence.js";
import { provenance } from "./lineage.js";
import {
	commandDigest,
	makeReceipt,
	persistReceipt,
	replayReceipt,
	requireTransactionThread,
	scopeFrom,
	ThreadServiceKernel,
} from "./service-kernel.js";
import type {
	AppendAssistantOutputInput,
	ThreadCommandContext,
	ThreadReceipt,
} from "./types.js";

export class ThreadAssistantOutputService extends ThreadServiceKernel {
	async appendAssistantOutput(
		context: ThreadCommandContext,
		input: AppendAssistantOutputInput,
	): Promise<ThreadReceipt<DromioThreadItemV1>> {
		const scope = scopeFrom(context);
		const current = await this.requireThread(scope, input.threadId);
		await this.authorize("turn.control", context, scope, current);
		const digest = commandDigest("items.append_assistant_output", input);
		return this.store.transaction(async (tx) => {
			const replay = await replayReceipt<DromioThreadItemV1>(
				tx,
				scope,
				context,
				"items.append_assistant_output",
				digest,
			);
			if (replay) return replay;
			let thread = await requireTransactionThread(tx, scope, input.threadId);
			const turns = await tx.listTurns(thread.id);
			const turn = turns.find((candidate) => candidate.id === input.turnId);
			if (
				!turn ||
				(turn.status !== "running" &&
					turn.status !== "waiting_for_approval" &&
					turn.status !== "waiting_for_input")
			) {
				throw new ThreadServiceError({
					code: "validation_failed",
					message: "Assistant output requires an active turn.",
				});
			}
			const items = await tx.listItems(thread.id);
			const existing = items.find(
				(item): item is DromioMessageItem =>
					item.type === "message" &&
					item.role === "assistant" &&
					item.turnId === turn.id &&
					(!input.messageId || item.id === input.messageId),
			);
			const now = this.clock.now();
			if (context.execution) {
				assertExecutionFence(turn, context, now, "current");
			}
			const message: DromioMessageItem = existing
				? {
						...existing,
						content: appendText(existing.content, input.text),
						status: input.final ? "completed" : "in_progress",
						revision: existing.revision + 1,
					}
				: {
						id: input.messageId ?? this.ids.create("item"),
						threadId: thread.id,
						turnId: turn.id,
						ordinal: thread.lastItemOrdinal + 1,
						createdAt: now,
						createdBy: context.actor.subject,
						provenance: provenance(context, {
							threadId: thread.id,
							turnId: turn.id,
						}),
						type: "message",
						role: "assistant",
						author: context.actor.subject,
						content: [{ type: "text", text: input.text }],
						status: input.final ? "completed" : "in_progress",
						revision: 1,
						contextVisibility: "model_and_user",
					};
			await tx.putItem(message);
			thread = {
				...thread,
				lastItemOrdinal: Math.max(thread.lastItemOrdinal, message.ordinal),
				updatedAt: now,
				version: thread.version + 1,
			};
			thread = await this.appendEventAndAdvance(
				tx,
				thread,
				context,
				input.final ? "item.revised" : "message.output_text.delta",
				{
					messageId: message.id,
					turnId: turn.id,
					text: input.text,
					revision: message.revision,
				},
			);
			await tx.putThread(thread);
			const receipt = makeReceipt(
				context.commandId,
				message,
				{ sequence: thread.lastSequence, applicationSequence: undefined },
				false,
			);
			await persistReceipt(
				tx,
				scope,
				context,
				"items.append_assistant_output",
				digest,
				receipt,
			);
			return receipt;
		});
	}
}
