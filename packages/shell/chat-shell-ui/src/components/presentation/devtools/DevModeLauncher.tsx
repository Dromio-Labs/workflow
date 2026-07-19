import type {ShellControlId} from "../../../contracts/chatShellPresentation";
import {ComponentInventory} from "./ComponentInventory";
import type {AuthoringChoice, ControlAuthoringState} from "./authoringModel";
import {DevButton} from "./DevButton";

export type DevToolsMode = "closed" | "edit" | "preview";

export function DevModeLauncher({
  controlStates,
  mode,
  onClose,
  onExport,
  onHideSelected,
  onPreview,
  onReset,
  onSetChoice,
  onReturnToEdit,
  onToggle,
  panelOpen,
  selectedCount,
}: {
  readonly controlStates: Readonly<Record<ShellControlId, ControlAuthoringState>>;
  readonly mode: DevToolsMode;
  readonly onClose: () => void;
  readonly onExport: () => void;
  readonly onHideSelected: () => void;
  readonly onPreview: () => void;
  readonly onReset: () => void;
  readonly onSetChoice: (controlId: ShellControlId, choice: AuthoringChoice) => void;
  readonly onReturnToEdit: () => void;
  readonly onToggle: () => void;
  readonly panelOpen: boolean;
  readonly selectedCount: number;
}) {
  const shownCount = Object.values(controlStates).filter((state) => state.result === "shown").length;
  const changedCount = Object.values(controlStates).filter((state) => state.draft !== "inherit").length;

  return (
    <div
      className="hero-visual-theme fixed bottom-4 z-[1200]"
      style={{left: "var(--chat-shell-devtools-left, 1rem)"}}
    >
      {panelOpen ? (
        <section
          aria-label="Dev Mode controls"
          className="hero-overlay-scrollbar absolute left-0 grid gap-3 overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl"
          style={{
            bottom: "calc(100% + 8px)",
            maxHeight: "min(28rem, calc(100svh - 5rem))",
            width: "min(24rem, calc(100vw - 2rem))",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-foreground">
              {mode === "preview" ? "Production preview" : "Dev Mode"}
            </span>
            {mode === "edit" ? (
              <span className="text-xs text-foreground-subtle">
                {shownCount} live · {changedCount} draft changes
              </span>
            ) : null}
          </div>
          {mode === "preview" ? (
            <DevButton onClick={onReturnToEdit}>Back to edit</DevButton>
          ) : (
            <>
              {selectedCount > 0 ? (
                <DevButton onClick={onHideSelected}>Hide selected ({selectedCount})</DevButton>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <DevButton onClick={onPreview}>Preview</DevButton>
                <DevButton onClick={onExport}>Export</DevButton>
                <DevButton onClick={onReset}>Reset draft</DevButton>
                <DevButton onClick={onClose}>Done</DevButton>
              </div>
              <ComponentInventory
                controlStates={controlStates}
                onSetChoice={onSetChoice}
              />
            </>
          )}
        </section>
      ) : null}
      <button
        aria-expanded={panelOpen}
        aria-label="Toggle Dev Mode controls"
        className="relative grid size-10 place-items-center rounded-full border border-border bg-background text-foreground shadow-xl hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        title="Dev Mode"
        type="button"
      >
        <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="18">
          <path d="m8 8-4 4 4 4" />
          <path d="m16 8 4 4-4 4" />
          <path d="m14 5-4 14" />
        </svg>
        {mode !== "closed" ? <span aria-hidden="true" className="absolute right-0 top-0 size-2.5 rounded-full border-2 border-background bg-[#ff453a]" /> : null}
      </button>
    </div>
  );
}
