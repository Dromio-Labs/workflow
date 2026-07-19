import type {
  EventRecord,
} from "../core/index.js";
import type {
  WorkflowAppRunSnapshot,
  WorkflowAppStartRunInput,
  WorkflowAppWorkflowDescriptor,
} from "../client/interactions/workflow-app.js";
import type {
  AuthorizeWorkflowControlPlaneInput,
  CancelTriggerJobInput,
  ClaimTriggerJobInput,
  CompleteTriggerJobInput,
  DeadLetterTriggerJobInput,
  EnqueueTriggerInput,
  EnqueueTriggerResult,
  FailTriggerJobInput,
  PruneRuntimeInput,
  RetryTriggerJobInput,
  RuntimeRetentionResult,
  SignalOccurrenceReceipt,
  TriggerDescriptor,
  TriggerJobEvent,
  TriggerJobFilter,
  TriggerJobSnapshot,
  WatchOptions,
  WorkflowControlPlane,
  WorkflowRunFilter,
} from "./types.js";
import type { SignalDescriptor } from "../authoring/signal.js";

export type CreateRemoteWorkflowControlPlaneClientInput = {
  baseUrl: string;
  bearerToken?: string;
  fetch?: (request: Request) => Promise<Response> | Response;
};

export function createRemoteWorkflowControlPlaneClient(
  input: CreateRemoteWorkflowControlPlaneClientInput,
): WorkflowControlPlane {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const fetcher = input.fetch ?? fetch;

  return {
    async answerQuestion(runId, answerInput) {
      const body = await request(
        `/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(answerInput.questionId)}/answer`,
        {
          body: JSON.stringify({ value: answerInput.value }),
          method: "POST",
        },
      );
      return (body as { run: WorkflowAppRunSnapshot }).run;
    },
    async authorize(_input: AuthorizeWorkflowControlPlaneInput) {
      // Remote requests are authorized server-side with this client's bearer token.
    },
    async cancelTriggerJob(cancelInput) {
      const body = await request(`/trigger-jobs/${encodeURIComponent(cancelInput.jobId)}/cancel`, {
        body: JSON.stringify({ reason: cancelInput.reason }),
        method: "POST",
      });
      return (body as { job: TriggerJobSnapshot }).job;
    },
    async claimNextTriggerJob(_input: ClaimTriggerJobInput) {
      throw new Error("Remote control-plane clients do not claim jobs directly; run workers against the local/server-side control plane.");
    },
    async completeTriggerJob(_input: CompleteTriggerJobInput) {
      throw new Error("Remote control-plane clients do not complete jobs directly; use a worker adapter.");
    },
    async deadLetterTriggerJob(deadInput: DeadLetterTriggerJobInput) {
      const body = await request(`/trigger-jobs/${encodeURIComponent(deadInput.jobId)}/dead-letter`, {
        body: JSON.stringify({ error: deadInput.error }),
        method: "POST",
      });
      return (body as { job: TriggerJobSnapshot }).job;
    },
    async enqueueScheduledTriggerOccurrence() {
      throw new Error("Remote control-plane clients do not enqueue schedule occurrences directly; run scheduler workers against the local/server-side control plane.");
    },
    async enqueueTrigger(enqueueInput) {
      const response = await requestWithStatus(`/triggers/${encodeURIComponent(enqueueInput.triggerId)}`, {
        body: JSON.stringify(enqueueInput.input),
        headers: {
          ...(enqueueInput.idempotencyKey ? { "idempotency-key": enqueueInput.idempotencyKey } : {}),
        },
        method: "POST",
      });
      return {
        created: response.status === 202,
        job: (response.body as { job: TriggerJobSnapshot }).job,
      } satisfies EnqueueTriggerResult;
    },
    async failTriggerJob(_input: FailTriggerJobInput) {
      throw new Error("Remote control-plane clients do not fail jobs directly; use retry, dead-letter, cancel, or a worker adapter.");
    },
    async getRun(runId) {
      const body = await request(`/runs/${encodeURIComponent(runId)}`);
      return (body as { run: WorkflowAppRunSnapshot }).run;
    },
    async getSignal(id) {
      const body = await request(`/signals/${encodeURIComponent(id)}`);
      return (body as { signal: SignalDescriptor }).signal;
    },
    async getSignalOccurrence(id) {
      const body = await request(`/signal-occurrences/${encodeURIComponent(id)}`);
      return (body as { receipt: SignalOccurrenceReceipt }).receipt;
    },
    async getTrigger(id) {
      const body = await request(`/triggers/${encodeURIComponent(id)}`);
      return (body as { trigger: TriggerDescriptor }).trigger;
    },
    async getTriggerJob(id) {
      const body = await request(`/trigger-jobs/${encodeURIComponent(id)}`);
      return (body as { job: TriggerJobSnapshot }).job;
    },
    async getWorkflow(id) {
      const workflows = await this.listWorkflows();
      const workflow = workflows.find((item) => item.id === id);
      if (!workflow) throw new Error(`Workflow not found: ${id}`);
      return workflow;
    },
    async listRuns(_filter?: WorkflowRunFilter) {
      const body = await request("/runs");
      return (body as { runs: WorkflowAppRunSnapshot[] }).runs;
    },
    async listSignals() {
      const body = await request("/signals");
      return (body as { signals: SignalDescriptor[] }).signals;
    },
    async listTriggerJobs(_filter?: TriggerJobFilter) {
      const body = await request("/trigger-jobs");
      return (body as { jobs: TriggerJobSnapshot[] }).jobs;
    },
    async listTriggers() {
      const body = await request("/triggers");
      return (body as { triggers: TriggerDescriptor[] }).triggers;
    },
    async listWorkflows() {
      const body = await request("/workflows");
      return (body as { workflows: WorkflowAppWorkflowDescriptor[] }).workflows;
    },
    async pruneRuntime(_input: PruneRuntimeInput) {
      throw new Error("Remote control-plane retention is server-owned.");
    },
    async publishSignalOccurrence(publishInput) {
      const response = await requestWithStatus(
        `/signals/${encodeURIComponent(publishInput.signalId)}/occurrences`,
        {
          body: JSON.stringify({
            correlation: publishInput.correlation,
            occurredAt: publishInput.occurredAt,
            payload: publishInput.payload,
          }),
          headers: { "idempotency-key": publishInput.idempotencyKey },
          method: "POST",
        },
      );
      return response.body as Awaited<ReturnType<WorkflowControlPlane["publishSignalOccurrence"]>>;
    },
    async resumeHook(resumeInput) {
      const body = await request(`/hooks/${encodeURIComponent(resumeInput.token)}/resume`, {
        body: JSON.stringify({ value: resumeInput.value }),
        method: "POST",
      });
      return (body as { run: WorkflowAppRunSnapshot }).run;
    },
    async resumeRun(runId: string) {
      const body = await request(`/runs/${encodeURIComponent(runId)}/resume`, {
        method: "POST",
      });
      return (body as { run: WorkflowAppRunSnapshot }).run;
    },
    async retryTriggerJob(retryInput: RetryTriggerJobInput) {
      const body = await request(`/trigger-jobs/${encodeURIComponent(retryInput.jobId)}/retry`, {
        body: JSON.stringify({ retryDelayMs: retryInput.retryDelayMs }),
        method: "POST",
      });
      return (body as { job: TriggerJobSnapshot }).job;
    },
    async startRun(startInput: WorkflowAppStartRunInput) {
      const body = await request("/runs", {
        body: JSON.stringify(startInput),
        method: "POST",
      });
      return (body as { run: WorkflowAppRunSnapshot }).run;
    },
    async startRunFromTriggerJob(_jobId: string) {
      throw new Error("Remote control-plane clients do not run jobs directly; use a worker adapter.");
    },
    watchRun(runId: string, options?: WatchOptions) {
      return streamEvents<EventRecord>(`/runs/${encodeURIComponent(runId)}/events`, options);
    },
    watchTriggerJob(jobId: string, options?: WatchOptions) {
      return streamEvents<TriggerJobEvent>(`/trigger-jobs/${encodeURIComponent(jobId)}/events`, options);
    },
  };

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    return (await requestWithStatus(path, init)).body;
  }

  async function requestWithStatus(path: string, init: RequestInit = {}): Promise<{
    body: unknown;
    status: number;
  }> {
    const response = await fetcher(new Request(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : {}),
        ...init.headers,
      },
    }));
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? `Request failed with ${response.status}.`);
    return {
      body,
      status: response.status,
    };
  }

  async function* streamEvents<TEvent>(path: string, options: WatchOptions = {}): AsyncIterable<TEvent> {
    const response = await fetcher(new Request(`${baseUrl}${withQuery(path, options)}`, {
      headers: {
        ...(input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : {}),
      },
    }));
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `Stream failed with ${response.status}.`);
    }
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const event = parseServerSentEvent<TEvent>(part);
          if (event) yield event;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}

export const createDromioPlatformControlPlaneClient = createRemoteWorkflowControlPlaneClient;

function parseServerSentEvent<TEvent>(part: string): TEvent | undefined {
  const data = part
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  return data ? JSON.parse(data) as TEvent : undefined;
}

function withQuery(path: string, options: WatchOptions) {
  if (options.fromIndex === undefined) return path;
  return `${path}?fromIndex=${encodeURIComponent(String(options.fromIndex))}`;
}
