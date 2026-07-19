/** @jsxImportSource @opentui/solid */
import { type WorkflowTuiExportFieldDescriptor } from "../workflow-app-tui.js";
import { type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { clampIndex } from "./routing-keyboard.js";
import { truncate } from "./string-format.js";
import { THEME, WORKFLOW_EXPORT_STEPS } from "./style.js";
import { type ShellCommand, type SlashCommand, type WorkflowExportWizardState } from "./types.js";
import { workflowExportStepFields } from "./workflow-export.js";
import { For, Show } from "solid-js";

export function CommandPalette(props: {
  commands: ShellCommand[];
  index: number;
  query: string;
  viewportHeight: number;
  viewportWidth: number;
}) {
  const width = () => Math.max(32, Math.min(72, props.viewportWidth - 8));
  const height = () => {
    const viewportMax = Math.max(10, props.viewportHeight - 8);
    const desired = props.query.trim()
      ? Math.max(10, Math.min(16, props.commands.length + 7))
      : Math.max(14, Math.min(24, props.commands.length + 7));
    return clampNumber(Math.min(viewportMax, desired), 10, 24);
  };
  const left = () => Math.max(2, Math.floor((props.viewportWidth - width()) / 2));
  const top = () => Math.max(2, Math.floor((props.viewportHeight - height()) / 2));
  const visibleCommandCount = () => Math.max(1, height() - 7);
  const visibleStart = () => commandWindowStart(props.index, props.commands.length, visibleCommandCount());
  const visibleCommands = () => props.commands.slice(visibleStart(), visibleStart() + visibleCommandCount());
  const hintWidth = () => Math.max(8, Math.min(18, Math.floor(width() * 0.26)));
  const sectionTitle = () => props.query.trim() ? "Results" : "Suggested";
  return (
    <box
      backgroundColor={THEME.backgroundPanel}
      border={["top", "right", "bottom", "left"]}
      borderColor={THEME.borderActive}
      flexDirection="column"
      height={height()}
      left={left()}
      overflow="hidden"
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      position="absolute"
      top={top()}
      width={width()}
    >
      <box flexDirection="row" height={1}>
        <text fg={THEME.text} flexGrow={1} height={1} truncate={true}>Commands</text>
        <text fg={THEME.muted} height={1} truncate={true}>esc</text>
      </box>
      <box height={1} />
      <text fg={THEME.muted} height={1} truncate={true}>
        {props.query.trim() ? `Search  ${props.query}` : "Search"}
      </text>
      <box height={1} />
      <text fg={THEME.accent} height={1} truncate={true}>{sectionTitle()}</text>
      <Show when={props.commands.length > 0} fallback={<PaletteLine fg={THEME.muted} text="No matches" />}>
        <For each={visibleCommands()}>
          {(command, index) => (
            <CommandPaletteRow
              command={command}
              hintWidth={hintWidth()}
              selected={visibleStart() + index() === props.index}
            />
          )}
        </For>
      </Show>
    </box>
  );
}

export function SlashCommandMenu(props: {
  commands: SlashCommand[];
  index: number;
  query: string;
  viewportHeight: number;
  viewportWidth: number;
}) {
  const width = () => Math.max(42, Math.min(92, props.viewportWidth - 8));
  const height = () =>
    clampNumber(Math.min(Math.max(8, props.commands.length + 5), props.viewportHeight - 8), 8, 18);
  const visibleCommandCount = () => Math.max(1, height() - 4);
  const visibleStart = () => commandWindowStart(
    props.index,
    props.commands.length,
    visibleCommandCount(),
  );
  const visibleCommands = () =>
    props.commands.slice(visibleStart(), visibleStart() + visibleCommandCount());
  const nameWidth = () => Math.max(12, Math.min(22, Math.floor(width() * 0.24)));
  return (
    <box
      backgroundColor={THEME.background}
      border={["top", "right", "bottom", "left"]}
      borderColor={THEME.borderActive}
      flexDirection="column"
      height={height()}
      left={Math.max(2, Math.floor((props.viewportWidth - width()) / 2))}
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      position="absolute"
      top={Math.max(2, Math.floor((props.viewportHeight - height()) / 2))}
      width={width()}
    >
      <box flexDirection="row" height={1}>
        <text fg={THEME.text} flexGrow={1} height={1} truncate={true}>Commands</text>
        <text fg={THEME.muted} height={1} truncate={true}>esc</text>
      </box>
      <text fg={THEME.muted} height={1} truncate={true}>
        {props.query.trim() ? `Search  ${props.query}` : "Search"}
      </text>
      <Show when={props.commands.length > 0} fallback={<PaletteLine fg={THEME.muted} text="No matches" />}>
        <For each={visibleCommands()}>
          {(command, index) => (
            <SlashCommandRow
              command={command}
              nameWidth={nameWidth()}
              selected={visibleStart() + index() === props.index}
            />
          )}
        </For>
      </Show>
    </box>
  );
}

export function SlashCommandRow(props: {
  command: SlashCommand;
  nameWidth: number;
  selected: boolean;
}) {
  return (
    <box
      backgroundColor={props.selected ? THEME.selected : undefined}
      flexDirection="row"
      height={1}
    >
      <text fg={props.selected ? THEME.warning : THEME.text} height={1} truncate={true} width={2}>
        {props.selected ? "› " : "  "}
      </text>
      <text fg={props.selected ? THEME.warning : THEME.text} height={1} truncate={true} width={props.nameWidth}>
        {props.command.name}
      </text>
      <text fg={props.selected ? THEME.warning : THEME.muted} flexGrow={1} height={1} truncate={true}>
        {props.command.description}
      </text>
    </box>
  );
}


export function WorkflowExportWizardDialog(props: {
  fields: WorkflowTuiExportFieldDescriptor[];
  selectedWorkflowCount: number;
  state: WorkflowExportWizardState;
  terminalHeight: number;
  terminalWidth: number;
  workflows: WorkflowAppWorkflowDescriptor[];
  workflowIds: string[];
}) {
  const width = () => Math.min(84, Math.max(56, props.terminalWidth - 10));
  const height = () => Math.min(20, Math.max(12, props.terminalHeight - 8));
  const left = () => Math.max(2, Math.floor((props.terminalWidth - width()) / 2));
  const top = () => Math.max(2, Math.floor((props.terminalHeight - height()) / 2));
  const stepFields = () => workflowExportStepFields(props.fields, props.state.step);
  const selectedField = () => stepFields()[clampIndex(props.state.fieldIndex, stepFields().length)];
  const workflowTitle = (workflowId: string) =>
    props.workflows.find((workflow) => workflow.id === workflowId)?.title ?? workflowId;
  const summary = () => props.workflowIds.slice(0, 4).map(workflowTitle).join(", ") +
    (props.workflowIds.length > 4 ? ` +${props.workflowIds.length - 4}` : "");
  return (
    <box
      backgroundColor={THEME.backgroundPanel}
      border={["top", "right", "bottom", "left"]}
      borderColor={props.state.error ? THEME.error : THEME.borderActive}
      flexDirection="column"
      height={height()}
      left={left()}
      overflow="hidden"
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      position="absolute"
      top={top()}
      width={width()}
    >
      <box flexDirection="row" height={1}>
        <text fg={THEME.accent} flexGrow={1} height={1} truncate={true}>Export Workflow App</text>
        <text fg={THEME.muted} height={1} truncate={true}>
          {`${props.state.step + 1}/${WORKFLOW_EXPORT_STEPS.length}`}
        </text>
      </box>
      <text fg={THEME.muted} height={1} truncate={true}>
        {`${props.selectedWorkflowCount} selected · ${summary()}`}
      </text>
      <box flexDirection="row" height={1}>
        <For each={WORKFLOW_EXPORT_STEPS}>
          {(stepName, index) => (
            <text
              fg={index() === props.state.step ? THEME.warning : THEME.muted}
              height={1}
              truncate={true}
              width={Math.floor((width() - 4) / WORKFLOW_EXPORT_STEPS.length)}
            >
              {stepName}
            </text>
          )}
        </For>
      </box>
      <Show
        when={!props.state.result}
        fallback={
          <box flexDirection="column" flexGrow={1}>
            <text fg={THEME.success} height={1} truncate={true}>Export complete</text>
            <text fg={THEME.text} height={1} truncate={true}>
              {props.state.result?.message ?? props.state.result?.bundleDir ?? "Bundle written."}
            </text>
            <Show when={props.state.result?.manifestPath}>
              {(manifestPath) => <text fg={THEME.muted} height={1} truncate={true}>{`manifest ${manifestPath()}`}</text>}
            </Show>
            <Show when={props.state.result?.binaryPath}>
              {(binaryPath) => <text fg={THEME.muted} height={1} truncate={true}>{`binary ${binaryPath()}`}</text>}
            </Show>
            <text fg={THEME.muted} height={1} truncate={true}>enter close</text>
          </box>
        }
      >
        <box flexDirection="column" flexGrow={1}>
          <For each={stepFields()}>
            {(field, index) => {
              const selected = () => index() === clampIndex(props.state.fieldIndex, stepFields().length);
              const value = () => props.state.values[field.id] ?? "";
              const displayValue = () => value() || field.placeholder || "";
              return (
                <box
                  backgroundColor={selected() ? THEME.selected : undefined}
                  flexDirection="row"
                  height={1}
                >
                  <text fg={selected() ? THEME.warning : THEME.text} height={1} truncate={true} width={2}>
                    {selected() ? "› " : "  "}
                  </text>
                  <text fg={THEME.muted} height={1} truncate={true} width={18}>
                    {field.label}
                  </text>
                  <text
                    fg={field.type === "boolean" ? THEME.info : value() ? THEME.text : THEME.muted}
                    flexGrow={1}
                    height={1}
                    truncate={true}
                  >
                    {field.type === "boolean" ? (value() === "true" ? "yes" : "no") : displayValue()}
                  </text>
                </box>
              );
            }}
          </For>
          <Show when={selectedField()?.description}>
            {(description) => <text fg={THEME.muted} height={1} truncate={true}>{description()}</text>}
          </Show>
          <Show when={props.state.error}>
            {(error) => <text fg={THEME.error} height={1} truncate={true}>{error()}</text>}
          </Show>
          <text fg={THEME.muted} height={1} truncate={true}>
            {props.state.running ? "exporting..." : "up/down fields · tab next · enter continue/export · esc close"}
          </text>
        </box>
      </Show>
    </box>
  );
}


export function CommandPaletteRow(props: {
  command: ShellCommand;
  hintWidth: number;
  selected: boolean;
}) {
  return (
    <box
      backgroundColor={props.selected ? THEME.selected : undefined}
      flexDirection="row"
      height={1}
    >
      <text fg={props.selected ? THEME.warning : THEME.text} height={1} truncate={true} width={2}>
        {props.selected ? "› " : "  "}
      </text>
      <text fg={props.selected ? THEME.warning : THEME.text} flexGrow={1} height={1} truncate={true}>
        {props.command.title}
      </text>
      <Show when={props.command.hint}>
        {(hint) => (
          <text fg={THEME.muted} height={1} truncate={true} width={props.hintWidth}>
            {hint()}
          </text>
        )}
      </Show>
    </box>
  );
}

export function commandWindowStart(index: number, length: number, visible: number) {
  if (length <= visible) return 0;
  const selected = clampNumber(index, 0, length - 1);
  const centered = selected - Math.floor(visible / 2);
  return clampNumber(centered, 0, length - visible);
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function PaletteLine(props: {
  fg: string;
  text: string;
}) {
  return (
    <text fg={props.fg} height={1} truncate={true}>
      {props.text}
    </text>
  );
}
