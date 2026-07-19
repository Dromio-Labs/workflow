import type {
  Question,
} from "../../../core/index.js";
import type {
  WorkflowRunStoreSnapshot,
} from "../workflow-run-store.js";
import {
  openTuiQuestionOptions,
} from "../opentui-question-dock.js";

export function answerPreview(value: string) {
  return value.replace(/\r?\n/g, " ↵ ");
}

export function questionPromptLines(prompt: string, columns: number) {
  const width = Math.max(32, Math.min(120, Math.floor(columns)));
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  let truncated = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
      if (lines.length >= 2) {
        truncated = true;
        break;
      }
    }
    current = word.length > width ? `${word.slice(0, Math.max(0, width - 1))}…` : word;
    if (word.length > width || index < words.length - 1) truncated = true;
  }
  if (current && lines.length < 2) lines.push(current);
  if (lines.length === 0) lines.push(normalized.slice(0, width));
  if (truncated && lines.length === 2) {
    lines[1] = ellipsize(lines[1], width);
  }
  return lines;
}

export function ellipsize(value: string, width: number) {
  if (value.length <= width) return value;
  if (width <= 1) return "…";
  return `${value.slice(0, width - 1)}…`;
}

export function questionTabLabel(
  question: Pick<Question, "id" | "prompt" | "title">,
  index: number,
  labels?: readonly string[],
) {
  const title = question.title?.trim();
  if (title) return title;
  return labels?.[index] ?? title ?? question.id ?? `Q${index + 1}`;
}

export function questionTabWidth(
  question: Pick<Question, "id" | "prompt" | "title">,
  index: number,
  labels?: readonly string[],
) {
  const label = questionTabLabel(question, index, labels);
  return Math.min(18, Math.max(10, label.length + 2));
}

export function inputLabel(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "prompt" in value && typeof value.prompt === "string") {
    return value.prompt;
  }
  if (value === undefined) return undefined;
  return JSON.stringify(value);
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

export function statusGlyph(status: string) {
  if (status === "ok") return "✓";
  if (status === "error") return "×";
  if (status === "warning") return "!";
  if (status === "running") return "◐";
  return "·";
}

export function statusColor(status: string) {
  if (status === "ok") return "#86efac";
  if (status === "error") return "#fca5a5";
  if (status === "warning") return "#fde68a";
  if (status === "running") return "#8bd3ff";
  return "#7d8aa2";
}

export function stepStatusColor(status: string) {
  if (status === "done") return "#86efac";
  if (status === "failed") return "#fca5a5";
  if (status === "waiting" || status === "retrying" || status === "looped") return "#fde68a";
  if (status === "running" || status === "revisiting") return "#8bd3ff";
  return "#7d8aa2";
}

export function formatStepIndex(step: { boundary?: "end" | "trigger"; index: number }) {
  if (step.boundary === "trigger") return "[start]";
  if (step.boundary === "end") return "[end]";
  return String(step.index).padStart(2, "0");
}

export function boundaryStepColor(step: { boundary?: "end" | "trigger" }) {
  if (step.boundary === "trigger") return "#86efac";
  if (step.boundary === "end") return "#fde68a";
  return undefined;
}

export function questionHelp(question: Question) {
  if (questionAllowsCustomChoice(question)) return "1-3 select suggestion · enter submit · type custom answer · esc fallback";
  if (question.type === "multi") return "space toggle · numbers toggle · enter submit · esc fallback";
  if (question.type === "confirm") return "y/n choose · enter choose selected · esc fallback";
  if (question.type === "choice") return "enter choose selected/default · numbers choose · esc fallback";
  return "enter submit · esc fallback";
}

export function questionAllowsCustomChoice(question: Question) {
  return question.type === "choice" && question.allowCustom === true;
}

export function questionTextForAnswer(question: Question | undefined, answer: unknown) {
  if (!question || answer === undefined) return "";
  if (questionAllowsCustomChoice(question)) {
    const matchesSuggestion = openTuiQuestionOptions(question).some((option) => Object.is(option.value, answer));
    if (matchesSuggestion) return "";
  }
  if (typeof answer === "string") return answer;
  if (answer === null) return "";
  return JSON.stringify(answer);
}

export function truncate(value: string, length: number) {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
}

export function wrapLine(value: string, length: number) {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1))}…`;
}

export function selectionId(kind: "row" | "step", id: string) {
  return `${kind}:${id}`;
}

export function parseSelectionId(value: string | undefined): { id: string; kind: "row" | "step" } | undefined {
  if (!value) return undefined;
  const index = value.indexOf(":");
  if (index < 0) return undefined;
  const kind = value.slice(0, index);
  const id = value.slice(index + 1);
  if ((kind !== "row" && kind !== "step") || !id) return undefined;
  return { id, kind };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
