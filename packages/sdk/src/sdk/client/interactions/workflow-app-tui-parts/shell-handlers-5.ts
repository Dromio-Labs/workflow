import { appendPromptText } from "./attachments.js";
import { clampNumber } from "./command-palette.js";
import { clampIndex, deletePreviousWord, isDeletePreviousWordKey, isDownKey, isEscapeKey, isReturnKey, isUpKey } from "./routing-keyboard.js";
import { WORKFLOW_EXPORT_STEPS } from "./style.js";
import { workflowExportInitialValues, workflowExportStepFields, workflowExportStepIndex, workflowExportValidationError } from "./workflow-export.js";
import { decodePasteBytes, type KeyEvent, type PasteEvent } from "@opentui/core";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers5(ctx: WorkflowAppTuiShellHandlerContext) {

  function handleLibraryKey(event: KeyEvent) {
    let { commandKey, keymap, libraryWorkflowIds, navigateStart, navigateTriggerJobs, navigateTriggers, openWorkflowExportWizard, props, selectWorkflowIndex, selectedLibraryIndex, setLibraryDiagramOpen, setWorkflowExportMode, setWorkflowExportSelection, toggleWorkflowExportSelection, updateWorkflowQuery, workflowExportMode, workflowQuery } = ctx();
      if (isUpKey(event)) {
        event.preventDefault();
        selectWorkflowIndex(selectedLibraryIndex() - 1, libraryWorkflowIds());
        return;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        selectWorkflowIndex(selectedLibraryIndex() + 1, libraryWorkflowIds());
        return;
      }
      if (event.name === "tab") {
        event.preventDefault();
        setLibraryDiagramOpen((open: boolean) => !open);
        return;
      }
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        updateWorkflowQuery(deletePreviousWord(workflowQuery()));
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        updateWorkflowQuery(workflowQuery().slice(0, -1));
        return;
      }
      if (isEscapeKey(event)) {
        if (workflowQuery()) {
          event.preventDefault();
          updateWorkflowQuery("");
        } else if (workflowExportMode()) {
          event.preventDefault();
          setWorkflowExportMode(false);
          setWorkflowExportSelection(new Set<string>());
        }
        return;
      }
      if (workflowExportMode() && (event.name === "space" || event.sequence === " ")) {
        event.preventDefault();
        const workflowId = libraryWorkflowIds()[selectedLibraryIndex()];
        if (workflowId) toggleWorkflowExportSelection(workflowId);
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        const workflowId = libraryWorkflowIds()[selectedLibraryIndex()];
        if (workflowExportMode()) {
          openWorkflowExportWizard();
          return;
        }
        if (workflowId) navigateStart(workflowId);
        return;
      }
      if (!workflowQuery() && props.controlPlane && commandKey(event, keymap.triggers)) {
        event.preventDefault();
        void navigateTriggers();
        return;
      }
      if (!workflowQuery() && props.controlPlane && commandKey(event, keymap.jobs)) {
        event.preventDefault();
        void navigateTriggerJobs();
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        updateWorkflowQuery(workflowQuery() + event.sequence);
      }
    }

  function openWorkflowExportMode() {
    let { navigateLibrary, props, setDialog, setWorkflowExportMode, setWorkflowExportSelection, showToast } = ctx();
      if (!props.exportWorkflows) {
        setDialog({
          message: "This app has not configured an export handler yet.",
          title: "Export",
          variant: "help",
        });
        return;
      }
      if (!navigateLibrary()) return;
      setWorkflowExportMode(true);
      setWorkflowExportSelection(new Set<string>());
      showToast({
        message: "Space toggles workflows · Enter opens export",
        title: "Export mode",
        variant: "info",
      });
    }

  function toggleWorkflowExportSelection(workflowId: string) {
    let { setWorkflowExportSelection } = ctx();
      setWorkflowExportSelection((current: ReadonlySet<string>) => {
        const next = new Set<string>(current);
        if (next.has(workflowId)) next.delete(workflowId);
        else next.add(workflowId);
        return next;
      });
    }

  function openWorkflowExportWizard() {
    let { props, setWorkflowExportWizard, showToast, workflowExportFields, workflowExportSelection } = ctx();
      if (!props.exportWorkflows) return;
      const selection = workflowExportSelection();
      if (selection.size === 0) {
        showToast({
          message: "Select at least one workflow with Space.",
          title: "Export",
          variant: "warning",
        });
        return;
      }
      setWorkflowExportWizard({
        fieldIndex: 0,
        running: false,
        step: 0,
        values: workflowExportInitialValues(workflowExportFields(), [...selection], props.app),
      });
    }

  function handleWorkflowExportWizardKey(event: KeyEvent) {
    let { setWorkflowExportMode, setWorkflowExportWizard, submitWorkflowExportWizard, workflowExportFields, workflowExportWizard } = ctx();
      const wizard = workflowExportWizard();
      if (!wizard) return;
      if (isEscapeKey(event)) {
        event.preventDefault();
        if (wizard.running) return;
        setWorkflowExportWizard(undefined);
        return;
      }
      if (wizard.result) {
        if (isReturnKey(event)) {
          event.preventDefault();
          setWorkflowExportWizard(undefined);
          setWorkflowExportMode(false);
        }
        return;
      }
      const fields = workflowExportStepFields(workflowExportFields(), wizard.step);
      if (isUpKey(event)) {
        event.preventDefault();
        setWorkflowExportWizard({ ...wizard, fieldIndex: clampIndex(wizard.fieldIndex - 1, fields.length) });
        return;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        setWorkflowExportWizard({ ...wizard, fieldIndex: clampIndex(wizard.fieldIndex + 1, fields.length) });
        return;
      }
      if (event.name === "tab") {
        event.preventDefault();
        setWorkflowExportWizard({ ...wizard, step: (wizard.step + 1) % WORKFLOW_EXPORT_STEPS.length, fieldIndex: 0 });
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        if (wizard.step < WORKFLOW_EXPORT_STEPS.length - 1) {
          setWorkflowExportWizard({ ...wizard, step: wizard.step + 1, fieldIndex: 0, error: undefined });
          return;
        }
        void submitWorkflowExportWizard();
        return;
      }
      const field = fields[clampIndex(wizard.fieldIndex, fields.length)];
      if (!field || wizard.running) return;
      if (field.type === "boolean" && (event.name === "space" || event.sequence === " ")) {
        event.preventDefault();
        setWorkflowExportWizard({
          ...wizard,
          values: {
            ...wizard.values,
            [field.id]: wizard.values[field.id] === "true" ? "false" : "true",
          },
        });
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        setWorkflowExportWizard({
          ...wizard,
          values: {
            ...wizard.values,
            [field.id]: (wizard.values[field.id] ?? "").slice(0, -1),
          },
        });
        return;
      }
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        setWorkflowExportWizard({
          ...wizard,
          values: {
            ...wizard.values,
            [field.id]: deletePreviousWord(wizard.values[field.id] ?? ""),
          },
        });
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1 && field.type !== "boolean") {
        event.preventDefault();
        setWorkflowExportWizard({
          ...wizard,
          values: {
            ...wizard.values,
            [field.id]: `${wizard.values[field.id] ?? ""}${event.sequence}`,
          },
        });
      }
    }

  function handleWorkflowExportWizardPaste(event: PasteEvent) {
    let { setWorkflowExportWizard, workflowExportFields, workflowExportWizard } = ctx();
      const wizard = workflowExportWizard();
      if (!wizard || wizard.running || wizard.result) return;
      const fields = workflowExportStepFields(workflowExportFields(), wizard.step);
      const field = fields[clampIndex(wizard.fieldIndex, fields.length)];
      if (!field || field.type === "boolean") return;
      const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      setWorkflowExportWizard({
        ...wizard,
        values: {
          ...wizard.values,
          [field.id]: `${wizard.values[field.id] ?? ""}${normalizedText}`,
        },
      });
    }

  async function submitWorkflowExportWizard() {
    let { props, setWorkflowExportWizard, showToast, workflowExportFields, workflowExportSelection, workflowExportWizard } = ctx();
      const wizard = workflowExportWizard();
      const exportHandler = props.exportWorkflows;
      if (!wizard || !exportHandler) return;
      const invalid = workflowExportValidationError(workflowExportFields(), wizard.values);
      if (invalid) {
        const invalidStep = workflowExportStepIndex(workflowExportFields().find((field: any) => field.id === invalid.fieldId)?.step ?? "app");
        setWorkflowExportWizard({
          ...wizard,
          error: invalid.message,
          fieldIndex: Math.max(0, workflowExportStepFields(workflowExportFields(), invalidStep).findIndex((field) => field.id === invalid.fieldId)),
          step: invalidStep,
        });
        return;
      }
      setWorkflowExportWizard({ ...wizard, error: undefined, running: true });
      try {
        const result = await exportHandler.run({
          fields: wizard.values,
          workflowIds: [...workflowExportSelection()],
        });
        setWorkflowExportWizard({
          ...wizard,
          result,
          running: false,
        });
        showToast({
          message: result.bundleDir ?? result.message ?? "Export complete",
          title: "Exported",
          variant: "success",
        });
      } catch (error) {
        setWorkflowExportWizard({
          ...wizard,
          error: error instanceof Error ? error.message : String(error),
          running: false,
        });
      }
    }

  function handleLibraryDiagramKey(event: KeyEvent) {
    let { libraryWorkflowIds, navigateStart, selectWorkflowIndex, selectedLibraryIndex, setLibraryDiagramOpen } = ctx();
      if (event.name === "tab" || isEscapeKey(event)) {
        event.preventDefault();
        setLibraryDiagramOpen(false);
        return;
      }
      if (isUpKey(event)) {
        event.preventDefault();
        selectWorkflowIndex(selectedLibraryIndex() - 1, libraryWorkflowIds());
        return;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        selectWorkflowIndex(selectedLibraryIndex() + 1, libraryWorkflowIds());
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        setLibraryDiagramOpen(false);
        const workflowId = libraryWorkflowIds()[selectedLibraryIndex()];
        if (workflowId) navigateStart(workflowId);
        return;
      }
      event.preventDefault();
    }

  function replacePromptDraft(value: string, cursor = value.length) {
    let { setPrompt, setPromptCursor } = ctx();
      setPrompt(value);
      setPromptCursor(clampNumber(cursor, 0, value.length));
    }

  function editPromptDraft(editor: (value: string, cursor: number) => { cursor: number; value: string }) {
  let { prompt, promptCursor, replacePromptDraft } = ctx();
      const current = prompt();
      const cursor = clampNumber(promptCursor(), 0, current.length);
      const next = editor(current, cursor);
      replacePromptDraft(next.value, next.cursor);
    }

  function insertPromptTextAtCursor(text: string) {
    let { editPromptDraft } = ctx();
      if (!text) return;
      editPromptDraft((value: any, cursor: number) => ({
        cursor: cursor + text.length,
        value: `${value.slice(0, cursor)}${text}${value.slice(cursor)}`,
      }));
    }

  function appendPromptTextAtCursor(text: string) {
    let { editPromptDraft } = ctx();
      if (!text) return;
      editPromptDraft((value: any, cursor: number) => {
        const before = value.slice(0, cursor);
        const after = value.slice(cursor);
        const inserted = appendPromptText(before, text);
        return {
          cursor: inserted.length,
          value: `${inserted}${after}`,
        };
      });
    }

  function deletePromptCharacterBeforeCursor() {
    let { editPromptDraft } = ctx();
      editPromptDraft((value: any, cursor: number) => {
        if (cursor <= 0) return { cursor, value };
        return {
          cursor: cursor - 1,
          value: `${value.slice(0, cursor - 1)}${value.slice(cursor)}`,
        };
      });
    }

  function deletePromptWordBeforeCursor() {
    let { editPromptDraft } = ctx();
      editPromptDraft((value: any, cursor: number) => {
        if (cursor <= 0) return { cursor, value };
        const nextBefore = deletePreviousWord(value.slice(0, cursor));
        return {
          cursor: nextBefore.length,
          value: `${nextBefore}${value.slice(cursor)}`,
        };
      });
    }

  function movePromptCursor(delta: number) {
    let { prompt, setPromptCursor } = ctx();
      setPromptCursor((cursor: number) => clampNumber(cursor + delta, 0, prompt().length));
    }

  return { handleLibraryKey, openWorkflowExportMode, toggleWorkflowExportSelection, openWorkflowExportWizard, handleWorkflowExportWizardKey, handleWorkflowExportWizardPaste, submitWorkflowExportWizard, handleLibraryDiagramKey, replacePromptDraft, editPromptDraft, insertPromptTextAtCursor, appendPromptTextAtCursor, deletePromptCharacterBeforeCursor, deletePromptWordBeforeCursor, movePromptCursor };
}
