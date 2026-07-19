import { expect, test } from "bun:test";
import type { DromioActorContextV1 } from "@dromio/protocols";
import { createThreadAccessPolicy } from "./access-policy";
import { MemoryThreadStore } from "./memory-store";
import { ThreadService } from "./service";

const creator: DromioActorContextV1 = {
	schemaVersion: "dromio.actor-context.v1",
	subject: { type: "user", id: "creator" },
	tenantId: "tenant-1",
	applicationId: "app-1",
	roles: ["member"],
	groupIds: [],
};

test("portable access policy maps grants and intersects host policy", async () => {
	const store = new MemoryThreadStore();
	const unrestricted = new ThreadService({ store });
	const thread = (
		await unrestricted.createThread(
			{ actor: creator, commandId: "create" },
			{},
		)
	).resource;
	const member = {
		...creator,
		subject: { type: "user" as const, id: "member" },
	};
	const policy = createThreadAccessPolicy(store);
	await expect(
		policy.authorize({
			action: "thread.read",
			actor: member,
			scope: creator,
			thread,
		}),
	).rejects.toMatchObject({ code: "permission_denied" });
	await unrestricted.grantAccess(
		{ actor: creator, commandId: "grant" },
		{
			threadId: thread.id,
			principal: member.subject,
			role: "viewer",
		},
	);
	await expect(
		policy.authorize({
			action: "thread.read",
			actor: member,
			scope: creator,
			thread,
		}),
	).resolves.toBeUndefined();
	await expect(
		policy.authorize({
			action: "turn.create",
			actor: member,
			scope: creator,
			thread,
		}),
	).rejects.toMatchObject({ code: "permission_denied" });

	const hostPolicy = createThreadAccessPolicy(store, {
		authorize: async () => {
			throw new Error("host denied");
		},
	});
	await expect(
		hostPolicy.authorize({
			action: "thread.read",
			actor: creator,
			scope: creator,
			thread,
		}),
	).rejects.toThrow("host denied");
});

test("a thread creator can read the purge receipt after the thread is gone", async () => {
	const store = new MemoryThreadStore();
	const service = new ThreadService({
		store,
		policy: createThreadAccessPolicy(store),
	});
	const thread = (
		await service.createThread(
			{ actor: creator, commandId: "purge-create" },
			{},
		)
	).resource;
	await service.deleteThread(
		{ actor: creator, commandId: "purge-delete" },
		thread.id,
	);
	await service.purgeThread(
		{ actor: creator, commandId: "purge-now" },
		thread.id,
	);
	expect(
		await service.getPurgeReceipt(
			{ actor: creator, commandId: "purge-read" },
			thread.id,
		),
	).toMatchObject({ threadId: thread.id, purgedBy: creator.subject });
});
