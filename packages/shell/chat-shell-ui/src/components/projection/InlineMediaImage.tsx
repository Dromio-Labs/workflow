import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "@chatshell/response-protocol";
import { ImagePreviewDialog } from "./ImagePreviewDialog";

type InlineMedia = NonNullable<ChatMessage["media"]>[number];

export function InlineMediaImage({
	className,
	item,
}: {
	className: string;
	item: InlineMedia;
}) {
	const [imageState, setImageState] = useState<{
		status: "loading" | "ready" | "error";
		url: string;
	}>({
		status: item.availability === "unavailable" ? "error" : "loading",
		url: item.url,
	});
	const [resolvedUrl, setResolvedUrl] = useState(item.url);
	const [attempt, setAttempt] = useState(0);
	const [previewOpen, setPreviewOpen] = useState(false);
	const previewTriggerRef = useRef<HTMLButtonElement>(null);
	const loadState = imageState.url === resolvedUrl ? imageState.status : "loading";

	useEffect(() => {
		setResolvedUrl(item.url);
		setImageState({
			status: item.availability === "unavailable" ? "error" : "loading",
			url: item.url,
		});
	}, [item.availability, item.url]);

	async function retryImage() {
		setAttempt((current) => current + 1);
		if (!item.retryUrl) return;
		try {
			const response = await fetch(item.retryUrl, {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expiresInSeconds: 300 }),
			});
			if (!response.ok) throw new Error(`Media grant failed (${response.status}).`);
			const grant = (await response.json()) as { url: string };
			setResolvedUrl(grant.url);
			setImageState({ status: "loading", url: grant.url });
		} catch {
			setImageState({ status: "error", url: resolvedUrl });
		}
	}

	if (loadState === "error") {
		return (
			<div
				className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 text-center text-xs text-foreground-subtle"
				role="alert"
			>
				<span>{item.name} is unavailable.</span>
				{item.error ? <span className="sr-only">{item.error}</span> : null}
				<button
					className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-hover"
					onClick={() => void retryImage()}
					type="button"
				>
					Retry image
				</button>
			</div>
		);
	}

	return (
		<>
			<button
				aria-busy={loadState === "loading"}
				aria-expanded={previewOpen}
				aria-haspopup="dialog"
				aria-label={`Preview ${item.name}`}
				className="relative block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border bg-card text-left"
				onClick={() => setPreviewOpen(true)}
				ref={previewTriggerRef}
				type="button"
			>
				{loadState === "loading" ? (
					<span className="absolute inset-0 flex items-center justify-center text-xs text-foreground-subtle">
						Loading image…
					</span>
				) : null}
				<img
					alt={item.name}
					className={`${className} pointer-events-none`}
					key={attempt}
					loading="eager"
					onError={() => setImageState({ status: "error", url: resolvedUrl })}
					onLoad={() => setImageState({ status: "ready", url: resolvedUrl })}
					src={resolvedUrl}
				/>
			</button>
			{previewOpen ? (
				<ImagePreviewDialog
					name={item.name}
					onClose={() => setPreviewOpen(false)}
					openerRef={previewTriggerRef}
					url={resolvedUrl}
				/>
			) : null}
		</>
	);
}
