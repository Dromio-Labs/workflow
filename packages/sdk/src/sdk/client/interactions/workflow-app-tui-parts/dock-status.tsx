/** @jsxImportSource @opentui/solid */
import { type WorkflowAppRun, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { clampNumber } from "./command-palette.js";
import { formFieldEditableValue, formFieldStructuredLine, formFieldStructuredPrefix, inputFormHeaderLine, workflowInputPlaceholder } from "./input-form.js";
import { dockHint, dockTitle, statusAction, statusShortcutHint } from "./routing-keyboard.js";
import { truncate } from "./string-format.js";
import { THEME } from "./style.js";
import { type ShellRoute, type ShellStatus, type StartPane, type TuiInputForm, type TuiInputFormField, type TuiInputMode, type TuiPromptAttachment } from "./types.js";
import { render } from "@opentui/solid";
import { For, Show } from "solid-js";

export function InteractionDock(props: {
  attachments: TuiPromptAttachment[];
  canRenderInputForm: boolean;
  compact?: boolean;
  inputForm?: TuiInputForm;
  inputMode: TuiInputMode;
  prompt(): string;
  promptCursor: number;
  route(): ShellRoute;
  selectedInputFieldIndex: number;
  selectedStartPane: StartPane;
  status(): ShellStatus;
  workflow(): WorkflowAppWorkflowDescriptor;
  workflowQuery(): string;
}) {
  const filtering = () => props.route().type === "library";
  const compactFilter = () => Boolean(props.compact && filtering());
  const editable = () => (props.route().type === "start" || props.route().type === "triggerFire") &&
    (props.status() === "idle" || props.status() === "completed" || props.status() === "failed");
  const inputPaneActive = () => props.route().type !== "start" || props.selectedStartPane === "fields";
  const active = () => filtering() || (editable() && inputPaneActive());
  const commandUsage = () => props.workflow().commands?.map((command) => command.usage ?? `/${command.name}`).join(", ");
  const placeholder = () => workflowInputPlaceholder(props.workflow()) ?? commandUsage() ?? "What do you want to run?";
  const renderedInput = () => props.inputForm && editable() ? props.inputForm : undefined;
  const rawStructuredInput = () => props.canRenderInputForm && editable() && props.inputMode === "raw";
  const title = () => filtering()
    ? "Filter workflows"
    : renderedInput()
    ? `${renderedInput()!.title} · render`
    : rawStructuredInput()
    ? `${props.workflow().title} input · raw`
    : dockTitle(props.route(), props.status(), placeholder());
  const detail = () => filtering()
    ? `${compactFilter() ? "filter " : ""}> ${props.workflowQuery() || "type to search"}`
    : renderedInput()
    ? ""
    : rawStructuredInput()
    ? ""
    : editable()
    ? `> ${props.prompt()}`
    : dockHint(props.route(), props.status());
  const attachmentText = () => props.attachments.length
    ? `attached ${props.attachments.map((attachment) => attachment.label).join(", ")}`
    : "";
  return (
    <box
      backgroundColor={THEME.backgroundAlt}
      border={["left", "top"]}
      borderColor={active() ? THEME.borderActive : THEME.border}
      flexDirection="column"
      flexShrink={0}
      marginTop={compactFilter() ? 0 : 1}
      paddingBottom={filtering() ? 0 : 1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={compactFilter() ? 0 : 1}
    >
      <Show when={!compactFilter()}>
        <text
          fg={filtering() ? THEME.accent : active() ? THEME.accent : THEME.muted}
          height={1}
          truncate={true}
        >
          {title()}
        </text>
      </Show>
      <Show
        when={editable() && !renderedInput() && !rawStructuredInput()}
        fallback={
          <Show when={detail()}>
            {(value) => <text fg={THEME.text} height={1} truncate={true}>{value()}</text>}
          </Show>
        }
      >
        <PromptInputLine
          cursor={props.promptCursor}
          prefix="> "
          value={props.prompt()}
        />
      </Show>
      <Show when={rawStructuredInput()}>
        <box paddingTop={1}>
          <PromptInputLine
            cursor={props.promptCursor}
            prefix="> "
            value={props.prompt()}
          />
        </box>
      </Show>
      <Show when={renderedInput()}>
        {(form) => (
          <box flexDirection="column" paddingTop={1}>
            <text fg={THEME.muted} height={1} truncate={true}>
              {inputFormHeaderLine()}
            </text>
            <For each={form().fields.slice(0, 6)}>
              {(field, index) => {
                const selected = () => index() === props.selectedInputFieldIndex;
                return (
                  <InputFormFieldRow
                    cursor={props.promptCursor}
                    field={field}
                    selected={selected()}
                  />
                );
              }}
            </For>
          </box>
        )}
      </Show>
      <Show when={attachmentText()}>
        {(text) => <text fg={THEME.success} height={1} truncate={true}>{text()}</text>}
      </Show>
    </box>
  );
}

export function InputFormFieldRow(props: {
  cursor: number;
  field: TuiInputFormField;
  selected: boolean;
}) {
  const editable = () => props.selected && props.field.type !== "checkbox";
  return (
    <Show
      when={editable()}
      fallback={
        <text fg={props.selected ? THEME.accent : THEME.text} height={1} truncate={true}>
          {formFieldStructuredLine(props.field, props.selected)}
        </text>
      }
    >
      <PromptInputLine
        cursor={props.cursor}
        fg={THEME.accent}
        prefix={formFieldStructuredPrefix(props.field, true)}
        value={formFieldEditableValue(props.field)}
      />
    </Show>
  );
}

export function PromptInputLine(props: {
  cursor: number;
  fg?: string;
  prefix?: string;
  value: string;
}) {
  const cursor = () => clampNumber(props.cursor, 0, props.value.length);
  const fg = () => props.fg ?? THEME.text;
  const before = () => props.value.slice(0, cursor());
  const cursorText = () => props.value[cursor()] ?? " ";
  const after = () => props.value.slice(cursor() + (cursor() < props.value.length ? 1 : 0));
  return (
    <box flexDirection="row" height={1}>
      <text fg={fg()} height={1} truncate={true}>
        {`${props.prefix ?? ""}${before()}`}
      </text>
      <box backgroundColor={THEME.text} height={1} width={1}>
        <text fg={THEME.background} height={1}>
          {cursorText() === " " ? "\u00a0" : cursorText()}
        </text>
      </box>
      <text fg={fg()} height={1} truncate={true}>
        {after()}
      </text>
    </box>
  );
}

export function HookDock(props: {
  run: WorkflowAppRun;
  value: string;
}) {
  const hook = props.run.session.pendingHooks?.[0];
  const title = hook?.id ?? "hook";
  const detail = typeof hook?.input === "string"
    ? hook.input
    : hook?.input
    ? JSON.stringify(hook.input)
    : "";
  return (
    <box
      backgroundColor={THEME.backgroundAlt}
      border={["left", "top"]}
      borderColor={THEME.warning}
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingTop={1}
    >
      <text fg={THEME.warning}>Waiting on {title}</text>
      <Show when={detail}>
        {(message) => <text fg={THEME.muted}>{truncate(message(), 76)}</text>}
      </Show>
      <text fg={THEME.text}>&gt; {props.value}</text>
    </box>
  );
}

export function StatusBar(props: {
  commandName: string;
  compact?: boolean;
  leaderActive?: boolean;
  route: ShellRoute;
  status: ShellStatus;
  workflow: WorkflowAppWorkflowDescriptor;
}) {
  const shortcuts = () => statusShortcutHint(props.route, props.status, props.workflow);
  const accent = () => props.leaderActive ? THEME.muted : THEME.accent;
  const action = () => props.leaderActive ? "leader" : statusAction(props.route, props.status, props.workflow);
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      height={props.compact ? 1 : 2}
      overflow="hidden"
      paddingTop={props.compact ? 0 : 1}
    >
      <text fg={accent()} height={1} truncate={true}>{props.commandName}</text>
      <text fg={THEME.muted} height={1}> · </text>
      <text fg={props.leaderActive ? THEME.muted : THEME.text} height={1} truncate={true}>{props.workflow.title}</text>
      <text fg={THEME.muted} height={1}> · {props.status} · </text>
      <text fg={props.leaderActive ? THEME.muted : THEME.warning} height={1} truncate={true}>{action()}</text>
      <text fg={THEME.muted} height={1}>  </text>
      <box flexGrow={1} />
      <text fg={THEME.muted} flexShrink={1} height={1} truncate={true}>
        {shortcuts() ? `${shortcuts()} · ctrl+p commands` : "ctrl+p commands"}
      </text>
    </box>
  );
}
