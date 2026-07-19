/** @jsxImportSource @opentui/solid */
import type { WorkflowViewSnapshot } from "@dromio/workflow-room-protocol";
import { Show } from "solid-js";
import { THEME } from "./style.js";
import type { WorkflowViewProtocolPanelMode } from "./types.js";
import { WorkflowViewProtocolPanel } from "./workflow-view-protocol-panel.js";

export function WorkflowRunProtocolRail(props: {
  mode?: WorkflowViewProtocolPanelMode;
  snapshot?: WorkflowViewSnapshot;
  terminalWidth: number;
  visible: boolean;
}) {
  return (
    <Show when={props.visible && props.snapshot && props.terminalWidth >= 110}>
      <box
        border={["left"]}
        borderColor={THEME.border}
        flexDirection="column"
        flexShrink={0}
        minHeight={0}
        paddingLeft={1}
        width={42}
      >
        <scrollbox flexGrow={1} minHeight={0} stickyScroll={false}>
          <WorkflowViewProtocolPanel mode={props.mode} snapshot={props.snapshot} />
        </scrollbox>
      </box>
    </Show>
  );
}
