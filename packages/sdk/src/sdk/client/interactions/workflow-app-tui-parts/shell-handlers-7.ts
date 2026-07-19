import { isPromptAttachmentMediaType, mediaTypeFromPath, nextAttachmentLabel, pastedFilePath, savePromptAttachment } from "./attachments.js";
import { readClipboardImage } from "./native-io.js";
import { clampIndex, isDeletePreviousWordKey, isDownKey, isEndKey, isEscapeKey, isHomeKey, isLeftKey, isReturnKey, isRightKey, isUpKey } from "./routing-keyboard.js";
import { decodePasteBytes, type KeyEvent, type PasteEvent } from "@opentui/core";
import { render } from "@opentui/solid";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { type WorkflowAppTuiShellContext } from "./shell-context.js";

export type WorkflowAppTuiShellHandlerContext = WorkflowAppTuiShellContext;

export function createWorkflowAppTuiShellHandlers7(ctx: WorkflowAppTuiShellHandlerContext) {

  function handleTriggersKey(event: KeyEvent) {
    let { commandKey, copyOpenApiUrl, copySelectedTriggerCurl, keymap, navigateLibrary, navigateTriggerFire, navigateTriggerJobs, openSwaggerUi, refreshTriggerRuntime, selectTriggerIndex, selectedTrigger, selectedTriggerIndex } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        navigateLibrary();
        return;
      }
      if (isUpKey(event)) {
        event.preventDefault();
        selectTriggerIndex(selectedTriggerIndex() - 1);
        return;
      }
      if (isDownKey(event) || event.name === "tab") {
        event.preventDefault();
        selectTriggerIndex(selectedTriggerIndex() + 1);
        return;
      }
      if (commandKey(event, keymap.refresh)) {
        event.preventDefault();
        void refreshTriggerRuntime();
        return;
      }
      if (commandKey(event, keymap.jobs)) {
        event.preventDefault();
        void navigateTriggerJobs();
        return;
      }
      if (commandKey(event, keymap.fireTrigger) || isReturnKey(event)) {
        event.preventDefault();
        const trigger = selectedTrigger();
        if (trigger) navigateTriggerFire(trigger);
        return;
      }
      if (commandKey(event, keymap.copyCurl)) {
        event.preventDefault();
        void copySelectedTriggerCurl();
        return;
      }
      if (commandKey(event, keymap.openApi)) {
        event.preventDefault();
        void copyOpenApiUrl();
        return;
      }
      if (commandKey(event, keymap.openSwagger)) {
        event.preventDefault();
        void openSwaggerUi();
      }
    }

  function handleTriggerFireKey(event: KeyEvent) {
    let { deletePromptCharacterBeforeCursor, deletePromptWordBeforeCursor, insertPromptTextAtCursor, movePromptCursor, navigateTriggers, prompt, setPromptCursor, submitTriggerPrompt } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        void navigateTriggers();
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
        deletePromptWordBeforeCursor();
        return;
      }
      if (event.name === "backspace") {
        event.preventDefault();
        deletePromptCharacterBeforeCursor();
        return;
      }
      if (isReturnKey(event)) {
        event.preventDefault();
        void submitTriggerPrompt();
        return;
      }
      if (!event.ctrl && !event.meta && event.sequence && event.sequence.length === 1) {
        event.preventDefault();
        insertPromptTextAtCursor(event.sequence);
      }
    }

  function handleTriggerJobsKey(event: KeyEvent) {
    let { commandKey, confirmSelectedJobCancel, confirmSelectedJobDeadLetter, copySelectedJobId, keymap, navigateLibrary, navigateTriggers, openSelectedJobRun, refreshTriggerRuntime, retrySelectedJob, selectJobIndex, selectedJobIndex } = ctx();
      if (isEscapeKey(event)) {
        event.preventDefault();
        navigateLibrary();
        return;
      }
      if (isUpKey(event)) {
        event.preventDefault();
        selectJobIndex(selectedJobIndex() - 1);
        return;
      }
      if (isDownKey(event) || event.name === "tab") {
        event.preventDefault();
        selectJobIndex(selectedJobIndex() + 1);
        return;
      }
      if (commandKey(event, keymap.refresh)) {
        event.preventDefault();
        void refreshTriggerRuntime();
        return;
      }
      if (commandKey(event, keymap.triggers)) {
        event.preventDefault();
        void navigateTriggers();
        return;
      }
      if (commandKey(event, keymap.viewRun)) {
        event.preventDefault();
        void openSelectedJobRun();
        return;
      }
      if (commandKey(event, keymap.retryJob)) {
        event.preventDefault();
        void retrySelectedJob();
        return;
      }
      if (commandKey(event, keymap.cancelJob)) {
        event.preventDefault();
        confirmSelectedJobCancel();
        return;
      }
      if (commandKey(event, keymap.deadLetterJob)) {
        event.preventDefault();
        confirmSelectedJobDeadLetter();
        return;
      }
      if (commandKey(event, keymap.copyId)) {
        event.preventDefault();
        void copySelectedJobId();
        return;
      }
    }

  async function handlePasteEvent(event: PasteEvent) {
    let { appendPromptTextAtCursor, attachPromptFile, editFormFieldDraft, pasteClipboardImage, resetPromptHistoryBrowse, selectedInputFieldIndex, selectedStartInputMode, startInputForm } = ctx();
      const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const pastedContent = normalizedText.trim();
      if (!pastedContent) {
        await pasteClipboardImage();
        return;
      }
      const filePath = pastedFilePath(pastedContent);
      if (filePath && attachPromptFile(filePath)) return;
      resetPromptHistoryBrowse();
      const form = startInputForm();
      if (form && selectedStartInputMode() === "render") {
        const field = form.fields[clampIndex(selectedInputFieldIndex(), form.fields.length)];
        if (field && field.type !== "checkbox") {
          editFormFieldDraft(form, field, (value: any, cursor: number) => ({
            cursor: cursor + normalizedText.length,
            value: `${value.slice(0, cursor)}${normalizedText}${value.slice(cursor)}`,
          }));
          return;
        }
      }
      appendPromptTextAtCursor(normalizedText);
    }

  async function pasteClipboardImage() {
    let { addPromptAttachment } = ctx();
      const image = await readClipboardImage();
      if (!image) return false;
      addPromptAttachment({
        buffer: image.buffer,
        filename: "clipboard.png",
        mediaType: image.mediaType,
      });
      return true;
    }

  function attachPromptFile(filePath: string) {
    let { addPromptAttachment } = ctx();
      const mediaType = mediaTypeFromPath(filePath);
      if (!isPromptAttachmentMediaType(mediaType)) return false;
      try {
        addPromptAttachment({
          buffer: readFileSync(filePath),
          filename: path.basename(filePath),
          mediaType,
          sourcePath: filePath,
        });
        return true;
      } catch {
        return false;
      }
    }

  function addPromptAttachment(input: {
      buffer: Buffer;
      filename: string;
      mediaType: string;
      sourcePath?: string;
    }) {
      let { promptAttachments, setPromptAttachments } = ctx();
      const label = nextAttachmentLabel(promptAttachments(), input.mediaType);
      const savedPath = savePromptAttachment(input);
      setPromptAttachments((attachments: any) => [
        ...attachments,
        {
          id: randomUUID(),
          label,
          mediaType: input.mediaType,
          name: input.filename,
          path: savedPath,
          size: input.buffer.byteLength,
        },
      ]);
    }

  return { handleTriggersKey, handleTriggerFireKey, handleTriggerJobsKey, handlePasteEvent, pasteClipboardImage, attachPromptFile, addPromptAttachment };
}
