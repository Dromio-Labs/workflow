import type {ChatShellAction} from "../../contracts/chatShellManifest";
import {Icon} from "../ui/Icon";

export function SidebarNav({actions, onActionTrigger}: {actions: ChatShellAction[]; onActionTrigger?: (actionId: string, surface?: string) => void}) {
  return (
    <div className="flex flex-col gap-1 px-2 py-3">
      {actions.map((action) => (
        <SidebarActionButton action={action} key={action.id} onActionTrigger={onActionTrigger} />
      ))}
    </div>
  );
}

function SidebarActionButton({action, onActionTrigger}: {action: ChatShellAction; onActionTrigger?: (actionId: string, surface?: string) => void}) {
  return (
    <button type="button" onClick={() => onActionTrigger?.(action.id, "sidebar")} data-icon="inline-start" data-size="lg" data-slot="button" data-variant="ghost" className="group/button inline-flex h-8 w-full shrink-0 items-center justify-start gap-2 rounded-lg border border-transparent bg-clip-padding px-2.5 text-sm font-medium whitespace-nowrap text-foreground outline-none transition-all select-none hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-expanded:bg-hover aria-expanded:text-foreground has-data-[icon=inline-start]:pl-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4">
      <Icon className="size-4 shrink-0" name={action.icon} />
      <span className="truncate">{action.label}</span>
      {action.shortcut ? <span className="ml-auto shrink-0 text-[11px] font-normal text-foreground-subtlest">{action.shortcut}</span> : null}
    </button>
  );
}
