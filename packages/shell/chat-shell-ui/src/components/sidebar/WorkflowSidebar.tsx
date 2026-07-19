import {Icon} from "../ui/Icon";

export type WorkflowSidebarItem = {
  id: string;
  label: string;
  meta: string;
};

export type WorkflowSidebarProps = {
  activeWorkflowId: string;
  appTitle: string;
  items: WorkflowSidebarItem[];
  onSelectWorkflow: (workflowId: string) => void;
  runtimeLabel?: string;
  runtimeStatus?: string;
};

export function WorkflowSidebar({
  activeWorkflowId,
  appTitle,
  items,
  onSelectWorkflow,
  runtimeLabel = "Local runtime",
  runtimeStatus = "Ready",
}: WorkflowSidebarProps) {
  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div aria-hidden="true" className="flex h-12 shrink-0 items-center gap-3 px-5">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-extrabold text-[#06151c]">D</span>
        <span className="flex min-w-0 flex-col">
          <strong className="truncate text-[13px] font-semibold text-foreground">{appTitle}</strong>
          <span className="text-[11px] text-foreground-subtlest">Workflow app</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 pt-2">
        <div className="flex items-center justify-between gap-2 pl-[18px] pr-3">
          <h3 className="min-w-0 text-[13px] font-semibold text-foreground-subtlest">Workflows</h3>
        </div>
        <div className="hero-sidebar-scroll-mask hero-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto" data-bottom="true" data-top="true">
          <div className="flex min-h-0 flex-col px-2">
            <div className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-[13px] text-foreground-subtle">
              <Icon className="size-4 shrink-0" name="folder-open" />
              <span className="min-w-0 flex-1 truncate">{appTitle}</span>
            </div>
            <nav aria-label="Workflows" className="space-y-0.5" id="workflow-list">
              {items.map((item) => (
                  <button
                    aria-current={item.id === activeWorkflowId ? "page" : undefined}
                    className={[
                      "workflow-sidebar-item group/workflow flex h-8 w-full min-w-0 items-center gap-2 rounded-lg py-1 pl-2.5 pr-1 text-left text-foreground outline-none transition-colors",
                      "hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-input-border-focused",
                    ].join(" ")}
                    data-workflow-id={item.id}
                    key={item.id}
                    onClick={() => onSelectWorkflow(item.id)}
                    type="button"
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      <span aria-hidden="true" className="workflow-sidebar-active-dot block size-1.5 rounded-full bg-brand" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={item.label}>{item.label}</span>
                    <span className="mr-0.5 shrink-0 text-xs text-foreground-subtle group-hover/workflow:hidden">{item.meta}</span>
                  </button>
              ))}
            </nav>
          </div>
        </div>
      </div>
      <footer className="flex items-center gap-2 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-extrabold text-[#06151c]">D</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="truncate text-[13px] font-medium text-foreground">{runtimeLabel}</strong>
          <span className="flex items-center gap-1.5 text-[11px] text-foreground-subtlest"><i className="size-1.5 rounded-full bg-success" />{runtimeStatus}</span>
        </span>
      </footer>
    </section>
  );
}
