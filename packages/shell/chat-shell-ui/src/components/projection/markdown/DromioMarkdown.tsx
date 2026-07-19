import { useEffect, useState, type ComponentType } from "react";
import type { PluginConfig, StreamdownProps } from "streamdown";

import type { ProjectedConversationMetadata } from "../ProjectedConversation";
import { ensureClipboardWriteText } from "./clipboard";
import { createDromioMarkdownComponents } from "./components";

const MARKDOWN_CONTROLS = {
	code: { copy: true, download: false },
	mermaid: false,
	table: false,
} satisfies NonNullable<StreamdownProps["controls"]>;

export type DromioMarkdownProps = {
	content: string;
	isStreaming?: boolean;
	projection?: ProjectedConversationMetadata;
};

const defaultProjection: ProjectedConversationMetadata = {
	fileLinks: [],
	inlineCode: [],
	userTimestampLabel: "",
};

export function DromioMarkdown({
	content,
	isStreaming = false,
	projection = defaultProjection,
}: DromioMarkdownProps) {
	if (typeof window === "undefined") {
		return <MarkdownFallback content={content} />;
	}

	return (
		<ClientDromioMarkdown
			content={content}
			isStreaming={isStreaming}
			projection={projection}
		/>
	);
}

function ClientDromioMarkdown({
	content,
	isStreaming,
	projection,
}: Required<DromioMarkdownProps>) {
	const runtime = useClientStreamdown();

	useEffect(() => {
		ensureClipboardWriteText();
	}, []);

	if (!runtime) {
		return <MarkdownFallback content={content} />;
	}
	const Streamdown = runtime.Component;

	return (
		<Streamdown
			allowedTags={{ file: ["path"] }}
			className="min-w-0 max-w-full"
			components={createDromioMarkdownComponents(projection)}
			controls={MARKDOWN_CONTROLS}
			isAnimating={isStreaming}
			literalTagContent={["file"]}
			mode={isStreaming ? "streaming" : "static"}
			parseIncompleteMarkdown={isStreaming}
			plugins={runtime.plugins}
		>
			{content}
		</Streamdown>
	);
}

function MarkdownFallback({ content }: { content: string }) {
	return (
		<div className="min-w-0 max-w-full whitespace-pre-wrap" data-markdown="loading">
			{content}
		</div>
	);
}

type StreamdownComponent = ComponentType<StreamdownProps>;
interface StreamdownRuntime {
	Component: StreamdownComponent;
	plugins: PluginConfig;
}

let loadedStreamdown: StreamdownRuntime | null = null;

function useClientStreamdown(): StreamdownRuntime | null {
	const [runtime, setRuntime] = useState<StreamdownRuntime | null>(
		loadedStreamdown,
	);

	useEffect(() => {
		let active = true;
		if (loadedStreamdown) {
			setRuntime(loadedStreamdown);
			return () => {
				active = false;
			};
		}

		void Promise.all([import("streamdown"), import("./codeHighlighter")]).then(
			([{ Streamdown }, { dromioCodeHighlighter }]) => {
				loadedStreamdown = {
					Component: Streamdown,
					plugins: { code: dromioCodeHighlighter },
				};
				if (active) setRuntime(loadedStreamdown);
			},
		);

		return () => {
			active = false;
		};
	}, []);

	return runtime;
}
