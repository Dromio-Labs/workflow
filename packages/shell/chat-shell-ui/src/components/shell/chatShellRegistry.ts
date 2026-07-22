import {
	initialConversationState,
	type ConversationState,
} from "../../packages/chatshell-response-protocol";
import type {
	ChatShellControlPlane,
	ChatShellManifest,
	ChatShellRuntime,
	ChatShellSlot,
	ChatShellSlotRegion,
	ChatShellStatus,
	ChatShellTask,
	ChatShellTasks,
	ChatShellWindow,
	ChatShellWorkspace,
} from "../../contracts/chatShellManifest";
import {
	type ConversationProjection,
	getThreadConversationView,
	type ThreadConversationView,
} from "../../runtime/controlPlaneConversation";

type ActiveShellConversationProjection = Omit<
	ChatShellRuntime["conversation"],
	"state"
> & {
	isStreaming: boolean;
	metadata: ConversationProjection;
	runtimeState: ChatShellRuntime["conversation"]["state"];
	state: ConversationState;
	threadId: string;
};

export function createChatShellRegistry(manifest: ChatShellManifest) {
	return {
		controlPlane: manifest.controlPlane,
		layout: manifest.layout,
		registries: manifest.registries,
		runtime: manifest.runtime,
		slots: createShellSlotRegistry(manifest.registries.layoutSlots),
	};
}

export function createShellSlotRegistry(slots: ChatShellSlot[]) {
	const visibleSlots = slots
		.filter((slot) => slot.visible !== false)
		.slice()
		.sort((left, right) => left.order - right.order);

	return {
		all: slots,
		visible: visibleSlots,
		byRegion: visibleSlots.reduce(
			(regions, slot) => {
				const regionSlots = regions[slot.region] ?? [];
				regions[slot.region] = [...regionSlots, slot];
				return regions;
			},
			{} as Partial<Record<ChatShellSlotRegion, ChatShellSlot[]>>,
		),
	};
}

export function getPrimaryShellSlot(
	slots: ReturnType<typeof createShellSlotRegistry>,
	region: ChatShellSlotRegion,
): ChatShellSlot {
	const slot = slots.byRegion[region]?.[0];

	if (!slot) {
		throw new Error(`Shell slot region "${region}" is not registered.`);
	}

	return slot;
}

export function getOptionalShellSlot(
	slots: ReturnType<typeof createShellSlotRegistry>,
	region: ChatShellSlotRegion,
): ChatShellSlot | undefined {
	return slots.byRegion[region]?.[0];
}

export function buildActiveShellProjection({
	activeThreadId,
	controlPlane,
	runtimeConversation,
	status,
	window,
}: {
	activeThreadId: string;
	controlPlane: ChatShellControlPlane;
	runtimeConversation: ChatShellRuntime["conversation"];
	status: ChatShellStatus;
	window: ChatShellWindow;
}) {
	const resolvedActiveThreadId = resolveActiveShellThreadId(
		controlPlane,
		activeThreadId,
	);
	const tasks = buildTasksFromControlPlane(
		controlPlane,
		resolvedActiveThreadId,
	);
	const taskContext = findTaskContext(tasks, resolvedActiveThreadId);

	if (!taskContext) {
		throw new Error(
			`Control plane active thread "${resolvedActiveThreadId}" is not present in the sidebar workspace registry.`,
		);
	}

	const threadView = getThreadConversationView(
		controlPlane,
		resolvedActiveThreadId,
	);
	const conversation: ActiveShellConversationProjection = {
		...runtimeConversation,
		isStreaming: runtimeConversation.state === "streaming",
		metadata: threadView.projection,
		runtimeState: runtimeConversation.state,
		state: initialConversationState,
		threadId: threadView.thread.id,
	};
	const activeStatus = buildStatusForThread(status, threadView);
	const activeWindow = {
		...window,
		title: taskContext.task.title,
		titleGenerating: taskContext.task.titleGenerating,
		workspace: taskContext.workspace.name,
	};

	return {
		activeStatus,
		activeWindow,
		conversation,
		taskContext,
		tasks,
		threadView,
	};
}

export function resolveActiveShellThreadId(
	controlPlane: Pick<
		ChatShellControlPlane,
		"activeThreadId" | "threads" | "workspaces"
	>,
	requestedThreadId: string,
): string {
	const thread = controlPlane.threads.find(
		(candidate) => candidate.id === requestedThreadId,
	);
	const workspace = controlPlane.workspaces.find(
		(candidate) => candidate.id === thread?.workspaceId,
	);

	return thread && workspace?.threadIds.includes(thread.id)
		? requestedThreadId
		: controlPlane.activeThreadId;
}

export function buildTasksFromControlPlane(
	controlPlane: ChatShellControlPlane,
	activeTaskId: string,
): ChatShellTasks {
	const threads = new Map(
		controlPlane.threads.map((thread) => [thread.id, thread]),
	);
	const pinned = controlPlane.threads
		.filter((thread) => !thread.ephemeral && thread.pinnedAt !== undefined)
		.sort(comparePinnedThreads)
		.map(toTask);

	return {
		activeTaskId,
		...(pinned.length ? { pinned } : {}),
		workspaces: controlPlane.workspaces.map((workspace) => ({
			id: workspace.id,
			name: workspace.name,
			tasks: workspace.threadIds.map((threadId) => {
				const thread = threads.get(threadId);

				if (!thread) {
					throw new Error(
						`Control plane workspace "${workspace.id}" references missing thread "${threadId}".`,
					);
				}

				return toTask(thread);
			}),
		})),
	};
}

function toTask(
	thread: ChatShellControlPlane["threads"][number],
): ChatShellTask {
	return {
		ephemeral: thread.ephemeral,
		id: thread.id,
		timeLabel: thread.timeLabel,
		title: thread.title,
		titleGenerating: thread.titleGenerating,
		unread: thread.unread,
	};
}

function comparePinnedThreads(
	left: ChatShellControlPlane["threads"][number],
	right: ChatShellControlPlane["threads"][number],
): number {
	const rank =
		(left.pinRank ?? Number.MAX_SAFE_INTEGER) -
		(right.pinRank ?? Number.MAX_SAFE_INTEGER);
	if (rank !== 0) return rank;
	return (
		(right.pinnedAt ?? "").localeCompare(left.pinnedAt ?? "") ||
		left.id.localeCompare(right.id)
	);
}

export function findTaskContext(
	tasks: ChatShellTasks,
	taskId: string,
): { task: ChatShellTask; workspace: ChatShellWorkspace } | undefined {
	for (const workspace of tasks.workspaces) {
		const task = workspace.tasks.find((item) => item.id === taskId);

		if (task) {
			return { task, workspace };
		}
	}

	return undefined;
}

export function buildStatusForThread(
	status: ChatShellStatus,
	view: ThreadConversationView,
): ChatShellStatus {
	const completedStatus = view.conversation.goal.completed
		? "Complete"
		: "Working";
	const projectedProgressRows = view.conversation.progress.map(
		(label, index) => ({
			icon: "check" as const,
			id: `progress-${view.thread.id}-${index}`,
			kind: "progress" as const,
			label,
			status: "done" as const,
		}),
	);
	const registeredProgressRows = status.sections.find(
		(section) => section.id === "progress",
	)?.rows;
	const useRegisteredStatus = view.thread.active === true;

	return {
		...status,
		git: {
			...status.git,
			additions: view.conversation.changes.additions,
			branch: view.conversation.branch,
			deletions: view.conversation.changes.deletions,
		},
		goal: useRegisteredStatus
			? status.goal
			: {
					status: completedStatus,
					subtitle: view.conversation.goal.subtitle,
					title: view.conversation.goal.title,
				},
		progress: useRegisteredStatus
			? status.progress
			: view.conversation.progress.map((label, index) => ({
					id: `progress-${view.thread.id}-${index}`,
					label,
					status: "done" as const,
				})),
		sections: status.sections.map((section) => {
			if (section.id === "git-tools") {
				return {
					...section,
					rows: section.rows.map((row) => {
						if (row.id === "changes") {
							return {
								...row,
								additions: view.conversation.changes.additions,
								deletions: view.conversation.changes.deletions,
							};
						}

						if (row.id === "branch") {
							return {
								...row,
								label: view.conversation.branch,
							};
						}

						return row;
					}),
				};
			}

			if (section.id === "goal") {
				return {
					...section,
					status: useRegisteredStatus ? section.status : completedStatus,
					rows: section.rows.map((row) =>
						row.id === "goal-current"
							? {
									...row,
									label: view.conversation.goal.title,
									metadata: view.conversation.goal.subtitle.split(" · "),
								}
							: row,
					),
				};
			}

			if (section.id === "progress") {
				return {
					...section,
					rows:
						useRegisteredStatus && registeredProgressRows
							? registeredProgressRows
							: projectedProgressRows,
				};
			}

			return section;
		}),
	};
}
