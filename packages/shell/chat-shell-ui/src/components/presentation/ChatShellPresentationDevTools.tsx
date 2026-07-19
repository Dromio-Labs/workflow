import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  chatShellPresentationSchemaVersion,
  ShellControlIdSchema,
  ShellPresentationPatchSchema,
  type ShellControlId,
  type ShellPresentationPatch,
  type ShellPresentationPolicy,
  type ShellPresentationPreferences,
} from "../../contracts/chatShellPresentation";
import type {ChatShellManifest} from "../../contracts/chatShellManifest";
import {
  createAuthoringCanvasPatch,
  createEmptyPresentationPatch,
  mergePresentationPatches,
  resolveControlAuthoringStates,
  type AuthoringChoice,
} from "./devtools/authoringModel";
import {DevModeLauncher, type DevToolsMode} from "./devtools/DevModeLauncher";
import {ExportPanel} from "./devtools/ExportPanel";
import {useDevToolsLauncherAnchor} from "./devtools/useDevToolsLauncherAnchor";

export type ChatShellDevToolsOptions = {
  readonly enabled: boolean;
  readonly initiallyOpen?: boolean;
  readonly onPresentationChange?: (patch: ShellPresentationPatch) => void;
  readonly authoringManifest?: ChatShellManifest;
};

export function ChatShellPresentationDevTools({
  children,
  initialPatch,
  manifest,
  options,
  policy,
  preferences,
}: {
  readonly children: (patch: ShellPresentationPatch | undefined, mode: DevToolsMode) => ReactNode;
  readonly initialPatch?: ShellPresentationPatch;
  readonly manifest: ChatShellManifest;
  readonly options: ChatShellDevToolsOptions;
  readonly policy?: ShellPresentationPolicy;
  readonly preferences?: ShellPresentationPreferences;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<DevToolsMode>(
    options.initiallyOpen ? "edit" : "closed",
  );
  const [panelOpen, setPanelOpen] = useState(options.initiallyOpen ?? false);
  const [draftOverrides, setDraftOverrides] = useState<ShellPresentationPatch>(
    createEmptyPresentationPatch,
  );
  const [selected, setSelected] = useState<ReadonlySet<ShellControlId>>(
    () => new Set(),
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const effectivePatch = useMemo(
    () => mergePresentationPatches(initialPatch, draftOverrides),
    [draftOverrides, initialPatch],
  );
  const controlStates = useMemo(
    () => resolveControlAuthoringStates({
      authoringManifest: options.authoringManifest,
      baselinePatch: initialPatch,
      draftOverrides,
      manifest,
      policy,
      preferences,
    }),
    [draftOverrides, initialPatch, manifest, options.authoringManifest, policy, preferences],
  );
  const renderedPatch = mode === "closed"
    ? initialPatch
    : mode === "preview" ? effectivePatch : createAuthoringCanvasPatch();
  useDevToolsLauncherAnchor(rootRef);

  useEffect(() => {
    if (mode !== "edit") {
      return;
    }

    rootRef.current?.querySelectorAll<HTMLElement>("[data-shell-control-id]").forEach((element) => {
      const parsed = ShellControlIdSchema.safeParse(element.dataset.shellControlId);
      if (parsed.success) {
        const state = controlStates[parsed.data];
        element.dataset.shellDevtoolsBaseline = state.baseline;
        element.dataset.shellDevtoolsDraft = state.draft;
        element.dataset.shellDevtoolsResult = state.result;
        element.dataset.shellDevtoolsResultLabel = resultLabel(state.result);
      }
    });
  }, [controlStates, mode]);

  const updateDraftOverrides = (next: ShellPresentationPatch) => {
    const parsed = ShellPresentationPatchSchema.parse(next);
    setDraftOverrides(parsed);
    options.onPresentationChange?.(mergePresentationPatches(initialPatch, parsed));
  };

  const setControlChoice = (controlId: ShellControlId, choice: AuthoringChoice) => {
    const state = controlStates[controlId];
    if ((choice === "visible" && !state.canShow) || (choice === "hidden" && !state.canHide)) {
      return;
    }
    const controls = {...draftOverrides.controls};
    if (choice === "inherit") {
      delete controls[controlId];
    } else {
      controls[controlId] = {visibility: choice};
    }
    updateDraftOverrides({controls, schemaVersion: chatShellPresentationSchemaVersion});
  };

  const hideControls = (controlIds: readonly ShellControlId[]) => {
    const hideableControlIds = controlIds.filter((controlId) => controlStates[controlId].canHide);
    if (hideableControlIds.length === 0) {
      return;
    }

    updateDraftOverrides({
      controls: {
        ...draftOverrides.controls,
        ...Object.fromEntries(hideableControlIds.map((controlId) => [
          controlId,
          {visibility: "hidden" as const},
        ])),
      },
      schemaVersion: chatShellPresentationSchemaVersion,
    });
    setSelected(new Set());
  };

  const reset = () => {
    setSelected(new Set());
    updateDraftOverrides(createEmptyPresentationPatch());
  };

  const handleControlClick = (event: MouseEvent<HTMLDivElement>) => {
    if (mode !== "edit") {
      return;
    }

    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-shell-control-id]")
      : null;
    const parsedControlId = ShellControlIdSchema.safeParse(
      target?.dataset.shellControlId,
    );

    if (!target || !parsedControlId.success) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (target.dataset.shellControlRequired === "true") {
      return;
    }

    const controlState = controlStates[parsedControlId.data];
    if ((!controlState.canHide && controlState.result === "shown")
      || (!controlState.canShow && controlState.result !== "shown")) {
      return;
    }

    if (!event.shiftKey) {
      setControlChoice(
        parsedControlId.data,
        controlStates[parsedControlId.data].result === "shown" ? "hidden" : "visible",
      );
      return;
    }

    setSelected((current) => {
      const next = new Set(current);
      if (next.has(parsedControlId.data)) {
        next.delete(parsedControlId.data);
      } else {
        next.add(parsedControlId.data);
      }
      return next;
    });
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const applyImport = () => {
    const result = parsePatch(importValue);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }

    setImportError(null);
    setSelected(new Set());
    updateDraftOverrides(result.patch);
  };

  const togglePanel = () => {
    if (mode === "closed") {
      setMode("edit");
      setPanelOpen(true);
      return;
    }
    setPanelOpen((open) => !open);
  };

  const enterPreview = () => {
    setMode("preview");
    setPanelOpen(false);
  };

  const returnToEdit = () => {
    setMode("edit");
    setPanelOpen(true);
  };

  const closeEditor = () => {
    setMode("closed");
    setPanelOpen(false);
    setExportOpen(false);
  };

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col"
      data-shell-dev-mode={mode}
      onClickCapture={handleControlClick}
      ref={rootRef}
    >
      <div className="relative min-h-0 w-full flex-1">
        {children(renderedPatch, mode)}
      </div>
      {mode === "edit" && exportOpen ? (
        <ExportPanel
          importError={importError}
          importValue={importValue}
          onApplyImport={applyImport}
          onCopy={copy}
          onImportValueChange={setImportValue}
          onReset={reset}
          patch={effectivePatch}
        />
      ) : null}
      <DevModeLauncher
        controlStates={controlStates}
        mode={mode}
        onClose={closeEditor}
        onExport={() => setExportOpen((open) => !open)}
        onHideSelected={() => hideControls([...selected])}
        onPreview={enterPreview}
        onReset={reset}
        onSetChoice={setControlChoice}
        onReturnToEdit={returnToEdit}
        onToggle={togglePanel}
        panelOpen={panelOpen}
        selectedCount={selected.size}
      />
    </div>
  );
}

function parsePatch(value: string):
  | {readonly ok: true; readonly patch: ShellPresentationPatch}
  | {readonly error: string; readonly ok: false} {
  try {
    const result = ShellPresentationPatchSchema.safeParse(JSON.parse(value));
    return result.success
      ? {ok: true, patch: result.data}
      : {error: result.error.issues[0]?.message ?? "Invalid presentation patch", ok: false};
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid JSON",
      ok: false,
    };
  }
}

function resultLabel(result: "shown" | "hidden" | "sample" | "unsupported") {
  if (result === "shown") return "Live";
  if (result === "hidden") return "Hidden";
  if (result === "sample") return "Sample";
  return "Unsupported";
}
