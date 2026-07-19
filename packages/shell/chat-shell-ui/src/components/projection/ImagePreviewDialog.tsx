import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Icon } from "../ui/Icon";

export function ImagePreviewDialog({
	name,
	onClose,
	openerRef,
	url,
}: {
	name: string;
	onClose: () => void;
	openerRef: RefObject<HTMLButtonElement | null>;
	url: string;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		closeRef.current?.focus();

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key === "Tab") {
				event.preventDefault();
				closeRef.current?.focus();
			}
		};
		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			document.removeEventListener("keydown", handleKeyDown);
			openerRef.current?.focus();
		};
	}, [onClose, openerRef]);

	if (typeof document === "undefined") return null;

	return createPortal(
		<div
			aria-label={`Image preview: ${name}`}
			aria-modal="true"
			className="hero-visual-theme fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
			role="dialog"
		>
			<figure className="m-0 flex max-h-full max-w-full flex-col items-center gap-3">
				<img
					alt={name}
					className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] rounded-lg object-contain shadow-2xl sm:max-w-[calc(100vw-4rem)]"
					src={url}
				/>
				<figcaption className="max-w-[min(42rem,calc(100vw-4rem))] truncate text-sm text-white/80">
					{name}
				</figcaption>
			</figure>
			<button
				aria-label="Close image preview"
				className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-5 sm:top-5"
				onClick={onClose}
				ref={closeRef}
				type="button"
			>
				<Icon className="size-5" name="x" />
			</button>
		</div>,
		document.body,
	);
}
