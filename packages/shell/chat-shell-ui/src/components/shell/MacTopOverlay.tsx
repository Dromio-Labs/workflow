import type {ReactNode} from "react";

import {Icon} from "../ui/Icon";
import {
  getPresentedShellControlAttributes,
  isShellControlVisible,
} from "../presentation/presentedShellControl";
import type {ResolvedShellControl} from "../presentation/resolveShellPresentationControls";

export function MacTopOverlay({
  collapsed,
  control,
  onNewTask,
  onToggleFullscreen,
  onToggleSidebar,
}: {
  collapsed: boolean;
  control: ResolvedShellControl;
  onNewTask: () => void;
  onToggleFullscreen: () => void;
  onToggleSidebar: () => void;
}) {
  if (!isShellControlVisible(control)) {
    return null;
  }

  return (
    <div className="hidden md:flex @container/topoverfay pointer-events-none absolute left-0 top-0 z-20 h-14 w-fit" style={{width: 256}}>
      <div className="flex h-14 items-center pl-5 pt-2">
        <div {...getPresentedShellControlAttributes(control)} className="pointer-events-auto flex shrink-0 items-center gap-6 [app-region:no-drag]">
          <MacTrafficLights onToggleFullscreen={onToggleFullscreen} />
          <div className="flex shrink-0 items-center gap-1.5">
            <OverlayIconButton ariaLabel="Toggle sidebar" onClick={onToggleSidebar}>
              {collapsed ? <PanelLeftOpenIcon /> : <Icon className="size-4" name="layout-panel-left" />}
            </OverlayIconButton>
            <OverlayIconButton ariaLabel="Go Back" disabled>
              <ArrowLeftIcon />
            </OverlayIconButton>
            <OverlayIconButton ariaLabel="Go Forward" disabled>
              <ArrowRightIcon />
            </OverlayIconButton>
            <div
              aria-hidden={!collapsed}
              className="inline-flex overflow-hidden transition-[opacity,width] duration-300 ease-out"
              data-state={collapsed ? "open" : "closed"}
              style={{
                opacity: collapsed ? 1 : 0,
                pointerEvents: collapsed ? "auto" : "none",
                width: collapsed ? 28 : 0,
              }}
            >
              <OverlayIconButton ariaLabel="New Task" onClick={onNewTask}>
                <Icon className="size-4" name="message-plus" />
              </OverlayIconButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MacTrafficLights({onToggleFullscreen}: {onToggleFullscreen: () => void}) {
  return (
    <div className="flex shrink-0 pl-2.5 items-center gap-3">
      <span aria-hidden="true" className="size-3 rounded-full bg-[#ff5f57] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.28)]" />
      <span aria-hidden="true" className="size-3 rounded-full bg-[#febc2e] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.28)]" />
      <button
        aria-label="Toggle fullscreen"
        className="mac-fullscreen-button relative inline-flex size-3 items-center justify-center rounded-full bg-[#28c840] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.28)] outline-none transition-[filter,transform] hover:brightness-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-[#28c840]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onToggleFullscreen}
        type="button"
      >
        <svg aria-hidden="true" className="mac-fullscreen-icon size-2" fill="none" viewBox="0 0 8 8">
          <path d="M1.5 3.25V1.5h1.75" stroke="#0b5f1c" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
          <path d="M6.5 4.75V6.5H4.75" stroke="#0b5f1c" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
        </svg>
      </button>
    </div>
  );
}

function OverlayIconButton({
  ariaLabel,
  children,
  disabled,
  onClick,
}: {
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="group/button inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap text-foreground outline-none transition-all select-none hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground disabled:pointer-events-none disabled:opacity-50 [app-region:no-drag] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ArrowLeftIcon() {
  return (
    <svg aria-hidden="true" className="lucide lucide-arrow-left size-4" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" className="lucide lucide-arrow-right size-4" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function PanelLeftOpenIcon() {
  return (
    <svg aria-hidden="true" className="lucide lucide-panel-left-open size-4" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M9 3v18" />
      <path d="m14 9 3 3-3 3" />
    </svg>
  );
}
