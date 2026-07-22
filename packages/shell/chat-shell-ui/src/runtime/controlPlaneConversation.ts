import {
	type ConversationState,
	createStreamMapperState,
	initialConversationState,
	type ModelStreamEvent,
	mapModelStreamEvent,
	projectStreamEvent,
	type ResponseMedia,
	type ToolInput,
	type ToolStatus,
} from "../packages/chatshell-response-protocol";

import type { ChatShellControlPlane } from "../contracts/chatShellManifest";

export const CONTROL_PLANE_STREAM_TOKENS_PER_SECOND = 60;

type ConversationRecord = ChatShellControlPlane["conversations"][number];
type MessagePartRecord = ChatShellControlPlane["messageParts"][number];
type MessageRecord = ChatShellControlPlane["messages"][number];
type ThreadRecord = ChatShellControlPlane["threads"][number];
type ToolCallRecord = Omit<
	ChatShellControlPlane["toolCalls"][number],
	"input" | "status"
> & {
	input: ToolInput;
	status: ToolStatus;
};

type FileReference = {
	language?: string;
	name: string;
	path?: string;
};

export type ConversationProjection = {
	fileLinks: FileReference[];
	inlineCode: string[];
	userTimestampLabel: string;
	workspacePath?: string;
};

export type ConversationRow =
	| {
			content: string;
			type: "content" | "thought";
	  }
	| {
			toolCall: ToolCallRecord;
			type: "tool";
	  };

export type ThreadConversationView = {
	assistantMessages: Array<{
		durationMs: number;
		id: string;
		media: ResponseMedia[];
		rows: ConversationRow[];
		showHeader: boolean;
	}>;
	conversation: ConversationRecord;
	thread: ThreadRecord;
	projection: ConversationProjection;
	messages: Array<
		| {
				content: string;
				id: string;
				media: ResponseMedia[];
				role: "user";
		  }
		| {
				durationMs: number;
				id: string;
				media: ResponseMedia[];
				role: "assistant";
				rows: ConversationRow[];
				showHeader: boolean;
		  }
	>;
	userMessage: {
		content: string;
		id: string;
		media: ResponseMedia[];
	};
};

export function buildControlPlaneConversationStream(
	controlPlane: ChatShellControlPlane,
	threadId = controlPlane.activeThreadId,
): ModelStreamEvent[] {
	const view = getThreadConversationView(controlPlane, threadId);
	const events: ModelStreamEvent[] = [];

	for (const message of view.messages) {
		if (message.role === "user") {
			events.push({
				content: message.content,
				id: message.id,
				kind: "user_message",
				...(message.media.length ? { media: message.media } : {}),
			});
			continue;
		}

		const assistantMessage = message;
		events.push({
			id: assistantMessage.id,
			kind: "assistant_start",
			...(assistantMessage.media.length
				? { media: assistantMessage.media }
				: {}),
			showHeader: assistantMessage.showHeader,
			startedAt: Date.now(),
		});

		assistantMessage.rows.forEach((row) => {
			switch (row.type) {
				case "content":
				case "thought": {
					const kind =
						row.type === "content" ? "text_delta" : "reasoning_delta";

					for (const delta of tokenizeForStream(row.content)) {
						events.push({
							delta,
							kind,
							messageId: assistantMessage.id,
						});
					}

					return;
				}

				case "tool": {
					const rawInput = JSON.stringify(row.toolCall.input);

					events.push({
						kind: "tool_input_start",
						messageId: assistantMessage.id,
						toolCallId: row.toolCall.id,
						toolName: row.toolCall.toolName,
					});

					for (const delta of chunkText(rawInput, 24)) {
						events.push({
							delta,
							kind: "tool_input_delta",
							toolCallId: row.toolCall.id,
						});
					}

					events.push({
						input: row.toolCall.input,
						kind: "tool_input_end",
						toolCallId: row.toolCall.id,
					});
					events.push({
						input: row.toolCall.input,
						kind: "tool_call",
						messageId: assistantMessage.id,
						status: row.toolCall.status,
						toolCallId: row.toolCall.id,
						toolName: row.toolCall.toolName,
					});
				}
			}
		});

		events.push({
			durationMs: assistantMessage.durationMs,
			kind: "finish",
			messageId: assistantMessage.id,
		});
	}

	return events;
}

export function projectControlPlaneConversationState(
	controlPlane: ChatShellControlPlane,
	threadId = controlPlane.activeThreadId,
): ConversationState {
	const state = projectModelStreamEvents(
		buildControlPlaneConversationStream(controlPlane, threadId),
	);
	const metadata = new Map(
		controlPlane.messages.map((message) => [message.id, message]),
	);
	return {
		messages: state.messages.map((message) => {
			const source = metadata.get(message.id);
			return {
				...message,
				...(source?.modelId ? { modelId: source.modelId } : {}),
				...(source?.modelLabel ? { modelLabel: source.modelLabel } : {}),
				...(source?.providerId ? { providerId: source.providerId } : {}),
			};
		}),
	};
}

export function projectModelStreamEvents(
	events: ModelStreamEvent[],
): ConversationState {
	const mapperState = createStreamMapperState();
	let projected: ConversationState = initialConversationState;

	for (const event of events) {
		for (const uiEvent of mapModelStreamEvent(event, mapperState)) {
			projected = projectStreamEvent(projected, uiEvent);
		}
	}

	return projected;
}

export function getActiveThreadView(controlPlane: ChatShellControlPlane) {
	return getThreadConversationView(controlPlane, controlPlane.activeThreadId);
}

export function getThreadConversationView(
	controlPlane: ChatShellControlPlane,
	threadId: string,
): ThreadConversationView {
	const thread = mustFind(
		controlPlane.threads,
		(record) => record.id === threadId,
		`thread ${threadId}`,
	);
	const conversation = mustFind(
		controlPlane.conversations,
		(record) => record.id === thread.conversationId,
		`conversation ${thread.conversationId}`,
	);
	const messages = controlPlane.messages.filter(
		(message) => message.conversationId === conversation.id,
	);
	const userMessage = mustFind(
		messages,
		(message) => message.role === "user",
		`user message for ${conversation.id}`,
	);
	const userContent = getMessageParts(controlPlane, userMessage)
		.map((part) => (part.type === "content" ? part.content : ""))
		.filter(Boolean)
		.join("\n\n");
	const userMedia = getMessageParts(controlPlane, userMessage).flatMap(
		(part) =>
			part.type === "media"
				? [
						{
							...(part.availability ? { availability: part.availability } : {}),
							...(part.error ? { error: part.error } : {}),
							fileId: part.fileId,
							mediaType: part.mediaType,
							name: part.name,
							...(part.retryUrl ? { retryUrl: part.retryUrl } : {}),
							url: part.url,
						},
					]
				: [],
	);
	const projectedMessages: ThreadConversationView["messages"] = messages.map(
		(message) => {
			if (message.role === "user") {
				const parts = getMessageParts(controlPlane, message);
				return {
					content: parts
						.map((part) => (part.type === "content" ? part.content : ""))
						.filter(Boolean)
						.join("\n\n"),
					id: message.id,
					media: parts.flatMap((part) =>
						part.type === "media"
							? [
									{
										...(part.availability
											? { availability: part.availability }
											: {}),
										...(part.error ? { error: part.error } : {}),
										fileId: part.fileId,
										mediaType: part.mediaType,
										name: part.name,
										...(part.retryUrl ? { retryUrl: part.retryUrl } : {}),
										url: part.url,
									},
								]
							: [],
					),
					role: "user",
				};
			}

			return {
				durationMs: message.durationMs ?? 0,
				id: message.id,
				media: getMessageMedia(controlPlane, message),
				role: "assistant",
				rows: getAssistantRows(controlPlane, message),
				showHeader: message.showHeader ?? true,
			};
		},
	);

	return {
		assistantMessages: messages
			.filter((message) => message.role === "assistant")
			.map((message) => ({
				durationMs: message.durationMs ?? 0,
				id: message.id,
				media: getMessageMedia(controlPlane, message),
				rows: getAssistantRows(controlPlane, message),
				showHeader: message.showHeader ?? true,
			})),
		conversation,
		messages: projectedMessages,
		projection: buildConversationProjection(controlPlane, thread, messages),
		thread,
		userMessage: {
			content: userContent,
			id: userMessage.id,
			media: userMedia,
		},
	};
}

function getMessageMedia(
	controlPlane: ChatShellControlPlane,
	message: MessageRecord,
): ResponseMedia[] {
	return getMessageParts(controlPlane, message).flatMap((part) =>
		part.type === "media"
			? [
					{
						...(part.availability ? { availability: part.availability } : {}),
						...(part.error ? { error: part.error } : {}),
						fileId: part.fileId,
						mediaType: part.mediaType,
						name: part.name,
						...(part.retryUrl ? { retryUrl: part.retryUrl } : {}),
						url: part.url,
					},
				]
			: [],
	);
}

function getAssistantRows(
	controlPlane: ChatShellControlPlane,
	message: MessageRecord,
): ConversationRow[] {
	return getMessageParts(controlPlane, message)
		.filter((part) => part.type !== "media")
		.map((part): ConversationRow => {
			switch (part.type) {
				case "content":
				case "thought":
					return {
						content: part.content,
						type: part.type,
					};

				case "tool-call":
					return {
						toolCall: mustFind(
							controlPlane.toolCalls,
							(toolCall) => toolCall.id === part.toolCallId,
							`tool call ${part.toolCallId}`,
						) as ToolCallRecord,
						type: "tool",
					};
			}
		});
}

function buildConversationProjection(
	controlPlane: ChatShellControlPlane,
	thread: ThreadRecord,
	messages: MessageRecord[],
): ConversationProjection {
	const messageIds = new Set(messages.map((message) => message.id));
	const toolCalls = controlPlane.toolCalls.filter((toolCall) =>
		messageIds.has(toolCall.messageId),
	) as ToolCallRecord[];
	const inlineCode = new Set<string>();
	const fileLinks = new Map<string, FileReference>();
	let workspacePath: string | undefined;

	for (const toolCall of toolCalls) {
		if (toolCall.input.command) {
			inlineCode.add(toolCall.input.command);
		}

		workspacePath = workspacePath ?? getToolWorkspacePath(toolCall.input);

		for (const file of getToolFileReferences(toolCall.input)) {
			fileLinks.set(file.name, file);
		}
	}

	return {
		fileLinks: [...fileLinks.values()],
		inlineCode: [...inlineCode],
		userTimestampLabel: getThreadTimestampLabel(thread),
		workspacePath,
	};
}

function getToolWorkspacePath(input: ToolInput) {
	return getInputRecord(input).workspacePath;
}

function getToolFileReferences(input: ToolInput): FileReference[] {
	const fileReferences: FileReference[] = [];

	for (const file of input.files ?? []) {
		fileReferences.push(toFileReference(file));
	}

	for (const file of input.toolSummary?.files ?? []) {
		fileReferences.push(toFileReference(file));
	}

	return fileReferences;
}

function toFileReference(file: { language?: string; name: string }) {
	return {
		...file,
		path: getInputRecord(file).path,
	};
}

function getInputRecord(value: unknown): Record<string, string | undefined> {
	return typeof value === "object" && value !== null
		? (value as Record<string, string | undefined>)
		: {};
}

function getThreadTimestampLabel(thread: ThreadRecord) {
	if (!thread.timeLabel) {
		return "Just now";
	}

	if (thread.timeLabel.endsWith("m")) {
		return `${thread.timeLabel} ago`;
	}

	if (thread.timeLabel.endsWith("h")) {
		return `${thread.timeLabel} ago`;
	}

	if (thread.timeLabel.endsWith("d")) {
		return `${thread.timeLabel} ago`;
	}

	return thread.timeLabel;
}

function getMessageParts(
	controlPlane: ChatShellControlPlane,
	message: MessageRecord,
): MessagePartRecord[] {
	return message.partIds.map((partId) =>
		mustFind(
			controlPlane.messageParts,
			(part) => part.id === partId,
			`message part ${partId}`,
		),
	);
}

function tokenizeForStream(text: string): string[] {
	return text.match(/\S+\s*/g) ?? [];
}

function chunkText(text: string, size: number) {
	const chunks: string[] = [];

	for (let index = 0; index < text.length; index += size) {
		chunks.push(text.slice(index, index + size));
	}

	return chunks;
}

function mustFind<T>(
	records: T[],
	predicate: (record: T) => boolean,
	label: string,
): T {
	const record = records.find(predicate);

	if (!record) {
		throw new Error(`Missing ChatShell control-plane record: ${label}`);
	}

	return record;
}
