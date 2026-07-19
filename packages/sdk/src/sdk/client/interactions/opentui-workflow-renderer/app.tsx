/** @jsxImportSource @opentui/solid */
import {
  useKeyboard,
  useTerminalDimensions,
} from "@opentui/solid";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type {
  WorkflowRunSemanticRow,
  WorkflowRunStore,
  WorkflowRunStoreSnapshot,
} from "../workflow-run-store.js";
import {
  runWorkflowDiagramViewportColumns,
  runWorkflowDiagramViewportRows,
  WorkflowSnapshotDiagramPane,
} from "../workflow-app-tui-parts/diagram-view.js";
import type {
  QuestionDockController,
} from "./controller.js";
import {
  boundaryStepColor,
  formatStepIndex,
  inputLabel,
  parseSelectionId,
  selectionId,
  statusColor,
  statusGlyph,
  stepStatus,
  stepStatusColor,
  truncate,
  wrapLine,
} from "./display.js";
import {
  QuestionDock,
} from "./question-dock.js";

export function WorkflowTuiApp(props: {
  questionController: QuestionDockController;
  store: WorkflowRunStore;
}) {
  const [snapshot, setSnapshot] = createSignal(props.store.snapshot());
  const [selectedId, setSelectedId] = createSignal<string | undefined>();
  const [spinnerFrame, setSpinnerFrame] = createSignal(0);
  const dimensions = useTerminalDimensions();
  onCleanup(props.store.subscribe(setSnapshot));
  const spinnerTimer = setInterval(() => {
    setSpinnerFrame((frame) => (frame + 1) % 120);
  }, 80);
  if (typeof spinnerTimer === "object" && "unref" in spinnerTimer) spinnerTimer.unref();
  onCleanup(() => clearInterval(spinnerTimer));
  const inspectableIds = createMemo(() => [
    ...snapshot().steps.map((step) => selectionId("step", step.id)),
    ...snapshot().transcript.map((row) => selectionId("row", row.id)),
  ]);
  const activeSelectedId = createMemo(() => {
    const current = selectedId();
    const ids = inspectableIds();
    if (current && ids.includes(current)) return current;
    const currentStepId = snapshot().currentStepId;
    if (currentStepId) return selectionId("step", currentStepId);
    const lastRow = snapshot().transcript.at(-1);
    if (lastRow) return selectionId("row", lastRow.id);
    return ids[0];
  });
  const setActiveSelection = (next: string) => setSelectedId(next);
  const activeStepId = createMemo(() => {
    const parsed = parseSelectionId(activeSelectedId());
    if (parsed?.kind === "step") return parsed.id;
    return snapshot().currentStepId ?? snapshot().currentStep?.id;
  });

  useKeyboard((event) => {
    if (props.questionController.current()) return;
    if (event.eventType === "release") return;
    if (event.name !== "up" && event.name !== "down" && event.name !== "k" && event.name !== "j") return;
    event.preventDefault();
    const ids = inspectableIds();
    if (ids.length === 0) return;
    const currentIndex = Math.max(0, ids.indexOf(activeSelectedId() ?? ids[0]!));
    const delta = event.name === "up" || event.name === "k" ? -1 : 1;
    setActiveSelection(ids[(currentIndex + delta + ids.length) % ids.length]!);
  });

  return (
    <box
      backgroundColor="#090b0f"
      flexDirection="column"
      height={dimensions().height}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      width={dimensions().width}
    >
      <Header snapshot={snapshot()} />
      <box flexDirection="row" flexGrow={1} gap={1}>
        <StepRail
          onSelect={(id) => setActiveSelection(selectionId("step", id))}
          selectedId={activeSelectedId()}
          snapshot={snapshot()}
        />
        <WorkflowRunCanvasPane
          onSelectRow={(id) => setActiveSelection(selectionId("row", id))}
          onSelectStep={(id) => setActiveSelection(selectionId("step", id))}
          selectedId={activeSelectedId()}
          selectedStepId={activeStepId()}
          snapshot={snapshot()}
          spinnerFrame={spinnerFrame()}
          terminalHeight={dimensions().height}
          terminalWidth={dimensions().width}
        />
        <Show when={dimensions().width >= 132}>
          <TranscriptPane
            onSelect={(id) => setActiveSelection(selectionId("row", id))}
            selectedId={activeSelectedId()}
            snapshot={snapshot()}
          />
        </Show>
        <Show when={dimensions().width >= 112}>
          <InspectorPane selectedId={activeSelectedId()} snapshot={snapshot()} />
        </Show>
      </box>
      <QuestionDock controller={props.questionController} snapshot={snapshot()} />
    </box>
  );
}

function WorkflowRunCanvasPane(props: {
  onSelectRow(rowId: string): void;
  onSelectStep(stepId: string): void;
  selectedId?: string;
  selectedStepId?: string;
  snapshot: WorkflowRunStoreSnapshot;
  spinnerFrame: number;
  terminalHeight: number;
  terminalWidth: number;
}) {
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <WorkflowSnapshotDiagramPane
        selectedStepId={props.selectedStepId}
        snapshot={props.snapshot}
        spinnerFrame={props.spinnerFrame}
        viewportColumns={runWorkflowDiagramViewportColumns(props.terminalWidth)}
        viewportRows={Math.max(8, runWorkflowDiagramViewportRows(props.terminalHeight) - 8)}
        onSelectStep={props.onSelectStep}
      />
      <box
        border={["top"]}
        borderColor="#273244"
        flexDirection="column"
        flexShrink={0}
        height={Math.max(7, Math.min(10, Math.floor(props.terminalHeight / 4)))}
        marginTop={1}
        paddingTop={1}
      >
        <TranscriptPane
          onSelect={props.onSelectRow}
          selectedId={props.selectedId}
          snapshot={props.snapshot}
        />
      </box>
    </box>
  );
}

function Header(props: { snapshot: WorkflowRunStoreSnapshot }) {
  return (
    <box flexDirection="column" flexShrink={0} paddingBottom={1}>
      <text fg="#d9e2f2">
        {props.snapshot.graph.id} · {props.snapshot.runId ?? "starting"} · {props.snapshot.status}
      </text>
      <Show when={inputLabel(props.snapshot.input)}>
        {(label) => <text fg="#7d8aa2">Prompt: {truncate(label(), 110)}</text>}
      </Show>
    </box>
  );
}

function StepRail(props: {
  onSelect(stepId: string): void;
  selectedId?: string;
  snapshot: WorkflowRunStoreSnapshot;
}) {
  return (
    <box
      border={["right"]}
      borderColor="#273244"
      flexDirection="column"
      flexShrink={0}
      paddingRight={1}
      width={34}
    >
      <text fg="#7d8aa2">Workflow</text>
      <For each={props.snapshot.steps}>
        {(step) => {
          const selected = () => props.selectedId === selectionId("step", step.id);
          return (
            <box
              backgroundColor={selected() ? "#142033" : undefined}
              flexDirection="column"
              onMouseUp={() => props.onSelect(step.id)}
              paddingBottom={selected() ? 1 : 0}
              paddingLeft={selected() ? 1 : 0}
              paddingTop={1}
            >
              <text fg={boundaryStepColor(step) ?? (step.status === "running" || step.status === "waiting" ? "#8bd3ff" : "#d9e2f2")}>
                {selected() ? "▸ " : "  "}{formatStepIndex(step)} {truncate(step.label, 18)}
              </text>
              <text fg="#7d8aa2">
                {stepStatus(step.status)}
                {typeof step.score === "number" ? ` · ${Math.round(step.score * 100)}%` : ""}
                {step.note ? ` · ${truncate(step.note, 18)}` : ""}
              </text>
            </box>
          );
        }}
      </For>
    </box>
  );
}

function TranscriptPane(props: {
  onSelect(rowId: string): void;
  selectedId?: string;
  snapshot: WorkflowRunStoreSnapshot;
}) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <text fg="#7d8aa2">Activity</text>
      <scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom">
        <Show when={props.snapshot.transcript.length > 0} fallback={<text fg="#7d8aa2">Waiting for workflow events...</text>}>
          <For each={props.snapshot.transcript}>
            {(item) => (
              <TranscriptRow
                item={item}
                onSelect={() => props.onSelect(item.id)}
                selected={props.selectedId === selectionId("row", item.id)}
              />
            )}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}

function TranscriptRow(props: {
  item: WorkflowRunSemanticRow;
  onSelect(): void;
  selected?: boolean;
}) {
  return (
    <box
      backgroundColor={props.selected ? "#141923" : undefined}
      flexDirection="column"
      onMouseUp={props.onSelect}
      paddingBottom={props.selected ? 1 : 0}
      paddingLeft={props.selected ? 1 : 0}
      paddingTop={1}
    >
      <text fg={statusColor(props.item.status)}>
        {props.selected ? "▸ " : ""}{statusGlyph(props.item.status)} {props.item.phaseTitle}: {props.item.text}{props.item.timeLabel ? ` · ${props.item.timeLabel}` : ""}
      </text>
      <For each={props.item.children ?? []}>
        {(child) => (
          <text fg="#7d8aa2">
            {"  "}
            {typeof child === "string" ? child : child.text}
          </text>
        )}
      </For>
    </box>
  );
}

function InspectorPane(props: {
  selectedId?: string;
  snapshot: WorkflowRunStoreSnapshot;
}) {
  const selectedStep = () => {
    const parsed = parseSelectionId(props.selectedId);
    if (parsed?.kind !== "step") return undefined;
    return props.snapshot.steps.find((step) => step.id === parsed.id);
  };
  const selectedRow = () => {
    const parsed = parseSelectionId(props.selectedId);
    if (parsed?.kind !== "row") return undefined;
    return props.snapshot.transcript.find((row) => row.id === parsed.id);
  };
  const relatedRows = () => {
    const step = selectedStep();
    if (!step) return [];
    return props.snapshot.transcript
      .filter((row) => row.stepId === step.id)
      .slice(-5);
  };

  return (
    <box
      border={["left"]}
      borderColor="#273244"
      flexDirection="column"
      flexShrink={0}
      paddingLeft={1}
      width={38}
    >
      <text fg="#7d8aa2">Inspect</text>
      <Show when={selectedStep()}>
        {(step) => (
          <box flexDirection="column" paddingTop={1}>
            <text fg={boundaryStepColor(step()) ?? "#d9e2f2"}>{formatStepIndex(step())} {truncate(step().label, 28)}</text>
            <text fg={stepStatusColor(step().status)}>{stepStatus(step().status)}</text>
            <Show when={typeof step().score === "number"}>
              <text fg="#86efac">score {Math.round((step().score ?? 0) * 100)}%</text>
            </Show>
            <Show when={step().description}>
              {(description) => <text fg="#9aa7bd">{wrapLine(description(), 34)}</text>}
            </Show>
            <Show when={relatedRows().length > 0}>
              <box flexDirection="column" paddingTop={1}>
                <text fg="#7d8aa2">Recent</text>
                <For each={relatedRows()}>
                  {(row) => <text fg={statusColor(row.status)}>{statusGlyph(row.status)} {truncate(row.text, 32)}{row.timeLabel ? ` · ${row.timeLabel}` : ""}</text>}
                </For>
              </box>
            </Show>
          </box>
        )}
      </Show>
      <Show when={selectedRow()}>
        {(row) => (
          <box flexDirection="column" paddingTop={1}>
            <text fg={statusColor(row().status)}>{statusGlyph(row().status)} {row().phaseTitle}</text>
            <text fg="#d9e2f2">{wrapLine(row().text, 34)}</text>
            <Show when={row().stepId}>
              {(stepId) => <text fg="#7d8aa2">step {stepId()}</text>}
            </Show>
            <For each={row().children ?? []}>
              {(child) => (
                <text fg="#9aa7bd">
                  {wrapLine(typeof child === "string" ? child : child.text, 34)}
                </text>
              )}
            </For>
          </box>
        )}
      </Show>
      <Show when={!selectedStep() && !selectedRow()}>
        <text fg="#7d8aa2">Select a workflow step or activity row.</text>
      </Show>
      <box flexGrow={1} />
      <text fg="#5f6f89">click rows · ↑/↓ inspect</text>
    </box>
  );
}
