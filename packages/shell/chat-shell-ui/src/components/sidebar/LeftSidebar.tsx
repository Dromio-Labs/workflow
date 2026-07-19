import type {ChatShellAction, ChatShellMenuItem, ChatShellSidebar, ChatShellTasks, ChatShellUser} from "../../contracts/chatShellManifest";
import type {ResolvedShellControls} from "../presentation/resolveShellPresentationControls";
import {SidebarNav} from "./SidebarNav";
import {TasksPanel} from "./TasksPanel";
import {UserFooter} from "./UserFooter";

export function LeftSidebar({
  collapsed = false,
  controls,
  navActions,
  onActionTrigger,
  onMenuSelect,
  onOpenSettings,
  onSelectTask,
  sidebar,
  tasks,
  user,
  width,
}: {
  collapsed?: boolean;
  controls: ResolvedShellControls;
  navActions: ChatShellAction[];
  onActionTrigger?: (actionId: string, surface?: string) => void;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onOpenSettings: () => void;
  onSelectTask: (taskId: string) => void;
  sidebar: ChatShellSidebar;
  tasks: ChatShellTasks;
  user: ChatShellUser;
  width?: number;
}) {
  const isResizable = typeof width === "number";
  const widthStyle = isResizable ? {width} : undefined;
  const frameTransition = isResizable ? "transition-[opacity,transform]" : "transition-[width,opacity,transform]";
  const frameSizeClass = isResizable
    ? collapsed
      ? "opacity-0 -translate-x-1 pointer-events-none"
      : "opacity-100 translate-x-0"
    : collapsed
      ? "w-2 opacity-0"
      : "w-56 md:w-60 lg:w-64 opacity-100";

  return (
    <section
      className={[
        "relative h-full min-h-0 flex-col shrink-0 overflow-hidden duration-300 ease-out hidden md:block bg-transparent",
        frameTransition,
        frameSizeClass,
      ].join(" ")}
      style={widthStyle}
    >
      <div
        className={[
          "flex h-full min-h-0 flex-col transition-transform duration-300 ease-out translate-x-0",
          isResizable ? "" : "w-56 md:w-60 lg:w-64",
        ].join(" ")}
        style={widthStyle}
      >
        <div className="h-12 shrink-0 [app-region:drag]" />
        <SidebarNav actions={navActions} onActionTrigger={onActionTrigger} />
        <TasksPanel controls={controls} onActionTrigger={onActionTrigger} onMenuSelect={onMenuSelect} onSelectTask={onSelectTask} sidebar={sidebar} tasks={tasks} />
        <UserFooter control={controls["sidebar.user"]} onMenuSelect={onMenuSelect} onOpenSettings={onOpenSettings} user={user} />
      </div>
    </section>
  );
}
