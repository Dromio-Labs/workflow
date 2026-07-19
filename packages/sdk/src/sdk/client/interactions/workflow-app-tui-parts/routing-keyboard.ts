import { type TriggerJobSnapshot } from "../../../workflow-control-plane/index.js";
import { type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { providerModelValue } from "./active-run-session.js";
import { SPINNER_FRAMES, THEME } from "./style.js";
import { type ShellRoute, type ShellStatus } from "./types.js";
import { type KeyEvent } from "@opentui/core";

export function isSlashCommandKey(event: KeyEvent) {
  return !event.ctrl && !event.meta && !event.option && !event.super && event.sequence === "/";
}

export function isEscapeKey(event: {
  code?: string;
  name?: string;
  raw?: string;
  sequence?: string;
}) {
  const name = event.name?.toLowerCase();
  return name === "escape" ||
    name === "esc" ||
    event.sequence === "\x1B" ||
    event.raw === "\x1B" ||
    event.sequence === "\x1B[27u" ||
    event.raw === "\x1B[27u" ||
    event.code === "[27u";
}

export function isReturnKey(event: {
  baseCode?: number;
  code?: string;
  name?: string;
  raw?: string;
  sequence?: string;
}) {
  const name = event.name?.toLowerCase();
  const sequence = event.sequence ?? event.raw;
  return name === "return" ||
    name === "enter" ||
    name === "kpenter" ||
    name === "numpadenter" ||
    event.sequence === "\r" ||
    event.sequence === "\n" ||
    event.raw === "\r" ||
    event.raw === "\n" ||
    sequence === "\x1BOM" ||
    event.code === "Enter" ||
    event.code === "NumpadEnter" ||
    event.code === "[13u" ||
    event.code === "[57414u" ||
    event.baseCode === 13 ||
    event.baseCode === 57414;
}

export function isUpKey(event: KeyEvent) {
  return event.name === "up" ||
    event.sequence === "\x1B[A" ||
    event.sequence === "\x1BOA" ||
    event.raw === "\x1B[A" ||
    event.raw === "\x1BOA";
}

export function isDownKey(event: KeyEvent) {
  return event.name === "down" ||
    event.sequence === "\x1B[B" ||
    event.sequence === "\x1BOB" ||
    event.raw === "\x1B[B" ||
    event.raw === "\x1BOB";
}

export function isLeftKey(event: KeyEvent) {
  return event.name === "left" ||
    event.sequence === "\x1B[D" ||
    event.sequence === "\x1BOD" ||
    event.raw === "\x1B[D" ||
    event.raw === "\x1BOD";
}

export function isRightKey(event: KeyEvent) {
  return event.name === "right" ||
    event.sequence === "\x1B[C" ||
    event.sequence === "\x1BOC" ||
    event.raw === "\x1B[C" ||
    event.raw === "\x1BOC";
}

export function isPageUpKey(event: KeyEvent) {
  return event.name === "pageup" ||
    event.name === "pageUp" ||
    event.sequence === "\x1B[5~" ||
    event.raw === "\x1B[5~";
}

export function isPageDownKey(event: KeyEvent) {
  return event.name === "pagedown" ||
    event.name === "pageDown" ||
    event.sequence === "\x1B[6~" ||
    event.raw === "\x1B[6~";
}

export function isHomeKey(event: KeyEvent) {
  return event.name === "home" ||
    event.sequence === "\x1B[H" ||
    event.sequence === "\x1B[1~" ||
    event.raw === "\x1B[H" ||
    event.raw === "\x1B[1~";
}

export function isEndKey(event: KeyEvent) {
  return event.name === "end" ||
    event.sequence === "\x1B[F" ||
    event.sequence === "\x1B[4~" ||
    event.raw === "\x1B[F" ||
    event.raw === "\x1B[4~";
}

export function isPasteKey(event: KeyEvent) {
  return (event.ctrl || event.meta || event.super) && event.name.toLowerCase() === "v";
}

export function keyMatches(
  event: KeyEvent,
  binding: string,
  context: { leader?: string; leaderActive?: boolean } = {},
): boolean {
  const values = binding
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0 || values.includes("none")) return false;
  return values.some((value) => {
    if (value.startsWith("<leader>")) {
      if (!context.leaderActive) return false;
      const suffix = value.slice("<leader>".length).replace(/^\+?/, "").trim();
      return suffix ? keyMatches(event, suffix) : true;
    }
    if (context.leaderActive) return false;
    return singleKeyMatches(event, value);
  });
}

export function singleKeyMatches(event: KeyEvent, binding: string): boolean {
  const parts = binding.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const wantCtrl = parts.includes("ctrl") || parts.includes("control");
  const wantMeta = parts.includes("meta") || parts.includes("cmd") || parts.includes("mod");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt") || parts.includes("option");
  const wantSuper = parts.includes("super");
  if (wantCtrl && !wantMeta && !wantAlt && !wantSuper && !wantShift && key.length === 1) {
    const code = key.charCodeAt(0);
    const controlSequence = code >= 97 && code <= 122 ? String.fromCharCode(code - 96) : undefined;
    if (controlSequence && (event.sequence === controlSequence || event.raw === controlSequence)) return true;
  }
  if (Boolean(event.ctrl) !== wantCtrl) return false;
  if (Boolean(event.meta) !== wantMeta) return false;
  if (Boolean(event.shift) !== wantShift) return false;
  if (Boolean(event.option) !== wantAlt) return false;
  if (Boolean(event.super) !== wantSuper) return false;
  const eventName = event.name?.toLowerCase();
  const eventSequence = event.sequence?.toLowerCase();
  if (key === "return" || key === "enter") return isReturnKey(event);
  if (key === "escape" || key === "esc") return isEscapeKey(event);
  if (key === "space") return eventName === "space" || eventSequence === " ";
  if (key === "up") return isUpKey(event);
  if (key === "down") return isDownKey(event);
  if (key === "left") return isLeftKey(event);
  if (key === "right") return isRightKey(event);
  if (eventName === key) return true;
  return !wantCtrl && !wantMeta && !wantAlt && !wantSuper && !wantShift && eventSequence === key;
}

export function isInterruptKey(event: KeyEvent) {
  return event.ctrl &&
    !event.meta &&
    !event.shift &&
    !event.option &&
    !event.super &&
    !event.hyper &&
    event.name.toLowerCase() === "c";
}

export function isDeletePreviousWordKey(event: KeyEvent) {
  return (event.name === "backspace" && (event.meta || event.option)) ||
    (event.ctrl && event.name.toLowerCase() === "w");
}

export function isCtrlNavigationKey(event: KeyEvent, name: string) {
  return event.ctrl &&
    !event.meta &&
    !event.shift &&
    !event.option &&
    !event.super &&
    !event.hyper &&
    event.name.toLowerCase() === name;
}

export function deletePreviousWord(value: string) {
  return value.replace(/\s+$/, "").replace(/\S+$/, "");
}

export function headerHelp(route: ShellRoute, status: ShellStatus) {
  void route;
  void status;
  return "";
}

export function statusShortcutHint(route: ShellRoute, status: ShellStatus, workflow?: WorkflowAppWorkflowDescriptor) {
  if (route.type === "library") return "type filter · ↑↓ select · enter start";
  if (route.type === "start") return "tab pane · metadata enter · leader+e editor · / commands";
  if (route.type === "triggers") return "↑↓ select · f fire · j jobs · r refresh";
  if (route.type === "triggerFire") return "←→ cursor · enter enqueue · / commands";
  if (route.type === "triggerJobs") return "↑↓ select · enter run · r refresh";
  if (route.type === "artifact") return "↑↓ scroll · enter open · r rerun · esc run";
  if (route.type === "step") return route.runId ? "enter data · esc run · r rerun" : "enter data · esc start";
  if (status === "waiting") return "answer in dock · esc";
  if (status === "completed") return "enter artifact · r rerun · esc";
  if (status === "running") return "r rerun";
  return "";
}

export function dockTitle(route: ShellRoute, status: ShellStatus, placeholder: string) {
  if (route.type === "library") return "Select a workflow";
  if (route.type === "start") return placeholder;
  if (route.type === "triggerFire") return "Trigger JSON input";
  if (status === "running") return "Run in progress";
  if (status === "waiting") return "Waiting for interaction";
  if (status === "completed") return "Run completed";
  if (status === "failed") return "Run failed";
  return "Workflow";
}

export function dockHint(route: ShellRoute, status: ShellStatus) {
  if (route.type === "triggers") return "Trigger registry";
  if (route.type === "triggerFire") return "Trigger input";
  if (route.type === "triggerJobs") return "Trigger jobs";
  if (route.type === "artifact") return "Result artifact";
  if (route.type === "step") return "Workflow step";
  if (status === "running") return "Run in progress";
  if (status === "waiting") return "Waiting for interaction";
  if (status === "completed") return "Run completed";
  if (status === "failed") return "Run failed";
  return "";
}

export function statusAction(route: ShellRoute, status: ShellStatus, workflow?: WorkflowAppWorkflowDescriptor) {
  if (route.type === "library") return "enter start";
  if (route.type === "start") return "enter run";
  if (route.type === "triggers") return "f fire";
  if (route.type === "triggerFire") return "enter enqueue";
  if (route.type === "triggerJobs") return "job inspect";
  if (route.type === "artifact") return "artifact open";
  if (route.type === "step") return "enter data";
  if (status === "waiting") return "answer required";
  if (status === "completed") return "enter open artifact";
  if (status === "running") return "running";
  return "ready";
}

export function sidebarPrimaryAction(route: ShellRoute, status: ShellStatus) {
  if (route.type === "library") return "enter start";
  if (route.type === "start") return "enter run";
  if (route.type === "triggers") return "f fire trigger";
  if (route.type === "triggerFire") return "enter enqueue";
  if (route.type === "triggerJobs") return "enter linked run";
  if (route.type === "artifact") return "enter open";
  if (route.type === "step") return "click step detail";
  if (status === "completed") return "enter open artifact";
  if (status === "waiting") return "answer in dock";
  if (status === "running") return "running";
  if (status === "failed") return "r rerun";
  return "ready";
}

export function sidebarSecondaryAction(route: ShellRoute, status: ShellStatus) {
  if (route.type === "library") return "/view toggle · up/down select · ctrl+p commands";
  if (route.type === "start") return "tab pane · metadata enter · fields edit";
  if (route.type === "triggers") return "j jobs · esc library";
  if (route.type === "triggerFire") return "esc triggers";
  if (route.type === "triggerJobs") return "leader+r retry · leader+x cancel";
  if (route.type === "artifact") return "esc run · r rerun";
  if (route.type === "step") return route.runId ? "up/down step · esc run · r rerun" : "up/down step · esc start";
  if (status === "waiting") return "ctrl+p commands";
  if (status === "running") return "ctrl+p commands";
  return "r rerun · esc library";
}

export function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return (index + length) % length;
}

export function jobStatusColor(status: TriggerJobSnapshot["status"]) {
  if (status === "completed") return THEME.success;
  if (status === "dead" || status === "failed") return THEME.error;
  if (status === "retrying") return THEME.warning;
  if (status === "running" || status === "claimed") return THEME.info;
  return THEME.text;
}

export function preRunModelActivityLabel(prefix: string, event: { detail?: unknown }, fallbackSource?: string) {
  const model = stringDetail(event.detail, "model") ??
    stringDetail(event.detail, "resolvedModel") ??
    stringDetail(event.detail, "opencodeModel");
  const provider = stringDetail(event.detail, "provider");
  const worker = stringDetail(event.detail, "worker");
  const source = [provider || worker, model].filter(Boolean).join("/") || fallbackSource;
  return source ? `${prefix} · ${source}` : prefix;
}

export function preRunModelFallbackSource(options: Array<{ id?: string; label?: string; model?: string; provider?: string; worker?: string }>) {
  const selected = options[0];
  if (!selected) return undefined;
  return selected.label ?? providerModelValue(selected.provider ?? selected.worker, selected.model) ?? selected.id;
}

export function preRunReplyPreview(content: string) {
  const parsed = parsePreRunReplyJson(content);
  if (parsed) return parsed;
  const partial = content.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)/s)?.[1];
  return partial ? safeJsonStringFragment(partial) : "";
}

export function parsePreRunReplyJson(content: string) {
  try {
    const parsed = JSON.parse(content) as { reply?: unknown };
    return typeof parsed.reply === "string" ? parsed.reply : "";
  } catch {
    return "";
  }
}

export function safeJsonStringFragment(value: string) {
  try {
    return JSON.parse(`"${value.replace(/\\?$/, "")}"`) as string;
  } catch {
    return value
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
}

export function stringDetail(detail: unknown, key: string) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function numberDetail(detail: unknown, key: string) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const value = (detail as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

export function stepStatus(status: string) {
  if (status === "done") return "done";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (status === "waiting") return "waiting";
  if (status === "revisiting") return "revisiting";
  if (status === "looped") return "looped";
  if (status === "stale") return "stale";
  if (status === "retrying") return "retrying";
  return "pending";
}

export function stepSpins(status: string) {
  return status === "running" || status === "revisiting";
}

export function spinnerGlyph(frame: number) {
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
}

export function statusGlyph(status: string, spinnerFrame = 0) {
  if (status === "ok") return "✓";
  if (status === "error") return "×";
  if (status === "warning") return "!";
  if (status === "running") return spinnerGlyph(spinnerFrame);
  return "·";
}

export function statusColor(status: string) {
  if (status === "ok") return THEME.success;
  if (status === "error") return THEME.error;
  if (status === "warning") return "#fde68a";
  if (status === "running") return THEME.info;
  return THEME.muted;
}

export function stepStatusColor(status: string) {
  if (status === "done") return THEME.success;
  if (status === "failed") return THEME.error;
  if (status === "waiting" || status === "retrying" || status === "looped") return "#fde68a";
  if (status === "running" || status === "revisiting") return THEME.info;
  return THEME.muted;
}

export function parseHookInput(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}
