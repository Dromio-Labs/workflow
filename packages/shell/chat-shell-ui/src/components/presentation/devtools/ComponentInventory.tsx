import type {ShellControlId} from "../../../contracts/chatShellPresentation";
import {shellControlCatalog, shellControlIds} from "../shellControlCatalog";
import type {AuthoringChoice, AuthoringResult, ControlAuthoringState} from "./authoringModel";

const resultGroups: readonly {readonly result: AuthoringResult; readonly title: string}[] = [
  {result: "shown", title: "On this screen"},
  {result: "hidden", title: "Configured but hidden"},
  {result: "sample", title: "Available sample positions"},
  {result: "unsupported", title: "Unsupported by this app"},
];

export function ComponentInventory({
  controlStates,
  onSetChoice,
}: {
  readonly controlStates: Readonly<Record<ShellControlId, ControlAuthoringState>>;
  readonly onSetChoice: (controlId: ShellControlId, choice: AuthoringChoice) => void;
}) {
  return (
    <section aria-label="Component inventory" className="grid gap-3 border-t border-border pt-3">
      <div>
        <h2 className="text-xs font-semibold text-foreground">Components</h2>
        <p className="mt-1 text-[11px] leading-4 text-foreground-subtle">
          Baseline is the app config. Draft is your override. Result is what the exported config produces.
        </p>
      </div>
      <div className="hero-overlay-scrollbar grid max-h-72 gap-3 overflow-y-auto pr-1">
        {resultGroups.map((group) => {
          const ids = shellControlIds.filter((controlId) => controlStates[controlId].result === group.result);
          if (ids.length === 0) return null;

          return (
            <section className="grid gap-1" key={group.result}>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-foreground-subtlest">
                {group.title} ({ids.length})
              </h3>
              {ids.map((controlId) => (
                <ControlInventoryRow
                  controlId={controlId}
                  key={controlId}
                  onSetChoice={onSetChoice}
                  state={controlStates[controlId]}
                />
              ))}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ControlInventoryRow({
  controlId,
  onSetChoice,
  state,
}: {
  readonly controlId: ShellControlId;
  readonly onSetChoice: (controlId: ShellControlId, choice: AuthoringChoice) => void;
  readonly state: ControlAuthoringState;
}) {
  const definition = shellControlCatalog[controlId];

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border/70 bg-input/40 px-2 py-2" data-shell-inventory-control-id={controlId}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{definition.label}</div>
          <div className="truncate font-mono text-[10px] text-foreground-subtlest">{controlId}</div>
        </div>
        <div className="flex shrink-0 gap-1 text-[9px]">
          <StateBadge label={`Base: ${state.baseline}`} />
          <StateBadge label={`Result: ${state.result}`} tone={state.result === "hidden" ? "danger" : "default"} />
        </div>
      </div>
      <div aria-label={`${definition.label} draft override`} className="grid grid-cols-3 overflow-hidden rounded-md border border-border" role="group">
        {(["inherit", "visible", "hidden"] as const).map((choice) => (
          <button
            aria-pressed={state.draft === choice}
            className="border-r border-border px-2 py-1 text-[10px] text-foreground last:border-r-0 aria-pressed:bg-foreground aria-pressed:text-background disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            disabled={(choice === "visible" && !state.canShow) || (choice === "hidden" && !state.canHide)}
            key={choice}
            onClick={() => onSetChoice(controlId, choice)}
            type="button"
          >
            {choice === "visible" ? "Show" : choice === "hidden" ? "Hide" : "Inherit"}
          </button>
        ))}
      </div>
    </div>
  );
}

function StateBadge({label, tone = "default"}: {readonly label: string; readonly tone?: "danger" | "default"}) {
  return (
    <span className={tone === "danger"
      ? "rounded border border-[#ff453a]/60 bg-[#ff453a]/10 px-1.5 py-0.5 text-[#ff8a80]"
      : "rounded border border-border px-1.5 py-0.5 text-foreground-subtle"}
    >
      {label}
    </span>
  );
}
