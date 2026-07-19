/** @jsxImportSource @opentui/solid */
import { type WorkflowAppRunOrigin } from "../workflow-app.js";
import { type WorkflowRunStoreSnapshot } from "../workflow-run-store.js";
import { ActivityTable, runDurationText } from "./activity-table.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { For, Show } from "solid-js";

export function RunTranscript(props: {
  error: string;
  origin?: WorkflowAppRunOrigin;
  result: string;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  onOpenActivityContent(title: string, content: string): void;
  onOpenResult(): void;
}) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <text fg={THEME.muted} height={1} truncate={true}>
        {["Activity", runDurationText(props.snapshot, props.snapshot.status)].filter(Boolean).join(" · ")}
      </text>
      <Show when={props.origin}>
        {(origin) => (
          <text fg={THEME.info} height={1} truncate={true}>
            origin: {origin().type}{origin().triggerId ? ` · ${origin().triggerId}` : ""}{origin().triggerJobId ? ` · ${origin().triggerJobId}` : ""}
          </text>
        )}
      </Show>
      <scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom">
        <ActivityTable
          emptyText="Waiting for workflow events..."
          rows={props.snapshot.transcript}
          spinnerFrame={props.spinnerFrame}
          onOpenRowContent={props.onOpenActivityContent}
        />
        <Show when={props.result}>
          {(result) => (
            <box
              border={["top"]}
              borderColor={THEME.border}
              flexDirection="column"
              marginTop={1}
              onMouseUp={props.onOpenResult}
              paddingTop={1}
            >
              <text fg={THEME.success}>Result</text>
              <For each={result().split("\n").slice(0, 8)}>
                {(line) => <text fg={THEME.text}>{truncate(line, 88)}</text>}
              </For>
            </box>
          )}
        </Show>
        <Show when={props.error}>
          {(error) => <text fg={THEME.error}>Error: {truncate(error(), 88)}</text>}
        </Show>
      </scrollbox>
    </box>
  );
}
