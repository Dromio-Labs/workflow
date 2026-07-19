import {useState, type ReactNode} from "react";

import type {ChatShellMenuItem, ChatShellWindow} from "../../contracts/chatShellManifest";
import type {
  ResolvedShellControl,
  ResolvedWindowChromeControls,
} from "../presentation/resolveWindowChromePresentation";
import {DropdownMenu, getMenuPanelId} from "../ui/DropdownMenu";
import {Icon} from "../ui/Icon";

export const utilityControlsRight = 12;

export function getUtilityControlsWidth(controls: ResolvedWindowChromeControls) {
  const count = getVisibleUtilityControls(controls).length;
  return count === 0 ? 0 : count * 28 + (count - 1) * 8;
}

export function UtilityControls({
  controls,
  onActionTrigger,
  onToggleSidePanel,
  onToggleStatus,
  sidePanelOpen,
  statusOpen,
}: {
  controls: ResolvedWindowChromeControls;
  onActionTrigger?: (actionId: string, surface?: string) => void;
  onToggleSidePanel?: () => void;
  onToggleStatus?: () => void;
  sidePanelOpen: boolean;
  statusOpen: boolean;
}) {
  if (getVisibleUtilityControls(controls).length === 0) {
    return null;
  }

  return (
    <div
      className="absolute top-2 z-40 flex shrink-0 items-center gap-1 [app-region:no-drag] sm:gap-2"
      style={{right: utilityControlsRight}}
    >
      <PresentedIconButton active={statusOpen} ariaLabel="Toggle status panel" control={controls["chrome.status"]} onClick={onToggleStatus}><Icon className="size-4" name="square-chart" /></PresentedIconButton>
      <PresentedIconButton ariaLabel="Toggle terminal" control={controls["chrome.terminal"]} onClick={() => onActionTrigger?.("terminal.toggle", "windowChrome")}><Icon className="size-4" name="terminal" /></PresentedIconButton>
      <PresentedIconButton active={sidePanelOpen} ariaLabel={sidePanelOpen ? "Collapse side pane" : "Expand side pane"} control={controls["chrome.side-panel"]} onClick={onToggleSidePanel}>
        <PanelRightOpenIcon />
      </PresentedIconButton>
    </div>
  );
}

export function ActiveBotButton({
  control,
  menu,
  onMenuSelect,
}: {
  control: ResolvedShellControl;
  menu: NonNullable<ChatShellWindow["appPicker"]>;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState(
    menu.sections[0]?.items.find((item) => item.checked)?.label ?? "Finder",
  );
  const menuPanelId = getMenuPanelId(menu.id, "app-picker");
  const disabledReason = control.resolution.state === "disabled"
    ? control.resolution.reason
    : undefined;
  const handleSelect = (item: ChatShellMenuItem) => {
    onMenuSelect?.(menu.id, item);
    setSelectedApp(item.value ?? item.label);
    setOpen(false);
  };

  return (
    <DropdownMenu className="right-0 top-full mt-1 w-44" menu={menu} onClose={() => setOpen(false)} onSelect={handleSelect} open={open} selectedValue={selectedApp}>
      <div className="flex items-center h-7 rounded-lg border border-border bg-input overflow-hidden p-0 hover:border-border-hover">
        <button aria-controls={menuPanelId} aria-description={disabledReason} aria-expanded={open} aria-haspopup="menu" aria-label={`Open in ${selectedApp}`} className="group/button inline-flex shrink-0 items-center justify-center border-transparent bg-clip-padding text-[13px]/relaxed whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 text-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg:not([class*=size-])]:size-4 size-7 rounded-none border-0" data-size="icon-md" data-slot="button" data-variant="ghost" disabled={Boolean(disabledReason)} onClick={() => setOpen((value) => !value)} title={disabledReason ?? `Open in ${selectedApp}`} type="button">
          <span aria-hidden="true" className="chat-shell-app-picker-icon flex size-5 shrink-0 items-center justify-center border border-border/70 bg-surface text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <Icon className="size-3.5" name="spark" />
          </span>
        </button>
        <button aria-controls={menuPanelId} aria-description={disabledReason} aria-expanded={open} aria-haspopup="menu" aria-label="Choose app" className="group/button inline-flex shrink-0 items-center justify-center border-transparent bg-clip-padding text-[13px]/relaxed whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground size-7 [&_svg:not([class*=size-])]:size-4 rounded-none border-0 text-foreground-subtlest !w-5" data-size="icon-md" data-slot="dropdown-menu-trigger" data-variant="ghost" disabled={Boolean(disabledReason)} onClick={() => setOpen((value) => !value)} title={disabledReason ?? "Choose app"} type="button">
          <Icon className="size-3.5" name="chevron-down" />
        </button>
      </div>
    </DropdownMenu>
  );
}

function getVisibleUtilityControls(controls: ResolvedWindowChromeControls) {
  return [
    controls["chrome.status"],
    controls["chrome.terminal"],
    controls["chrome.side-panel"],
  ].filter((control) => control.resolution.state !== "hidden");
}

function PresentedIconButton({
  control,
  ...props
}: Parameters<typeof IconButton>[0] & {readonly control: ResolvedShellControl}) {
  if (control.resolution.state === "hidden") {
    return null;
  }

  return (
    <span
      className="relative inline-flex"
      data-shell-control-configurable={control.policy.userConfigurable}
      data-shell-control-id={control.id}
      data-shell-control-label={control.label}
      data-shell-control-required={control.policy.required ?? false}
      data-shell-control-state={control.resolution.state}
    >
      <IconButton
        {...props}
        disabledReason={control.resolution.state === "disabled" ? control.resolution.reason : undefined}
      />
    </span>
  );
}

function IconButton({
  active,
  ariaLabel,
  children,
  disabledReason,
  onClick,
}: {
  active?: boolean;
  ariaLabel: string;
  children: ReactNode;
  disabledReason?: string;
  onClick?: () => void;
}) {
  return (
    <button
      aria-description={disabledReason}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={[
        "group/button inline-flex items-center justify-center border border-transparent bg-clip-padding text-[13px]/relaxed whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 aria-expanded:bg-hover aria-expanded:text-foreground size-7 rounded-lg [&_svg:not([class*='size-'])]:size-4 shrink-0 hover:bg-hover hover:text-foreground focus:ring-2 focus:ring-ring/60",
        active ? "!bg-selected text-foreground" : "bg-clip-padding text-foreground",
      ].join(" ")}
      disabled={Boolean(disabledReason)}
      onClick={onClick}
      title={disabledReason}
      type="button"
    >
      {children}
    </button>
  );
}

function PanelRightOpenIcon() {
  return (
    <svg aria-hidden="true" className="lucide lucide-panel-right-open size-4" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M15 3v18" />
      <path d="m10 15-3-3 3-3" />
    </svg>
  );
}
