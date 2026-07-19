export type ShellShortcutAction =
	| "new-chat"
	| "toggle-sidebar"
	| "toggle-side-panel";

type ShellShortcutBinding = {
	action: ShellShortcutAction;
	altKey: boolean;
	code: "KeyB" | "KeyN";
	ctrlKey: boolean;
	label: string;
	metaKey: boolean;
	shiftKey: boolean;
};

const shellWebShortcutBindings: readonly ShellShortcutBinding[] = [
	{
		action: "new-chat",
		altKey: false,
		code: "KeyN",
		ctrlKey: true,
		label: "⌃N",
		metaKey: false,
		shiftKey: false,
	},
	{
		action: "toggle-sidebar",
		altKey: false,
		code: "KeyB",
		ctrlKey: false,
		label: "⌘B",
		metaKey: true,
		shiftKey: false,
	},
	{
		action: "toggle-side-panel",
		altKey: true,
		code: "KeyB",
		ctrlKey: false,
		label: "⌥⌘B",
		metaKey: true,
		shiftKey: false,
	},
];

export function resolveShellWebShortcut(
	event: Pick<
		KeyboardEvent,
		| "altKey"
		| "code"
		| "ctrlKey"
		| "defaultPrevented"
		| "metaKey"
		| "repeat"
		| "shiftKey"
	>,
): ShellShortcutAction | null {
	if (event.defaultPrevented || event.repeat) return null;

	return (
		shellWebShortcutBindings.find(
			(binding) =>
				binding.code === event.code &&
				binding.altKey === event.altKey &&
				binding.ctrlKey === event.ctrlKey &&
				binding.metaKey === event.metaKey &&
				binding.shiftKey === event.shiftKey,
		)?.action ?? null
	);
}

export function getShellWebShortcutLabel(action: ShellShortcutAction): string {
	const binding = shellWebShortcutBindings.find(
		(candidate) => candidate.action === action,
	);
	if (!binding) throw new Error(`Missing shell-web shortcut for ${action}.`);
	return binding.label;
}
