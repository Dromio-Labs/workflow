import { stepDetailTitle, type WorkflowStepDetailTarget } from "./artifact-step-pages.js";
import { runStepInspectorPopupLines } from "./run-inspector-data.js";
import { metadataRowExternalEditorTarget, workflowConfigExternalEditorTarget, workflowConfigFieldEffectiveValue, workflowConfigValueFromDraft, workflowPromptWithConfigValue, workflowPromptWithoutConfigValue, writeWorkflowConfigValue } from "./config-utils.js";
import { artifactDisplayPath, firstStepInspectorPopupActionLineIndex } from "./dialogs-popups.js";
import { parsePromptObject } from "./input-form.js";
import { copyTextToClipboard, openPathInExternalEditor } from "./native-io.js";
import { clampIndex, deletePreviousWord, isDeletePreviousWordKey, isEscapeKey, isReturnKey } from "./routing-keyboard.js";
import { stepRuntimeDataContent } from "./step-detail-view.js";
import { type ExternalEditorTarget, type ShellToast, type WorkflowConfigField } from "./types.js";
import { decodePasteBytes, type KeyEvent, type PasteEvent } from "@opentui/core";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers2(ctx: WorkflowAppTuiShellHandlerContext) {

  function handleConfigValueEditorKey(event: KeyEvent) {
    let { saveConfigValueEditor, setConfigValueEditor, setConfigValueEditorDraft, toggleConfigValueEditorTarget } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        setConfigValueEditor(undefined);
        return;
      }
      if (isDeletePreviousWordKey(event)) {
        event.preventDefault();
        setConfigValueEditorDraft(deletePreviousWord);
        return;
      }
      if (event.name === "tab") {
        event.preventDefault();
        toggleConfigValueEditorTarget();
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        setConfigValueEditorDraft((value: any) => value.slice(0, -1));
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        saveConfigValueEditor();
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        setConfigValueEditorDraft((value: any) => value + event.sequence);
      }
    }

  function handleConfigValueEditorPaste(event: PasteEvent) {
    let { setConfigValueEditorDraft } = ctx();
      const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      setConfigValueEditorDraft((value: any) => `${value}${normalizedText}`);
    }

  function setConfigValueEditorDraft(update: string | ((value: string) => string)) {
  let { setConfigValueEditor } = ctx();
      setConfigValueEditor((editor: any) => {
        if (!editor) return editor;
        return {
          ...editor,
          draft: typeof update === "function" ? update(editor.draft) : update,
        };
      });
    }

  function openConfigValueEditor(field: WorkflowConfigField) {
    let { configOverridesByWorkflow, prompt, selectedWorkflow, setConfigValueEditor } = ctx();
      const workflow = selectedWorkflow();
      const key = field.inputKey ?? field.id;
      const currentValue = workflowConfigFieldEffectiveValue(
        field,
        parsePromptObject(prompt()),
        configOverridesByWorkflow()[workflow.id] ?? {},
      );
      setConfigValueEditor({
        configPath: key === "configPath" ? undefined : workflow.configuration?.configPath,
        draft: currentValue === undefined || currentValue === "" ? "" : String(currentValue),
        field,
        saveTarget: "request",
        workflowId: workflow.id,
      });
    }

  function openPromptFileViewer(filePath: string) {
    let { setPromptFileViewer, setPromptFileViewerScrollOffset, showToast } = ctx();
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      try {
        setPromptFileViewerScrollOffset(0);
        setPromptFileViewer({
          content: readFileSync(absolutePath, "utf8"),
          displayPath: artifactDisplayPath(absolutePath),
          path: absolutePath,
        });
      } catch (caught) {
        showToast({
          message: caught instanceof Error ? caught.message : String(caught),
          title: "Prompt file",
          variant: "error",
        });
      }
    }

  function selectedExternalEditorTarget(): ExternalEditorTarget | undefined {
  let { configOverridesByWorkflow, prompt, route, selectedMetadataPromptRowIndex, selectedMetadataRows, selectedStartPane, selectedWorkflow, selectedWorkflowId } = ctx();
      const currentRoute = route();
      if (currentRoute.type === "start" && selectedStartPane() === "metadata") {
        const metadataTarget = metadataRowExternalEditorTarget(
          selectedMetadataRows()[clampIndex(selectedMetadataPromptRowIndex(), selectedMetadataRows().length)],
          selectedWorkflow(),
          prompt(),
          configOverridesByWorkflow()[selectedWorkflowId()] ?? {},
        );
        if (metadataTarget) return metadataTarget;
      }
      return workflowConfigExternalEditorTarget(selectedWorkflow(), prompt(), configOverridesByWorkflow()[selectedWorkflowId()] ?? {});
    }

  function openWorkflowConfigExternalEditor() {
    let { configOverridesByWorkflow, openExternalEditorTarget, prompt, selectedWorkflow, selectedWorkflowId, showToast } = ctx();
      const target = workflowConfigExternalEditorTarget(
        selectedWorkflow(),
        prompt(),
        configOverridesByWorkflow()[selectedWorkflowId()] ?? {},
      );
      if (!target) {
        showToast({
          message: "This workflow does not expose a config file path.",
          title: "External editor",
          variant: "warning",
        });
        return;
      }
      void openExternalEditorTarget(target);
    }

  async function openSelectedExternalEditorTarget() {
    let { openExternalEditorTarget, selectedExternalEditorTarget, showToast } = ctx();
      const target = selectedExternalEditorTarget();
      if (!target) {
        showToast({
          message: "Select a metadata file row, or choose a workflow with a config file.",
          title: "External editor",
          variant: "warning",
        });
        return;
      }
      await openExternalEditorTarget(target);
    }

  async function openExternalEditorTarget(target: ExternalEditorTarget) {
    let { refreshWorkflowConfigOverridesFromFile, renderer, showToast } = ctx();
      const result = await openPathInExternalEditor({
        create: target.create,
        defaultContent: target.defaultContent,
        filePath: target.filePath,
        renderer,
      });
      if (!result.ok) {
        showToast({
          message: result.message,
          title: "External editor",
          variant: "error",
        });
        return;
      }
      if (target.kind === "config" && target.workflowId) {
        const refresh = refreshWorkflowConfigOverridesFromFile(target.workflowId, result.filePath);
        if (!refresh.ok) {
          showToast({
            message: refresh.message,
            title: "External editor",
            variant: "warning",
          });
          return;
        }
      }
      showToast({
        message: `Edited ${artifactDisplayPath(result.filePath)}`,
        title: "External editor",
        variant: "success",
      });
    }

  function refreshWorkflowConfigOverridesFromFile(
      workflowId: string,
      filePath: string,
    ): { ok: true } | { message: string; ok: false } {
  let { setConfigOverridesByWorkflow } = ctx();
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return {
            message: "Config file must contain a JSON object before values can refresh.",
            ok: false,
          };
        }
        setConfigOverridesByWorkflow((current: any) => ({
          ...current,
          [workflowId]: {
            ...(current[workflowId] ?? {}),
            ...(parsed as Record<string, unknown>),
          },
        }));
        return { ok: true };
      } catch (caught) {
        return {
          message: caught instanceof Error ? caught.message : String(caught),
          ok: false,
        };
      }
    }

  function openActiveRunStepInspectorPopup() {
    let { currentActiveRunStepId, selectedWorkflow, selectedWorkspaceFrame, setStepInspectorPopup, setStepInspectorPopupScrollOffset, setStepInspectorPopupSelectedLineIndex, showToast, snapshot } = ctx();
      const stepId = currentActiveRunStepId();
      const currentSnapshot = snapshot();
      const step = stepId ? currentSnapshot.steps.find((candidate: any) => candidate.id === stepId) : undefined;
      if (!step) {
        showToast({
          message: "Select a workflow step before opening the inspector.",
          title: "Step inspector",
          variant: "info",
        });
        return;
      }
      const lines = runStepInspectorPopupLines({
        snapshot: currentSnapshot,
        step,
        workflow: selectedWorkflow(),
        workspaceFrame: selectedWorkspaceFrame(),
      });
      setStepInspectorPopupScrollOffset(0);
      setStepInspectorPopupSelectedLineIndex(firstStepInspectorPopupActionLineIndex(lines));
      setStepInspectorPopup({
        lines,
        stepId: step.id,
        title: `STEP INSPECTOR • ${stepDetailTitle(step)}`,
      });
    }

  function openStepRuntimeDataViewer(step: WorkflowStepDetailTarget) {
    let { setPromptFileViewer, setPromptFileViewerScrollOffset, showToast } = ctx();
      const content = stepRuntimeDataContent(step);
      if (!content) {
        showToast({
          message: "No runtime input or output has been captured for this step yet.",
          title: "Step data",
          variant: "info",
        });
        return;
      }
      setPromptFileViewerScrollOffset(0);
      setPromptFileViewer({
        content,
        displayPath: stepDetailTitle(step),
        path: `${step.id}.runtime.json`,
        title: "Step data",
      });
    }

  function openActivityContentViewer(title: string, content: string) {
    let { setPromptFileViewer, setPromptFileViewerScrollOffset } = ctx();
      setPromptFileViewerScrollOffset(0);
      setPromptFileViewer({
        content,
        displayPath: title,
        path: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "activity"}.txt`,
        title: "Activity inspector",
      });
    }

  function toggleConfigValueEditorTarget() {
    let { setConfigValueEditor, showToast } = ctx();
      setConfigValueEditor((editor: any) => {
        if (!editor) return editor;
        if (!editor.configPath) {
          showToast({
            message: "This field can only be saved to the request draft.",
            title: "Configuration",
            variant: "warning",
          });
          return editor;
        }
        return {
          ...editor,
          saveTarget: editor.saveTarget === "request" ? "config" : "request",
        };
      });
    }

  function saveConfigValueEditor() {
    let { configValueEditor, prompt, replacePromptDraft, resetPromptHistoryBrowse, setConfigOverridesByWorkflow, setConfigValueEditor, showToast } = ctx();
      const editor = configValueEditor();
      if (!editor) return;
      const key = editor.field.inputKey ?? editor.field.id;
      let value: unknown;
      try {
        value = workflowConfigValueFromDraft(editor.field, editor.draft);
      } catch (caught) {
        showToast({
          message: caught instanceof Error ? caught.message : String(caught),
          title: "Configuration",
          variant: "error",
        });
        return;
      }
      if (editor.saveTarget === "config") {
        if (!editor.configPath) {
          showToast({
            message: "This field does not have a config file destination.",
            title: "Configuration",
            variant: "error",
          });
          return;
        }
        try {
          writeWorkflowConfigValue(editor.configPath, key, value);
        } catch (caught) {
          showToast({
            message: caught instanceof Error ? caught.message : String(caught),
            title: "Configuration",
            variant: "error",
          });
          return;
        }
        setConfigOverridesByWorkflow((current: any) => ({
          ...current,
          [editor.workflowId]: {
            ...(current[editor.workflowId] ?? {}),
            [key]: value,
          },
        }));
        resetPromptHistoryBrowse();
        replacePromptDraft(workflowPromptWithoutConfigValue(prompt(), key));
      } else {
        resetPromptHistoryBrowse();
        replacePromptDraft(workflowPromptWithConfigValue(prompt(), key, value));
      }
      setConfigValueEditor(undefined);
      showToast({
        message: editor.saveTarget === "config"
          ? `Saved ${editor.field.label ?? editor.field.id} to ${editor.configPath}`
          : `Updated ${editor.field.label ?? editor.field.id} in the run input draft`,
        title: "Configuration",
        variant: "success",
      });
    }

  function copySelectionToClipboard() {
    let { copySelectedTextToClipboard } = ctx();
      copySelectedTextToClipboard();
    }

  function copySelectedTextToClipboard() {
    let { copyTextWithToast, renderer } = ctx();
      const text = renderer.getSelection()?.getSelectedText();
      if (!text) return false;
      copyTextWithToast(text);
      renderer.clearSelection();
      return true;
    }

  function copyTextWithToast(text: string) {
    let { renderer, showToast } = ctx();
      void copyTextToClipboard(text, renderer)
        .then(() => showToast({ message: "Copied to clipboard", variant: "info" }))
        .catch((caught) => {
          showToast({
            message: caught instanceof Error ? caught.message : String(caught),
            title: "Clipboard",
            variant: "error",
          });
        });
    }

  function showToast(input: ShellToast & { duration?: number }) {
    let { setToast, toastTimer } = ctx();
      const { duration = 3000, ...current } = input;
      setToast(current);
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        setToast(undefined);
        toastTimer = undefined;
      }, duration);
      if (typeof toastTimer === "object" && "unref" in toastTimer) toastTimer.unref();
    }

  return { handleConfigValueEditorKey, handleConfigValueEditorPaste, setConfigValueEditorDraft, openConfigValueEditor, openPromptFileViewer, selectedExternalEditorTarget, openWorkflowConfigExternalEditor, openSelectedExternalEditorTarget, openExternalEditorTarget, refreshWorkflowConfigOverridesFromFile, openActiveRunStepInspectorPopup, openStepRuntimeDataViewer, openActivityContentViewer, toggleConfigValueEditorTarget, saveConfigValueEditor, copySelectionToClipboard, copySelectedTextToClipboard, copyTextWithToast, showToast };
}
