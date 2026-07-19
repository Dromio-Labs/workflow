import {useEffect, useState} from "react";

import type {ChatShellMenuItem, ChatShellStatus, ChatShellStatusRow, ChatShellStatusSection} from "../../contracts/chatShellManifest";
import {Icon} from "../ui/Icon";
import {DropdownMenu, getMenuPanelId} from "../ui/DropdownMenu";

export function RightStatusPanel({
  onMenuSelect,
  onStatusSelect,
  status,
}: {
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onStatusSelect?: (statusId: string) => void;
  status: ChatShellStatus;
}) {
  return (
    <div className="flex w-full">
      <aside aria-label="Status" className="pointer-events-auto relative flex w-full flex-col rounded-2xl border border-popover-border bg-popover text-foreground shadow-md p-2">
        <div className="flex flex-col gap-2">
          {status.sections.map((section, index) => (
            <StatusSection first={index === 0} key={section.id} onMenuSelect={onMenuSelect} onStatusSelect={onStatusSelect} section={section} />
          ))}
        </div>
      </aside>
    </div>
  );
}

function StatusSection({
  first = false,
  onMenuSelect,
  onStatusSelect,
  section,
}: {
  first?: boolean;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onStatusSelect?: (statusId: string) => void;
  section: ChatShellStatusSection;
}) {
  const [open, setOpen] = useState(true);
  const state = open ? "open" : "closed";

  return (
    <div data-state={state} data-slot="collapsible" className={first ? "min-w-0 flex-none" : "min-w-0 flex-none border-t border-border pt-2"}>
      <section className="min-w-0 flex-none">
        <div className="mb-0.5 flex h-8 min-w-0 shrink-0 items-center px-2">
          <button type="button" className="group flex min-w-0 shrink-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused" aria-expanded={open} aria-label={`Toggle ${section.title} status section`} data-state={state} data-slot="collapsible-trigger" onClick={() => setOpen((value) => !value)}>
            <span className="shrink-0 text-[13px] text-foreground-subtle">{section.title}</span>
            <Icon className={["size-3.5 shrink-0 text-foreground-subtle opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-visible:opacity-100", open ? "" : "-rotate-90"].join(" ")} name="chevron-down" />
          </button>
          {section.status ? <div className="ml-auto inline-flex min-w-0 max-w-full shrink items-center text-xs text-foreground-subtlest"><span className="min-w-0 truncate">{section.status}</span></div> : null}
        </div>
        <div data-state={state} data-slot="collapsible-content" hidden={!open} className="group/collapsible-content overflow-visible data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up duration-300 ease-in-out">
          <div className="duration-300 ease-in-out group-data-[state=open]/collapsible-content:animate-in group-data-[state=open]/collapsible-content:fade-in-0">
            <div className="space-y-0 pb-1">
              {section.rows.map((row) => (
                <StatusRow key={row.id} onMenuSelect={onMenuSelect} onStatusSelect={onStatusSelect} row={row} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusRow({
  onMenuSelect,
  onStatusSelect,
  row,
}: {
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onStatusSelect?: (statusId: string) => void;
  row: ChatShellStatusRow;
}) {
  if (row.kind === "goal") {
    return <GoalRow row={row} />;
  }

  if (row.kind === "progress") {
    const status = row.status ?? "done";
    const presentation = progressPresentation[status];
    return (
      <div className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-1" data-progress-status={status}>
        {row.icon ? <Icon className={`size-4 shrink-0 ${presentation.iconClass}`} name={row.icon} /> : null}
        <p className={`min-w-0 flex-1 text-[13px] leading-4 [overflow-wrap:anywhere] ${presentation.labelClass}`}>{row.label}</p>
      </div>
    );
  }

  if (row.kind === "branch") {
    return <BranchRow onMenuSelect={onMenuSelect} row={row} />;
  }

  if (row.kind === "commit") {
    return (
      <div className="min-w-0">
        <div className="flex items-center overflow-hidden border-border transition-all group/git-action-status h-8 w-full justify-start gap-1 rounded-lg border-0 bg-transparent hover:border-transparent hover:bg-hover">
          <button type="button" aria-label="Open Git actions" className="group/button inline-flex shrink-0 items-center border-transparent bg-clip-padding whitespace-nowrap transition-all outline-none select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg:not([class*='size-'])]:size-3.5 rounded-none border-0 h-8 min-w-0 max-w-[calc(100%-2.25rem)] justify-start gap-2 rounded-l-lg px-2 pr-0 text-left text-[13px] hover:bg-transparent hover:text-foreground" onClick={() => onStatusSelect?.(row.id)}>
            {row.icon ? <Icon className="size-4 text-foreground" name={row.icon} /> : null}
            <span className="min-w-0 truncate">{row.label}</span>
          </button>
          <button type="button" aria-label="Git actions" title="Git actions" className="group/button inline-flex shrink-0 items-center justify-center border-transparent bg-clip-padding text-[13px]/relaxed whitespace-nowrap transition-all outline-none select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg:not([class*='size-'])]:size-4 border-0 !w-5 ml-1 size-5 rounded-md text-foreground-subtle group-hover/git-action-status:bg-tag" onClick={() => onStatusSelect?.(`${row.id}.actions`)}>
            <MoreThinIcon />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button type="button" className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused" onClick={() => onStatusSelect?.(row.id)}>
      {row.icon ? <Icon className="size-4 shrink-0 text-foreground" name={row.icon} /> : null}
      <span className="min-w-0 flex-1 truncate text-foreground">{row.label}</span>
      {typeof row.additions === "number" || typeof row.deletions === "number" ? (
        <span className="shrink-0 font-mono tabular-nums">
          {typeof row.additions === "number" ? <span className="text-diff-added">+{row.additions}</span> : null}{" "}
          {typeof row.deletions === "number" ? <span className="text-diff-removed">-{row.deletions}</span> : null}
        </span>
      ) : row.value ? <span className="shrink-0 text-foreground-subtle">{row.value}</span> : null}
    </button>
  );
}

const progressPresentation = {
  active: {iconClass: "text-foreground", labelClass: "text-foreground"},
  done: {iconClass: "text-success", labelClass: "text-foreground-subtlest line-through"},
  failed: {iconClass: "text-diff-removed", labelClass: "text-diff-removed"},
  pending: {iconClass: "text-foreground-subtlest", labelClass: "text-foreground-subtlest"},
} as const;

function BranchRow({onMenuSelect, row}: {onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void; row: ChatShellStatusRow}) {
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState(row.label);
  const menuPanelId = row.menu ? getMenuPanelId(row.menu.id, `status-${row.id}`) : undefined;

  useEffect(() => {
    setBranch(row.label);
  }, [row.label]);

  const button = (
    <button
      type="button"
      aria-controls={menuPanelId}
      aria-expanded={open}
      aria-haspopup={row.menu ? "menu" : undefined}
      aria-label="Switch status Git branch"
      className="group/button shrink-0 items-center border border-transparent bg-clip-padding whitespace-nowrap transition-all outline-none select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 text-foreground aria-expanded:bg-hover aria-expanded:text-foreground [&_svg:not([class*='size-'])]:size-3.5 max-w-full flex h-8 w-full min-w-0 justify-start gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-hover hover:text-foreground [&>span]:max-w-[calc(100%-3.5rem)] [&_svg:first-child]:text-foreground"
      onClick={() => setOpen((value) => !value)}
    >
      {row.icon ? <Icon className="size-4 text-foreground-subtle" name={row.icon} /> : null}
      <span className="min-w-0 max-w-40 truncate text-left">{branch}</span>
      {row.trailingIcon ? <Icon className="size-3.5 text-foreground-subtle" name={row.trailingIcon} /> : null}
    </button>
  );

  return (
    <div className="min-w-0">
      <div className="flex items-center w-full px-0 pt-0">
        {row.menu ? (
          <DropdownMenu
            className="left-0 top-full mt-1 w-full min-w-56"
            menu={row.menu}
            onClose={() => setOpen(false)}
            onSelect={(item) => {
              onMenuSelect?.(row.menu!.id, item);
              setBranch(item.value ?? item.label);
              setOpen(false);
            }}
            open={open}
            selectedValue={branch}
          >
            {button}
          </DropdownMenu>
        ) : button}
      </div>
    </div>
  );
}

function GoalRow({row}: {row: ChatShellStatusRow}) {
  return (
    <div className="flex min-w-0 items-start gap-2 px-2 py-2 rounded-lg hover:bg-hover">
      {row.icon ? <Icon className="size-4 shrink-0 text-foreground-subtle" name={row.icon} /> : null}
      <div className="min-w-0 flex flex-col flex-1 gap-1.5">
        <p className="line-clamp-3 min-w-0 text-[13px] leading-4 text-foreground">{row.label}</p>
        {row.metadata?.length ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
              {row.metadata.map((item, index) => (
                <span className="contents" key={`${row.id}-${item}`}>
                  {index > 0 ? <span className="text-foreground-subtlest">·</span> : null}
                  <span className="text-foreground-subtle">{item}</span>
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MoreThinIcon() {
  return (
    <svg aria-hidden="true" className="lucide lucide-ellipsis size-4" fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}
