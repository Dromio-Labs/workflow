import { ThreadServiceError } from "./errors.js";
import type { ThreadAction, ThreadPolicyPort, ThreadStore } from "./ports.js";

export interface ThreadHostPolicy {
	authorize(
		input: Parameters<ThreadPolicyPort["authorize"]>[0],
	): Promise<void>;
}

export function createThreadAccessPolicy(
	store: ThreadStore,
	hostPolicy?: ThreadHostPolicy,
): ThreadPolicyPort {
	return {
		authorize: async (input) => {
			const { action, actor, scope, thread } = input;
			if (
				actor.tenantId !== scope.tenantId ||
				actor.applicationId !== scope.applicationId ||
				(thread &&
					(thread.tenantId !== scope.tenantId ||
						thread.applicationId !== scope.applicationId))
			)
				throw denied("Actor, resource, and requested scope do not match.");
			await hostPolicy?.authorize(input);
			if (action === "thread.create") return;
			if (!thread) {
				if (
					action === "thread.read" ||
					privileged(actor.roles, actor.subject.type)
				)
					return;
				throw denied(`Actor ${actor.subject.id} cannot ${action}.`);
			}
			if (
				privileged(actor.roles, actor.subject.type) ||
				thread.createdBy.id === actor.subject.id
			)
				return;
			const now = new Date().toISOString();
			const grants = await store.listGrants(scope, thread.id);
			const grant = grants.find(
				(value) =>
					!value.revokedAt &&
					(!value.expiresAt || value.expiresAt > now) &&
					((value.principal.type === actor.subject.type &&
						value.principal.id === actor.subject.id) ||
						(value.principal.type === "group" &&
							actor.groupIds.includes(value.principal.id)) ||
						(value.principal.type === "tenant" &&
							value.principal.id === actor.tenantId)),
			);
			const share =
				actor.subject.type === "share_link"
					? (await store.listShareLinks(scope, thread.id)).find(
							(value) =>
								value.id === actor.subject.id &&
								!value.revokedAt &&
								(!value.expiresAt || value.expiresAt > now),
						)
					: undefined;
			const role = grant?.role ?? share?.role;
			if (
				role === "moderator" ||
				(role === "contributor" && contributorAction(action)) ||
				(role === "viewer" && action === "thread.read")
			)
				return;
			throw denied(
				`Actor ${actor.subject.id} cannot ${action} thread ${thread.id}.`,
			);
		},
	};
}

function contributorAction(action: ThreadAction): boolean {
	return (
		action === "thread.read" ||
		action === "thread.update" ||
		action === "turn.create" ||
		action === "turn.control" ||
		action === "interaction.resolve"
	);
}

function privileged(roles: readonly string[], subjectType: string): boolean {
	return (
		roles.includes("owner") ||
		roles.includes("admin") ||
		roles.includes("runtime") ||
		subjectType === "system"
	);
}

function denied(message: string): ThreadServiceError {
	return new ThreadServiceError({ code: "permission_denied", message });
}
