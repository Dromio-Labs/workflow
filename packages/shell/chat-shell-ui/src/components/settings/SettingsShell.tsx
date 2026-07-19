import type {ReactNode} from "react";

import type {IconName} from "../../contracts/chatShellManifest";
import {Icon} from "../ui/Icon";

export type SettingsShellNavItem = {
  readonly icon: IconName;
  readonly id: string;
  readonly label: string;
};

export type SettingsShellNavSection = {
  readonly id: string;
  readonly items: readonly SettingsShellNavItem[];
  readonly title?: string;
};

/**
 * The settings-page idiom (left nav rail + content column) as a composable
 * page shell, so products can build consoles from the kit's own components
 * instead of imitating them with CSS. Content is host-owned children.
 */
export function SettingsShell({
  activeItemId,
  backLabel = "Back to app",
  children,
  contentTitle,
  footer,
  nav,
  onBack,
  onSelect,
}: {
  readonly activeItemId: string;
  readonly backLabel?: string;
  readonly children: ReactNode;
  readonly contentTitle: string;
  readonly footer?: ReactNode;
  readonly nav: readonly SettingsShellNavSection[];
  readonly onBack?: () => void;
  readonly onSelect: (itemId: string) => void;
}) {
  return (
    <div className="hero-visual-theme flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <aside className="flex h-full shrink-0 flex-col border-r border-border bg-background-alt px-2 py-4" style={{width: 280}}>
        {onBack ? (
          <button
            className="mb-3 flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
            onClick={onBack}
            type="button"
          >
            <span aria-hidden="true" className="text-lg leading-none">←</span>
            <span>{backLabel}</span>
          </button>
        ) : null}
        <nav className="hero-overlay-scrollbar min-h-0 flex-1 overflow-y-auto" style={{paddingBottom: 16, paddingRight: 8}}>
          {nav.map((section) => (
            <div className="mb-5" key={section.id}>
              {section.title ? <div className="mb-1 px-2 text-[13px] text-foreground-subtlest">{section.title}</div> : null}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = item.id === activeItemId;

                  return (
                    <button
                      aria-current={active ? "page" : undefined}
                      className={[
                        "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors",
                        active ? "!bg-selected font-medium text-foreground shadow-sm" : "text-foreground hover:bg-hover",
                      ].join(" ")}
                      key={item.id}
                      onClick={() => onSelect(item.id)}
                      type="button"
                    >
                      <Icon className="size-4 shrink-0 text-current" name={item.icon} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        {footer ? (
          <div className="border-t border-border px-2 py-3 text-[13px] text-foreground-subtle">{footer}</div>
        ) : null}
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden" style={{paddingRight: 12}}>
        <div className="hero-overlay-scrollbar h-full overflow-y-auto">
          <div
            className="flex w-full flex-col"
            style={{
              boxSizing: "border-box",
              gap: 28,
              margin: "0 auto",
              maxWidth: 880,
              padding: "32px 32px 56px",
            }}
          >
            <h1 className="text-xl font-medium text-foreground">{contentTitle}</h1>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
