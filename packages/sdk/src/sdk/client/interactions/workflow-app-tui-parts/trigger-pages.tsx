/** @jsxImportSource @opentui/solid */
import { type TriggerDescriptor, type TriggerJobSnapshot } from "../../../workflow-control-plane/index.js";
import { triggerInputFields } from "./input-form.js";
import { jobStatusColor } from "./routing-keyboard.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import * as path from "node:path";
import { For, Show } from "solid-js";

export function TriggerRegistryPage(props: {
  jobs: TriggerJobSnapshot[];
  selectedTrigger?: TriggerDescriptor;
  triggers: TriggerDescriptor[];
  onFireTrigger(trigger: TriggerDescriptor): void;
  onRefresh(): void | Promise<void>;
  onSelectTrigger(triggerId: string): void;
}) {
  const selectedJobs = () => props.jobs.filter((job) => job.triggerId === props.selectedTrigger?.id).slice(0, 6);
  return (
    <box flexDirection="row" flexGrow={1} gap={2}>
      <box flexDirection="column" width={40}>
        <text fg={THEME.accent}>Trigger Registry</text>
        <Show
          when={props.triggers.length > 0}
          fallback={<text fg={THEME.muted}>No triggers found in registry.</text>}
        >
          <For each={props.triggers}>
            {(trigger) => {
              const selected = () => trigger.id === props.selectedTrigger?.id;
              return (
                <box
                  backgroundColor={selected() ? THEME.selected : undefined}
                  flexDirection="column"
                  onMouseUp={() => props.onSelectTrigger(trigger.id)}
                  paddingTop={1}
                >
                  <text fg={selected() ? THEME.accent : THEME.text} height={1} truncate={true}>
                    {selected() ? "> " : "  "}{truncate(trigger.label, 32)}
                  </text>
                  <text fg={trigger.enabled ? THEME.muted : THEME.warning} height={1} truncate={true}>
                    {trigger.type} · {trigger.workflowId} · {trigger.enabled ? "enabled" : "disabled"}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>
      <box flexDirection="column" flexGrow={1}>
        <Show
          when={props.selectedTrigger}
          fallback={<text fg={THEME.muted}>Select a trigger.</text>}
        >
          {(trigger) => (
            <>
              <text fg={THEME.accent}>{trigger().label}</text>
              <text fg={THEME.text}>id: {trigger().id}</text>
              <text fg={THEME.text}>workflow: {trigger().workflowId}</text>
              <text fg={THEME.text}>endpoint: {trigger().config?.method ?? "POST"} {trigger().config?.path ?? `/api/triggers/${trigger().id}`}</text>
              <text fg={THEME.text}>auth: {trigger().auth?.mode ?? "bearer"}</text>
              <text fg={trigger().enabled ? THEME.success : THEME.warning}>status: {trigger().enabled ? "enabled" : "disabled"}</text>
              <box flexDirection="column" paddingTop={1}>
                <text fg={THEME.muted}>Input form</text>
                <For each={triggerInputFields(trigger()).slice(0, 8)}>
                  {(field) => <text fg={THEME.text} height={1} truncate={true}>{field}</text>}
                </For>
              </box>
              <box flexDirection="column" paddingTop={1}>
                <text fg={THEME.muted}>Recent jobs</text>
                <Show
                  when={selectedJobs().length > 0}
                  fallback={<text fg={THEME.muted}>No jobs for this trigger yet.</text>}
                >
                  <For each={selectedJobs()}>
                    {(job) => <text fg={jobStatusColor(job.status)} height={1} truncate={true}>{job.status} · {job.id} · {job.runId ?? "no run"}</text>}
                  </For>
                </Show>
              </box>
              <box paddingTop={1}>
                <text fg={THEME.muted}>f fire · j jobs · r refresh · leader+c curl · leader+s Swagger</text>
              </box>
            </>
          )}
        </Show>
      </box>
    </box>
  );
}

export function TriggerFirePage(props: {
  trigger?: TriggerDescriptor;
}) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <text fg={THEME.accent}>Fire Trigger</text>
      <Show
        when={props.trigger}
        fallback={<text fg={THEME.muted}>No trigger selected.</text>}
      >
        {(trigger) => (
          <box flexDirection="column" paddingTop={1}>
            <text fg={THEME.text}>trigger: {trigger().id}</text>
            <text fg={THEME.text}>workflow: {trigger().workflowId}</text>
            <text fg={THEME.text}>endpoint: {trigger().config?.method ?? "POST"} {trigger().config?.path ?? `/api/triggers/${trigger().id}`}</text>
            <text fg={THEME.muted}>Edit JSON input in the dock, then press enter.</text>
            <box flexDirection="column" paddingTop={1}>
              <text fg={THEME.muted}>Fields</text>
              <For each={triggerInputFields(trigger()).slice(0, 12)}>
                {(field) => <text fg={THEME.text} height={1} truncate={true}>{field}</text>}
              </For>
            </box>
          </box>
        )}
      </Show>
    </box>
  );
}

export function TriggerJobsPage(props: {
  jobs: TriggerJobSnapshot[];
  selectedJob?: TriggerJobSnapshot;
  onRefresh(): void | Promise<void>;
  onSelectJob(jobId: string): void;
}) {
  return (
    <box flexDirection="row" flexGrow={1} gap={2}>
      <box flexDirection="column" width={44}>
        <text fg={THEME.accent}>Trigger Jobs</text>
        <Show
          when={props.jobs.length > 0}
          fallback={<text fg={THEME.muted}>No trigger jobs yet.</text>}
        >
          <For each={props.jobs}>
            {(job) => {
              const selected = () => job.id === props.selectedJob?.id;
              return (
                <box
                  backgroundColor={selected() ? THEME.selected : undefined}
                  flexDirection="column"
                  onMouseUp={() => props.onSelectJob(job.id)}
                  paddingTop={1}
                >
                  <text fg={selected() ? THEME.accent : jobStatusColor(job.status)} height={1} truncate={true}>
                    {selected() ? "> " : "  "}{job.status} · {job.triggerId}
                  </text>
                  <text fg={THEME.muted} height={1} truncate={true}>
                    {job.id} · attempts {job.attempts}/{job.maxAttempts}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>
      <box flexDirection="column" flexGrow={1}>
        <Show
          when={props.selectedJob}
          fallback={<text fg={THEME.muted}>Select a job.</text>}
        >
          {(job) => (
            <>
              <text fg={THEME.accent}>Job Detail</text>
              <text fg={jobStatusColor(job().status)}>status: {job().status}</text>
              <text fg={THEME.text}>job: {job().id}</text>
              <text fg={THEME.text}>trigger: {job().triggerId}</text>
              <text fg={THEME.text}>workflow: {job().workflowId}</text>
              <text fg={THEME.text}>run: {job().runId ?? "not started"}</text>
              <text fg={THEME.text}>attempts: {job().attempts}/{job().maxAttempts}</text>
              <text fg={THEME.text}>available: {job().availableAt}</text>
              <Show when={job().lockedBy}>
                {(lockedBy) => <text fg={THEME.text}>locked: {lockedBy()} until {job().lockedUntil}</text>}
              </Show>
              <Show when={job().error}>
                {(error) => <text fg={THEME.error}>error: {truncate(error(), 88)}</text>}
              </Show>
              <box flexDirection="column" paddingTop={1}>
                <text fg={THEME.muted}>Input preview</text>
                <For each={jobPayloadPreview(job().payload).split("\n").slice(0, 8)}>
                  {(line) => <text fg={THEME.text} height={1} truncate={true}>{line}</text>}
                </For>
              </box>
              <text fg={THEME.muted}>enter run · r refresh · leader+r retry · leader+x cancel · leader+y copy id</text>
            </>
          )}
        </Show>
      </box>
    </box>
  );
}

function jobPayloadPreview(payload: { input?: unknown } | Record<string, unknown>): string {
  return JSON.stringify("input" in payload ? payload.input : payload, null, 2);
}
