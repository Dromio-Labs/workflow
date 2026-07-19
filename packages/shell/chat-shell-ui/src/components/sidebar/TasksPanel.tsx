import {useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent} from "react";
import {createPortal} from "react-dom";

import type {ChatShellMenu, ChatShellMenuItem, ChatShellSidebar, ChatShellTasks, ChatShellWorkspace} from "../../contracts/chatShellManifest";
import {
  getPresentedShellControlAttributes,
  isShellControlVisible,
} from "../presentation/presentedShellControl";
import type {ResolvedShellControls} from "../presentation/resolveShellPresentationControls";
import {MenuPanel} from "../ui/DropdownMenu";
import {Icon} from "../ui/Icon";
import {TaskItem} from "./TaskItem";
import {taskMenuForPinState} from "./taskMenuPinState";

type SidebarContextMenuState =
  | {
      kind: "task";
      taskId: string;
      x: number;
      y: number;
    }
  | {
      kind: "workspace";
      workspaceId: string;
      x: number;
      y: number;
    };

export function TasksPanel({
  controls,
  onActionTrigger,
  onMenuSelect,
  onSelectTask,
  sidebar,
  tasks,
}: {
  controls: ResolvedShellControls;
  onActionTrigger?: (actionId: string, surface?: string) => void;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onSelectTask: (taskId: string) => void;
  sidebar: ChatShellSidebar;
  tasks: ChatShellTasks;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollbar, setScrollbar] = useState({height: 0, top: 0, visible: false});
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [filterQuery, setFilterQuery] = useState("");

  const listedTasks = {
    ...tasks,
    pinned: tasks.pinned?.filter((task) => !task.ephemeral),
    workspaces: tasks.workspaces.map((workspace) => ({
      ...workspace,
      tasks: workspace.tasks.filter((task) => !task.ephemeral),
    })),
  };
  const normalizedFilter = filterQuery.trim().toLowerCase();
  const visibleTasks = normalizedFilter.length === 0
    ? listedTasks
    : {
      ...listedTasks,
      pinned: listedTasks.pinned?.filter((task) =>
        task.title.toLowerCase().includes(normalizedFilter) || task.id === tasks.activeTaskId,
      ),
      workspaces: listedTasks.workspaces.map((workspace) => ({
        ...workspace,
        tasks: workspace.tasks.filter((task) =>
          task.title.toLowerCase().includes(normalizedFilter) || task.id === tasks.activeTaskId,
        ),
      })),
    };
  const pinnedTaskIds = new Set((visibleTasks.pinned ?? []).map((task) => task.id));

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return undefined;
    }

    const updateScrollbar = () => {
      const {clientHeight, scrollHeight, scrollTop} = scrollElement;
      const maxScrollTop = scrollHeight - clientHeight;

      if (maxScrollTop <= 1) {
        setScrollbar({height: 0, top: 0, visible: false});
        return;
      }

      const height = Math.max(96, Math.min(clientHeight - 8, (clientHeight / scrollHeight) * clientHeight));
      const top = (scrollTop / maxScrollTop) * (clientHeight - height);
      setScrollbar({height, top, visible: true});
    };

    updateScrollbar();

    const resizeObserver = new ResizeObserver(updateScrollbar);
    resizeObserver.observe(scrollElement);
    if (scrollElement.firstElementChild) {
      resizeObserver.observe(scrollElement.firstElementChild);
    }

    scrollElement.addEventListener("scroll", updateScrollbar, {passive: true});

    return () => {
      resizeObserver.disconnect();
      scrollElement.removeEventListener("scroll", updateScrollbar);
    };
  }, [tasks]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const handlePointerDown = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    const handleScroll = () => setContextMenu(null);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleScroll);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleScroll);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [contextMenu]);

  const openTaskContextMenu = (event: ReactMouseEvent, taskId: string) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectTask(taskId);
    setContextMenu({
      kind: "task",
      taskId,
      ...getContextMenuPosition(event.clientX, event.clientY, 288, 396),
    });
  };

  const openWorkspaceContextMenu = (event: ReactMouseEvent, workspaceId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "workspace",
      workspaceId,
      ...getContextMenuPosition(event.clientX, event.clientY, 272, 244),
    });
  };

  const openKeyboardContextMenu = (event: ReactKeyboardEvent, kind: SidebarContextMenuState["kind"], id: string) => {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = getContextMenuPosition(rect.left + 18, rect.top + rect.height - 4, kind === "task" ? 288 : 272, kind === "task" ? 396 : 244);

    if (kind === "task") {
      onSelectTask(id);
      setContextMenu({kind, taskId: id, ...position});
      return;
    }

    setContextMenu({kind, workspaceId: id, ...position});
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pt-2">
      <div className="mb-4 flex min-h-0 flex-col gap-1 px-2 empty:hidden" />
      <div className="flex items-center justify-between gap-2 pl-[18px] pr-3">
        <h3 className="min-w-0 text-[13px] font-semibold text-foreground-subtlest">{sidebar.tasksTitle}</h3>
        {isShellControlVisible(controls["sidebar.archive"]) ? <button {...getPresentedShellControlAttributes(controls["sidebar.archive"])} type="button" aria-label={sidebar.archiveToggle.label} data-state="off" className="group/button inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap text-foreground-subtle outline-none transition-all select-none hover:border-border-hover hover:bg-input/50 hover:text-foreground data-[state=on]:bg-hover data-[state=on]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3" onClick={() => onActionTrigger?.("tasks.archive.toggle", "sidebar")}>
          <Icon className="size-3.5 shrink-0" name={sidebar.archiveToggle.icon} />
        </button> : null}
      </div>
      {sidebar.filter && isShellControlVisible(controls["sidebar.filter"]) ? (
        <div {...getPresentedShellControlAttributes(controls["sidebar.filter"])} className="px-2">
          <input
            aria-label={sidebar.filter.placeholder}
            className="h-7 w-full rounded-lg border border-border bg-input/50 px-2.5 text-[13px] text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-focused"
            placeholder={sidebar.filter.placeholder}
            type="search"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
          />
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1">
        {scrollbar.visible ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-1 top-0 z-10 w-[5px] rounded-full bg-foreground-subtlest/45"
            style={{height: scrollbar.height, transform: `translateY(${scrollbar.top}px)`}}
          />
        ) : null}
        <div data-top="true" data-bottom="true" className="hero-sidebar-scroll-mask hero-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" ref={scrollRef}>
          <div className="flex min-h-0 flex-col gap-3 px-2">
            {visibleTasks.pinned?.length ? (
              <section aria-labelledby="pinned-threads-heading" className="space-y-1">
                <h3
                  className="px-2.5 text-[13px] font-medium text-foreground-subtlest"
                  id="pinned-threads-heading"
                >
                  Pinned
                </h3>
                <ul className="space-y-0.5" data-testid="pinned-thread-list">
                  {visibleTasks.pinned.map((task) => (
                    <TaskItem
                      active={task.id === visibleTasks.activeTaskId}
                      key={task.id}
                      menu={sidebar.contextMenus.task}
                      onMenuSelect={onMenuSelect}
                      onOpenContextMenu={openTaskContextMenu}
                      onOpenKeyboardContextMenu={(event, taskId) =>
                        openKeyboardContextMenu(event, "task", taskId)
                      }
                      onSelectTask={onSelectTask}
                      pinned
                      task={task}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            <ul className="space-y-2 pb-4" data-testid="workspace-list">
              {visibleTasks.workspaces.map((workspace) => (
                <WorkspaceGroup
                  activeTaskId={visibleTasks.activeTaskId}
                  key={workspace.id}
                  onOpenKeyboardContextMenu={openKeyboardContextMenu}
                  onOpenTaskContextMenu={openTaskContextMenu}
                  onOpenWorkspaceContextMenu={openWorkspaceContextMenu}
                  onActionTrigger={onActionTrigger}
                  onMenuSelect={onMenuSelect}
                  onSelectTask={onSelectTask}
                  pinnedTaskIds={pinnedTaskIds}
                  taskMenu={sidebar.contextMenus.task}
                  workspace={workspace}
                  workspaceMenu={sidebar.contextMenus.workspace}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
      {contextMenu ? (
        <SidebarContextMenu
          contextValue={contextMenu.kind === "task" ? contextMenu.taskId : contextMenu.workspaceId}
          menu={contextMenu.kind === "task"
            ? taskMenuForPinState(
                sidebar.contextMenus.task,
                tasks.pinned?.some((task) => task.id === contextMenu.taskId) ?? false,
              )
            : sidebar.contextMenus.workspace}
          onClose={() => setContextMenu(null)}
          onMenuSelect={onMenuSelect}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      ) : null}
    </div>
  );
}

function WorkspaceGroup({
  activeTaskId,
  onActionTrigger,
  onOpenKeyboardContextMenu,
  onOpenTaskContextMenu,
  onOpenWorkspaceContextMenu,
  onMenuSelect,
  onSelectTask,
  pinnedTaskIds,
  taskMenu,
  workspace,
  workspaceMenu,
}: {
  activeTaskId: string;
  onActionTrigger?: (actionId: string, surface?: string) => void;
  onOpenKeyboardContextMenu: (event: ReactKeyboardEvent, kind: SidebarContextMenuState["kind"], id: string) => void;
  onOpenTaskContextMenu: (event: ReactMouseEvent, taskId: string) => void;
  onOpenWorkspaceContextMenu: (event: ReactMouseEvent, workspaceId: string) => void;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onSelectTask: (taskId: string) => void;
  pinnedTaskIds: ReadonlySet<string>;
  taskMenu: ChatShellMenu;
  workspace: ChatShellWorkspace;
  workspaceMenu: ChatShellMenu;
}) {
  const [open, setOpen] = useState(true);
  const state = open ? "open" : "closed";
  const workspaceTasks = workspace.tasks.filter((task) => !pinnedTaskIds.has(task.id));

  return (
    <li className="space-y-2">
      <div data-state={state} data-slot="collapsible" className="flex flex-col gap-1">
        {/* Actions are siblings of the trigger: buttons cannot nest. */}
        <div className="group flex h-8 min-w-0 items-center gap-1 rounded-lg pr-1 transition-all hover:bg-surface-hover">
          <button
            type="button"
            data-slot="collapsible-trigger"
            data-state={state}
            aria-expanded={open}
            aria-label={`Toggle ${workspace.name} workspace`}
            className="group/button flex h-8 min-w-0 flex-1 items-center justify-start gap-2 rounded-lg border border-transparent bg-clip-padding px-2 pl-2.5 text-left text-xs/relaxed font-medium whitespace-nowrap text-foreground outline-none transition-all select-none hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground focus-visible:ring-2 focus-visible:ring-input-border-focused [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
            onClick={() => setOpen((value) => !value)}
            onContextMenu={(event) => onOpenWorkspaceContextMenu(event, workspace.id)}
            onKeyDown={(event) => onOpenKeyboardContextMenu(event, "workspace", workspace.id)}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="relative flex size-4 shrink-0 items-center justify-center"><Icon className="h-4 w-4 text-foreground-subtle" name={open ? "folder-open" : "folder"} /></span>
              <div className="min-w-0 truncate text-[13px] text-foreground-subtle">{workspace.name}</div>
            </div>
          </button>
          <WorkspaceActions
            menu={workspaceMenu}
            onActionTrigger={onActionTrigger}
            onOpenContextMenu={onOpenWorkspaceContextMenu}
            workspaceId={workspace.id}
          />
        </div>
        {workspaceTasks.length ? (
          <div
            data-state={state}
            data-slot="collapsible-content"
            className={[
              "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
              open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            ].join(" ")}
          >
            <div
              className={[
                "min-h-0 overflow-hidden transition-opacity duration-100 ease-out",
                open ? "opacity-100" : "opacity-0",
              ].join(" ")}
            >
              <div className="flex flex-col gap-2"><div><div className="space-y-1"><ul className="space-y-0.5">
                {workspaceTasks.map((task) => (
                  <TaskItem
                    active={task.id === activeTaskId}
                    key={task.id}
                    menu={taskMenu}
                    onMenuSelect={onMenuSelect}
                    onOpenContextMenu={onOpenTaskContextMenu}
                    onOpenKeyboardContextMenu={(event, taskId) =>
                      onOpenKeyboardContextMenu(event, "task", taskId)
                    }
                    onSelectTask={onSelectTask}
                    task={task}
                  />
                ))}
              </ul></div></div></div>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function WorkspaceActions({
  menu,
  onActionTrigger,
  onOpenContextMenu,
  workspaceId,
}: {
  menu: ChatShellMenu;
  onActionTrigger?: (actionId: string, surface?: string) => void;
  onOpenContextMenu: (event: ReactMouseEvent, workspaceId: string) => void;
  workspaceId: string;
}) {
  const hasWorkspaceActions = menu.sections.some((section) => section.items.length > 0);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex shrink-0 items-center gap-1">
        {hasWorkspaceActions ? (
          <button type="button" aria-label="Workspace actions" title="Workspace actions" data-size="icon-sm" data-slot="dropdown-menu-trigger" data-variant="ghost" className="group/button inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap text-foreground-subtle opacity-0 outline-none transition-all select-none group-hover:opacity-100 hover:bg-surface-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3" onClick={(event) => onOpenContextMenu(event, workspaceId)}>
            <Icon className="size-3.5" name="more" />
          </button>
        ) : null}
        <button type="button" aria-label="New chat in workspace" title="New chat" data-size="icon-sm" data-slot="button" data-variant="ghost" className="group/button inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap text-foreground-subtle opacity-0 outline-none transition-all select-none group-hover:opacity-100 hover:bg-surface-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3" onClick={(event) => { event.stopPropagation(); onActionTrigger?.(`workspace.${workspaceId}.task.new`, "sidebar"); }}>
          <Icon className="h-3.5 w-3.5" name="message-plus" />
        </button>
      </div>
    </div>
  );
}

function SidebarContextMenu({
  contextValue,
  menu,
  onClose,
  onMenuSelect,
  x,
  y,
}: {
  contextValue: string;
  menu: ChatShellMenu;
  onClose: () => void;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  x: number;
  y: number;
}) {
  return createPortal(
    <div
      className="hero-visual-theme fixed z-[2147481000]"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{left: x, top: y}}
    >
      <MenuPanel
        className="w-72 shadow-[0_18px_44px_rgba(0,0,0,0.34)]"
        menu={menu}
        onClose={onClose}
        onSelect={(item) => {
          onMenuSelect?.(menu.id, {...item, value: contextValue});
          onClose();
        }}
      />
    </div>,
    document.body,
  );
}

function getContextMenuPosition(clientX: number, clientY: number, width: number, height: number) {
  const padding = 8;
  const x = Math.max(padding, Math.min(clientX, window.innerWidth - width - padding));
  const y = Math.max(padding, Math.min(clientY, window.innerHeight - height - padding));

  return {x, y};
}
