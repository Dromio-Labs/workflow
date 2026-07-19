import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from "react";
import {createPortal} from "react-dom";

import type {ChatShellMenuItem, ChatShellWindow} from "../../contracts/chatShellManifest";
import {DropdownMenu, getMenuPanelId, MenuPanel} from "../ui/DropdownMenu";
import {Icon} from "../ui/Icon";
import {
  getPresentedShellControlAttributes,
  isShellControlVisible,
} from "../presentation/presentedShellControl";
import type {ResolvedShellControls} from "../presentation/resolveShellPresentationControls";
import {
  ActiveBotButton,
  getUtilityControlsWidth,
  UtilityControls,
  utilityControlsRight,
} from "./WindowChromeControls";

const sidePanelSurface = "#181818";
const sidePanelDivider = "#303030";
const appPickerWidth = 64;
const appPickerGap = 8;

export function WindowChrome({
  collapsedSidebar = false,
  compactLayout = false,
  controls,
  onActionTrigger,
  onMenuSelect,
  onToggleSidePanel,
  onToggleStatus,
  sidebarWidth,
  sidePanelOpen = false,
  sidePanelResizing = false,
  sidePanelTabs,
  sidePanelWidth = 384,
  statusOpen = true,
  window,
}: {
  collapsedSidebar?: boolean;
  compactLayout?: boolean;
  controls: ResolvedShellControls;
  onActionTrigger?: (actionId: string, surface?: string) => void;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onToggleSidePanel?: () => void;
  onToggleStatus?: () => void;
  sidebarWidth?: number;
  sidePanelOpen?: boolean;
  sidePanelResizing?: boolean;
  sidePanelTabs?: ReactNode;
  sidePanelWidth?: number;
  statusOpen?: boolean;
  window: ChatShellWindow;
}) {
  const [selectedBranch, setSelectedBranch] = useState(window.branch);
  const headerControlsVisible = useMediaQuery("(min-width: 640px)");
  const appPicker = window.appPicker;
  const appPickerVisible = controls["chrome.app-picker"].resolution.state !== "hidden" && Boolean(appPicker);
  const utilityControlsWidth = getUtilityControlsWidth(controls);
  const visibleSidebarWidth = compactLayout ? 0 : sidebarWidth ?? (collapsedSidebar ? 8 : 256);
  const headerPaddingLeft = compactLayout ? 16 : Math.max(16, 272 - visibleSidebarWidth);
  const appPickerRight = sidePanelOpen ? sidePanelWidth + appPickerGap : utilityControlsRight + utilityControlsWidth + appPickerGap;
  const visibleChromeWidth = utilityControlsWidth + (appPickerVisible ? appPickerGap + appPickerWidth : 0);
  const headerPaddingRight = headerControlsVisible ? utilityControlsRight + visibleChromeWidth + 12 : utilityControlsRight + utilityControlsWidth + 12;
  const headerStyle = {
    paddingLeft: headerPaddingLeft,
    paddingRight: headerPaddingRight,
  } as CSSProperties;

  return (
    <section className="relative overflow-visible flex flex-col h-12 shrink-0">
      <header className="relative flex h-12 w-full shrink-0" data-testid="workspace-header">
        <div
          aria-hidden="true"
          className={[
            "pointer-events-none absolute bottom-0 left-0 z-10 h-px bg-border",
            sidePanelResizing ? "transition-none" : "transition-[right] duration-300 ease-out",
          ].join(" ")}
          style={{right: sidePanelOpen ? sidePanelWidth : 0}}
        />
        <div
          className={[
            "flex h-12 min-w-0 flex-1 items-center justify-between gap-2 py-2 [app-region:drag]",
            sidePanelResizing ? "transition-none" : "transition-[padding] duration-300",
          ].join(" ")}
          style={headerStyle}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 [app-region:no-drag]">
            <WorkspaceTitle title={window.title} titleGenerating={window.titleGenerating} />
            <WorkspacePill control={controls["chrome.workspace"]} workspace={window.workspace} />
            <BranchPill branch={selectedBranch} control={controls["chrome.branch"]} menu={window.branchMenu} onMenuSelect={onMenuSelect} onSelectBranch={setSelectedBranch} />
            <HeaderMoreMenu control={controls["chrome.more"]} menu={window.moreMenu} onMenuSelect={onMenuSelect} />
          </div>
          {sidePanelTabs ? (
            <div
              aria-hidden={!sidePanelOpen}
              className={[
                "absolute inset-y-0 right-0 z-20 hidden max-w-full items-center gap-3 border-l pl-3.5 pr-[118px] [app-region:no-drag] sm:flex",
                sidePanelResizing ? "transition-none" : "transition-[opacity,transform,width] duration-300 ease-out",
                sidePanelOpen ? "opacity-100 translate-x-0" : "pointer-events-none opacity-0 translate-x-full",
              ].join(" ")}
              data-side-panel-header
              style={{backgroundColor: sidePanelSurface, borderColor: sidePanelDivider, width: `min(100%, ${sidePanelWidth}px)`}}
            >
              {sidePanelTabs}
            </div>
          ) : null}
          {appPickerVisible && appPicker ? <div
            className={[
              "absolute top-2 z-30 hidden [app-region:no-drag] sm:flex",
              sidePanelResizing ? "transition-none" : "transition-[right] duration-300 ease-out",
            ].join(" ")}
            data-shell-control-configurable={controls["chrome.app-picker"].policy.userConfigurable}
            data-shell-control-id="chrome.app-picker"
            data-shell-control-label={controls["chrome.app-picker"].label}
            data-shell-control-required={controls["chrome.app-picker"].policy.required ?? false}
            data-shell-control-state={controls["chrome.app-picker"].resolution.state}
            style={{right: appPickerRight}}
          >
            <ActiveBotButton control={controls["chrome.app-picker"]} menu={appPicker} onMenuSelect={onMenuSelect} />
          </div> : null}
          <UtilityControls
            controls={controls}
            onActionTrigger={onActionTrigger}
            onToggleSidePanel={onToggleSidePanel}
            onToggleStatus={onToggleStatus}
            sidePanelOpen={sidePanelOpen}
            statusOpen={statusOpen}
          />
        </div>
      </header>
    </section>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => getMediaQueryMatch(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function getMediaQueryMatch(query: string) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(query).matches;
}

function WorkspaceTitle({title, titleGenerating}: {title: string; titleGenerating?: boolean}) {
  return (
    <h1 className="flex min-w-12 max-w-100 shrink items-center gap-2 truncate text-[13px] font-semibold text-foreground" data-testid="workspace-title" title={title}>
      <span
        className={["min-w-0 truncate", titleGenerating ? "animated-gradient-text" : ""].join(" ")}
        data-title-generating={titleGenerating ? "true" : undefined}
      >
        {title}
      </span>
    </h1>
  );
}

function WorkspacePill({control, workspace}: {control: ResolvedShellControls["chrome.workspace"]; workspace: string}) {
  if (!isShellControlVisible(control)) {
    return null;
  }

  return (
    <div
      {...getPresentedShellControlAttributes(control)}
      className="hidden h-7 min-w-0 max-w-[14rem] shrink items-center justify-center gap-1 rounded-full border border-border/0 bg-tag/50 pl-3 pr-2.5 text-xs/relaxed text-foreground sm:flex"
      data-testid="workspace-path"
    >
      <Icon className="size-3.5 text-foreground-subtle" name="folder" />
      <span className="min-w-0 truncate leading-relaxed">{workspace}</span>
    </div>
  );
}

function BranchPill({
  branch,
  control,
  menu,
  onMenuSelect,
  onSelectBranch,
}: {
  branch: string;
  control: ResolvedShellControls["chrome.branch"];
  menu: ChatShellWindow["branchMenu"];
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onSelectBranch: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuPanelId = getMenuPanelId(menu.id, "branch");

  if (!isShellControlVisible(control)) {
    return null;
  }

  if (!menu.sections.some((section) => section.items.length > 0)) {
    return (
      <div
        {...getPresentedShellControlAttributes(control)}
        aria-label={`Git branch: ${branch}`}
        className="hidden h-7 min-w-0 max-w-full shrink items-center gap-1 rounded-full border border-border/0 bg-tag/50 pl-3 pr-2 text-xs/relaxed text-foreground sm:inline-flex"
      >
        <BranchIcon className="size-4 text-foreground-subtle" strokeWidth={2} />
        <span className="max-w-25 truncate text-left">{branch}</span>
      </div>
    );
  }

  return (
    <DropdownMenu
      className="left-0 top-full mt-1 w-48"
      menu={menu}
      onClose={() => setOpen(false)}
      onSelect={(item) => {
        onMenuSelect?.(menu.id, item);
        onSelectBranch(item.value ?? item.label);
        setOpen(false);
      }}
      open={open}
      selectedValue={branch}
    >
      <button
        {...getPresentedShellControlAttributes(control)}
        aria-controls={menuPanelId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Switch Git branch"
        className="group/button hidden shrink items-center justify-center bg-clip-padding whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 text-foreground hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground h-7 gap-1 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*=size-])]:size-3.5 min-w-0 rounded-full text-xs/relaxed max-w-full pl-3 pr-2 border border-border/0 bg-tag/50 hover:border-border-hover hover:bg-tag/50 sm:inline-flex"
        data-size="default"
        data-slot="popover-trigger"
        data-variant="ghost"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <BranchIcon className="size-4 text-foreground-subtle" strokeWidth={2} />
        <span className="max-w-25 truncate text-left">{branch}</span>
        <ChevronDownIcon className="size-3.5 text-foreground-subtle" strokeWidth={2} />
      </button>
    </DropdownMenu>
  );
}

function HeaderMoreMenu({control, menu, onMenuSelect}: {control: ResolvedShellControls["chrome.more"]; menu: ChatShellWindow["moreMenu"]; onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void}) {
  const [open, setOpen] = useState(false);
  const [submenuId, setSubmenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({left: 0, top: 0});
  const [submenuSide, setSubmenuSide] = useState<"left" | "right">("right");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const submenu = submenuId ? menu.submenus?.[submenuId] : undefined;
  const mainMenuWidth = 224;
  const submenuWidth = 256;
  const menuPanelId = getMenuPanelId(menu.id, "header-more");

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - mainMenuWidth - 8));
    setMenuPosition({
      left,
      top: rect.bottom + 4,
    });
    setSubmenuSide(left + mainMenuWidth + 4 + submenuWidth > window.innerWidth - 8 ? "left" : "right");
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updateMenuPosition();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || layerRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
      setSubmenuId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setSubmenuId(null);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    setSubmenuId(null);
  };

  if (!isShellControlVisible(control)) {
    return null;
  }

  return (
    <>
      <button
        {...getPresentedShellControlAttributes(control)}
        aria-controls={menuPanelId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Chat actions"
        className="group/button inline-flex items-center justify-center border border-transparent bg-clip-padding text-[13px]/relaxed whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 aria-expanded:bg-hover aria-expanded:text-foreground size-7 rounded-lg [&_svg:not([class*='size-'])]:size-4 shrink-0 hover:bg-hover hover:text-foreground bg-clip-padding text-foreground"
        onClick={() => {
          if (!open) {
            updateMenuPosition();
          }
          setOpen((value) => !value);
        }}
        ref={triggerRef}
        type="button"
      >
        <Icon className="size-4" name="more" />
      </button>
      {open ? createPortal(
        <div className="hero-visual-theme fixed z-[1000]" ref={layerRef} style={{left: menuPosition.left, top: menuPosition.top}}>
          <MenuPanel
            className="w-56"
            id={menuPanelId}
            menu={menu}
            onClose={closeMenu}
            onCloseAutoFocus={() => triggerRef.current?.focus()}
            onSelect={(item) => {
              onMenuSelect?.(menu.id, item);
              closeMenu();
            }}
            onSubmenu={(item) => setSubmenuId(item.submenuId && menu.submenus?.[item.submenuId] ? item.submenuId : null)}
            style={{position: "relative"}}
          />
          {submenu ? (
            <MenuPanel
              className="w-64"
              menu={submenu}
              onClose={closeMenu}
              onSelect={(item) => {
                onMenuSelect?.(submenu.id, item);
                closeMenu();
              }}
              style={{
                left: submenuSide === "right" ? mainMenuWidth + 4 : -submenuWidth - 4,
                top: submenuId === "fork" ? 158 : 129,
              }}
            />
          ) : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}

function BranchIcon({className, strokeWidth}: {className: string; strokeWidth: number}) {
  return (
    <svg aria-hidden="true" className={`lucide lucide-git-branch ${className}`} fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 6a9 9 0 0 0-9 9V3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
    </svg>
  );
}

function ChevronDownIcon({className, strokeWidth}: {className: string; strokeWidth: number}) {
  return (
    <svg aria-hidden="true" className={`lucide lucide-chevron-down ${className}`} fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
