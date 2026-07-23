/** @jsxImportSource react */
import "./activity-json-render.js";
import { WorkflowSidebar } from "@dromio/chat-shell-ui";
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
  type PanelSize,
} from "react-resizable-panels";

type ShellPayload = {
  appId: string;
  defaultWorkflowId: string;
  title: string;
  workflows: Array<{
    id: string;
    layout: { boxes: Array<{ kind: string }> };
    title: string;
  }>;
};

const payload = JSON.parse(document.getElementById("workflow-gui-data")!.textContent!) as ShellPayload;
const rootElement = document.getElementById("workflow-gui-root")!;

function WorkflowGuiShell() {
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const activityResizeRef = useRef<{ pointerX: number; width: number } | undefined>(undefined);
  const [activityOpen, setActivityOpen] = useState(true);
  const [activityWidth, setActivityWidth] = useState(360);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  function announceLayoutChange() {
    window.dispatchEvent(new Event("workflow-gui-layout-change"));
  }

  function onSidebarResize(size: PanelSize) {
    const open = size.inPixels > 1;
    setSidebarOpen((current) => current === open ? current : open);
    announceLayoutChange();
  }

  function toggleSidebar() {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (sidebar.isCollapsed()) sidebar.expand();
    else sidebar.collapse();
    requestAnimationFrame(announceLayoutChange);
  }

  function beginActivityResize(event: ReactPointerEvent<HTMLButtonElement>) {
    activityResizeRef.current = { pointerX: event.clientX, width: activityWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizeActivity(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = activityResizeRef.current;
    if (!start) return;
    setActivityWidth(Math.max(280, Math.min(520, start.width + start.pointerX - event.clientX)));
    announceLayoutChange();
  }

  function finishActivityResize(event: ReactPointerEvent<HTMLButtonElement>) {
    activityResizeRef.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <main
      className="hero-visual-theme chat-shell-layout app-shell"
      data-activity-open={String(activityOpen)}
      data-sidebar-collapsed={String(!sidebarOpen)}
      data-workflow-gui={payload.appId}
    >
      <Group
        className="shell-panels"
        id="workflow-shell-panels"
        onLayoutChanged={announceLayoutChange}
        orientation="horizontal"
      >
        <Panel
          collapsedSize={0}
          collapsible
          defaultSize="300px"
          groupResizeBehavior="preserve-pixel-size"
          id="workflow-sidebar-panel"
          maxSize="360px"
          minSize="240px"
          onResize={onSidebarResize}
          panelRef={sidebarRef}
        >
          <WorkflowSidebar
            activeWorkflowId={payload.defaultWorkflowId}
            appTitle={payload.title}
            items={payload.workflows.map((workflow) => ({
              id: workflow.id,
              label: workflow.title,
              meta: `${workflow.layout.boxes.filter((box) => !box.kind.endsWith("group") && box.kind !== "initial").length} steps`,
            }))}
            onSelectWorkflow={(workflowId: string) => window.dispatchEvent(new CustomEvent("workflow-gui-select-workflow", { detail: { workflowId } }))}
          />
        </Panel>
        <Separator
          aria-label="Resize workflow sidebar"
          className="sidebar-resize-handle"
          disabled={!sidebarOpen}
          id="workflow-sidebar-resize-handle"
        ><span /></Separator>
        <Panel id="workflow-canvas-panel" minSize="420px">
          <div className="chat-shell-main-gutter">
            <Workspace
              activityOpen={activityOpen}
              activityWidth={activityWidth}
              onActivityResize={resizeActivity}
              onActivityResizeEnd={finishActivityResize}
              onActivityResizeStart={beginActivityResize}
              onToggleActivity={() => setActivityOpen((open) => !open)}
              onToggleSidebar={toggleSidebar}
              sidebarOpen={sidebarOpen}
            />
          </div>
        </Panel>
      </Group>
    </main>
  );
}

function Workspace({
  activityOpen,
  activityWidth,
  onActivityResize,
  onActivityResizeEnd,
  onActivityResizeStart,
  onToggleActivity,
  onToggleSidebar,
  sidebarOpen,
}: {
  activityOpen: boolean;
  activityWidth: number;
  onActivityResize: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onActivityResizeEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onActivityResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggleActivity: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}) {
  const workspaceStyle = { "--activity-panel-width": `${activityWidth}px` } as CSSProperties;
  return (
    <section className="workspace">
      <header className="workspace-header">
        <div className="workspace-heading">
          <button id="toggle-sidebar" className="sidebar-toggle-button" type="button" aria-label="Toggle sidebar" aria-expanded={sidebarOpen} title="Toggle sidebar" onClick={onToggleSidebar}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="2" /><path d="M5.5 2v12" /></svg>
          </button>
          <div className="workflow-heading">
            <h1 id="workflow-title" />
            <span id="trigger-label" className="trigger-label">Manual trigger</span>
          </div>
        </div>
        <div className="canvas-actions">
          <button id="zoom-out" type="button" title="Zoom out">−</button>
          <button id="zoom-in" type="button" title="Zoom in">+</button>
          <button id="fit-view" type="button">Fit</button>
          <button
            id="toggle-activity"
            className="activity-toggle-button"
            type="button"
            aria-label={activityOpen ? "Hide activity" : "Show activity"}
            aria-expanded={activityOpen}
            aria-pressed={activityOpen}
            onClick={onToggleActivity}
            title={activityOpen ? "Hide activity" : "Show activity"}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="2" width="13" height="12" rx="2" />
              <path d="M9.5 2v12M11.5 5h1M11.5 8h1M11.5 11h1" />
            </svg>
          </button>
          <button id="run-workflow-header" className="run-header-button" type="button">Run</button>
        </div>
      </header>
      <div className="workspace-body" data-activity-open={String(activityOpen)} style={workspaceStyle}>
        <div id="canvas-viewport" className="canvas-viewport" aria-label="Workflow canvas">
          <div id="canvas-world" className="canvas-world">
            <svg id="canvas-edges" aria-hidden="true" />
            <div id="canvas-boxes" />
          </div>
          <aside id="node-detail" className="node-detail-card hero-scrollbar" aria-label="Selected workflow step" hidden />
          <div className="canvas-help">Drag to pan · Scroll to zoom · Select a step to inspect</div>
          <section id="run-dock" className="run-dock" aria-label="Run workflow" hidden>
            <form id="run-form" className="run-form">
              <textarea id="run-input" aria-label="Prompt input" rows={2} placeholder="Enter the prompt for this workflow" />
              <div className="run-form-footer">
                <span id="run-input-label">Prompt · manual trigger</span>
                <button id="run-submit" type="submit" aria-label="Run workflow">↑</button>
              </div>
            </form>
            <form id="structured-run-form" className="structured-run-form" hidden>
              <div className="trigger-form-heading">
                <div>
                  <strong id="structured-run-title">Workflow input</strong>
                  <span id="structured-run-description" />
                </div>
                <span id="structured-run-progress" />
              </div>
              <div id="structured-run-fields" className="structured-run-fields" />
              <div className="structured-run-actions">
                <button id="structured-run-back" type="button" hidden>Back</button>
                <button id="structured-run-skip" type="button" hidden>Skip</button>
                <button id="structured-run-submit" type="submit">Run workflow</button>
              </div>
            </form>
            <form id="artifact-run-form" className="artifact-run-form" hidden>
              <label id="artifact-drop-zone" className="artifact-drop-zone">
                <input id="artifact-file-input" type="file" hidden />
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" /></svg>
                <strong id="artifact-run-title">Add workflow files</strong>
                <span id="artifact-run-description">Drag files here or click to browse</span>
                <span id="artifact-run-constraints" />
              </label>
              <div id="artifact-file-list" className="artifact-file-list" />
              <button id="artifact-run-submit" className="artifact-run-submit" type="submit">Run workflow</button>
            </form>
            <form id="question-form" className="question-form" hidden>
              <fieldset className="question-fieldset">
                <legend id="question-title" className="question-title" />
                <div id="question-options" className="question-options" />
              </fieldset>
              <input id="question-custom" aria-label="Custom answer" placeholder="Or type a custom answer" />
              <button type="submit">Continue</button>
            </form>
          </section>
        </div>
        <section className="activity-side-panel" aria-hidden={!activityOpen} inert={!activityOpen}>
          <button
            aria-label="Resize workflow activity"
            className="activity-resize-handle"
            onPointerCancel={onActivityResizeEnd}
            onPointerDown={onActivityResizeStart}
            onPointerMove={onActivityResize}
            onPointerUp={onActivityResizeEnd}
            role="separator"
            type="button"
          />
          <aside id="inspector" className="inspector hero-scrollbar" aria-label="Workflow activity" />
        </section>
      </div>
    </section>
  );
}

flushSync(() => createRoot(rootElement).render(<WorkflowGuiShell />));
const appClientPath = "/app.js";
await import(appClientPath);
