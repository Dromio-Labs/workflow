import type {
	DromioThreadEventType,
	DromioThreadEventV1,
	DromioThreadV1,
} from "@dromio/protocols";
import { ThreadServiceError } from "./errors.js";
import { provenance } from "./lineage.js";
import {
	assertVersion,
	commandDigest,
	makeReceipt,
	persistReceipt,
	replayReceipt,
	requireTransactionThread,
	scopeFrom,
	ThreadServiceKernel,
} from "./service-kernel.js";
import type {
	CreateThreadInput,
	ThreadCommandContext,
	ThreadListPage,
	ThreadListQuery,
	ThreadReceipt,
	ThreadScope,
	ThreadSnapshot,
	UpdateThreadInput,
	UserEventPage,
} from "./types.js";
import { normalizeLabels, validateThreadListQuery, validateThreadMetadata } from "./thread-metadata.js";

export class ThreadResourceService extends ThreadServiceKernel {
	async createThread(
		context: ThreadCommandContext,
		input: CreateThreadInput = {},
	): Promise<ThreadReceipt<DromioThreadV1>> {
		const scope = scopeFrom(context);
		validateThreadMetadata(input);
		await this.authorize("thread.create", context, scope);
		const digest = commandDigest("threads.create", input);

		return this.store.transaction(async (tx) => {
			const replay = await replayReceipt<DromioThreadV1>(
				tx,
				scope,
				context,
				"threads.create",
				digest,
			);
			if (replay) return replay;

			const now = this.clock.now();
			const threadId = this.ids.create("thread");
			if (await tx.getThread(threadId)) {
				throw new ThreadServiceError({
					code: "idempotency_conflict",
					message: `Thread ${threadId} already exists.`,
				});
			}
			const thread: DromioThreadV1 = {
				schemaVersion: "dromio.thread.v1",
				id: threadId,
				...scope,
				title: input.title?.trim() || "New chat",
				labels: normalizeLabels(input.labels),
				status: "active",
				createdBy: context.actor.subject,
				createdAt: now,
				updatedAt: now,
				version: 1,
				lastSequence: 1,
				lastItemOrdinal: 0,
				lastTurnOrdinal: 0,
				provenance: provenance(context, { threadId }),
				...(input.metadata ? { metadata: input.metadata } : {}),
				...(input.metadataSchema ? { metadataSchema: input.metadataSchema } : {}),
				...(input.metadataIndex ? { metadataIndex: input.metadataIndex } : {}),
			};
			await tx.putThread(thread);
			const event = await this.appendEvent(
				tx,
				thread,
				context,
				"thread.created",
				{ threadId },
			);
			const receipt = makeReceipt(context.commandId, thread, event, false);
			await persistReceipt(
				tx,
				scope,
				context,
				"threads.create",
				digest,
				receipt,
			);
			return receipt;
		});
	}

	getThread(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<ThreadSnapshot> {
		return this.snapshot(context, threadId);
	}

	async listThreads(
		context: ThreadCommandContext,
		query: Omit<ThreadListQuery, keyof ThreadScope> = {},
	): Promise<ThreadListPage> {
		const scope = scopeFrom(context);
		validateThreadListQuery(query);
		await this.authorize("thread.read", context, scope);
		const page = await this.store.listThreads({ ...query, ...scope });
		const visible: DromioThreadV1[] = [];
		for (const thread of page.data) {
			if (await this.canRead(context, scope, thread)) visible.push(thread);
		}
		const userStates = (
			await Promise.all(
				visible.map((thread) =>
					this.store.getUserState(scope, thread.id, context.actor.subject.id),
				),
			)
		).filter((state) => state !== undefined);
		return {
			data: visible,
			userStates,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
		};
	}

	async readThreadEvents(
		context: ThreadCommandContext,
		threadId: string,
		after = 0,
		limit = 500,
	): Promise<readonly DromioThreadEventV1[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("thread.read", context, scope, thread);
		await this.assertEventCursor(scope, { kind: "thread", threadId }, after);
		return this.store.readThreadEvents(
			scope,
			threadId,
			after,
			boundedLimit(limit),
		);
	}

	async readApplicationEvents(
		context: ThreadCommandContext,
		after = 0,
		limit = 500,
	): Promise<readonly DromioThreadEventV1[]> {
		return (await this.readApplicationEventPage(context, after, limit)).events;
	}

	async readApplicationEventPage(
		context: ThreadCommandContext,
		after = 0,
		limit = 500,
	): Promise<{
		readonly events: readonly DromioThreadEventV1[];
		readonly throughSequence: number;
		readonly hasMore: boolean;
	}> {
		const scope = scopeFrom(context);
		await this.authorize("thread.read", context, scope);
		await this.assertEventCursor(scope, { kind: "application" }, after);
		const bounded = boundedLimit(limit);
		const events = await this.store.readApplicationEvents(
			scope,
			after,
			bounded,
		);
		const visible: DromioThreadEventV1[] = [];
		for (const event of events) {
			const thread = await this.store.getThread(scope, event.threadId);
			if (thread && (await this.canRead(context, scope, thread))) {
				visible.push(event);
			}
		}
		return {
			events: visible,
			throughSequence: events.at(-1)?.applicationSequence ?? after,
			hasMore: events.length === bounded,
		};
	}

	async readUserEventPage(
		context: ThreadCommandContext,
		after = 0,
		limit = 500,
	): Promise<UserEventPage> {
		const scope = scopeFrom(context);
		const bounded = boundedLimit(limit);
		await this.assertEventCursor(scope, { kind: "user", userId: context.actor.subject.id }, after);
		const events = await this.store.readUserEvents(
			scope,
			context.actor.subject.id,
			after,
			bounded,
		);
		return {
			events,
			throughSequence: events.at(-1)?.sequence ?? after,
			hasMore: events.length === bounded,
		};
	}

	private async assertEventCursor(scope: ThreadScope, feed: { readonly kind: "application" } | { readonly kind: "thread"; readonly threadId: string } | { readonly kind: "user"; readonly userId: string }, after: number): Promise<void> {
		if (after === 0) return;
		const bounds = await this.store.readEventCursorBounds(scope, feed);
		if (after > bounds.latest || (bounds.oldest > 0 && after < bounds.oldest - 1)) {
			throw new ThreadServiceError({ code: "cursor_expired", message: "The event cursor is outside the retained event window." });
		}
	}

	updateThread(
		context: ThreadCommandContext,
		threadId: string,
		input: UpdateThreadInput,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		validateThreadMetadata(input);
		if (input.labels) normalizeLabels(input.labels);
		return this.mutateThread(
			context,
			threadId,
			"threads.update",
			"thread.update",
			input,
			(thread) => ({
				...thread,
				...(input.title !== undefined
					? { title: input.title.trim() || "New chat" }
					: {}),
				...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
				...(input.labels !== undefined ? { labels: normalizeLabels(input.labels) } : {}),
				...(input.metadataSchema !== undefined ? { metadataSchema: input.metadataSchema } : {}),
				...(input.metadataIndex !== undefined ? { metadataIndex: input.metadataIndex } : {}),
			}),
			"thread.updated",
		);
	}

	archiveThread(
		context: ThreadCommandContext,
		threadId: string,
		expectedVersion?: number,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		return this.mutateThread(
			context,
			threadId,
			"threads.archive",
			"thread.archive",
			{ expectedVersion },
			(thread) => ({ ...thread, status: "archived" }),
			"thread.archived",
		);
	}

	unarchiveThread(
		context: ThreadCommandContext,
		threadId: string,
		expectedVersion?: number,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		return this.mutateThread(
			context,
			threadId,
			"threads.unarchive",
			"thread.archive",
			{ expectedVersion },
			(thread) => ({ ...thread, status: "active" }),
			"thread.unarchived",
		);
	}

	private async mutateThread(
		context: ThreadCommandContext,
		threadId: string,
		commandName: string,
		action: "thread.update" | "thread.archive",
		input: UpdateThreadInput,
		mutate: (thread: DromioThreadV1) => DromioThreadV1,
		eventType: DromioThreadEventType,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		const scope = scopeFrom(context);
		const current = await this.requireThread(scope, threadId);
		await this.authorize(action, context, scope, current);
		const digest = commandDigest(commandName, { threadId, ...input });
		return this.store.transaction(async (tx) => {
			const replay = await replayReceipt<DromioThreadV1>(
				tx,
				scope,
				context,
				commandName,
				digest,
			);
			if (replay) return replay;
			const thread = await requireTransactionThread(tx, scope, threadId);
			assertVersion(thread, input.expectedVersion);
			const next = mutate({
				...thread,
				updatedAt: this.clock.now(),
				version: thread.version + 1,
			});
			const stored = await this.appendEventAndAdvance(
				tx,
				next,
				context,
				eventType,
				{ threadId },
			);
			await tx.putThread(stored);
			const receipt = makeReceipt(
				context.commandId,
				stored,
				{ sequence: stored.lastSequence, applicationSequence: undefined },
				false,
			);
			await persistReceipt(tx, scope, context, commandName, digest, receipt);
			return receipt;
		});
	}
}

function boundedLimit(limit: number): number {
	return Math.min(Math.max(limit, 1), 1_000);
}
