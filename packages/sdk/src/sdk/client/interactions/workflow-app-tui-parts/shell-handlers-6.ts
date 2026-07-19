import { formFieldEditableValue } from "./input-form.js";
import { clampIndex, deletePreviousWord, isDeletePreviousWordKey, isDownKey, isEndKey, isEscapeKey, isHomeKey, isLeftKey, isReturnKey, isRightKey, isUpKey } from "./routing-keyboard.js";
import { type StartPane, type TuiInputForm, type TuiInputMode } from "./types.js";
import { type KeyEvent } from "@opentui/core";
import { render } from "@opentui/solid";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers6(ctx: WorkflowAppTuiShellHandlerContext) {

  function handleStartKey(event: KeyEvent) {
    let { deletePromptCharacterBeforeCursor, deletePromptWordBeforeCursor, handleStartCanvasPaneKey, handleStartFormKey, handleStartMetadataPaneKey, handleStartStepPaneKey, insertPromptTextAtCursor, isStartStepPaneEditingKey, movePromptCursor, navigateLibrary, prompt, recallPromptHistory, resetPromptHistoryBrowse, selectedStartInputMode, selectedStartPane, selectedStartStepId, setPromptCursor, startInputForm, submitPrompt, switchStartPane, viewStep } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        navigateLibrary();
        return;
      }
      const form = startInputForm();
      if (event.name === "tab") {
        event.preventDefault();
        switchStartPane(event.shift ? -1 : 1);
        return;
      }
      if (selectedStartPane() === "steps") {
        if (handleStartStepPaneKey(event)) return;
        if (form && selectedStartInputMode() === "render" && isStartStepPaneEditingKey(event)) {
          event.preventDefault();
          return;
        }
      }
      if (selectedStartPane() === "canvas") {
        if (handleStartCanvasPaneKey(event)) return;
        if (isStartStepPaneEditingKey(event)) {
          event.preventDefault();
          return;
        }
      }
      if (selectedStartPane() === "metadata") {
        if (handleStartMetadataPaneKey(event)) return;
        if (isStartStepPaneEditingKey(event)) {
          event.preventDefault();
          return;
        }
      }
      if (form && selectedStartInputMode() === "render" && handleStartFormKey(event, form)) return;
      if (isUpKey(event)) {
        event.preventDefault();
        recallPromptHistory(-1);
        return;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        recallPromptHistory(1);
        return;
      }
      if (isLeftKey(event)) {
        event.preventDefault();
        movePromptCursor(-1);
        return;
      }
      if (isRightKey(event)) {
        event.preventDefault();
        movePromptCursor(1);
        return;
      }
      if (isHomeKey(event)) {
        event.preventDefault();
        setPromptCursor(0);
        return;
      }
      if (isEndKey(event)) {
        event.preventDefault();
        setPromptCursor(prompt().length);
        return;
      }
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        resetPromptHistoryBrowse();
        deletePromptWordBeforeCursor();
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        resetPromptHistoryBrowse();
        deletePromptCharacterBeforeCursor();
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        if (form?.kind === "json" && selectedStartInputMode() === "render") {
          void submitPrompt();
          return;
        }
        if (!prompt().trim() && selectedStartStepId()) {
          viewStep(selectedStartStepId()!);
          return;
        }
        void submitPrompt();
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        resetPromptHistoryBrowse();
        insertPromptTextAtCursor(event.sequence);
      }
    }

  function switchStartPane(direction: -1 | 1) {
    let { setSelectedStartCenterTab, setSelectedStartPane, showStartDiagramPane } = ctx();
      const panes: StartPane[] = showStartDiagramPane()
        ? ["fields", "steps", "canvas", "metadata"]
        : ["fields", "steps", "metadata"];
      setSelectedStartPane((pane: any) => {
        const index = panes.indexOf(pane);
        const next = panes[(index + direction + panes.length) % panes.length] ?? "fields";
        if (next === "canvas") setSelectedStartCenterTab("canvas");
        return next;
      });
    }

  function handleStartStepPaneKey(event: KeyEvent) {
    let { collapseSelectedStartStep, expandSelectedStartStep, selectStartStep, selectStartStepBoundary, selectedStartOutlineItem, selectedStartStepId, submitPrompt, viewStep } = ctx();
      if (isUpKey(event)) {
        event.preventDefault();
        selectStartStep(-1);
        return true;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        selectStartStep(1);
        return true;
      }
      if (isLeftKey(event)) {
        event.preventDefault();
        collapseSelectedStartStep();
        return true;
      }
      if (isRightKey(event)) {
        event.preventDefault();
        expandSelectedStartStep();
        return true;
      }
      if (isHomeKey(event)) {
        event.preventDefault();
        selectStartStepBoundary("first");
        return true;
      }
      if (isEndKey(event)) {
        event.preventDefault();
        selectStartStepBoundary("last");
        return true;
      }
      if (isReturnKey(event) && selectedStartStepId()) {
        event.preventDefault();
        if (selectedStartOutlineItem()?.node.boundary === "trigger") {
          void submitPrompt();
          return true;
        }
        viewStep(selectedStartStepId()!);
        return true;
      }
      return false;
    }

  function handleStartCanvasPaneKey(event: KeyEvent) {
    let { selectStartCanvasBoundary, selectStartCanvasStep, selectedStartOutlineItem, selectedStartStepId, setSelectedStartCenterTab, submitPrompt, viewStep } = ctx();
      if (isLeftKey(event)) {
        event.preventDefault();
        setSelectedStartCenterTab("canvas");
        return true;
      }
      if (isRightKey(event)) {
        event.preventDefault();
        setSelectedStartCenterTab("activity");
        return true;
      }
      if (isUpKey(event)) {
        event.preventDefault();
        selectStartCanvasStep(-1);
        return true;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        selectStartCanvasStep(1);
        return true;
      }
      if (isHomeKey(event)) {
        event.preventDefault();
        selectStartCanvasBoundary("first");
        return true;
      }
      if (isEndKey(event)) {
        event.preventDefault();
        selectStartCanvasBoundary("last");
        return true;
      }
      if (isReturnKey(event) && selectedStartStepId()) {
        event.preventDefault();
        if (selectedStartOutlineItem()?.node.boundary === "trigger") {
          void submitPrompt();
          return true;
        }
        viewStep(selectedStartStepId()!);
        return true;
      }
      return false;
    }

  function handleStartMetadataPaneKey(event: KeyEvent) {
    let { setMetadataPopupOpen } = ctx();
      if (isReturnKey(event)) {
        event.preventDefault();
        setMetadataPopupOpen(true);
        return true;
      }
      return false;
    }

  function handleStepDetailTreeKey(event: KeyEvent) {
    let { collapseSelectedDetailStep, expandSelectedDetailStep, openSelectedStepRuntimeData, selectStepDetailBoundary, selectStepDetailStep } = ctx();
      if (isUpKey(event)) {
        event.preventDefault();
        selectStepDetailStep(-1);
        return true;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        selectStepDetailStep(1);
        return true;
      }
      if (isLeftKey(event)) {
        event.preventDefault();
        collapseSelectedDetailStep();
        return true;
      }
      if (isRightKey(event)) {
        event.preventDefault();
        expandSelectedDetailStep();
        return true;
      }
      if (isHomeKey(event)) {
        event.preventDefault();
        selectStepDetailBoundary("first");
        return true;
      }
      if (isEndKey(event)) {
        event.preventDefault();
        selectStepDetailBoundary("last");
        return true;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        openSelectedStepRuntimeData();
        return true;
      }
      return false;
    }

  function isStartStepPaneEditingKey(event: KeyEvent) {
      return event.name === "backspace" ||
        isDeletePreviousWordKey(event) ||
        Boolean(!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1);
    }

  function handleStartFormKey(event: KeyEvent, form: TuiInputForm) {
    let { editFormFieldDraft, moveFormFieldCursor, resetPromptHistoryBrowse, selectInputField, selectedInputFieldIndex, setFormFieldValue, setPromptCursor } = ctx();
      if (form.fields.length === 0) return false;
      if (isUpKey(event)) {
        event.preventDefault();
        selectInputField(-1, form);
        return true;
      }
      if (isDownKey(event)) {
        event.preventDefault();
        selectInputField(1, form);
        return true;
      }
      if (isReturnKey(event) || event.name === "tab") return false;
      const field = form.fields[clampIndex(selectedInputFieldIndex(), form.fields.length)];
      if (!field) return false;
      if (field.type === "checkbox" && (event.name === "space" || event.sequence === " ")) {
        event.preventDefault();
        setFormFieldValue(form, field, !Boolean(field.value));
        return true;
      }
      if (field.type !== "checkbox" && isLeftKey(event)) {
        event.preventDefault();
        moveFormFieldCursor(field, -1);
        return true;
      }
      if (field.type !== "checkbox" && isRightKey(event)) {
        event.preventDefault();
        moveFormFieldCursor(field, 1);
        return true;
      }
      if (field.type !== "checkbox" && isHomeKey(event)) {
        event.preventDefault();
        setPromptCursor(0);
        return true;
      }
      if (field.type !== "checkbox" && isEndKey(event)) {
        event.preventDefault();
        setPromptCursor(formFieldEditableValue(field).length);
        return true;
      }
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        resetPromptHistoryBrowse();
        editFormFieldDraft(form, field, (value: any, cursor: number) => {
          if (field.type === "checkbox" || cursor <= 0) return { cursor, value };
          const nextBefore = deletePreviousWord(value.slice(0, cursor));
          return {
            cursor: nextBefore.length,
            value: `${nextBefore}${value.slice(cursor)}`,
          };
        });
        return true;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        resetPromptHistoryBrowse();
        editFormFieldDraft(form, field, (value: any, cursor: number) => {
          if (field.type === "checkbox" || cursor <= 0) return { cursor, value };
          return {
            cursor: cursor - 1,
            value: `${value.slice(0, cursor - 1)}${value.slice(cursor)}`,
          };
        });
        return true;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1 && field.type !== "checkbox") {
        event.preventDefault();
        resetPromptHistoryBrowse();
        const text = event.sequence;
        editFormFieldDraft(form, field, (value: any, cursor: number) => ({
          cursor: cursor + text.length,
          value: `${value.slice(0, cursor)}${text}${value.slice(cursor)}`,
        }));
        return true;
      }
      return false;
    }

  function setStartInputMode(next: TuiInputMode) {
    let { selectedWorkflowId, setInputModeByWorkflow, showToast } = ctx();
      setInputModeByWorkflow((value: any) => ({
        ...value,
        [selectedWorkflowId()]: next,
      }));
      showToast({
        message: next === "render" ? "Using rendered input fields" : "Using raw JSON/text input",
        title: "Input mode",
        variant: "info",
      });
    }

  return { handleStartKey, switchStartPane, handleStartStepPaneKey, handleStartCanvasPaneKey, handleStartMetadataPaneKey, handleStepDetailTreeKey, isStartStepPaneEditingKey, handleStartFormKey, setStartInputMode };
}
