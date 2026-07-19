import {useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties} from "react";
import {createPortal} from "react-dom";

import type {ChatShellMenu, ChatShellMenuItem, ChatShellSettings, ChatShellSettingsControlRow, ChatShellUser} from "../../contracts/chatShellManifest";
import {getMenuPanelId, MenuPanel} from "../ui/DropdownMenu";
import {Icon} from "../ui/Icon";

type ChatShellSettingsChoiceRow = Extract<ChatShellSettingsControlRow, {control: "select" | "segmented"}>;

export function SettingsLayout({
  onBack,
  onMenuSelect,
  onSettingsChange,
  onToggleFullscreen,
  settings,
  user,
}: {
  onBack: () => void;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onSettingsChange?: (settingId: string, value: boolean | string) => void;
  onToggleFullscreen: () => void;
  settings: ChatShellSettings;
  user: ChatShellUser;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const [activeSectionId, setActiveSectionId] = useState(settings.activeSectionId);
  const [workModeId, setWorkModeId] = useState(settings.general.workModes.find((mode) => mode.checked)?.id ?? settings.general.workModes[0]?.id);
  const [selectValues, setSelectValues] = useState(() =>
    [...settings.general.permissionRows, ...settings.general.generalRows].reduce<Record<string, string>>((state, row) => {
      if (row.control === "select" || row.control === "segmented") {
        state[row.id] = row.value;
      }
      return state;
    }, {}),
  );
  const [toggles, setToggles] = useState(() =>
    [...settings.general.permissionRows, ...settings.general.generalRows].reduce<Record<string, boolean>>((state, row) => {
      if (row.control === "toggle") {
        state[row.id] = row.enabled;
      }
      return state;
    }, {}),
  );

  const activeTitle = useMemo(() => {
    for (const section of settings.navSections) {
      const item = section.items.find((candidate) => candidate.id === activeSectionId);
      if (item) {
        return item.label;
      }
    }
    throw new Error(`Settings active section "${activeSectionId}" is not registered in the manifest.`);
  }, [activeSectionId, settings.navSections]);

  useLayoutEffect(() => {
    window.requestAnimationFrame(() => {
      backButtonRef.current?.focus();
    });
  }, []);

  const keepFocusInSettings = useCallback((event: KeyboardEvent) => {
    if (event.key !== "Tab") {
      return;
    }

    const focusable = getFocusableElements(rootRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      rootRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !rootRef.current?.contains(active))) {
      event.preventDefault();
      last?.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onBack();
        return;
      }

      keepFocusInSettings(event);
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [keepFocusInSettings, onBack]);

  return (
    <div aria-label="Settings" aria-modal="true" className="hero-visual-theme flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground" ref={rootRef} role="dialog" tabIndex={-1}>
      <aside className="flex h-full shrink-0 flex-col border-r border-border bg-background-alt px-2 py-4" style={{width: 296}}>
        <SettingsTrafficLights onToggleFullscreen={onToggleFullscreen} />
        <button
          className="mb-3 flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
          onClick={onBack}
          ref={backButtonRef}
          type="button"
        >
          <span aria-hidden="true" className="text-lg leading-none">←</span>
          <span>Back to app</span>
        </button>
        <label className="relative mb-4 block">
          <SearchIcon />
          <input
            aria-label="Search settings"
            className="h-8 w-full rounded-lg border border-input-border bg-input text-[13px] text-foreground outline-none placeholder:text-foreground-subtlest"
            placeholder={settings.searchPlaceholder}
            style={{paddingLeft: 38, paddingRight: 12}}
            type="search"
          />
        </label>
        <nav className="hero-overlay-scrollbar min-h-0 flex-1 overflow-y-auto" style={{paddingBottom: 16, paddingRight: 8}}>
          {settings.navSections.map((section) => (
            <div className="mb-5" key={section.id}>
              {section.title ? <div className="mb-1 px-2 text-[13px] text-foreground-subtlest">{section.title}</div> : null}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = item.id === activeSectionId;

                  return (
                    <button
                      aria-current={active ? "page" : undefined}
                      className={[
                        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors",
                        active ? "!bg-selected font-medium text-foreground shadow-sm" : "text-foreground hover:bg-hover",
                      ].join(" ")}
                      key={item.id}
                      onClick={() => {
                        setActiveSectionId(item.id);
                        onSettingsChange?.("activeSectionId", item.id);
                      }}
                      type="button"
                    >
                      <Icon className="size-4 shrink-0 text-current" name={item.icon} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.external ? <span className="text-foreground-subtlest">↗</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-border px-2 py-3 text-[13px] text-foreground-subtle">
          <div className="truncate">{user.email}</div>
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden" style={{paddingRight: 12}}>
        <div className="hero-overlay-scrollbar h-full overflow-y-auto">
          <div
            className="flex w-full flex-col"
            style={{
              boxSizing: "border-box",
              gap: 36,
              margin: "0 auto",
              maxWidth: 772,
              padding: "32px 32px 56px",
            }}
          >
          <h1 className="text-xl font-medium text-foreground">{activeTitle}</h1>
          {activeSectionId === "general" ? (
            <>
              <section className="flex flex-col" style={{gap: 22}}>
                <div>
                  <h2 className="text-sm font-medium text-foreground">Work mode</h2>
                  <p className="mt-1 text-[13px] text-foreground-subtle">Choose how much technical detail Codex shows</p>
                </div>
                <div className="grid" style={{gap: 16, gridTemplateColumns: "repeat(2, minmax(0, 1fr))"}}>
                  {settings.general.workModes.map((mode) => {
                    const active = mode.id === workModeId;
                    return (
                      <button
                        className={[
                          "flex items-center gap-3 rounded-lg border text-left transition-colors",
                          active ? "border-border !bg-selected text-foreground shadow-sm" : "border-border bg-transparent text-foreground hover:bg-hover",
                        ].join(" ")}
                        key={mode.id}
                        onClick={() => {
                          setWorkModeId(mode.id);
                          onSettingsChange?.("workModeId", mode.id);
                        }}
                        style={{
                          minHeight: 74,
                          padding: "14px 18px",
                        }}
                        type="button"
                      >
                        <Icon className="size-4 shrink-0 text-foreground" name={mode.icon} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{mode.label}</span>
                          <span className="mt-1 block truncate text-[13px] text-foreground-subtle">{mode.description}</span>
                        </span>
                        <RadioDot checked={active} />
                      </button>
                    );
                  })}
                </div>
              </section>
              <SettingsCard
                rows={settings.general.permissionRows}
                selectValues={selectValues}
                title="Permissions"
                toggles={toggles}
                onMenuSelect={onMenuSelect}
                onToggle={(id) => setToggles((current) => {
                  const next = !current[id];
                  onSettingsChange?.(id, next);
                  return {...current, [id]: next};
                })}
                onValueChange={(id, value) => {
                  setSelectValues((current) => ({...current, [id]: value}));
                  onSettingsChange?.(id, value);
                }}
              />
              <SettingsCard
                rows={settings.general.generalRows}
                selectValues={selectValues}
                title="General"
                toggles={toggles}
                onMenuSelect={onMenuSelect}
                onToggle={(id) => setToggles((current) => {
                  const next = !current[id];
                  onSettingsChange?.(id, next);
                  return {...current, [id]: next};
                })}
                onValueChange={(id, value) => {
                  setSelectValues((current) => ({...current, [id]: value}));
                  onSettingsChange?.(id, value);
                }}
              />
            </>
          ) : (
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-medium text-foreground">{activeTitle}</h2>
              <p className="mt-2 text-[13px] text-foreground-subtle">No controls registered for this section.</p>
            </section>
          )}
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingsTrafficLights({onToggleFullscreen}: {onToggleFullscreen: () => void}) {
  return (
    <div className="mb-6 flex items-center gap-2 px-3">
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

function SettingsCard({
  onMenuSelect,
  onToggle,
  onValueChange,
  rows,
  selectValues,
  title,
  toggles,
}: {
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onToggle: (id: string) => void;
  onValueChange: (id: string, value: string) => void;
  rows: ChatShellSettingsControlRow[];
  selectValues: Record<string, string>;
  title: string;
  toggles: Record<string, boolean>;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
        {rows.map((row, index) => (
          <div className={index > 0 ? "border-t border-border" : ""} key={row.id}>
            <div
              className="grid items-center gap-x-5 gap-y-2"
              style={{
                gridTemplateColumns: "minmax(0, 1fr) 224px",
                minHeight: row.control === "segmented" ? 92 : 66,
                padding: row.control === "segmented" ? "18px 20px" : "12px 20px",
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-foreground">{row.label}</span>
                {row.description ? <span className="mt-1 block text-[13px] leading-5 text-foreground-subtle">{row.description}</span> : null}
              </span>
              <div className="flex min-w-0 justify-end">
                <SettingsControl
                  onToggle={() => onToggle(row.id)}
                  onMenuSelect={onMenuSelect}
                  onValueChange={(value) => onValueChange(row.id, value)}
                  row={row}
                  toggled={toggles[row.id]}
                  value={selectValues[row.id]}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsControl({
  onMenuSelect,
  onToggle,
  onValueChange,
  row,
  toggled,
  value,
}: {
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onToggle: () => void;
  onValueChange: (value: string) => void;
  row: ChatShellSettingsControlRow;
  toggled?: boolean;
  value?: string;
}) {
  if (row.control === "toggle") {
    return (
      <button
        aria-pressed={Boolean(toggled)}
        className={[
          "relative shrink-0 border transition-colors",
          toggled ? "border-sky-500" : "border-border",
        ].join(" ")}
        onClick={onToggle}
        style={{
          backgroundColor: toggled ? "rgb(14, 165, 233)" : "rgba(255, 255, 255, 0.1)",
          borderRadius: 999,
          height: 20,
          width: 36,
        }}
        type="button"
      >
        <span
          className="absolute rounded-full bg-white shadow-sm transition-transform"
          style={{
            height: 16,
            left: 2,
            top: 1,
            transform: toggled ? "translateX(16px)" : "translateX(0)",
            width: 16,
          }}
        />
      </button>
    );
  }

  if (row.control === "segmented") {
    if (!value || !row.options.includes(value)) {
      throw new Error(`Settings segmented row "${row.id}" has invalid value "${value ?? ""}".`);
    }

    return (
      <div
        aria-label={row.label}
        className="flex max-w-full items-center justify-end overflow-hidden text-[13px] text-foreground-subtle"
        role="radiogroup"
        style={{gap: 10}}
      >
        {row.options.map((option) => (
          <button
            aria-checked={option === value}
            className="min-w-0 truncate rounded-full transition-colors"
            key={option}
            onClick={() => onValueChange(option)}
            role="radio"
            style={{
              backgroundColor: option === value ? "rgba(255, 255, 255, 0.1)" : "transparent",
              color: option === value ? "rgba(255, 255, 255, 0.92)" : "rgba(255, 255, 255, 0.56)",
              height: 32,
              minWidth: 62,
              padding: "0 14px",
            }}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  if (row.control === "select") {
    if (!value || !row.options.includes(value)) {
      throw new Error(`Settings select row "${row.id}" has invalid value "${value ?? ""}".`);
    }

    return <SettingsSelectControl onMenuSelect={onMenuSelect} onValueChange={onValueChange} row={row} value={value} />;
  }

  return null;
}

function SettingsSelectControl({
  onMenuSelect,
  onValueChange,
  row,
  value,
}: {
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onValueChange: (value: string) => void;
  row: ChatShellSettingsChoiceRow;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const generatedMenuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const options = row.options;
  const menu = useMemo<ChatShellMenu>(() => ({
    id: `${row.id}-menu`,
    sections: [
      {
        id: `${row.id}-options`,
        title: row.label,
        items: options.map((option) => ({
          checked: option === value,
          id: option.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          label: option,
          value: option,
        })),
      },
    ],
  }), [options, row.id, row.label, value]);
  const menuPanelId = getMenuPanelId(menu.id, generatedMenuId);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const width = Math.max(rect.width, 224);
      const estimatedHeight = Math.min(300, 36 + options.length * 30);
      const belowTop = rect.bottom + 6;
      const aboveTop = rect.top - estimatedHeight - 6;
      const top = belowTop + estimatedHeight > window.innerHeight - 12 && aboveTop > 12 ? aboveTop : belowTop;

      setMenuStyle({
        left: Math.round(rect.right - width),
        top: Math.round(top),
        width,
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div style={{width: "100%"}}>
      <button
        aria-controls={menuPanelId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${row.label}: ${value}`}
        className="group/button flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-transparent bg-tag px-3 text-left text-[13px] text-foreground outline-none transition-all hover:border-border-hover hover:bg-hover focus-visible:ring-2 focus-visible:ring-input-border-focused"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        role="combobox"
        style={{
          backgroundColor: open ? "rgba(255, 255, 255, 0.13)" : "rgba(255, 255, 255, 0.08)",
          borderColor: open ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.08)",
          width: "100%",
        }}
        type="button"
      >
        <span className="min-w-0 truncate">{value}</span>
        <Icon className="size-3.5 shrink-0 text-foreground-subtle transition-transform group-aria-expanded/button:rotate-180" name="chevron-down" />
      </button>
      {open && menuStyle ? createPortal(
        <div className="hero-visual-theme fixed z-[2147481000]" style={menuStyle}>
          <MenuPanel
            aria-label={row.label}
            className="w-full"
            id={menuPanelId}
            menu={menu}
            onClose={() => setOpen(false)}
            onCloseAutoFocus={() => triggerRef.current?.focus()}
            onSelect={(item) => {
              onMenuSelect?.(menu.id, item);
              onValueChange(item.value ?? item.label);
              setOpen(false);
              window.requestAnimationFrame(() => triggerRef.current?.focus());
            }}
            panelRef={(node) => {
              panelRef.current = node;
            }}
            selectedValue={value}
          />
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function RadioDot({checked}: {checked: boolean}) {
  return (
    <span className={checked ? "grid size-4 shrink-0 place-items-center rounded-full bg-sky-500" : "size-4 shrink-0 rounded-full border border-border"}>
      {checked ? <span className="size-1.5 rounded-full bg-white" /> : null}
    </span>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" className="absolute top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" style={{left: 12}} viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function getFocusableElements(root: HTMLElement | null) {
  return Array.from(root?.querySelectorAll<HTMLElement>(
    [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(","),
  ) ?? []).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}
