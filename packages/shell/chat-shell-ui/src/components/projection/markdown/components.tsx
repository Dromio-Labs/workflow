import {
	Children,
	type ComponentPropsWithoutRef,
	type JSX,
	type ReactNode,
} from "react";
import type { Components, ExtraProps } from "streamdown";

import type { ProjectedConversationMetadata } from "../ProjectedConversation";
import { renderInlineResponse } from "../ProjectedConversationParts";

const EXTERNAL_LINK_CLASS_NAME =
	"font-medium text-brand underline decoration-current underline-offset-2 hover:text-foreground";

export function createDromioMarkdownComponents(
	projection: ProjectedConversationMetadata,
): Components {
	const projected = (children: ReactNode) => projectChildren(children, projection);

	return {
		a: ({ children, node: _node, ...props }: MarkdownProps<"a">) => (
			<a
				{...props}
				className={EXTERNAL_LINK_CLASS_NAME}
				data-markdown="link"
				rel="noopener noreferrer"
				target="_blank"
			>
				{children}
			</a>
		),
		blockquote: ({ children, node: _node, ...props }: MarkdownProps<"blockquote">) => (
			<blockquote
				{...props}
				className="border-l-2 border-border pl-3 text-foreground-subtle"
				data-markdown="blockquote"
			>
				{projected(children)}
			</blockquote>
		),
		file: ({ children, path }) => (
			<ProjectedFileTag path={typeof path === "string" ? path : undefined} projection={projection}>
				{isReactContent(children) ? children : null}
			</ProjectedFileTag>
		),
		h1: ({ children, node: _node, ...props }: MarkdownProps<"h1">) => (
			<h1 {...props} className="text-lg font-semibold text-foreground" data-markdown="heading">
				{projected(children)}
			</h1>
		),
		h2: ({ children, node: _node, ...props }: MarkdownProps<"h2">) => (
			<h2 {...props} className="text-base font-semibold text-foreground" data-markdown="heading">
				{projected(children)}
			</h2>
		),
		h3: ({ children, node: _node, ...props }: MarkdownProps<"h3">) => (
			<h3 {...props} className="text-sm font-semibold text-foreground" data-markdown="heading">
				{projected(children)}
			</h3>
		),
		inlineCode: ({ children, node: _node, ...props }: MarkdownProps<"code">) => {
			const href = toExternalHttpUrl(children);
			if (href) {
				return (
					<a
						className={`${EXTERNAL_LINK_CLASS_NAME} font-mono text-[13px]`}
						data-markdown="link"
						href={href}
						rel="noopener noreferrer"
						target="_blank"
					>
						{children}
					</a>
				);
			}

			return (
				<code
					{...props}
					className="rounded bg-tag px-1.5 py-0.5 font-mono text-[13px] text-foreground"
					data-markdown="inline-code"
				>
					{children}
				</code>
			);
		},
		li: ({ children, node: _node, ...props }: MarkdownProps<"li">) => (
			<li {...props}>{projected(children)}</li>
		),
		ol: ({ children, node: _node, ...props }: MarkdownProps<"ol">) => (
			<ol {...props} className="list-decimal space-y-1 pl-5" data-markdown="list">
				{children}
			</ol>
		),
		p: ({ children, node: _node, ...props }: MarkdownProps<"p">) => (
			<p {...props}>{projected(children)}</p>
		),
		strong: ({ children, node: _node, ...props }: MarkdownProps<"strong">) => (
			<strong {...props} className="font-semibold text-foreground" data-markdown="bold">
				{projected(children)}
			</strong>
		),
		table: ({ children, node: _node, ...props }: MarkdownProps<"table">) => (
			<div className="max-w-full overflow-x-auto" data-markdown="table-scroll">
				<table
					{...props}
					className="w-max min-w-[36rem] border-collapse text-left text-xs"
					data-markdown="table"
				>
					{children}
				</table>
			</div>
		),
		td: ({ children, node: _node, ...props }: MarkdownProps<"td">) => (
			<td {...props} className="border border-border px-3 py-2 align-top">
				{projected(children)}
			</td>
		),
		th: ({ children, node: _node, ...props }: MarkdownProps<"th">) => (
			<th {...props} className="border border-border bg-background-alt px-3 py-2 font-semibold text-foreground">
				{projected(children)}
			</th>
		),
		ul: ({ children, node: _node, ...props }: MarkdownProps<"ul">) => (
			<ul {...props} className="list-disc space-y-1 pl-5" data-markdown="list">
				{children}
			</ul>
		),
	} as Components;
}

type MarkdownProps<Tag extends keyof JSX.IntrinsicElements> =
	ComponentPropsWithoutRef<Tag> & ExtraProps;

function toExternalHttpUrl(children: ReactNode): string | null {
	if (typeof children !== "string") return null;
	const candidate = children.trim();
	if (!URL.canParse(candidate)) return null;
	const url = new URL(candidate);
	return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
}

function ProjectedFileTag({
	children,
	path,
	projection,
}: {
	children: ReactNode;
	path?: string;
	projection: ProjectedConversationMetadata;
}) {
	const file = projection.fileLinks.find(
		(candidate) => candidate.path === path || candidate.name === path,
	);

	if (!file) {
		return <span data-markdown-file="invalid">{children}</span>;
	}

	return (
		<button
			className="wrap-anywhere cursor-pointer font-medium text-primary underline"
			data-markdown-file="projected"
			title={file.path ?? file.name}
			type="button"
		>
			{children}
		</button>
	);
}

function projectChildren(
	children: ReactNode,
	projection: ProjectedConversationMetadata,
): ReactNode {
	return Children.map(children, (child) =>
		typeof child === "string" ? renderInlineResponse(child, projection) : child,
	);
}

function isReactContent(value: unknown): value is ReactNode {
	return (
		value === null ||
		value === undefined ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		Array.isArray(value) ||
		(typeof value === "object" && "$$typeof" in value)
	);
}
