import {useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode} from "react";

import type {ChatShellMenu, ChatShellMenuItem} from "../../contracts/chatShellManifest";
import {Icon} from "./Icon";

type SubmenuHandler = (item: ChatShellMenuItem, anchor: HTMLButtonElement) => void;

export function DropdownMenu({
  children,
  className = "right-0 top-full mt-1 w-56",
  menu,
  onClose,
  onSelect,
  onSubmenu,
  open,
  selectedValue,
}: {
  children: ReactNode;
  className?: string;
  menu: ChatShellMenu;
  onClose: () => void;
  onSelect?: (item: ChatShellMenuItem) => void;
  onSubmenu?: SubmenuHandler;
  open: boolean;
  selectedValue?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const generatedPanelId = useId();
  const panelId = getMenuPanelId(menu.id, generatedPanelId);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        const shouldRestoreFocus = rootRef.current?.contains(document.activeElement) ?? false;
        onClose();
        if (shouldRestoreFocus) {
          window.requestAnimationFrame(() => getDropdownTrigger(rootRef.current)?.focus());
        }
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <div className="relative" data-dropdown-menu-id={panelId} ref={rootRef}>
      {children}
      {open ? <MenuPanel className={className} id={panelId} menu={menu} onClose={onClose} onCloseAutoFocus={() => getDropdownTrigger(rootRef.current)?.focus()} onSelect={onSelect} onSubmenu={onSubmenu} selectedValue={selectedValue} /> : null}
    </div>
  );
}

export function MenuPanel({
  className = "",
  menu,
  onClose,
  onCloseAutoFocus,
  onSelect,
  onSubmenu,
  autoFocus = true,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  id,
  panelRef: externalPanelRef,
  selectedValue,
  style,
}: {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  autoFocus?: boolean;
  className?: string;
  id?: string;
  menu: ChatShellMenu;
  onClose?: () => void;
  onCloseAutoFocus?: () => void;
  onSelect?: (item: ChatShellMenuItem) => void;
  onSubmenu?: SubmenuHandler;
  panelRef?: (node: HTMLDivElement | null) => void;
  selectedValue?: string;
  style?: CSSProperties;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const sections = normalizedQuery
    ? menu.sections.map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          `${item.label} ${item.description ?? ""} ${item.value ?? ""}`.toLowerCase().includes(normalizedQuery)),
      })).filter((section) => section.items.length > 0)
    : menu.sections;
  const handlePanelRef = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    externalPanelRef?.(node);
  }, [externalPanelRef]);

  useEffect(() => {
    if (!autoFocus) {
      return undefined;
    }

    const selectedItem = panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"][data-selected="true"]');
    const firstItem = getFocusableMenuItems(panelRef.current)[0];

    window.requestAnimationFrame(() => {
      (menu.searchPlaceholder ? searchRef.current : selectedItem ?? firstItem)?.focus();
    });
  }, [autoFocus, menu.searchPlaceholder]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const items = getFocusableMenuItems(panelRef.current);
      if (items.length === 0) {
        return;
      }
      const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      items[(currentIndex + 1) % items.length]?.focus();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const items = getFocusableMenuItems(panelRef.current);
      if (items.length === 0) {
        return;
      }
      const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      const items = getFocusableMenuItems(panelRef.current);
      items[0]?.focus();
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      const items = getFocusableMenuItems(panelRef.current);
      items.at(-1)?.focus();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      window.requestAnimationFrame(() => onCloseAutoFocus?.());
    }
  };

  return (
    <div
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`hero-overlay-scrollbar absolute z-50 overflow-hidden rounded-xl border border-popover-border bg-popover p-1 text-foreground shadow-md ${className}`}
      id={id}
      onKeyDown={handleKeyDown}
      ref={handlePanelRef}
      role="menu"
      style={style}
    >
      {menu.searchPlaceholder ? (
        <input
          aria-label={menu.searchPlaceholder}
          className="mb-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-focus"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={menu.searchPlaceholder}
          ref={searchRef}
          type="search"
          value={query}
        />
      ) : null}
      {sections.map((section, index) => (
        <div className={index > 0 ? "border-t border-border pt-1 mt-1" : ""} key={section.id}>
          {section.title ? <div className="px-2 py-1 text-[13px] text-foreground-subtle">{section.title}</div> : null}
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <MenuRow
                item={item}
                key={item.id}
                onSelect={onSelect}
                onSubmenu={onSubmenu}
                selected={selectedValue ? item.value === selectedValue || item.label === selectedValue : Boolean(item.checked)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MenuRow({
  item,
  onSelect,
  onSubmenu,
  selected,
}: {
  item: ChatShellMenuItem;
  onSelect?: (item: ChatShellMenuItem) => void;
  onSubmenu?: SubmenuHandler;
  selected: boolean;
}) {
  const interactive = !item.disabled;
  const handleChoose = (anchor: HTMLButtonElement) => {
    if (!interactive) {
      return;
    }

    if (item.submenuId) {
      onSubmenu?.(item, anchor);
      return;
    }

    onSelect?.(item);
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    handleChoose(event.currentTarget);
  };
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    handleChoose(event.currentTarget);
  };
  const handlePreviewSubmenu = (anchor: HTMLButtonElement) => {
    if (interactive) {
      onSubmenu?.(item, anchor);
    }
  };
  const handleFocus = (event: ReactFocusEvent<HTMLButtonElement>) => {
    handlePreviewSubmenu(event.currentTarget);
  };

  return (
    <button
      aria-disabled={item.disabled || undefined}
      className={[
        "flex min-h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-foreground outline-none transition-colors",
        interactive ? "hover:bg-hover focus-visible:bg-hover" : "cursor-default opacity-50",
        selected ? "bg-hover" : "",
      ].join(" ")}
      onClick={handleClick}
      onFocus={handleFocus}
      onPointerDown={handlePointerDown}
      onPointerEnter={(event) => handlePreviewSubmenu(event.currentTarget)}
      role="menuitem"
      data-selected={selected || undefined}
      style={selected ? {backgroundColor: "rgba(255, 255, 255, 0.1)"} : undefined}
      type="button"
    >
      {item.icon ? <Icon className="size-4 shrink-0 text-foreground-subtle" name={item.icon} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{item.label}</span>
        {item.description ? <span className="block truncate text-xs text-foreground-subtlest">{item.description}</span> : null}
      </span>
      {item.shortcut ? <span className="shrink-0 pl-2 text-xs text-foreground-subtlest">{item.shortcut}</span> : null}
      {item.submenuId ? <Icon className="size-3.5 shrink-0 text-foreground-subtle -rotate-90" name="chevron-down" /> : null}
      {selected && !item.submenuId ? <CheckIcon /> : null}
    </button>
  );
}

function getFocusableMenuItems(root: HTMLElement | null) {
  return Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []).filter(
    (item) => item.getAttribute("aria-disabled") !== "true",
  );
}

function getDropdownTrigger(root: HTMLElement | null) {
  return root?.querySelector<HTMLButtonElement>("[aria-expanded], [data-slot='dropdown-menu-trigger'], button");
}

export function getMenuPanelId(menuId: string, fallbackId: string) {
  const stableId = menuId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return stableId ? `${stableId}-panel` : `menu-${fallbackId}`;
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5 shrink-0 text-foreground-subtle" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}
