import type {
	DromioMessageItem,
	DromioThreadV1,
	DromioTurnV1,
} from "@dromio/protocols";
import { ThreadServiceError } from "./errors.js";
import { assertExecutionFence } from "./execution-fence.js";
import { correlation, provenance } from "./lineage.js";
import type { ThreadTransaction } from "./ports.js";
import { titleFromFirstMessage } from "./thread-title.js";
import {
	allowedTransition,
	assertVersion,
	commandDigest,
	eventForTurnStatus,
	isTerminal,
	makeReceipt,
	persistReceipt,
	replayReceipt,
	requireTransactionThread,
	scopeFrom,
	ThreadServiceKernel,
} from "./service-kernel.js";
import type {
	CreateTurnInput,
	ThreadCommandContext,
	ThreadReceipt,
	ThreadScope,
	TransitionTurnInput,
} from "./types.js";

export class ThreadTurnService extends ThreadServiceKernel {
	async createTurn(
		context: ThreadCommandContext,
		input: CreateTurnInput,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		const scope = scopeFrom(context);
		const current = await this.requireThread(scope, input.threadId);
		await this.authorize("turn.create", context, scope, current);
		const digest = commandDigest("turns.create", input);

		return this.store.transaction(async (tx) => {
			const replay = await replayReceipt<DromioTurnV1>(
				tx,
				scope,
				context,
				"turns.create",
				digest,
			);
			if (replay) return replay;
			const thread = await requireTransactionThread(tx, scope, input.threadId);
			assertVersion(thread, input.expectedVersion);
			if (thread.status !== "active") {
				throw new ThreadServiceError({
					code: "validation_failed",
					message: "Turns can only be created in active threads.",
				});
			}

			const now = this.clock.now();
			const itemId = this.ids.create("item");
			const turnId = this.ids.create("turn");
			const priorTurns = await tx.listTurns(thread.id);
			const eligible = priorTurns.every((turn) => isTerminal(turn.status));
			const generatedTitle =
				thread.title === "New chat" && priorTurns.length === 0
					? titleFromFirstMessage(input.content)
					: undefined;
			const itemOrdinal = thread.lastItemOrdinal + 1;
			const turnOrdinal = thread.lastTurnOrdinal + 1;
			await tx.putItem({
				id: itemId,
				threadId: thread.id,
				turnId,
				ordinal: itemOrdinal,
				createdAt: now,
				createdBy: context.actor.subject,
				type: "message",
				role: "user",
				author: context.actor.subject,
				content: input.content,
				status: "completed",
				revision: 1,
				contextVisibility: "model_and_user",
				provenance: provenance(context, {
					threadId: thread.id,
					turnId,
					itemId,
				}),
			});
			await tx.putMessageRevision({
				id: this.ids.create("revision"),
				messageId: itemId,
				revision: 1,
				content: input.content,
				createdAt: now,
				createdBy: context.actor.subject,
				reason: "creation",
			});
			const turn: DromioTurnV1 = {
				schemaVersion: "dromio.turn.v1",
				id: turnId,
				threadId: thread.id,
				ordinal: turnOrdinal,
				status: eligible ? "eligible" : "queued",
				inputItemIds: [itemId],
				...(input.modelSelection
					? { modelSelection: input.modelSelection }
					: {}),
				createdBy: context.actor.subject,
				createdAt: now,
				updatedAt: now,
				version: 1,
				provenance: provenance(context, {
					threadId: thread.id,
					turnId,
					itemId,
				}),
				...(input.retryOfTurnId ? { retryOfTurnId: input.retryOfTurnId } : {}),
				...(input.regeneratedFromTurnId
					? { regeneratedFromTurnId: input.regeneratedFromTurnId }
					: {}),
			};
			await tx.putTurn(turn);

			let nextThread: DromioThreadV1 = {
				...thread,
				...(generatedTitle ? { title: generatedTitle } : {}),
				lastItemOrdinal: itemOrdinal,
				lastTurnOrdinal: turnOrdinal,
				updatedAt: now,
				version: thread.version + 1,
			};
			if (generatedTitle) {
				nextThread = await this.appendEventAndAdvance(
					tx,
					nextThread,
					context,
					"thread.updated",
					{ threadId: thread.id },
				);
			}
			nextThread = await this.appendEventAndAdvance(
				tx,
				nextThread,
				context,
				"item.created",
				{ itemId, turnId },
			);
			nextThread = await this.appendEventAndAdvance(
				tx,
				nextThread,
				context,
				"turn.queued",
				{ turnId, ordinal: turnOrdinal },
			);
			if (eligible) {
				nextThread = await this.appendEventAndAdvance(
					tx,
					nextThread,
					context,
					"turn.eligible",
					{ turnId, ordinal: turnOrdinal },
				);
				await this.appendExecutionOutbox(
					tx,
					scope,
					nextThread,
					turn,
					now,
					context,
				);
			}
			await tx.putThread(nextThread);
			const receipt = makeReceipt(
				context.commandId,
				turn,
				{ sequence: nextThread.lastSequence, applicationSequence: undefined },
				false,
			);
			await persistReceipt(tx, scope, context, "turns.create", digest, receipt);
			return receipt;
		});
	}

	listTurns(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioTurnV1[]> {
		return this.listAuthorizedTurns(context, threadId);
	}

	getTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<DromioTurnV1> {
		return this.getAuthorizedTurn(context, threadId, turnId);
	}

	async cancelTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		const turn = await this.getAuthorizedTurn(context, threadId, turnId);
		if (turn.status === "cancelled") {
			return makeReceipt(
				context.commandId,
				turn,
				{
					sequence: (await this.snapshot(context, threadId)).thread
						.lastSequence,
					applicationSequence: undefined,
				},
				true,
			);
		}
		if (turn.status === "completed" || turn.status === "failed") {
			throw new ThreadServiceError({
				code: "validation_failed",
				message: `Terminal turn ${turnId} cannot be cancelled.`,
			});
		}
		return this.transitionTurn(context, {
			threadId,
			turnId,
			status:
				turn.status === "queued" || turn.status === "eligible"
					? "cancelled"
					: "cancelling",
			statusReason: "user_cancelled",
		});
	}

	retryTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		return this.createDerivedTurn(context, threadId, turnId, "retry");
	}

	regenerateTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		return this.createDerivedTurn(context, threadId, turnId, "regenerate");
	}

	async transitionTurn(
		context: ThreadCommandContext,
		input: TransitionTurnInput,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		const scope = scopeFrom(context);
		const current = await this.requireThread(scope, input.threadId);
		await this.authorize("turn.control", context, scope, current);
		const digest = commandDigest("turns.transition", input);
		return this.store.transaction(async (tx) => {
			const replay = await replayReceipt<DromioTurnV1>(
				tx,
				scope,
				context,
				"turns.transition",
				digest,
			);
			if (replay) return replay;
			let thread = await requireTransactionThread(tx, scope, input.threadId);
			assertVersion(thread, input.expectedVersion);
			const turns = await tx.listTurns(thread.id);
			const turn = turns.find((candidate) => candidate.id === input.turnId);
			if (!turn) {
				throw new ThreadServiceError({
					code: "resource_not_found",
					message: `Turn ${input.turnId} was not found.`,
				});
			}
			if (!allowedTransition(turn.status, input.status)) {
				throw new ThreadServiceError({
					code: "validation_failed",
					message: `Turn cannot transition from ${turn.status} to ${input.status}.`,
				});
			}
			const now = this.clock.now();
			if (context.execution) {
				assertExecutionFence(
					turn,
					context,
					now,
					input.status === "running" ? "claim" : "current",
				);
			}
			const updated: DromioTurnV1 = {
				...turn,
				status: input.status,
				updatedAt: now,
				version: turn.version + 1,
				...(input.statusReason ? { statusReason: input.statusReason } : {}),
				...(input.executionRunId
					? { executionRunId: input.executionRunId }
					: {}),
				...(context.execution
					? {
							executionRunId: context.execution.runId,
							executionAttemptId: context.execution.attemptId,
							executionFencingToken: context.execution.fencingToken,
						}
					: {}),
			};
			await tx.putTurn(updated);
			thread = { ...thread, updatedAt: now, version: thread.version + 1 };
			thread = await this.appendEventAndAdvance(
				tx,
				thread,
				context,
				eventForTurnStatus(input.status),
				{
					turnId: turn.id,
					ordinal: turn.ordinal,
					...(input.statusReason ? { reason: input.statusReason } : {}),
				},
			);

			if (input.status === "cancelling") {
				await tx.appendOutbox({
					id: this.ids.create("outbox"),
					topic: "execution.commands",
					aggregateId: thread.id,
					payload: {
						schemaVersion: "dromio.execution-command.v1",
						...correlation(context),
						operation: "cancel_thread_turn",
						...scope,
						threadId: thread.id,
						turnId: turn.id,
						turnOrdinal: turn.ordinal,
						generation: updated.version,
						createdAt: now,
					},
					createdAt: now,
					attempts: 0,
				});
			}

			if (isTerminal(input.status)) {
				thread = await this.eligibilizeNext(
					tx,
					scope,
					thread,
					turns,
					turn,
					now,
					context,
				);
			}
			await tx.putThread(thread);
			const receipt = makeReceipt(
				context.commandId,
				updated,
				{ sequence: thread.lastSequence, applicationSequence: undefined },
				false,
			);
			await persistReceipt(
				tx,
				scope,
				context,
				"turns.transition",
				digest,
				receipt,
			);
			return receipt;
		});
	}

	private async createDerivedTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
		mode: "retry" | "regenerate",
	): Promise<ThreadReceipt<DromioTurnV1>> {
		const snapshot = await this.snapshot(context, threadId);
		const source = snapshot.turns.find((turn) => turn.id === turnId);
		if (!source) {
			throw new ThreadServiceError({
				code: "resource_not_found",
				message: `Turn ${turnId} was not found.`,
			});
		}
		const message = snapshot.items.find(
			(item): item is DromioMessageItem =>
				item.type === "message" &&
				item.role === "user" &&
				source.inputItemIds.includes(item.id),
		);
		if (!message) {
			throw new ThreadServiceError({
				code: "validation_failed",
				message: `Turn ${turnId} has no retryable user input.`,
			});
		}
		return this.createTurn(context, {
			threadId,
			content: message.content,
			...(mode === "retry"
				? { retryOfTurnId: turnId }
				: { regeneratedFromTurnId: turnId }),
		});
	}

	private async eligibilizeNext(
		tx: ThreadTransaction,
		scope: ThreadScope,
		thread: DromioThreadV1,
		turns: readonly DromioTurnV1[],
		completed: DromioTurnV1,
		now: string,
		context: ThreadCommandContext,
	): Promise<DromioThreadV1> {
		const next = turns
			.filter(
				(candidate) =>
					candidate.status === "queued" &&
					candidate.ordinal > completed.ordinal,
			)
			.sort((left, right) => left.ordinal - right.ordinal)[0];
		if (!next) return thread;
		const eligible = {
			...next,
			status: "eligible" as const,
			updatedAt: now,
			version: next.version + 1,
		};
		await tx.putTurn(eligible);
		const advanced = await this.appendEventAndAdvance(
			tx,
			thread,
			context,
			"turn.eligible",
			{ turnId: eligible.id, ordinal: eligible.ordinal },
		);
		await this.appendExecutionOutbox(
			tx,
			scope,
			advanced,
			eligible,
			now,
			context,
		);
		return advanced;
	}
}
