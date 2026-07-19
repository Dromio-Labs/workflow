import {useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject} from "react";
import {createPortal} from "react-dom";

import type {ReactNode} from "react";

import type {ChatShellSidePanel, ChatShellSidePanelSurface} from "../../contracts/chatShellManifest";
import type {ShellContentLayout} from "../conversation/MainContent";
import {Icon} from "../ui/Icon";

export const sidePanelSurface = "#181818";
export const sidePanelMenuSurface = "#2b2b2b";
export const sidePanelDivider = "#303030";
export const sidePanelBorder = "#424242";

export const sidePanelComposerLayout: ShellContentLayout = {
  composerPaddingLeft: 0,
  composerPaddingRight: 0,
  conversationPaddingLeft: 0,
  conversationPaddingRight: 0,
};

export function SideOptionsRail({
  activeSurface,
  surfaceContent,
}: {
  activeSurface: ChatShellSidePanelSurface;
  surfaceContent: ReactNode;
}) {
  return (
    <aside aria-label={activeSurface.label} className="flex h-full min-h-0 flex-col text-foreground" style={{backgroundColor: sidePanelSurface}}>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" data-side-panel-surface-id={activeSurface.surfaceId}>
        {surfaceContent}
      </div>
    </aside>
  );
}

export function SidePanelTabs({
  activeSurface,
  inactiveTab,
  menuOpen,
  menuSurfaces,
  onCollapse,
  onCloseMenu,
  onOpenSurface,
  onToggleMenu,
  triggerRef,
}: {
  activeSurface: ChatShellSidePanelSurface;
  inactiveTab?: ChatShellSidePanel["inactiveTab"];
  menuOpen: boolean;
  menuSurfaces: ChatShellSidePanelSurface[];
  onCollapse: () => void;
  onCloseMenu: () => void;
  onOpenSurface: (surfaceId: string) => void;
  onToggleMenu: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const menuId = "side-panel-tab-menu";

  return (
    <div aria-label="Side panel surfaces" className="flex min-w-0 flex-1 items-center gap-2">
      {inactiveTab ? (
        <div
          aria-hidden="true"
          className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-medium leading-none text-foreground-subtle"
        >
          <Icon className="size-4 shrink-0 text-foreground-subtle" name={inactiveTab.icon} />
          <span className="min-w-0 truncate">{inactiveTab.label}</span>
        </div>
      ) : null}
      <button
        aria-current="page"
        aria-label={`Collapse ${activeSurface.label} side panel`}
        className="flex h-8 min-w-0 max-w-[11rem] items-center gap-2 rounded-lg px-3 text-left text-[13px] font-semibold leading-none text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
        onClick={onCollapse}
        style={{backgroundColor: "#242424"}}
        title={`Collapse ${activeSurface.label}`}
        type="button"
      >
        <Icon className="size-4 shrink-0 text-foreground" name={activeSurface.icon} />
        <span className="min-w-0 truncate">{activeSurface.label}</span>
        <Icon className="size-3.5 shrink-0 text-foreground-subtle" name="x" />
      </button>
      <button
        aria-controls={menuId}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Open side panel tab menu"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-hover"
        style={{backgroundColor: "#242424"}}
        onClick={onToggleMenu}
        ref={triggerRef}
        type="button"
      >
        <Icon className="size-4" name="list" />
      </button>
      {menuOpen ? (
        <SidePanelTabMenu
          anchorRef={triggerRef}
          id={menuId}
          onClose={onCloseMenu}
          onOpen={onOpenSurface}
          surfaces={menuSurfaces}
        />
      ) : null}
    </div>
  );
}

function SidePanelTabMenu({
  anchorRef,
  id,
  onClose,
  onOpen,
  surfaces,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  id: string;
  onClose: () => void;
  onOpen: (surfaceId: string) => void;
  surfaces: ChatShellSidePanelSurface[];
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        setMenuStyle(null);
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const header = anchor.closest("[data-side-panel-header]") as HTMLElement | null;
      const headerRect = header?.getBoundingClientRect();
      const width = Math.min(232, window.innerWidth - 16);
      const leftMin = headerRect ? headerRect.left + 8 : 8;
      const leftMax = headerRect ? headerRect.right - width - 16 : window.innerWidth - width - 8;
      const preferredLeft = rect.left - 20;
      const left = Math.max(leftMin, Math.min(preferredLeft, leftMax));

      setMenuStyle({
        left,
        position: "fixed",
        top: rect.bottom + 7,
        width,
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        window.requestAnimationFrame(() => anchorRef.current?.focus());
      }
    };

    updatePosition();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, onClose]);

  useEffect(() => {
    if (!menuStyle) {
      return;
    }

    window.requestAnimationFrame(() => {
      getSidePanelTabMenuItems(menuRef.current)[0]?.focus();
    });
  }, [menuStyle]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = getSidePanelTabMenuItems(menuRef.current);

    if (items.length === 0) {
      return;
    }

    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));

    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      window.requestAnimationFrame(() => anchorRef.current?.focus());
    }
  };

  if (!menuStyle) {
    return null;
  }

  return createPortal(
    <div
      aria-label="Side panel registry"
      className="hero-visual-theme z-[2147481000] overflow-hidden rounded-xl border p-2 shadow-[0_18px_44px_rgba(0,0,0,0.34)]"
      id={id}
      onKeyDown={handleMenuKeyDown}
      ref={menuRef}
      role="menu"
      style={{
        ...menuStyle,
        backgroundColor: sidePanelMenuSurface,
        borderColor: sidePanelBorder,
      }}
    >
      <div className="flex flex-col gap-0.5">
        {surfaces.map((surface) => (
          <button
            className="flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] font-medium leading-none text-foreground transition-colors hover:bg-[#3a3a3a] focus-visible:bg-[#3a3a3a] focus-visible:outline-none"
            key={surface.surfaceId}
            onClick={() => onOpen(surface.surfaceId)}
            role="menuitem"
            type="button"
          >
            <Icon className="size-3.5 shrink-0 text-foreground-subtle" name={surface.icon} />
            <span className="min-w-0 flex-1 truncate">{surface.label}</span>
            {surface.shortcut ? <span className="shrink-0 text-[12px] font-normal leading-none text-foreground-subtle">{surface.shortcut}</span> : null}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function getSidePanelTabMenuItems(root: HTMLElement | null) {
  return Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

export function SidePanelContent({
  surface,
}: {
  surface: ChatShellSidePanelSurface;
}) {
  return (
    <div className="flex w-full flex-col gap-7">
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-foreground-subtle" name={surface.icon} />
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{surface.content.title}</h3>
          {surface.shortcut ? <span className="shrink-0 text-xs text-foreground-subtle">{surface.shortcut}</span> : null}
        </div>
        {surface.content.body ? <p className="text-[13px] leading-5 text-foreground-subtle">{surface.content.body}</p> : null}
      </section>
      {surface.content.items?.length ? (
        <section className="flex w-full flex-col gap-2">
          {surface.content.items.map((item) => (
            <div className="flex min-h-5 items-center gap-3 text-[13px]" key={`${surface.surfaceId}-${item.label}`}>
              <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
              {item.value ? <span className="shrink-0 text-foreground-subtle">{item.value}</span> : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
