import {useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from "react";
import {createPortal} from "react-dom";

import type {ChatShellMenuItem, ChatShellUser} from "../../contracts/chatShellManifest";
import {
  getPresentedShellControlAttributes,
  isShellControlVisible,
} from "../presentation/presentedShellControl";
import type {ResolvedShellControl} from "../presentation/resolveShellPresentationControls";
import {Icon} from "../ui/Icon";
import {getMenuPanelId, MenuPanel} from "../ui/DropdownMenu";

const userMenuWidth = 288;
const userMenuOffset = 8;
const userMenuMargin = 8;
const userMenuFallbackHeight = 264;
const userMenuMinimumHeight = 120;

type UserMenuAnchor = "settings" | "user";
type CollisionBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};
type UserMenuPosition = {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
};

export function UserFooter({
  control,
  onMenuSelect,
  onOpenSettings,
  user,
}: {
  control: ResolvedShellControl;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onOpenSettings: () => void;
  user: ChatShellUser;
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<UserMenuAnchor>("settings");
  const [userMenuPosition, setUserMenuPosition] = useState<UserMenuPosition | null>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const menuLayerRef = useRef<HTMLDivElement>(null);
  const menuPanelId = getMenuPanelId(user.settingsMenu.id, "user-settings");

  const handleSettingsMenuSelect = (item: ChatShellMenuItem) => {
    onMenuSelect?.(user.settingsMenu.id, item);
    setUserMenuOpen(false);

    if (item.id === "settings") {
      onOpenSettings();
    }
  };
  const closeUserMenu = useCallback(() => {
    setUserMenuOpen(false);
  }, []);
  const toggleUserMenu = (anchor: UserMenuAnchor) => {
    if (userMenuOpen && userMenuAnchor === anchor) {
      setUserMenuOpen(false);
      return;
    }

    setUserMenuAnchor(anchor);
    setUserMenuOpen(true);
  };
  const updateUserMenuPosition = useCallback(() => {
    const anchor = userMenuAnchor === "settings" ? settingsButtonRef.current : userButtonRef.current;

    if (!anchor) {
      return;
    }

    const bounds = getCollisionBounds(anchor);
    const anchorRect = anchor.getBoundingClientRect();
    const menuPanel = menuLayerRef.current?.firstElementChild as HTMLElement | null;
    const measuredHeight = menuPanel?.scrollHeight || menuPanel?.getBoundingClientRect().height || userMenuFallbackHeight;
    const availableWidth = Math.max(0, bounds.right - bounds.left - userMenuMargin * 2);
    const width = Math.min(userMenuWidth, availableWidth);
    const availableAbove = anchorRect.top - userMenuOffset - (bounds.top + userMenuMargin);
    const availableBelow = bounds.bottom - userMenuMargin - (anchorRect.bottom + userMenuOffset);
    const placeAbove = availableAbove >= measuredHeight || availableAbove >= availableBelow;
    const interiorHeight = Math.max(0, bounds.bottom - bounds.top - userMenuMargin * 2);
    const preferredAvailableHeight = Math.max(0, placeAbove ? availableAbove : availableBelow);
    const minimumAvailableHeight = Math.min(userMenuMinimumHeight, interiorHeight);
    const availableHeight = Math.max(minimumAvailableHeight, Math.min(preferredAvailableHeight, interiorHeight));
    const visibleHeight = Math.min(measuredHeight, availableHeight);
    const left = clamp(anchorRect.right - width, bounds.left + userMenuMargin, bounds.right - userMenuMargin - width);
    const desiredTop = placeAbove ? anchorRect.top - userMenuOffset - visibleHeight : anchorRect.bottom + userMenuOffset;
    const top = clamp(desiredTop, bounds.top + userMenuMargin, bounds.bottom - userMenuMargin - visibleHeight);

    setUserMenuPosition({
      left,
      maxHeight: Math.floor(availableHeight),
      top,
      width,
    });
  }, [userMenuAnchor]);

  useLayoutEffect(() => {
    if (!userMenuOpen) {
      setUserMenuPosition(null);
      return undefined;
    }

    updateUserMenuPosition();
    const frame = window.requestAnimationFrame(updateUserMenuPosition);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [updateUserMenuPosition, userMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (
        userButtonRef.current?.contains(target) ||
        settingsButtonRef.current?.contains(target) ||
        menuLayerRef.current?.contains(target)
      ) {
        return;
      }

      setUserMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setUserMenuOpen(false);
        window.requestAnimationFrame(() => {
          const anchor = userMenuAnchor === "settings" ? settingsButtonRef.current : userButtonRef.current;
          anchor?.focus();
        });
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateUserMenuPosition);
    window.addEventListener("scroll", updateUserMenuPosition, true);
    window.visualViewport?.addEventListener("resize", updateUserMenuPosition);
    window.visualViewport?.addEventListener("scroll", updateUserMenuPosition);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateUserMenuPosition);
      window.removeEventListener("scroll", updateUserMenuPosition, true);
      window.visualViewport?.removeEventListener("resize", updateUserMenuPosition);
      window.visualViewport?.removeEventListener("scroll", updateUserMenuPosition);
    };
  }, [updateUserMenuPosition, userMenuOpen]);

  const menuLayerStyle: CSSProperties = userMenuPosition
    ? {
        left: userMenuPosition.left,
        top: userMenuPosition.top,
        width: userMenuPosition.width,
      }
    : {
        left: 0,
        top: 0,
        visibility: "hidden",
        width: userMenuWidth,
      };

  if (!isShellControlVisible(control)) {
    return null;
  }

  return (
    <div {...getPresentedShellControlAttributes(control)} className="flex items-center gap-2 p-4">
      <button
        aria-controls={menuPanelId}
        aria-expanded={userMenuOpen && userMenuAnchor === "user"}
        aria-haspopup="menu"
        aria-label={user.name}
        className="group/button inline-flex h-8 flex-1 items-center justify-start gap-2 rounded-l-2xl rounded-r-lg border border-transparent bg-clip-padding pl-0 px-2.5 text-left text-[13px] font-medium whitespace-nowrap text-foreground outline-none transition-all select-none hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4"
        data-testid="login-trigger"
        onClick={() => toggleUserMenu("user")}
        ref={userButtonRef}
        type="button"
      >
        <span className="group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken dark:after:mix-blend-lighten">
          {user.avatar ? (
            <img alt={user.name} className="aspect-square size-full rounded-full object-cover" src={user.avatar} />
          ) : (
            <span aria-hidden="true" className="flex size-full items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-foreground-subtle">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-foreground">{user.name}</span>
        </span>
      </button>
      <div className="flex items-center gap-1.5">
        <button
          aria-controls={menuPanelId}
          aria-expanded={userMenuOpen && userMenuAnchor === "settings"}
          aria-haspopup="menu"
          aria-label="Open settings menu"
          className="group/button inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap text-foreground outline-none transition-all select-none hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4"
          data-testid="task-settings-button"
          onClick={() => toggleUserMenu("settings")}
          ref={settingsButtonRef}
          type="button"
        >
          <Icon className="size-4" name="settings" />
        </button>
      </div>
      {userMenuOpen
        ? createPortal(
            <div className="hero-visual-theme fixed z-[1000]" ref={menuLayerRef} style={menuLayerStyle}>
              <MenuPanel
                className="w-full"
                id={menuPanelId}
                menu={user.settingsMenu}
                onClose={closeUserMenu}
                onCloseAutoFocus={() => {
                  const anchor = userMenuAnchor === "settings" ? settingsButtonRef.current : userButtonRef.current;
                  anchor?.focus();
                }}
                onSelect={handleSettingsMenuSelect}
                style={{
                  maxHeight: userMenuPosition?.maxHeight,
                  overflowY: "auto",
                  position: "relative",
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function getCollisionBounds(anchor: HTMLElement): CollisionBounds {
  const viewportBounds = {
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth,
    top: 0,
  };
  const frameBounds = anchor.closest<HTMLElement>(".chat-shell-frame")?.getBoundingClientRect();

  if (!frameBounds) {
    return viewportBounds;
  }

  return {
    bottom: Math.min(viewportBounds.bottom, frameBounds.bottom),
    left: Math.max(viewportBounds.left, frameBounds.left),
    right: Math.min(viewportBounds.right, frameBounds.right),
    top: Math.max(viewportBounds.top, frameBounds.top),
  };
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
