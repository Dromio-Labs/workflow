import { useEffect } from "react";

import {
	resolveShellWebShortcut,
	type ShellShortcutAction,
} from "./shellShortcuts";

export function useShellKeyboardShortcuts(
	handlers: Readonly<Record<ShellShortcutAction, () => void>>,
): void {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

			const action = resolveShellWebShortcut(event);
			if (!action) return;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			handlers[action]();
		};

		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [handlers]);
}
