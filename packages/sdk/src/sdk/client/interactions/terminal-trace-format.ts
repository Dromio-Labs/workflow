import type {
  EvaluationBar,
  EventRecord,
} from "../../core/index.js";
import type {
  TerminalTraceChild,
  TerminalTraceItem,
} from "./terminal-trace-types.js";

export function defaultFormatEvent(event: EventRecord): TerminalTraceItem | undefined {
  if (event.type === "run.started" || event.type === "run.resumed") {
    return {
      id: `run.${event.runId}`,
      phaseId: "run",
      phaseTitle: "Run",
      status: "running",
      text: runLabel(event),
    };
  }
  if (event.type === "run.completed" || event.type === "run.cancelled" || event.type === "run.failed" || event.type === "run.paused") {
    return {
      id: `run.${event.runId}`,
      phaseId: "run",
      phaseTitle: "Run",
      status: event.type === "run.failed" ? "error" : event.type === "run.paused" || event.type === "run.cancelled" ? "warning" : "ok",
      text: `${runLabel(event)}${formatMs(event.durationMs)}`,
    };
  }
  if (event.type === "step.started" || event.type === "step.completed" || event.type === "step.failed" || event.type === "step.waiting" || event.type === "step.retrying" || event.type === "step.goto") {
    return formatStepEvent(event);
  }
  if (event.type === "model.request.started" || event.type === "model.request.retrying" || event.type === "model.request.failed" || event.type === "model.response.completed") {
    return formatModelEvent(event);
  }
  if (event.type === "model.worker.selected") return formatModelWorkerSelectedEvent(event);
  if (event.type === "model.response.delta") return undefined;
  if (event.type === "operation.started" || event.type === "operation.completed" || event.type === "operation.failed" || event.type === "output.parsed" || event.type === "score.gated" || event.type === "operation.decision") {
    return formatPromptedOperationEvent(event);
  }
  if (event.type === "operation.progress") return undefined;
  if (event.type === "evaluation.completed") return formatEvaluationCompleted(event);
  if (event.type === "question.requested" || event.type === "question.answered" || event.type === "question.resolution.accepted" || event.type === "question.resolution.rejected") {
    return formatQuestionEvent(event);
  }
  if (event.type.startsWith("worker.item.")) return formatWorkerItemEvent(event);
  if (event.type.startsWith("fork.") || event.type.startsWith("join.")) {
    return formatForkEvent(event);
  }
  if (!isCommandEvent(event)) return undefined;

  const phase = typeof event.trace?.attributes?.phase === "string" ? event.trace.attributes.phase : "commands";
  const commandId = String(event.commandId ?? event.command ?? "command");
  const title = typeof event.title === "string" ? event.title : String(event.command ?? "command");
  if (event.type === "command.started") {
    return {
      id: `command.${commandId}`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: "running",
      text: title,
    };
  }
  if (event.type === "command.completed" || event.type === "command.failed") {
    const command = String(event.command ?? title);
    return {
      children: commandOutputPreview(event.output),
      id: `command.${commandId}`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: event.type === "command.completed" ? "ok" : "error",
      text: `Ran ${command}${formatMs(event.durationMs)}`,
    };
  }
  return undefined;
}

function formatForkEvent(event: EventRecord): TerminalTraceItem {
  const detail = event.detail as { branchId?: string; branchLabel?: string } | undefined;
  const branch = event.type.startsWith("fork.branch.");
  const join = event.type.startsWith("join.");
  const phase = join ? "join" : branch ? "fork-branch" : "fork";
  const status = event.type.endsWith(".failed")
    ? "error"
    : event.type.endsWith(".completed") ? "ok" : "running";
  return {
    children: detail?.branchId ? [`branch: ${detail.branchId}`] : undefined,
    id: event.trace?.spanId ?? `${phase}.${detail?.branchId ?? event.stepId ?? event.index}`,
    phaseId: phase,
    phaseTitle: join ? "Join" : branch ? "Fork Branch" : "Fork",
    status,
    text: event.message ?? detail?.branchLabel ?? detail?.branchId ?? phase,
  };
}

function formatStepEvent(event: EventRecord): TerminalTraceItem | undefined {
  const stepId = event.stepId;
  if (!stepId) return undefined;
  const phase = typeof event.trace?.attributes?.phase === "string" ? event.trace.attributes.phase : "steps";
  const label = titleFromTrace(event) ?? stepId;
  const duration = formatMs(event.durationMs);
  if (event.type === "step.started") {
    return { id: `step.${stepId}`, phaseId: phase, phaseTitle: titleCase(phase), status: "running", text: label };
  }
  if (event.type === "step.completed") {
    return { id: `step.${stepId}`, phaseId: phase, phaseTitle: titleCase(phase), status: "ok", text: `${label}${duration}` };
  }
  if (event.type === "step.failed") {
    return { children: errorChildren(event), id: `step.${stepId}`, phaseId: phase, phaseTitle: titleCase(phase), status: "error", text: `${label}${duration}` };
  }
  if (event.type === "step.waiting") {
    return { children: waitingChildren(event), id: `step.${stepId}.waiting`, phaseId: phase, phaseTitle: titleCase(phase), status: "warning", text: `${label} waiting${duration}` };
  }
  if (event.type === "step.retrying") {
    const detail = event.detail as { maxRetries?: number; reason?: string; retries?: number } | undefined;
    return {
      children: detail?.reason ? [detail.reason] : [],
      id: `step.${stepId}.retry.${event.index}`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: "warning",
      text: `${label} retry ${detail?.retries ?? "?"}/${detail?.maxRetries ?? "?"}${duration}`,
    };
  }
  if (event.type === "step.goto") {
    const detail = event.detail as { reason?: string; targetStepId?: string } | undefined;
    return {
      children: detail?.reason ? [detail.reason] : [],
      id: `step.${stepId}.goto.${event.index}`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: "info",
      text: `${label} -> ${detail?.targetStepId ?? "next"}${duration}`,
    };
  }
  return undefined;
}

function formatModelEvent(event: EventRecord): TerminalTraceItem {
  const detail = event.detail as {
    attempt?: number;
    contentLength?: number;
    error?: string;
    maxAttempts?: number;
    model?: string;
    operation?: string;
    provider?: string;
  } | undefined;
  const attributes = event.trace?.attributes;
  const phase = typeof event.trace?.attributes?.phase === "string" ? event.trace.attributes.phase : "model";
  const operation = detail?.operation ?? stringAttribute(attributes?.operation) ?? titleFromTrace(event) ?? "model request";
  const provider = [detail?.provider ?? stringAttribute(attributes?.provider), detail?.model ?? stringAttribute(attributes?.model)].filter(Boolean).join("/");
  const suffix = provider ? ` (${provider})` : "";
  const id = event.trace?.spanId ?? `model.${operation}`;
  const contentLength = typeof detail?.contentLength === "number"
    ? detail.contentLength
    : typeof attributes?.contentLength === "number" ? attributes.contentLength : undefined;
  if (event.type === "model.request.started") return { id, phaseId: phase, phaseTitle: titleCase(phase), status: "running", text: `${operation}${suffix}` };
  if (event.type === "model.request.retrying") {
    return {
      children: detail?.error ? [detail.error] : [],
      id: `${id}.retry.${event.index}`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: "warning",
      text: `${operation} retry ${detail?.attempt ?? "?"}/${detail?.maxAttempts ?? "?"}${suffix}`,
    };
  }
  if (event.type === "model.request.failed") {
    return { children: detail?.error ? [detail.error] : errorChildren(event), id, phaseId: phase, phaseTitle: titleCase(phase), status: "error", text: `${operation}${suffix}` };
  }
  return { children: typeof contentLength === "number" ? [`${contentLength} chars`] : [], id, phaseId: phase, phaseTitle: titleCase(phase), status: "ok", text: `${operation}${suffix}` };
}

function formatModelWorkerSelectedEvent(event: EventRecord): TerminalTraceItem {
  const detail = event.detail as {
    requested?: { id?: string; label?: string; model?: string; worker?: string };
    selected?: { id?: string; label?: string; model?: string; worker?: string };
    target?: { operation?: string; stepId?: string };
  } | undefined;
  const selected = detail?.selected;
  const requested = detail?.requested;
  const operation = detail?.target?.operation ?? stringAttribute(event.trace?.attributes?.operation) ?? "model";
  const label = selected ? modelLabel(selected) : event.message;
  const requestedLabel = requested && selected && requested.id !== selected.id ? [`requested ${modelLabel(requested)}`] : [];
  return {
    children: requestedLabel,
    id: `model.selection.${detail?.target?.stepId ?? event.stepId ?? event.index}.${operation}`,
    phaseId: "model",
    phaseTitle: "Model",
    status: "ok",
    text: `${operation}: ${label}`,
  };
}

function formatPromptedOperationEvent(event: EventRecord): TerminalTraceItem | undefined {
  const detail = event.detail as {
    decision?: { gateId?: string; nextAction?: string; status?: string };
    durationMs?: number;
    evaluation?: { score?: number; scorePolicyId?: string; status?: string };
    issue?: string;
    operationId?: string;
    outputContractId?: string;
    scorePolicyId?: string;
  } | undefined;
  const phase = typeof event.trace?.attributes?.phase === "string" ? event.trace.attributes.phase : "operations";
  const id = event.trace?.spanId ?? `operation.${detail?.operationId ?? event.index}`;
  const label = detail?.operationId ?? titleFromTrace(event) ?? "prompted operation";
  if (event.type === "operation.started") return { children: detail?.scorePolicyId ? [`policy: ${detail.scorePolicyId}`] : [], id, phaseId: phase, phaseTitle: titleCase(phase), status: "running", text: label };
  if (event.type === "operation.completed") return { id, phaseId: phase, phaseTitle: titleCase(phase), status: "ok", text: `${label}${formatMs(detail?.durationMs ?? event.durationMs)}` };
  if (event.type === "operation.failed") return { children: detail?.issue ? [detail.issue] : errorChildren(event), id, phaseId: phase, phaseTitle: titleCase(phase), status: "error", text: `${label}${formatMs(detail?.durationMs ?? event.durationMs)}` };
  if (event.type === "output.parsed") return { children: detail?.outputContractId ? [`contract: ${detail.outputContractId}`] : [], id: `${id}.parsed`, phaseId: phase, phaseTitle: titleCase(phase), status: "ok", text: "parsed output" };
  if (event.type === "score.gated") {
    const evaluation = detail?.evaluation;
    return {
      children: [...(evaluation?.scorePolicyId ? [`policy: ${evaluation.scorePolicyId}`] : [])],
      id: `${id}.score`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: evaluation?.status === "pass" ? "ok" : "warning",
      text: `score ${Math.round((evaluation?.score ?? 0) * 100)}% [${evaluation?.status ?? "unknown"}]`,
    };
  }
  if (event.type === "operation.decision") {
    const decision = detail?.decision;
    return {
      children: [...(decision?.gateId ? [`gate: ${decision.gateId}`] : []), ...(decision?.nextAction ? [`next: ${decision.nextAction}`] : [])],
      id: `${id}.decision`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: decision?.status === "failed" ? "error" : decision?.status === "completed" ? "ok" : "warning",
      text: `decision ${decision?.status ?? "unknown"}`,
    };
  }
  return undefined;
}

function formatQuestionEvent(event: EventRecord): TerminalTraceItem {
  const phase = typeof event.trace?.attributes?.phase === "string" ? event.trace.attributes.phase : "questions";
  if (event.type === "question.requested") {
    const detail = event.detail as { questions?: Array<{ id?: string; prompt?: string; title?: string }> } | undefined;
    const questions = detail?.questions ?? [];
    return {
      children: questions.map((question) => question.title ?? question.prompt ?? question.id ?? "question"),
      id: `questions.${event.index}`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: "warning",
      text: `needs ${questions.length || 1} answer${questions.length === 1 ? "" : "s"}`,
    };
  }
  const detail = event.detail as { confidence?: number; message?: string; questionId?: string; status?: string; value?: unknown } | undefined;
  if (event.type === "question.answered") {
    return {
      children: detail && "value" in detail ? [`answer: ${previewQuestionAnswer(detail.value)}`] : undefined,
      id: `question.${detail?.questionId ?? event.index}`,
      phaseId: phase,
      phaseTitle: titleCase(phase),
      status: "ok",
      text: `answered ${detail?.questionId ?? "question"}`,
    };
  }
  return {
    children: [
      ...(typeof detail?.confidence === "number" ? [`confidence: ${Math.round(detail.confidence * 100)}%`] : []),
      ...(detail?.message ? [detail.message] : []),
    ],
    id: `question.resolution.${detail?.questionId ?? event.index}`,
    phaseId: phase,
    phaseTitle: titleCase(phase),
    status: event.type === "question.resolution.accepted" ? "ok" : "warning",
    text: `answer ${event.type === "question.resolution.accepted" ? "accepted" : "rejected"}${detail?.questionId ? `: ${detail.questionId}` : ""}`,
  };
}

function formatWorkerItemEvent(event: EventRecord): TerminalTraceItem | undefined {
  const detail = event as { itemId?: string; preview?: string; provider?: string; title?: string };
  const phase = typeof event.trace?.attributes?.phase === "string" ? event.trace.attributes.phase : "worker";
  const id = `worker.${detail.itemId ?? event.index}`;
  const title = detail.title ?? detail.preview ?? event.message;
  if (event.type === "worker.item.delta") return undefined;
  return {
    children: detail.provider ? [`provider: ${detail.provider}`] : [],
    id,
    phaseId: phase,
    phaseTitle: titleCase(phase),
    status: event.type === "worker.item.failed" ? "error" : event.type === "worker.item.completed" ? "ok" : "running",
    text: title,
  };
}

function formatEvaluationCompleted(event: EventRecord): TerminalTraceItem | undefined {
  const evaluation = (event.detail as { evaluation?: EvaluationBar } | undefined)?.evaluation;
  if (!evaluation) return undefined;
  const status = evaluation.status === "pass" ? "ok" : evaluation.status === "fail" ? "error" : "warning";
  return {
    children: [
      renderScoreBar(evaluation.score, evaluation.threshold),
      ...evaluation.gaps.slice(0, 3).map((gap) => `gap ${gap.id}: ${gap.message}`),
      ...evaluation.questions.slice(0, 3).map((question) => `question ${question.id}: ${question.title ?? question.prompt}`),
    ],
    id: `evaluation.${event.index}.${evaluation.subjectId}`,
    phaseId: typeof event.trace?.attributes?.phase === "string" ? event.trace.attributes.phase : "evaluation",
    phaseTitle: typeof event.trace?.attributes?.phase === "string" ? titleCase(event.trace.attributes.phase) : "Evaluation",
    status,
    text: `${evaluation.label}: ${Math.round(evaluation.score * 100)}% ${evaluation.status}`,
  };
}

function modelLabel(value: { id?: string; label?: string; model?: string; worker?: string }) {
  const name = value.label ?? value.id ?? "model";
  return value.model ? `${name} (${value.worker ?? "worker"}/${value.model})` : name;
}

function runLabel(event: EventRecord) {
  const workflowId = typeof event.trace?.attributes?.workflowId === "string" ? event.trace.attributes.workflowId : undefined;
  return workflowId ?? event.runId;
}

function titleFromTrace(event: EventRecord) {
  return event.trace?.name;
}

function stringAttribute(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function errorChildren(event: EventRecord): string[] {
  const detail = event.detail as { error?: unknown; issue?: unknown; reason?: unknown } | undefined;
  return [detail?.error, detail?.issue, detail?.reason].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function waitingChildren(event: EventRecord): string[] {
  const detail = event.detail as {
    hook?: { id?: string };
    hooks?: Array<{ id?: string }>;
    questions?: Array<{ id?: string; prompt?: string; title?: string }>;
  } | undefined;
  if (detail?.questions?.length) return detail.questions.map((question) => question.title ?? question.prompt ?? question.id ?? "question");
  if (detail?.hooks?.length) return detail.hooks.map((hook) => hook.id ?? "hook");
  if (detail?.hook) return [detail.hook.id ?? "hook"];
  return [];
}

function isCommandEvent(event: EventRecord) {
  return event.type === "command.started" ||
    event.type === "command.output" ||
    event.type === "command.completed" ||
    event.type === "command.failed";
}

function formatMs(value: unknown) {
  if (typeof value !== "number") return "";
  if (value >= 1000) return ` [${(value / 1000).toFixed(value >= 10_000 ? 0 : 2)}s]`;
  return ` [${value}ms]`;
}

function renderScoreBar(score: number, threshold: number) {
  const width = 10;
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  const filled = Math.round(safeScore * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${Math.round(safeScore * 100)}% threshold ${Math.round(threshold * 100)}%`;
}

function commandOutputPreview(output: unknown): TerminalTraceChild[] {
  if (typeof output !== "string") return [];
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 5) return lines;
  return [...lines.slice(0, 2), `... +${lines.length - 4} lines (full output retained in event detail)`, ...lines.slice(-2)];
}

function previewQuestionAnswer(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length <= 120 ? text : `${text.slice(0, 119)}…`;
}

function titleCase(value: string) {
  return value.replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
