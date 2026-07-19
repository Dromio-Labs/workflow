import type {
	DromioAuditRecordV1,
	DromioLegalHoldV1,
	DromioMessageRevision,
	DromioPurgeReceiptV1,
	DromioRetentionPolicyV1,
	DromioThreadAccessGrantV1,
	DromioThreadDraftV1,
	DromioThreadExportV1,
	DromioThreadShareLinkV1,
	DromioThreadV1,
	DromioUsageRecordV1,
	DromioUserThreadStateV1,
} from "@dromio/protocols";
import { scopeFrom, ThreadServiceKernel } from "./service-kernel.js";
import type { ThreadCommandContext } from "./types.js";

export class ThreadGovernanceQueryService extends ThreadServiceKernel {
	async readableThreads(
		context: ThreadCommandContext,
		threads: readonly DromioThreadV1[],
	): Promise<readonly DromioThreadV1[]> {
		const scope = scopeFrom(context);
		const visible: DromioThreadV1[] = [];
		for (const thread of threads) {
			if (await this.canRead(context, scope, thread)) visible.push(thread);
		}
		return visible;
	}

	async getDraft(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<DromioThreadDraftV1 | undefined> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("thread.read", context, scope, thread);
		return this.store.getDraft(scope, threadId, context.actor.subject.id);
	}

	async listAccess(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioThreadAccessGrantV1[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("access.manage", context, scope, thread);
		return this.store.listGrants(scope, threadId);
	}

	async listShareLinks(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioThreadShareLinkV1[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("access.manage", context, scope, thread);
		return this.store.listShareLinks(scope, threadId);
	}

	async getUserState(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<DromioUserThreadStateV1 | undefined> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("thread.read", context, scope, thread);
		return this.store.getUserState(scope, threadId, context.actor.subject.id);
	}

	async listMessageRevisions(
		context: ThreadCommandContext,
		threadId: string,
		messageId: string,
	): Promise<readonly DromioMessageRevision[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("thread.read", context, scope, thread);
		return this.store.listMessageRevisions(scope, threadId, messageId);
	}

	async listExports(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioThreadExportV1[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("thread.read", context, scope, thread);
		return this.store.listExports(scope, threadId);
	}

	async getRetentionPolicy(
		context: ThreadCommandContext,
	): Promise<DromioRetentionPolicyV1 | undefined> {
		const scope = scopeFrom(context);
		await this.authorize("governance.manage", context, scope);
		return this.store.getRetentionPolicy(scope);
	}

	async listLegalHolds(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioLegalHoldV1[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("governance.manage", context, scope, thread);
		return this.store.listLegalHolds(scope, threadId);
	}

	async getPurgeReceipt(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<DromioPurgeReceiptV1 | undefined> {
		const scope = scopeFrom(context);
		const [thread, receipt] = await Promise.all([
			this.store.getThread(scope, threadId),
			this.store.getPurgeReceipt(scope, threadId),
		]);
		if (thread) {
			await this.authorize("governance.manage", context, scope, thread);
		} else if (
			!receipt ||
			receipt.purgedBy.type !== context.actor.subject.type ||
			receipt.purgedBy.id !== context.actor.subject.id
		) {
			await this.authorize("governance.manage", context, scope);
		}
		return receipt;
	}

	async listAudit(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioAuditRecordV1[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("governance.manage", context, scope, thread);
		return this.store.listAudit(scope, threadId);
	}

	async listUsage(
		context: ThreadCommandContext,
		threadId: string,
	): Promise<readonly DromioUsageRecordV1[]> {
		const scope = scopeFrom(context);
		const thread = await this.requireThread(scope, threadId);
		await this.authorize("governance.manage", context, scope, thread);
		return this.store.listUsage(scope, threadId);
	}
}
