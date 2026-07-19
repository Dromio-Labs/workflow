import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useId,
	useState,
} from "react";
import { createPortal } from "react-dom";

import type {
	ChatShellMenu,
	ChatShellMenuItem,
	ChatShellTask,
} from "../../contracts/chatShellManifest";
import { Icon } from "../ui/Icon";
import { taskMenuItemForPinState } from "./taskMenuPinState";

const QUICK_ACTION_ICONS = ["pin", "archive"] as const;

export function TaskItem({
	active,
	menu,
	onMenuSelect,
	onOpenContextMenu,
	onOpenKeyboardContextMenu,
	onSelectTask,
	pinned = false,
	task,
}: {
	active: boolean;
	menu: ChatShellMenu;
	onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
	onOpenContextMenu: (event: ReactMouseEvent, taskId: string) => void;
	onOpenKeyboardContextMenu: (
		event: ReactKeyboardEvent,
		taskId: string,
	) => void;
	onSelectTask: (taskId: string) => void;
	pinned?: boolean;
	task: ChatShellTask;
}) {
	const quickActions = getQuickActions(menu, pinned);

	return (
		<li
			className={[
				"group/task-item flex h-8 min-w-0 items-center rounded-lg pr-1 transition-[background-color,box-shadow]",
				"hover:bg-surface-hover focus-within:bg-surface-hover",
				active ? "bg-selected text-foreground shadow-sm" : "text-foreground",
			].join(" ")}
			data-slot="context-menu-trigger"
			data-state={active ? "open" : "closed"}
		>
			<button
				aria-current={active ? "page" : undefined}
				className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pl-2.5 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
				onClick={() => onSelectTask(task.id)}
				onContextMenu={(event) => onOpenContextMenu(event, task.id)}
				onKeyDown={(event) => onOpenKeyboardContextMenu(event, task.id)}
				type="button"
			>
				<span className="relative flex size-4 shrink-0 items-center justify-center">
					<span
						aria-hidden="true"
						className="flex size-4 items-center justify-center group-hover/task-item:hidden group-focus-within/task-item:hidden"
					>
						{task.unread ? (
							<span className="block size-1.5 rounded-full bg-brand" data-unread-indicator />
						) : null}
					</span>
				</span>
				<span className="flex h-6 min-w-0 flex-1 flex-wrap items-center gap-1.5">
					<span
						className={[
							"min-w-0 flex-1 truncate text-sm text-foreground",
							task.titleGenerating ? "animated-gradient-text" : "",
						].join(" ")}
						data-title-generating={task.titleGenerating ? "true" : undefined}
						title={task.title}
					>
						{task.title}
					</span>
				</span>
				<span className="mr-0.5 shrink-0 text-xs text-foreground-subtle group-hover/task-item:hidden group-focus-within/task-item:hidden">
					{task.timeLabel}
				</span>
			</button>
			{onMenuSelect ? (
				<div className="flex shrink-0 items-center gap-0.5">
					{quickActions.map((item) => (
						<TaskQuickAction
							item={item}
							key={item.id}
							menuId={menu.id}
							onMenuSelect={onMenuSelect}
							taskId={task.id}
						/>
					))}
				</div>
			) : null}
		</li>
	);
}

function TaskQuickAction({
	item,
	menuId,
	onMenuSelect,
	taskId,
}: {
	item: ChatShellMenuItem;
	menuId: string;
	onMenuSelect: (menuId: string, item: ChatShellMenuItem) => void;
	taskId: string;
}) {
	const tooltipId = useId();
	const [tooltip, setTooltip] = useState<{
		left: number;
		placement: "above" | "below";
		portalRoot: HTMLElement;
		top: number;
	} | null>(null);
	const showTooltip = (element: HTMLButtonElement) => {
		const rect = element.getBoundingClientRect();
		setTooltip({
			left: rect.left + rect.width / 2,
			placement: rect.top < 44 ? "below" : "above",
			portalRoot:
				element.closest<HTMLElement>(".hero-visual-theme") ?? document.body,
			top: rect.top < 44 ? rect.bottom + 6 : rect.top - 6,
		});
	};

	return (
		<>
			<button
				aria-describedby={tooltipId}
				aria-label={item.label}
				className="pointer-events-none inline-flex size-6 shrink-0 cursor-[var(--cursor-interactive)] items-center justify-center rounded-md border border-transparent text-foreground-subtle opacity-0 outline-none select-none group-hover/task-item:pointer-events-auto group-hover/task-item:opacity-100 group-focus-within/task-item:pointer-events-auto group-focus-within/task-item:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:bg-surface-hover focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-input-border-focused disabled:opacity-40"
				disabled={item.disabled}
				onBlur={() => setTooltip(null)}
				onClick={(event) => {
					event.stopPropagation();
					onMenuSelect(menuId, { ...item, value: taskId });
				}}
				onFocus={(event) => showTooltip(event.currentTarget)}
				onMouseEnter={(event) => showTooltip(event.currentTarget)}
				onMouseLeave={() => setTooltip(null)}
				type="button"
			>
				{item.icon ? <Icon className="size-3.5" name={item.icon} /> : null}
			</button>
			{tooltip
				? createPortal(
						<span
							className="pointer-events-none fixed z-100 -translate-x-1/2 whitespace-nowrap rounded-md border border-popover-border bg-tooltip px-2 py-1 text-xs text-tooltip-foreground shadow-md"
							id={tooltipId}
							role="tooltip"
							style={{
								left: tooltip.left,
								top: tooltip.top,
								transform:
									tooltip.placement === "above"
										? "translate(-50%, -100%)"
										: "translateX(-50%)",
							}}
						>
							{item.label}
						</span>,
						tooltip.portalRoot,
					)
				: null}
		</>
	);
}

function getQuickActions(
	menu: ChatShellMenu,
	pinned: boolean,
): readonly ChatShellMenuItem[] {
	const items = menu.sections.flatMap((section) => section.items);
	return QUICK_ACTION_ICONS.map((icon) =>
		items.find((item) => item.icon === icon),
	)
		.filter((item): item is ChatShellMenuItem => item !== undefined)
		.map((item) => taskMenuItemForPinState(item, pinned));
}
