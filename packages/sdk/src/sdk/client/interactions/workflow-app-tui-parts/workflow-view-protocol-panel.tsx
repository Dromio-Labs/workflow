/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js";
import type { WorkflowViewSnapshot } from "@dromio/workflow-room-protocol";
import { MetadataSection } from "./metadata-sections.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import type { WorkflowViewProtocolPanelMode } from "./types.js";
import { workflowViewProtocolLines } from "./workflow-view-protocol-lines.js";

export { workflowViewProtocolFixtureSnapshot, workflowViewProtocolLines } from "./workflow-view-protocol-lines.js";

export function WorkflowViewProtocolPanel(props: {
  mode?: WorkflowViewProtocolPanelMode;
  snapshot?: WorkflowViewSnapshot;
}) {
  const lines = () => props.snapshot
    ? workflowViewProtocolLines(props.snapshot, { mode: props.mode })
    : [];
  return (
    <Show when={lines().length > 0}>
      <MetadataSection rowCount={lines().length} separated={true} title="WORKFLOW ROOM">
        <For each={lines()}>
          {(line) => (
            <text fg={line.fg ?? THEME.text} height={1} truncate={true}>
              {truncate(line.text, 96)}
            </text>
          )}
        </For>
      </MetadataSection>
    </Show>
  );
}
