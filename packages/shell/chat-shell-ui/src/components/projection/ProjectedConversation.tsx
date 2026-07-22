import {
	type ChatMessage,
	type ConversationState,
	getToolCall,
	type MessagePart,
} from "../../packages/chatshell-response-protocol";
import { useState } from "react";
import type { ChatShellRuntime } from "../../contracts/chatShellManifest";
import { DromioMarkdown } from "./markdown";
import { ProjectedMediaGrid } from "./ProjectedMediaGrid";
import {
	ChangedFilesCard,
	ChevronRight,
	formatDurationLabel,
	ToolSummaryRow,
} from "./ProjectedConversationParts";
import { useProjectedConversationScroll } from "./useProjectedConversationScroll";

export type ProjectedConversationConfig = {
	error?: ChatShellRuntime["conversation"]["error"];
	isStreaming: boolean;
	metadata: ProjectedConversationMetadata;
	pendingApprovals?: readonly ProjectedPendingApproval[];
	runtimeState: ChatShellRuntime["conversation"]["state"];
	state: ConversationState;
	threadId: string;
};

export type ProjectedPendingApproval = {
	readonly requestId: string;
	readonly summary: string;
};

export type ProjectedConversationMetadata = {
	fileLinks: Array<{
		language?: string;
		name: string;
		path?: string;
	}>;
	inlineCode: string[];
	userTimestampLabel: string;
	workspacePath?: string;
};

export type ProjectedConversationEmptyState = {
	readonly subtitle?: string;
	readonly suggestions?: readonly {
		readonly id: string;
		readonly label: string;
		readonly prompt: string;
	}[];
	readonly title?: string;
	readonly onSelectSuggestion?: (prompt: string) => void;
};

export function ProjectedConversation({
	conversation,
	emptyState,
	onApprovalResponse,
}: {
	conversation: ProjectedConversationConfig;
	emptyState?: ProjectedConversationEmptyState;
	onApprovalResponse?: (
		requestId: string,
		decision: "approve" | "reject",
	) => void | Promise<void>;
}) {
	const { isStreaming, metadata, state } = conversation;
	const assistantMessages = state.messages.filter(
		(message) => message.role === "assistant",
	);
	const latestAssistantMessage = assistantMessages.at(-1);

	useProjectedConversationScroll({
		assistantMessageCount: assistantMessages.length,
		conversation,
		latestAssistantMessage,
	});

	return (
		<div data-projected-conversation="true" style={{ display: "contents" }}>
			{conversation.runtimeState === "empty" ? (
				<EmptyConversation emptyState={emptyState} />
			) : (
				<>
					{state.messages.map((message) =>
						message.role === "user" ? (
							<UserPrompt
								content={message.content}
								key={message.id}
								media={message.media}
								timestampLabel={metadata.userTimestampLabel}
							/>
						) : (
							<AssistantMessageBlock
								isLive={
									isStreaming && message.id === latestAssistantMessage?.id
								}
								isLatest={message.id === latestAssistantMessage?.id}
								key={message.id}
								message={message}
								projection={metadata}
							/>
						),
					)}
					{conversation.runtimeState === "error" ? (
						<ErrorConversation error={conversation.error} />
					) : null}
					{conversation.pendingApprovals?.map((approval) => (
						<PendingApprovalCard
							approval={approval}
							key={approval.requestId}
							onResponse={onApprovalResponse}
						/>
					))}
				</>
			)}
		</div>
	);
}

function PendingApprovalCard({
	approval,
	onResponse,
}: {
	approval: ProjectedPendingApproval;
	onResponse?: (
		requestId: string,
		decision: "approve" | "reject",
	) => void | Promise<void>;
}) {
	return (
		<section
			aria-label={`Approval required: ${approval.summary}`}
			className="rounded-xl border border-warning/35 bg-warning/10 px-4 py-3 text-[13px]"
			data-approval-request-id={approval.requestId}
		>
			<p className="m-0 font-medium text-foreground">Approval required</p>
			<p className="m-0 mt-1 leading-5 text-foreground-subtle">
				{approval.summary}
			</p>
			<div className="mt-3 flex items-center gap-2">
				<button
					className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground"
					onClick={() => void onResponse?.(approval.requestId, "approve")}
					type="button"
				>
					Approve
				</button>
				<button
					className="rounded-md border border-border bg-surface px-3 py-1.5 font-medium text-foreground hover:bg-surface-hover"
					onClick={() => void onResponse?.(approval.requestId, "reject")}
					type="button"
				>
					Reject
				</button>
			</div>
		</section>
	);
}
function EmptyConversation({
	emptyState,
}: {
	emptyState?: ProjectedConversationEmptyState;
}) {
	return (
		<div className="flex min-h-60 flex-col items-center justify-center gap-3 text-center text-[13px] text-foreground-subtle">
			<div className="flex size-9 items-center justify-center rounded-xl border border-border bg-surface text-foreground">
				+
			</div>
			<div className="max-w-70 space-y-1">
				<p className="m-0 font-medium text-foreground">
					{emptyState?.title ?? "Start a new task"}
				</p>
				<p className="m-0 leading-5">
					{emptyState?.subtitle ??
						"Ask the assistant to inspect, edit, or explain this workspace."}
				</p>
			</div>
			{emptyState?.suggestions?.length ? (
				<div
					aria-label="Suggested prompts"
					className="flex max-w-xl flex-wrap items-center justify-center gap-2.5 pt-1"
				>
					{emptyState.suggestions.map((suggestion) => (
						<button
							className="cursor-pointer rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] text-foreground transition-colors hover:bg-surface-hover"
							key={suggestion.id}
							onClick={() => emptyState.onSelectSuggestion?.(suggestion.prompt)}
							type="button"
						>
							{suggestion.label}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

function ErrorConversation({
	error,
}: {
	error?: ChatShellRuntime["conversation"]["error"];
}) {
	return (
		<div
			aria-atomic="true"
			className="rounded-xl border border-diff-removed/25 bg-diff-removed/10 px-4 py-3 text-[13px]"
			role="alert"
		>
			<p className="m-0 font-medium text-foreground">
				{error?.title ?? "Run interrupted"}
			</p>
			<p className="m-0 mt-1 leading-5 text-foreground-subtle">
				{error?.detail ??
					"The shell kept the transcript and is ready for a retry."}
			</p>
		</div>
	);
}

function UserPrompt({
	content,
	media,
	timestampLabel,
}: {
	content: string;
	media: ChatMessage["media"];
	timestampLabel: string;
}) {
	return (
		<div className="group/user-message ml-auto flex w-full flex-col items-end gap-2">
			<div className="flex w-full flex-col items-end gap-2">
				<div className="max-w-full max-w-xl rounded-xl rounded-tr-xs border border-border bg-surface px-4 py-3 text-[13px] text-foreground">
					<ProjectedMediaGrid
						className="mb-3 grid gap-2 sm:grid-cols-2"
						imageClassName="max-h-80 w-full rounded-lg object-contain"
						media={media}
					/>
					<div className="relative min-w-0 flex-1">
						<div
							className="min-w-0 overflow-hidden whitespace-pre-wrap break-words transition-[max-height] duration-300 ease-out motion-reduce:transition-none"
							style={{ maxHeight: "120px" }}
						>
							{content}
						</div>
					</div>
				</div>
			</div>
			<div className="mr-1 flex shrink-0 items-center gap-2 pb-2 md:pb-5 opacity md:opacity-0 transition-opacity group-hover/user-message:opacity-100">
				<span className="select-none text-xs text-foreground-subtlest">
					{timestampLabel}
				</span>
			</div>
		</div>
	);
}

function AssistantParts({
	isLive,
	isLatest,
	message,
	projection,
}: {
	isLive: boolean;
	isLatest: boolean;
	message: ChatMessage;
	projection: ProjectedConversationMetadata;
}) {
	const latestTextPartIndex = getLatestTextPartIndex(message.parts);

	return (
		<>
			{message.parts.map((part, index) => (
				<AssistantPart
					isLive={isLive}
					isLatestTextPart={isLatest && index === latestTextPartIndex}
					key={`${part.type}-${index}`}
					message={message}
					part={part}
					projection={projection}
				/>
			))}
		</>
	);
}

function AssistantPart({
	isLive,
	isLatestTextPart,
	message,
	part,
	projection,
}: {
	isLive: boolean;
	isLatestTextPart: boolean;
	message: ChatMessage;
	part: MessagePart;
	projection: ProjectedConversationMetadata;
}) {
	if (part.type === "thought") {
		return (
			<div
				className="latest-message flex flex-col gap-5 text-[13px] text-foreground-subtle"
				data-assistant-output="true"
				data-latest-assistant-output={isLatestTextPart ? "true" : undefined}
			>
				<div className="flex items-end gap-1">
					<div className="min-w-0 flex-1 space-y-4 whitespace-normal size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
						{part.content
							.split("\n\n")
							.map((paragraph, index) =>
								paragraph ? <p key={index}>{paragraph}</p> : null,
							)}
					</div>
				</div>
			</div>
		);
	}

	if (part.type === "content") {
		return (
			<div
				className="latest-message flex flex-col gap-5 text-[13px]"
				data-assistant-output="true"
				data-latest-assistant-output={isLatestTextPart ? "true" : undefined}
			>
				<div className="flex items-end gap-1">
					<div className="min-w-0 flex-1 space-y-4 whitespace-normal size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
						<DromioMarkdown
							content={part.content}
							isStreaming={isLive}
							projection={projection}
						/>
					</div>
				</div>
			</div>
		);
	}

	const toolCall = getToolCall(message, part.toolId);

	if (!toolCall) {
		return null;
	}

	return toolCall.input.files ? (
		<ChangedFilesCard projection={projection} toolCall={toolCall} />
	) : (
		<ToolSummaryRow projection={projection} toolCall={toolCall} />
	);
}

function AssistantMessageBlock({
	isLive,
	isLatest,
	message,
	projection,
}: {
	isLive: boolean;
	isLatest: boolean;
	message: ChatMessage;
	projection: ProjectedConversationMetadata;
}) {
	const [isExpanded, setIsExpanded] = useState(true);
	const state = isExpanded ? "open" : "closed";

	function toggleExpanded() {
		setIsExpanded((current) => !current);
	}

	return (
		<div
			data-message-id={message.id}
			data-latest-assistant={isLatest ? "true" : undefined}
			data-live-transcript={isLive ? "true" : undefined}
			data-slot="collapsible"
			data-state={state}
			className="history-message flex flex-col gap-5 text-[13px]"
		>
			<button
				aria-expanded={isExpanded}
				data-slot="collapsible-trigger"
				data-state={state}
				className="group/history-message flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border/50 bg-transparent p-0 pb-2 text-left text-[13px] text-foreground-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={toggleExpanded}
				type="button"
			>
				<span className="shrink-0">
					{isLive || message.status === "streaming"
						? "Working"
						: formatDurationLabel(message.durationMs)}
				</span>
				{message.modelLabel && message.providerId ? (
					<span className="min-w-0 truncate text-foreground-subtlest">
						{message.modelLabel} · {message.providerId}
					</span>
				) : null}
				<ChevronRight
					className={[
						"size-4 shrink-0 text-foreground-subtlest opacity-100 transition-all duration-200 ease-out group-hover/history-message:opacity-100",
						isExpanded ? "rotate-90" : "",
					]
						.join(" ")
						.trim()}
				/>
			</button>
			<div
				data-latest-assistant-content={isLatest ? "true" : undefined}
				data-slot="collapsible-content"
				data-state={state}
				className={[
					"group/collapsible-content grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out",
					isExpanded
						? "grid-rows-[1fr] opacity-100"
						: "grid-rows-[0fr] opacity-0",
				].join(" ")}
				aria-hidden={!isExpanded}
			>
				<div className="min-h-0 min-w-0">
					<div className="flex min-w-0 flex-col gap-5">
						<AssistantParts
							isLive={isLive}
							isLatest={isLatest}
							message={message}
							projection={projection}
						/>
						<ProjectedMediaGrid
							className="grid gap-2 sm:grid-cols-2"
							imageClassName="h-auto max-h-[32rem] w-full object-contain"
							media={message.media}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

function getLatestTextPartIndex(parts: MessagePart[]) {
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index];

		if (part.type === "content" || part.type === "thought") {
			return index;
		}
	}

	return -1;
}
