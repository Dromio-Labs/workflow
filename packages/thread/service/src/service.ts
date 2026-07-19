import type {
	DromioAuditRecordV1,
	DromioInteractionRequestV1,
	DromioLegalHoldV1,
	DromioMessageRevision,
	DromioPurgeReceiptV1,
	DromioRetentionPolicyV1,
	DromioThreadAccessGrantV1,
	DromioThreadDraftV1,
	DromioThreadEventV1,
	DromioThreadExportV1,
	DromioThreadItemV1,
	DromioThreadShareLinkV1,
	DromioThreadV1,
	DromioTurnV1,
	DromioUsageRecordV1,
	DromioUserThreadStateV1,
} from "@dromio/protocols";
import { ThreadAssistantOutputService } from "./assistant-output.js";
import { ThreadCompletenessService } from "./completeness.js";
import { ThreadServiceError } from "./errors.js";
import { ThreadGovernanceService } from "./governance.js";
import { ThreadGovernanceQueryService } from "./governance-queries.js";
import { ThreadLifecycleService } from "./lifecycle.js";
import { createThreadAccessPolicy } from "./access-policy.js";
import type { ThreadServiceOptions } from "./service-kernel.js";
import { ThreadSteeringService } from "./steering.js";
import { ThreadResourceService } from "./thread-resources.js";
import { ThreadToolService } from "./tools.js";
import { ThreadTurnService } from "./turn-service.js";
import type {
	AppendAssistantOutputInput,
	CompleteToolCallInput,
	CreateExportInput,
	CreateInteractionInput,
	CreateShareLinkInput,
	CreateThreadInput,
	CreateTurnInput,
	ForkThreadInput,
	GrantThreadAccessInput,
	MigrateMessageInput,
	PlaceLegalHoldInput,
	ResolveInteractionInput,
	ReviseMessageInput,
	SaveDraftInput,
	SetRetentionPolicyInput,
	StartToolCallInput,
	SteerTurnInput,
	ThreadCommandContext,
	ThreadListPage,
	ThreadListQuery,
	ThreadReceipt,
	ThreadScope,
	ThreadSnapshot,
	TransitionTurnInput,
	UpdateThreadInput,
	UpdateUserThreadStateInput,
	UserEventPage,
} from "./types.js";

export type { ThreadServiceOptions } from "./service-kernel.js";

export class ThreadService {
	private readonly governance: ThreadGovernanceService;
	private readonly governanceQueries: ThreadGovernanceQueryService;
	private readonly lifecycle: ThreadLifecycleService;
	private readonly completeness: ThreadCompletenessService;
	private readonly steering: ThreadSteeringService;
	private readonly tools: ThreadToolService;
	private readonly resources: ThreadResourceService;
	private readonly turns: ThreadTurnService;
	private readonly output: ThreadAssistantOutputService;
	readonly steeringSupported: boolean;

	constructor(options: ThreadServiceOptions) {
		const dependencies = {
			...options,
			policy: options.policy ?? createThreadAccessPolicy(options.store),
			clock: options.clock ?? { now: () => new Date().toISOString() },
			ids:
				options.ids ??
				({ create: (kind) => `${kind}_${crypto.randomUUID()}` } as const),
		};
		this.governance = new ThreadGovernanceService(dependencies);
		this.governanceQueries = new ThreadGovernanceQueryService(dependencies);
		this.lifecycle = new ThreadLifecycleService(dependencies);
		this.completeness = new ThreadCompletenessService(dependencies);
		this.steeringSupported = options.steeringSupported ?? false;
		this.steering = new ThreadSteeringService({
			...dependencies,
			supported: this.steeringSupported,
		});
		this.tools = new ThreadToolService(dependencies);
		this.resources = new ThreadResourceService(dependencies);
		this.turns = new ThreadTurnService(dependencies);
		this.output = new ThreadAssistantOutputService(dependencies);
	}

	createInteraction(
		context: ThreadCommandContext,
		input: CreateInteractionInput,
	): Promise<ThreadReceipt<DromioInteractionRequestV1>> {
		return this.governance.createInteraction(context, input);
	}

	resolveInteraction(
		context: ThreadCommandContext,
		input: ResolveInteractionInput,
	): Promise<ThreadReceipt<DromioInteractionRequestV1>> {
		return this.governance.resolveInteraction(context, input);
	}

	expireInteraction(
		context: ThreadCommandContext,
		interactionId: string,
	): Promise<boolean> {
		return this.governance.expireInteraction(context, interactionId);
	}

	async reviseMessage(
		context: ThreadCommandContext,
		input: ReviseMessageInput,
	): Promise<ThreadReceipt<DromioThreadItemV1>> {
		const snapshot = await this.getThread(context, input.threadId);
		const message = snapshot.items.find(
			(item) => item.id === input.messageId && item.type === "message",
		);
		if (
			!message ||
			message.type !== "message" ||
			message.role !== "user" ||
			!message.turnId
		) {
			throw new ThreadServiceError({
				code: "validation_failed",
				message: "Only user input messages can be edited.",
			});
		}
		const turn = snapshot.turns.find(
			(candidate) => candidate.id === message.turnId,
		);
		if (!turn) {
			throw new ThreadServiceError({
				code: "resource_not_found",
				message: `Turn ${message.turnId} was not found.`,
			});
		}
		return turn.status === "queued"
			? this.governance.reviseMessage(context, input)
			: this.lifecycle.editFork(context, input);
	}

	migrateMessage(
		context: ThreadCommandContext,
		input: MigrateMessageInput,
	): Promise<ThreadReceipt<DromioThreadItemV1>> {
		return this.governance.reviseMessage(context, input, "migration");
	}

	redactMessage(
		context: ThreadCommandContext,
		input: ReviseMessageInput,
	): Promise<ThreadReceipt<DromioThreadItemV1>> {
		return this.governance.reviseMessage(context, input, "redact");
	}

	withdrawMessage(
		context: ThreadCommandContext,
		input: ReviseMessageInput,
	): Promise<ThreadReceipt<DromioThreadItemV1>> {
		return this.governance.reviseMessage(context, input, "withdraw");
	}

	deleteMessage(
		context: ThreadCommandContext,
		input: ReviseMessageInput,
	): Promise<ThreadReceipt<DromioThreadItemV1>> {
		return this.governance.reviseMessage(context, input, "delete");
	}

	grantAccess(
		context: ThreadCommandContext,
		input: GrantThreadAccessInput,
	): Promise<ThreadReceipt<DromioThreadAccessGrantV1>> {
		return this.governance.grantAccess(context, input);
	}

	updateUserState(
		context: ThreadCommandContext,
		threadId: string,
		input: UpdateUserThreadStateInput,
	): Promise<ThreadReceipt<DromioUserThreadStateV1>> {
		return this.governance.updateUserState(context, threadId, input);
	}

	forkThread(
		context: ThreadCommandContext,
		input: ForkThreadInput,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		return this.lifecycle.fork(context, input);
	}

	getThreadAncestry(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioThreadV1[]> {
		return this.lifecycle.ancestry(context, threadId);
	}

	async listThreadChildren(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioThreadV1[]> {
		return this.governanceQueries.readableThreads(
			context,
			await this.lifecycle.children(context, threadId),
		);
	}

	createShareLink(
		context: ThreadCommandContext,
		input: CreateShareLinkInput,
	): Promise<ThreadReceipt<DromioThreadShareLinkV1>> {
		return this.completeness.createShareLink(context, input);
	}

	revokeAccess(
		context: ThreadCommandContext,
		threadId: string,
		resourceId: string,
	): Promise<
		ThreadReceipt<DromioThreadAccessGrantV1 | DromioThreadShareLinkV1>
	> {
		return this.completeness.revokeAccess(context, threadId, resourceId);
	}

	saveDraft(
		context: ThreadCommandContext,
		input: SaveDraftInput,
	): Promise<ThreadReceipt<DromioThreadDraftV1>> {
		return this.completeness.saveDraft(context, input);
	}

	deleteDraft(context: ThreadCommandContext, threadId: string): Promise<void> {
		return this.completeness.deleteDraft(context, threadId);
	}

	createExport(
		context: ThreadCommandContext,
		input: CreateExportInput,
	): Promise<ThreadReceipt<DromioThreadExportV1>> {
		return this.completeness.createExport(context, input);
	}

	setRetentionPolicy(
		context: ThreadCommandContext,
		input: SetRetentionPolicyInput,
	): Promise<ThreadReceipt<DromioRetentionPolicyV1>> {
		return this.completeness.setRetentionPolicy(context, input);
	}

	placeLegalHold(
		context: ThreadCommandContext,
		input: PlaceLegalHoldInput,
	): Promise<ThreadReceipt<DromioLegalHoldV1>> {
		return this.completeness.placeLegalHold(context, input);
	}

	releaseLegalHold(
		context: ThreadCommandContext,
		threadId: string,
		holdId: string,
	): Promise<ThreadReceipt<DromioLegalHoldV1>> {
		return this.completeness.releaseLegalHold(context, threadId, holdId);
	}

	deleteThread(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		return this.completeness.requestDeletion(context, threadId);
	}

	purgeThread(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<ThreadReceipt<DromioPurgeReceiptV1>> {
		return this.completeness.purge(context, threadId);
	}

	getDraft(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<DromioThreadDraftV1 | undefined> {
		return this.governanceQueries.getDraft(context, threadId);
	}

	listAccess(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioThreadAccessGrantV1[]> {
		return this.governanceQueries.listAccess(context, threadId);
	}

	listShareLinks(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioThreadShareLinkV1[]> {
		return this.governanceQueries.listShareLinks(context, threadId);
	}

	getUserState(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<DromioUserThreadStateV1 | undefined> {
		return this.governanceQueries.getUserState(context, threadId);
	}

	listMessageRevisions(
		context: ThreadCommandContext,
		threadId: string,
		messageId: string,
	): Promise<readonly DromioMessageRevision[]> {
		return this.governanceQueries.listMessageRevisions(
			context,
			threadId,
			messageId,
		);
	}

	listExports(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioThreadExportV1[]> {
		return this.governanceQueries.listExports(context, threadId);
	}

	getRetentionPolicy(
		context: ThreadCommandContext,
	): Promise<DromioRetentionPolicyV1 | undefined> {
		return this.governanceQueries.getRetentionPolicy(context);
	}

	listLegalHolds(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioLegalHoldV1[]> {
		return this.governanceQueries.listLegalHolds(context, threadId);
	}

	getPurgeReceipt(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<DromioPurgeReceiptV1 | undefined> {
		return this.governanceQueries.getPurgeReceipt(context, threadId);
	}

	listAudit(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioAuditRecordV1[]> {
		return this.governanceQueries.listAudit(context, threadId);
	}

	listUsage(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioUsageRecordV1[]> {
		return this.governanceQueries.listUsage(context, threadId);
	}

	recordUsage(
		context: ThreadCommandContext,
		input: Omit<
			DromioUsageRecordV1,
			| "schemaVersion"
			| "id"
			| "tenantId"
			| "applicationId"
			| "correlationId"
			| "occurredAt"
		>,
	): Promise<DromioUsageRecordV1> {
		return this.completeness.recordUsage(context, input);
	}

	steerTurn(
		context: ThreadCommandContext,
		input: SteerTurnInput,
	): Promise<ThreadReceipt<DromioThreadItemV1>> {
		return this.steering.steer(context, input);
	}

	startToolCall(context: ThreadCommandContext, input: StartToolCallInput) {
		return this.tools.start(context, input);
	}

	completeToolCall(
		context: ThreadCommandContext,
		input: CompleteToolCallInput,
	) {
		return this.tools.complete(context, input);
	}

	createThread(
		context: ThreadCommandContext,
		input: CreateThreadInput = {},
	): Promise<ThreadReceipt<DromioThreadV1>> {
		return this.resources.createThread(context, input);
	}

	getThread(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<ThreadSnapshot> {
		return this.resources.getThread(context, threadId);
	}

	listThreads(
		context: ThreadCommandContext,
		query: Omit<ThreadListQuery, keyof ThreadScope> = {},
	): Promise<ThreadListPage> {
		return this.resources.listThreads(context, query);
	}

	readThreadEvents(
		context: ThreadCommandContext,
		threadId: string,
		after = 0,
		limit = 500,
	): Promise<readonly DromioThreadEventV1[]> {
		return this.resources.readThreadEvents(context, threadId, after, limit);
	}

	readApplicationEvents(
		context: ThreadCommandContext,
		after = 0,
		limit = 500,
	): Promise<readonly DromioThreadEventV1[]> {
		return this.resources.readApplicationEvents(context, after, limit);
	}

	readApplicationEventPage(
		context: ThreadCommandContext,
		after = 0,
		limit = 500,
	): Promise<{
		readonly events: readonly DromioThreadEventV1[];
		readonly throughSequence: number;
		readonly hasMore: boolean;
	}> {
		return this.resources.readApplicationEventPage(context, after, limit);
	}

	readUserEventPage(
		context: ThreadCommandContext,
		after = 0,
		limit = 500,
	): Promise<UserEventPage> {
		return this.resources.readUserEventPage(context, after, limit);
	}

	updateThread(
		context: ThreadCommandContext,
		threadId: string,
		input: UpdateThreadInput,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		return this.resources.updateThread(context, threadId, input);
	}

	archiveThread(
		context: ThreadCommandContext,
		threadId: string,
		expectedVersion?: number,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		return this.resources.archiveThread(context, threadId, expectedVersion);
	}

	unarchiveThread(
		context: ThreadCommandContext,
		threadId: string,
		expectedVersion?: number,
	): Promise<ThreadReceipt<DromioThreadV1>> {
		return this.resources.unarchiveThread(context, threadId, expectedVersion);
	}

	createTurn(
		context: ThreadCommandContext,
		input: CreateTurnInput,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		return this.turns.createTurn(context, input);
	}

	listTurns(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioTurnV1[]> {
		return this.turns.listTurns(context, threadId);
	}

	getTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<DromioTurnV1> {
		return this.turns.getTurn(context, threadId, turnId);
	}

	cancelTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		return this.turns.cancelTurn(context, threadId, turnId);
	}

	retryTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		return this.turns.retryTurn(context, threadId, turnId);
	}

	regenerateTurn(
		context: ThreadCommandContext,
		threadId: string,
		turnId: string,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		return this.turns.regenerateTurn(context, threadId, turnId);
	}

	transitionTurn(
		context: ThreadCommandContext,
		input: TransitionTurnInput,
	): Promise<ThreadReceipt<DromioTurnV1>> {
		return this.turns.transitionTurn(context, input);
	}

	appendAssistantOutput(
		context: ThreadCommandContext,
		input: AppendAssistantOutputInput,
	): Promise<ThreadReceipt<DromioThreadItemV1>> {
		return this.output.appendAssistantOutput(context, input);
	}
}
