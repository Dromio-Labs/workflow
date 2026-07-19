/** @jsxImportSource react */
import { WorkflowSidebar } from "@dromio/chat-shell-ui";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import {
  createWorkflowFieldSvgRenderer,
  projectWorkflowFieldVisualState,
  workflowFieldLayout,
  type WorkflowFieldSvgRenderer,
} from "@dromio/workflow/client/workflow-field-svg";
import type { WorkflowRenderModel } from "@dromio/workflow/client/workflow-render";
import type { EventRecord } from "../../../core/index.js";
import type { WorkflowAppRunSnapshot } from "../workflow-app/types.js";
import type { WorkflowSvgAppPayload } from "../workflow-app-svg.js";

type StreamMessage =
  | { event: EventRecord; type: "event" }
  | { error: string; type: "error" }
  | { run: WorkflowAppRunSnapshot; type: "run" };

type PendingQuestion = {
  id: string;
  prompt?: string;
};

type WorkflowViewMode = "full" | "mini";

const payload = JSON.parse(document.getElementById("workflow-svg-data")!.textContent!) as WorkflowSvgAppPayload;

function WorkflowSvgShell() {
  const requested = new URLSearchParams(location.search).get("workflow");
  const initialId = payload.workflows.some((workflow) => workflow.id === requested)
    ? requested!
    : payload.defaultWorkflowId;
  const [workflowId, setWorkflowId] = useState(initialId);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [run, setRun] = useState<WorkflowAppRunSnapshot>();
  const [running, setRunning] = useState(false);
  const [viewMode, setViewMode] = useState<WorkflowViewMode>("full");
  const [error, setError] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    payload.workflows.map((workflow) => [workflow.id, workflow.defaultInput ?? ""]),
  ));
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const workflow = payload.workflows.find((item) => item.id === workflowId)!;
  const status = error ? "failed" : running ? "running" : run?.status ?? "idle";

  function selectWorkflow(nextId: string) {
    setWorkflowId(nextId);
    setEvents([]);
    setRun(undefined);
    setError(undefined);
    setRunning(false);
    const url = new URL(location.href);
    url.searchParams.set("workflow", nextId);
    history.replaceState(null, "", url);
  }

  async function startRun() {
    const input = drafts[workflowId]?.trim() ?? "";
    if (!input || running) return;
    setEvents([]);
    setRun(undefined);
    setError(undefined);
    setRunning(true);
    try {
      await streamRequest("/api/runs", {
        input,
        triggerId: workflow.trigger.id,
        workflowId,
      }, receiveMessage);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setRunning(false);
    }
  }

  function receiveMessage(message: StreamMessage) {
    if (message.type === "event") setEvents((current) => [...current, message.event]);
    if (message.type === "run") setRun(message.run);
    if (message.type === "error") setError(message.error);
  }

  function toggleSidebar() {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (sidebar.isCollapsed()) sidebar.expand();
    else sidebar.collapse();
  }

  const pendingQuestion = run?.pendingQuestions[0] as PendingQuestion | undefined;
  return (
    <main className="hero-visual-theme chat-shell-layout app-shell workflow-svg-shell">
      <Group className="shell-panels" orientation="horizontal">
        <Panel
          collapsedSize={0}
          collapsible
          defaultSize="300px"
          id="workflow-svg-sidebar"
          maxSize="360px"
          minSize="240px"
          panelRef={sidebarRef}
        >
          <WorkflowSidebar
            activeWorkflowId={workflowId}
            appTitle={payload.title}
            items={payload.workflows.map((item) => ({
              id: item.id,
              label: item.title,
              meta: `${item.stepCount} steps`,
            }))}
            onSelectWorkflow={selectWorkflow}
          />
        </Panel>
        <Separator aria-label="Resize workflow sidebar" className="sidebar-resize-handle"><span /></Separator>
        <Panel minSize="420px">
          <div className="chat-shell-main-gutter">
            <section className="workspace workflow-svg-workspace">
              <header className="workspace-header">
                <div className="workspace-heading">
                  <button className="sidebar-toggle-button" type="button" aria-label="Toggle sidebar" onClick={toggleSidebar}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="2" /><path d="M5.5 2v12" /></svg>
                  </button>
                  <div className="workflow-heading">
                    <h1>{workflow.title}</h1>
                    <span className="trigger-label">{workflow.trigger.label}</span>
                    <span className="workflow-svg-status" data-status={status}>{status}</span>
                  </div>
                </div>
                <div className="canvas-actions">
                  <div className="workflow-svg-view-toggle" aria-label="Workflow view" role="group">
                    <button aria-pressed={viewMode === "full"} type="button" onClick={() => setViewMode("full")}>Full</button>
                    <button aria-pressed={viewMode === "mini"} type="button" onClick={() => setViewMode("mini")}>Mini</button>
                  </div>
                  <button className="run-header-button" disabled={running} type="button" onClick={startRun}>Run</button>
                </div>
              </header>
              <div className="workflow-svg-body">
                <WorkflowField workflow={workflow} events={events} run={run} running={running} viewMode={viewMode} />
                <div className="workflow-svg-run-dock">
                  {pendingQuestion && run
                    ? <QuestionForm question={pendingQuestion} run={run} onMessage={receiveMessage} onRunning={setRunning} />
                    : (
                      <form className="workflow-svg-run-form" onSubmit={(event) => { event.preventDefault(); void startRun(); }}>
                        <textarea
                          aria-label="Prompt input"
                          disabled={running}
                          placeholder="Enter the prompt for this workflow"
                          rows={2}
                          value={drafts[workflowId] ?? ""}
                          onChange={(event) => setDrafts((current) => ({ ...current, [workflowId]: event.target.value }))}
                        />
                        <div className="workflow-svg-run-footer">
                          <span>{error ?? `${workflow.trigger.label} · ${workflow.trigger.type} trigger`}</span>
                          <button disabled={running || !drafts[workflowId]?.trim()} type="submit">{running ? "Running" : "Run workflow"}</button>
                        </div>
                      </form>
                    )}
                </div>
              </div>
            </section>
          </div>
        </Panel>
      </Group>
    </main>
  );
}

function WorkflowField({
  events,
  run,
  running,
  viewMode,
  workflow,
}: {
  events: EventRecord[];
  run?: WorkflowAppRunSnapshot;
  running: boolean;
  viewMode: WorkflowViewMode;
  workflow: WorkflowSvgAppPayload["workflows"][number];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<WorkflowFieldSvgRenderer | undefined>(undefined);
  const runInput = useMemo(() => events.length || run || running ? {
    events,
    status: run?.status ?? (running ? "running" : "idle"),
    triggerId: run?.origin?.triggerId ?? workflow.trigger.id,
  } : undefined, [events, run, running, workflow.trigger.id]);
  const miniLayout = useMemo(() => workflowFieldLayout(workflow.model, "mini"), [workflow.model]);
  const visualState = useMemo(
    () => projectWorkflowFieldVisualState(workflow.model, runInput),
    [runInput, workflow.model],
  );
  const currentNodeId = visualState.activeNodeId ?? visualState.activeNodeIds.at(-1);
  const currentNodeLabel = currentNodeId ? workflowNodeLabel(workflow.model, currentNodeId) : undefined;
  const miniTitle = currentNodeLabel ? runningNodeTitle(currentNodeLabel) : workflow.title;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    rendererRef.current?.dispose();
    rendererRef.current = createWorkflowFieldSvgRenderer(svg, {
      model: workflow.model,
      ...(runInput ? { run: runInput } : {}),
      variant: viewMode,
    });
    return () => rendererRef.current?.dispose();
  }, [workflow.id, viewMode]);

  useEffect(() => {
    rendererRef.current?.update({
      model: workflow.model,
      ...(runInput ? { run: runInput } : {}),
      variant: viewMode,
    });
  }, [runInput, viewMode, workflow.model]);

  return (
    <div className="workflow-field-viewport" data-view-mode={viewMode}>
      {viewMode === "mini" ? (
        <div className="workflow-field-mini-demo">
          <div className="workflow-field-mini-card">
            <svg
              className="workflow-field-svg"
              ref={svgRef}
              style={{ aspectRatio: `${miniLayout.width} / ${miniLayout.height}`, height: "auto" }}
            />
            <p
              aria-live="polite"
              className="workflow-field-mini-narrator"
              data-status={run?.status ?? (running ? "running" : "idle")}
            >
              {miniTitle}
            </p>
          </div>
          <button className="workflow-field-mini-trigger" type="button">Hover workflow preview</button>
        </div>
      ) : <svg className="workflow-field-svg" ref={svgRef} />}
    </div>
  );
}

function workflowNodeLabel(model: WorkflowRenderModel, nodeId: string): string | undefined {
  for (const node of model.nodes) {
    if (node.id === nodeId) return node.label;
    const childLabel = node.childWorkflow
      ? workflowNodeLabel(node.childWorkflow.model, nodeId)
      : undefined;
    if (childLabel) return childLabel;
  }
  return undefined;
}

function runningNodeTitle(label: string) {
  const [verb = label, ...rest] = label.trim().split(/\s+/);
  const normalizedVerb = verb.toLowerCase();
  const knownForms: Readonly<Record<string, string>> = {
    analyze: "Analyzing",
    answer: "Answering",
    assess: "Assessing",
    clarify: "Clarifying",
    end: "Ending",
    evaluate: "Evaluating",
    fork: "Forking",
    gate: "Gating",
    generate: "Generating",
    prompt: "Starting",
    review: "Reviewing",
    run: "Running",
    start: "Starting",
    trigger: "Triggering",
    write: "Writing",
  };
  const progressive = knownForms[normalizedVerb] ?? progressiveVerb(verb);
  return `${[progressive, ...rest].join(" ")}...`;
}

function progressiveVerb(verb: string) {
  if (/ing$/i.test(verb)) return verb;
  if (/y$/i.test(verb)) return `${verb.slice(0, -1)}ying`;
  if (/e$/i.test(verb)) return `${verb.slice(0, -1)}ing`;
  return `${verb}ing`;
}

function QuestionForm({
  onMessage,
  onRunning,
  question,
  run,
}: {
  onMessage: (message: StreamMessage) => void;
  onRunning: (running: boolean) => void;
  question: PendingQuestion;
  run: WorkflowAppRunSnapshot;
}) {
  const [answer, setAnswer] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!answer.trim()) return;
    onRunning(true);
    try {
      await streamRequest(`/api/runs/${encodeURIComponent(run.runId)}/questions/${encodeURIComponent(question.id)}`, { value: answer.trim() }, onMessage);
    } catch (reason) {
      onMessage({ error: errorMessage(reason), type: "error" });
    } finally {
      onRunning(false);
    }
  }
  return (
    <form className="workflow-svg-question-form" onSubmit={(event) => void submit(event)}>
      <strong>NEEDS A HUMAN</strong>
      <p>{question.prompt ?? "Continue this workflow run."}</p>
      <div className="workflow-svg-question-actions">
        <input aria-label="Question answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
        <button disabled={!answer.trim()} type="submit">Continue</button>
      </div>
    </form>
  );
}

async function streamRequest(path: string, body: object, onMessage: (message: StreamMessage) => void) {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? response.statusText);
  if (!response.body) throw new Error("Workflow stream did not return a body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onMessage(JSON.parse(line) as StreamMessage);
    if (done) break;
  }
  if (pending.trim()) onMessage(JSON.parse(pending) as StreamMessage);
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

createRoot(document.getElementById("workflow-svg-root")!).render(<WorkflowSvgShell />);
