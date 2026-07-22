import {
	type ToolCall,
	type ToolInput,
} from "../../packages/chatshell-response-protocol";
import { Icon } from "../ui/Icon";
import { InlineMediaImage } from "./InlineMediaImage";
import { InlineMediaVideo } from "./InlineMediaVideo";
import { getFileLanguagePresentation } from "./fileLanguage";
import type { ProjectedConversationMetadata } from "./ProjectedConversation";

export function ToolSummaryRow({
	projection,
	toolCall,
}: {
	projection: ProjectedConversationMetadata;
	toolCall: ToolCall;
}) {
	const summary = toolCall.input.toolSummary;
	const media = toolCall.input.media ?? [];

	if (!summary) {
		const label =
			toolCall.input.summary ?? toolCall.input.command ?? toolCall.title;

		return (
			<div
				className="flex min-w-0 flex-col gap-3"
				data-tool-call-id={toolCall.toolId}
			>
				<div className="group/tool-summary flex w-full cursor-default items-center gap-2 text-left text-[13px] transition-colors focus-visible:outline-none">
					<ToolIcon icon="tool" />
					<span className="font-medium text-foreground-subtle">
						{renderInlineResponse(label, projection)}
					</span>
					<ToolRowChevron />
				</div>
				<ToolMediaGallery media={media} />
			</div>
		);
	}

	return (
		<div
			className="flex min-w-0 flex-col gap-3"
			data-tool-call-id={toolCall.toolId}
		>
			<div className="group/tool-summary flex w-full cursor-default items-center gap-2 text-left text-[13px] transition-colors focus-visible:outline-none">
				{summary.icon !== "none" ? <ToolIcon icon={summary.icon} /> : null}
				<span className="font-medium whitespace-nowrap text-foreground-subtle">
					{summary.action}
				</span>
				<div className="min-w-0 flex max-w-full items-center gap-2 text-foreground-subtlest">
					{summary.command ? (
						<code className="truncate font-mono">{summary.command}</code>
					) : null}
					{summary.files && summary.files.length > 0 ? (
						<span className="inline-flex min-w-0 items-center gap-1">
							{summary.files.map((file, index) => (
								<span
									className="inline-flex min-w-0 items-center"
									key={`${file.name}-${index}`}
								>
									{index > 0 ? (
										<span className="text-foreground-subtlest">,</span>
									) : null}
									<button
										type="button"
										title={getFilePath(file, projection)}
										className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-foreground hover:underline"
									>
										<FileLanguageBadge
											language={file.language}
											name={file.name}
										/>
										<span className="min-w-0 truncate text-foreground">
											{file.name}
										</span>
									</button>
								</span>
							))}
						</span>
					) : null}
					{summary.detail ? (
						<span className="truncate">{summary.detail}</span>
					) : null}
					{summary.additions !== undefined ||
					summary.deletions !== undefined ? (
						<span className="shrink-0 tabular-nums">
							{summary.additions !== undefined ? (
								<span className="text-diff-added">+{summary.additions}</span>
							) : null}
							{summary.additions !== undefined &&
							summary.deletions !== undefined
								? " "
								: null}
							{summary.deletions !== undefined ? (
								<span className="text-diff-removed">-{summary.deletions}</span>
							) : null}
						</span>
					) : null}
					{summary.statusLabel ? (
						<span className="whitespace-nowrap">{summary.statusLabel}</span>
					) : null}
				</div>
				<ToolRowChevron />
			</div>
			<ToolMediaGallery media={media} />
		</div>
	);
}
function ToolMediaGallery({
	media,
}: {
	media: NonNullable<ToolInput["media"]>;
}) {
	if (!media.length) return null;
	return (
		<div className="grid gap-2 sm:grid-cols-2" data-tool-media-gallery="true">
			{media.map((item) =>
				item.mediaType.startsWith("image/") ? (
					<InlineMediaImage
						className="h-auto max-h-[32rem] w-full object-contain"
						item={item}
						key={item.fileId}
					/>
				) : item.mediaType.startsWith("video/") ? (
					<InlineMediaVideo item={item} key={item.fileId} />
				) : null
			)}
		</div>
	);
}

export function ChangedFilesCard({
	projection,
	toolCall,
}: {
	projection: ProjectedConversationMetadata;
	toolCall: ToolCall;
}) {
	const files = toolCall.input.files ?? [];
	const additions = files.reduce((sum, file) => sum + file.additions, 0);
	const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

	return (
		<div className="overflow-hidden rounded-xl border border-border bg-card shadow-none">
			<div className="flex h-10 items-center justify-between gap-3 px-4">
				<button
					type="button"
					aria-label="Toggle changed files"
					aria-controls="hero-summary-change-files"
					aria-expanded="false"
					className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
				>
					<ChevronRight className="size-3.5 shrink-0 text-foreground-subtle transition-transform sm:hidden -rotate-90" />
					<span className="min-w-0 truncate text-[13px] font-medium text-foreground">
						{toolCall.title}
					</span>
					<span className="shrink-0 tabular-nums text-xs">
						<span className="text-diff-added">+{additions}</span>{" "}
						<span className="text-diff-removed">-{deletions}</span>
					</span>
				</button>
				<div className="flex items-center gap-1.5 text-[13px] text-foreground-subtle">
					<button
						type="button"
						aria-label="Undo"
						title="Undo"
						className="group/button inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent bg-clip-padding px-2 text-xs font-medium whitespace-nowrap text-foreground-subtle outline-none transition-all select-none hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3"
					>
						<span>Undo</span>
						<UndoIcon />
					</button>
				</div>
			</div>
			<div id="hero-summary-change-files" className="hidden sm:block">
				{files.map((file) => (
					<div
						data-state="closed"
						data-slot="collapsible"
						className="bg-background/50"
						key={file.name}
					>
						<div
							className="group/file flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-background/30"
							title={getFilePath(file, projection)}
							data-state="closed"
							data-slot="collapsible-trigger"
							aria-expanded="false"
						>
							<div className="min-w-0 flex-1">
								<span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
									<FileLanguageBadge
										language={file.language}
										name={file.name}
									/>
									<span className="truncate text-[13px] font-medium text-foreground">
										{file.name}
									</span>
								</span>
							</div>
							<span className="flex shrink-0 items-center gap-2 tabular-nums text-xs">
								<span className="text-diff-added">+{file.additions}</span>
								<span className="text-diff-removed">-{file.deletions}</span>
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function FileLanguageBadge({
	language,
	name,
}: {
	language?: string;
	name: string;
}) {
	const presentation = getFileLanguagePresentation(language, name);

	return (
		<span
			aria-hidden="true"
			className="chat-shell-file-language-badge inline-flex h-4 min-w-4 shrink-0 items-center justify-center gap-0.5 border px-1 text-[8px] font-semibold leading-none"
			data-file-language={presentation.tone}
			title={language ?? name}
		>
			{presentation.label ? (
				<span className="max-w-5 truncate">{presentation.label}</span>
			) : (
				<Icon className="size-3" name="file" />
			)}
		</span>
	);
}

export function renderInlineResponse(
	text: string,
	projection: ProjectedConversationMetadata,
) {
	const matchers = [
		...projection.inlineCode,
		...projection.fileLinks.map((file) => file.name),
	]
		.filter(Boolean)
		.sort((a, b) => b.length - a.length);

	if (matchers.length === 0) {
		return text;
	}

	const parts = text.split(
		new RegExp(`(${matchers.map(escapeRegExp).join("|")})`, "g"),
	);

	return parts.map((part, index) => {
		if (projection.inlineCode.includes(part)) {
			return (
				<code
					className="rounded bg-tag px-1.5 py-0.5 font-mono text-[13px] text-foreground"
					data-streamdown="inline-code"
					key={index}
				>
					{part}
				</code>
			);
		}

		const file = projection.fileLinks.find(
			(candidate) => candidate.name === part,
		);

		if (file) {
			return (
				<button
					type="button"
					title={getFilePath(file, projection)}
					className="wrap-anywhere cursor-pointer font-medium text-primary underline"
					key={index}
				>
					{part}
				</button>
			);
		}

		return part;
	});
}

function getFilePath(
	file: { name: string },
	projection: ProjectedConversationMetadata,
) {
	const record = file as { path?: string };

	if (record.path) {
		return record.path;
	}

	const projectedFile = projection.fileLinks.find(
		(candidate) => candidate.name === file.name,
	);

	if (projectedFile?.path) {
		return projectedFile.path;
	}

	return projection.workspacePath
		? `${projection.workspacePath}/${file.name}`
		: file.name;
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatDurationLabel(durationMs = 0) {
	if (durationMs <= 0) return "Worked";
	const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts = [durationPart(hours, "hour"), durationPart(minutes, "minute"), durationPart(seconds, "second")].filter(Boolean);
	return `Worked for ${parts.join(" ")}`;
}

function durationPart(value: number, unit: string): string {
	return value > 0 ? `${value} ${unit}${value === 1 ? "" : "s"}` : "";
}

export function ChevronRight({ className }: { className: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={`lucide lucide-chevron-right ${className}`}
			aria-hidden="true"
		>
			<path d="m9 18 6-6-6-6" />
		</svg>
	);
}

function ToolRowChevron() {
	return (
		<ChevronRight className="size-4 text-foreground-subtlest opacity-0 transition-[opacity,transform] duration-200 ease-out will-change-transform group-hover/tool-summary:opacity-100 rotate-0" />
	);
}

function ToolIcon({ icon }: { icon: "edit" | "search" | "terminal" | "tool" }) {
	if (icon === "edit") {
		return (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="24"
				height="24"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="lucide lucide-pencil size-4 shrink-0 text-foreground-subtle"
				aria-hidden="true"
			>
				<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
				<path d="m15 5 4 4" />
			</svg>
		);
	}

	if (icon === "search") {
		return (
			<span className="shrink-0">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="lucide lucide-search size-4 shrink-0 text-foreground-subtle"
					aria-hidden="true"
				>
					<path d="m21 21-4.34-4.34" />
					<circle cx="11" cy="11" r="8" />
				</svg>
			</span>
		);
	}

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="lucide lucide-square-terminal size-4 shrink-0 text-foreground-subtle"
			aria-hidden="true"
		>
			<path d="m7 11 2-2-2-2" />
			<path d="M11 13h4" />
			<rect width="18" height="18" x="3" y="3" rx="2" />
		</svg>
	);
}

function UndoIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="lucide lucide-undo2 lucide-undo-2 size-3.5"
			aria-hidden="true"
		>
			<path d="M9 14 4 9l5-5" />
			<path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
		</svg>
	);
}
