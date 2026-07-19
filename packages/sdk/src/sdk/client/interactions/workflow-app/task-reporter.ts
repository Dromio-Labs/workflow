import type {
  EventRecord,
} from "../../../core/index.js";
import {
  createWorkflowCliRenderer,
} from "./terminal-renderer.js";
import {
  defaultFormatEvent,
} from "../terminal-trace-format.js";
import type {
  WorkflowAppCliReporter,
  WorkflowCliActivity,
  WorkflowCliRenderer,
  WorkflowTaskReporterOptions,
} from "./types.js";

export function createWorkflowTaskReporter(
  options: WorkflowTaskReporterOptions = {},
): WorkflowAppCliReporter {
  const renderer = options.renderer ?? createWorkflowCliRenderer(options);
  const modelPreviews = new Map<string, ModelPreview>();
  let dryRunMode = false;

  return {
    onStart(input) {
      modelPreviews.clear();
      dryRunMode = resolveDryRun(options.dryRun, input.input);
      renderer.start({
        ...input,
        dryRun: dryRunMode,
      });
    },
    onEvent(event) {
      if (event.type.startsWith("run.")) return;
      if (event.type === "model.response.delta") {
        renderModelDelta(event, modelPreviews, renderer);
        return;
      }
      if (event.type === "step.started") {
        renderer.startStep({
          label: childStepLabel(event),
          parentStepId: parentStepId(event),
          stepId: event.stepId ?? "workflow",
        });
        return;
      }
      if (event.type === "command.started") {
        const command = stringDetail(event, "command");
        if (!command) return;
        renderer.startCommand({
          command,
          stepId: event.stepId,
        });
        return;
      }
      if (event.type === "command.completed" || event.type === "command.failed" || event.type === "command.skipped") {
        const stepId = event.stepId;
        const command = stringDetail(event, "command");
        if (!stepId || !command) return;
        renderer.finishCommand({
          command,
          output: event.type === "command.failed" ? commandFailureOutput(event) : undefined,
          status: event.type === "command.skipped"
            ? "skipped"
            : event.type === "command.failed"
              ? "failed"
              : "completed",
          stepId,
        });
        return;
      }
      if (event.type === "step.completed") {
        renderer.finishStep({
          durationMs: event.durationMs,
          label: childStepLabel(event),
          parentStepId: parentStepId(event),
          status: dryRunMode ? "skipped" : "completed",
          stepId: event.stepId,
        });
        return;
      }
      if (event.type === "step.failed") {
        renderer.finishStep({
          durationMs: event.durationMs,
          label: childStepLabel(event),
          message: String(event.message ?? ""),
          parentStepId: parentStepId(event),
          status: "failed",
          stepId: event.stepId,
        });
        return;
      }
      if (event.type === "step.waiting") {
        renderer.finishStep({
          durationMs: event.durationMs,
          label: childStepLabel(event),
          parentStepId: parentStepId(event),
          status: "waiting",
          stepId: event.stepId,
        });
        return;
      }
      const forkActivity = formatForkActivity(event);
      if (forkActivity) {
        renderer.activity(forkActivity);
        return;
      }
      const item = defaultFormatEvent(event);
      if (!item) return;
      const activity: WorkflowCliActivity = {
        children: flattenChildren(item.children),
        phase: compactPhase(event.type, item.phaseTitle),
        status: item.status,
        stepId: event.stepId,
        text: item.text,
      };
      if (event.type === "model.request.started") {
        modelPreviews.set(modelEventKey(event), {
          activity,
          text: "",
          truncated: false,
        });
      } else if (event.type === "model.response.completed" || event.type === "model.request.failed") {
        modelPreviews.delete(modelEventKey(event));
      }
      renderer.activity(activity);
    },
    onComplete(input) {
      modelPreviews.clear();
      renderer.complete(input);
    },
    onError(input) {
      modelPreviews.clear();
      renderer.error(input);
    },
  };
}

const modelPreviewCharacterLimit = 150;

type ModelPreview = {
  activity: WorkflowCliActivity;
  text: string;
  truncated: boolean;
};

function renderModelDelta(
  event: EventRecord,
  previews: Map<string, ModelPreview>,
  renderer: WorkflowCliRenderer,
) {
  const preview = previews.get(modelEventKey(event));
  const delta = modelDelta(event);
  if (!preview || !delta) return;
  const appended = sanitizeModelPreview(`${preview.text}${delta}`);
  preview.truncated = preview.truncated || appended.length > modelPreviewCharacterLimit;
  preview.text = appended.slice(0, modelPreviewCharacterLimit);
  renderer.activity({
    ...preview.activity,
    children: [`${preview.text}${preview.truncated ? "…" : ""}`],
  });
}

function modelEventKey(event: EventRecord) {
  return event.trace?.spanId ?? `${event.stepId ?? "workflow"}:model`;
}

function modelDelta(event: EventRecord): string | undefined {
  if (!event.detail || typeof event.detail !== "object" || Array.isArray(event.detail)) return undefined;
  const delta = (event.detail as Record<string, unknown>).delta;
  return typeof delta === "string" ? delta : undefined;
}

function sanitizeModelPreview(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trimStart();
}

function formatForkActivity(event: EventRecord) {
  if (!event.type.startsWith("fork.") && !event.type.startsWith("join.")) return undefined;
  const detail = event.detail && typeof event.detail === "object" && !Array.isArray(event.detail)
    ? event.detail as Record<string, unknown>
    : {};
  const branchId = typeof detail.branchId === "string" ? detail.branchId : undefined;
  const phase = event.type.startsWith("join.")
    ? "Join"
    : event.type.startsWith("fork.branch.") ? "Branch" : "Fork";
  return {
    children: branchId ? [`branch: ${branchId}`] : undefined,
    phase,
    status: event.type.endsWith(".failed")
      ? "error" as const
      : event.type.endsWith(".completed") ? "ok" as const : "info" as const,
    stepId: event.stepId,
    text: event.message,
  };
}

function compactPhase(type: string, fallback: string) {
  if (type.startsWith("model.")) return "Model";
  if (type === "evaluation.completed") return "Evaluation";
  if (type === "score.gated") return "Gate";
  if (type.startsWith("operation.") || type === "output.parsed") return "Operation";
  if (type.startsWith("worker.item.")) return "Worker";
  if (type.startsWith("question.")) return "Question";
  return fallback;
}

function parentStepId(event: EventRecord): string | undefined {
  const detail = event.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const value = (detail as Record<string, unknown>).parentStepId;
  return typeof value === "string" ? value : undefined;
}

function childStepLabel(event: EventRecord) {
  const detail = event.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;
  const record = detail as Record<string, unknown>;
  const childStepId = record.itemWorkflowStepId;
  if (typeof childStepId !== "string") return undefined;
  const itemId = record.itemId;
  return typeof itemId === "string" ? `${itemId}.${childStepId}` : childStepId;
}

function flattenChildren(
  children: Array<string | { children?: unknown[]; text: string }> | undefined,
): string[] | undefined {
  if (!children?.length) return undefined;
  return children.flatMap((child) => typeof child === "string"
    ? [child]
    : [child.text, ...flattenChildren(normalizeChildren(child.children)) ?? []]);
}

function normalizeChildren(value: unknown[] | undefined) {
  if (!value) return undefined;
  return value.filter((item): item is string | { children?: unknown[]; text: string } =>
    typeof item === "string" || Boolean(item && typeof item === "object" && "text" in item)
  );
}

function commandFailureOutput(event: EventRecord): string | undefined {
  const output = [
    stringDetail(event, "stdout"),
    stringDetail(event, "stderr"),
  ].filter(Boolean).join("\n").trim();
  return output || undefined;
}

function stringDetail(event: EventRecord, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" ? value : undefined;
}

function resolveDryRun(input: WorkflowTaskReporterOptions["dryRun"], value: unknown): boolean {
  if (typeof input === "function") return input(value);
  return input === true;
}
