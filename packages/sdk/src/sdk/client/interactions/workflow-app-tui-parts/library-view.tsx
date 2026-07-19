/** @jsxImportSource @opentui/solid */
import { type WorkflowApp, type WorkflowAppWorkflowDescriptor } from "../workflow-app.js";
import { truncate } from "./string-format.js";
import { THEME, WORKFLOW_LIBRARY_META_WIDTH, WORKFLOW_LIBRARY_TITLE_WIDTH } from "./style.js";
import { type TuiWorkflowAppManifest, type TuiWorkflowAppWorkflowGroup, type WorkflowLibraryAppListing, type WorkflowLibraryViewMode } from "./types.js";
import { workflowDesignNodes } from "./workflow-design.js";
import { type MouseEvent as TuiMouseEvent } from "@opentui/core";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { createMemo, For, Show } from "solid-js";

export function WorkflowLibraryPage(props: {
  app: WorkflowApp;
  appListings: WorkflowLibraryAppListing[];
  compact?: boolean;
  exportMode: boolean;
  exportSelection: ReadonlySet<string>;
  libraryViewMode: WorkflowLibraryViewMode;
  selectedWorkflowId: string;
  workflows: WorkflowAppWorkflowDescriptor[];
  onSelectWorkflow(workflowId: string): void;
  onStartWorkflow(workflowId: string): void;
  onToggleExportSelection(workflowId: string): void;
}) {
  const rows = createMemo(() => props.libraryViewMode === "apps"
    ? workflowLibraryAppRows(props.app, props.workflows, props.appListings)
    : workflowLibraryRows(props.app, props.workflows));
  const appCount = createMemo(() => workflowLibraryVisibleAppCount(props.workflows, props.appListings));
  const countLabel = createMemo(() => props.libraryViewMode === "apps"
    ? `${appCount()} app${appCount() === 1 ? "" : "s"} · ${props.workflows.length} workflow${props.workflows.length === 1 ? "" : "s"}`
    : `${props.workflows.length} workflow${props.workflows.length === 1 ? "" : "s"}`);
  return (
    <box backgroundColor={THEME.background} flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <box backgroundColor={THEME.background} flexDirection="row" height={1}>
        <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>
          {countLabel()}
        </text>
        <text fg={THEME.muted} height={1} truncate={true}>
          {props.exportMode
            ? "/export · space select · enter bundle"
            : props.libraryViewMode === "apps" ? "/view workflows · enter start" : "/view apps · enter start"}
        </text>
      </box>
      <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingTop={props.compact ? 0 : 1}>
        <Show
          when={props.workflows.length > 0}
          fallback={<text fg={THEME.muted} height={1} truncate={true}>No workflows match this filter.</text>}
        >
          <For each={rows()}>
            {(row) => (
              <WorkflowLibraryRow
                row={row}
                exportMode={props.exportMode}
                exportSelected={row.kind === "workflow" && props.exportSelection.has(row.workflow.id)}
                selectedWorkflowId={props.selectedWorkflowId}
                onSelectWorkflow={props.onSelectWorkflow}
                onStartWorkflow={props.onStartWorkflow}
                onToggleExportSelection={props.onToggleExportSelection}
              />
            )}
          </For>
        </Show>
      </box>
    </box>
  );
}

export type WorkflowLibraryRowModel =
  | { description?: string; kind: "group"; title: string; variant?: "app" | "spacer" | "subgroup" }
  | {
    description: string;
    kind: "workflow";
    meta: string;
    workflow: WorkflowAppWorkflowDescriptor;
  };

export function WorkflowLibraryRow(props: {
  exportMode: boolean;
  exportSelected: boolean;
  row: WorkflowLibraryRowModel;
  selectedWorkflowId: string;
  onSelectWorkflow(workflowId: string): void;
  onStartWorkflow(workflowId: string): void;
  onToggleExportSelection(workflowId: string): void;
}) {
  if (props.row.kind === "group") {
    return (
      <box flexDirection="row" height={1}>
        <text
          fg={props.row.variant === "subgroup" ? THEME.muted : THEME.accent}
          height={1}
          truncate={true}
          width={props.row.variant === "subgroup" ? WORKFLOW_LIBRARY_TITLE_WIDTH + 4 : WORKFLOW_LIBRARY_TITLE_WIDTH + WORKFLOW_LIBRARY_META_WIDTH + 4}
        >
          {props.row.title}
        </text>
        <Show when={props.row.description}>
          {(description) => (
            <text fg={THEME.muted} flexGrow={1} height={1} truncate={true}>
              {description()}
            </text>
          )}
        </Show>
      </box>
    );
  }
  const workflow = props.row.workflow;
  const selected = () => workflow.id === props.selectedWorkflowId;
  const handleMouseUp = (event: TuiMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelectWorkflow(workflow.id);
    if (props.exportMode) {
      props.onToggleExportSelection(workflow.id);
      return;
    }
    props.onStartWorkflow(workflow.id);
  };
  return (
    <box
      backgroundColor={selected() ? THEME.selected : undefined}
      border={selected() ? ["left"] : undefined}
      borderColor={selected() ? THEME.borderActive : undefined}
      flexDirection="row"
      height={1}
      onMouseUp={handleMouseUp}
      paddingLeft={selected() ? 1 : 0}
    >
      <text fg={selected() ? THEME.accent : THEME.muted} height={1} truncate={true} width={2}>
        {selected() ? "› " : "  "}
      </text>
      <Show when={props.exportMode}>
        <text fg={props.exportSelected ? THEME.success : THEME.muted} height={1} truncate={true} width={4}>
          {props.exportSelected ? "[x]" : "[ ]"}
        </text>
      </Show>
      <text
        fg={selected() ? THEME.accent : THEME.text}
        height={1}
        truncate={true}
        width={props.exportMode ? Math.max(12, WORKFLOW_LIBRARY_TITLE_WIDTH - 4) : WORKFLOW_LIBRARY_TITLE_WIDTH}
      >
        {workflow.title}
      </text>
      <text fg={THEME.muted} height={1} width={1}> </text>
      <text fg={THEME.info} height={1} truncate={true} width={WORKFLOW_LIBRARY_META_WIDTH}>
        {props.row.meta}
      </text>
      <text fg={THEME.muted} height={1} width={1}> </text>
      <text fg={selected() ? THEME.text : THEME.muted} flexGrow={1} height={1} truncate={true}>
        {props.row.description}
      </text>
    </box>
  );
}

export function workflowLibraryRows(
  app: WorkflowApp,
  workflows: WorkflowAppWorkflowDescriptor[],
): WorkflowLibraryRowModel[] {
  const rows: WorkflowLibraryRowModel[] = [];
  let currentGroup = "";
  for (const workflow of workflows) {
    const group = workflowLibraryGroup(workflow);
    if (group !== currentGroup) {
      if (rows.length > 0) rows.push({ kind: "group", title: "", variant: "spacer" });
      rows.push({ kind: "group", title: group });
      currentGroup = group;
    }
    rows.push(workflowLibraryWorkflowRow(app, workflow));
  }
  return rows;
}

export function workflowLibraryAppRows(
  app: WorkflowApp,
  workflows: WorkflowAppWorkflowDescriptor[],
  appListings: WorkflowLibraryAppListing[],
): WorkflowLibraryRowModel[] {
  const rows: WorkflowLibraryRowModel[] = [];
  const visibleWorkflowIds = new Set(workflows.map((workflow) => workflow.id));
  const listedWorkflowIds = new Set<string>();
  for (const listing of appListings) {
    const visibleGroups = listing.groups
      .map((group) => ({
        ...group,
        workflows: group.workflows.filter((workflow) => visibleWorkflowIds.has(workflow.id)),
      }))
      .filter((group) => group.workflows.length > 0);
    if (visibleGroups.length === 0) continue;
    if (rows.length > 0) rows.push({ kind: "group", title: "", variant: "spacer" });
    rows.push({
      description: listing.description,
      kind: "group",
      title: listing.label,
      variant: "app",
    });
    for (const group of visibleGroups) {
      if (visibleGroups.length > 1) {
        rows.push({ kind: "group", title: "", variant: "spacer" });
        rows.push({
          kind: "group",
          title: `  ${group.label}`,
          variant: "subgroup",
        });
      }
      for (const workflow of group.workflows) {
        listedWorkflowIds.add(workflow.id);
        rows.push(workflowLibraryWorkflowRow(app, workflow));
      }
    }
  }
  const unlistedWorkflows = workflows.filter((workflow) => !listedWorkflowIds.has(workflow.id));
  if (unlistedWorkflows.length > 0) {
    if (rows.length > 0) rows.push({ kind: "group", title: "", variant: "spacer" });
    rows.push({ kind: "group", title: "Workflows" });
    for (const workflow of unlistedWorkflows) rows.push(workflowLibraryWorkflowRow(app, workflow));
  }
  return rows;
}

export function workflowLibraryWorkflowRow(
  app: WorkflowApp,
  workflow: WorkflowAppWorkflowDescriptor,
): WorkflowLibraryRowModel {
  const graph = app.graph(workflow.id);
  return {
    description: workflow.description ?? `${workflowDesignNodes(graph).length}-node workflow`,
    kind: "workflow",
    meta: `${workflowDesignNodes(graph).length} nodes`,
    workflow,
  };
}

export function workflowLibraryGroup(workflow: WorkflowAppWorkflowDescriptor) {
  if (workflow.id === "goal-pursuit") return "Goal";
  if (workflow.id === "planner" || workflow.id.includes("author")) return "Planning";
  if (workflow.id === "ingest") return "Ingest";
  if (workflow.id.startsWith("process-")) return "Processing";
  if (workflow.id === "search" || workflow.id.startsWith("search-")) return "Search";
  return "Workflows";
}

export function workflowLibraryAppListings(
  manifests: TuiWorkflowAppManifest[],
  workflows: WorkflowAppWorkflowDescriptor[],
): WorkflowLibraryAppListing[] {
  const workflowById = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  return manifests
    .map((manifest) => ({
      description: manifest.description,
      groups: manifest.workflowGroups
        .map((group) => ({
          id: group.id,
          label: group.label,
          workflows: group.workflows
            .map((workflowId) => workflowById.get(workflowId))
            .filter((workflow): workflow is WorkflowAppWorkflowDescriptor => Boolean(workflow)),
        }))
        .filter((group) => group.workflows.length > 0),
      id: manifest.id,
      label: manifest.label,
    }))
    .filter((listing) => listing.groups.length > 0);
}

export function workflowLibraryVisibleAppCount(
  workflows: WorkflowAppWorkflowDescriptor[],
  appListings: WorkflowLibraryAppListing[],
) {
  const visibleWorkflowIds = new Set(workflows.map((workflow) => workflow.id));
  return appListings.filter((listing) =>
    listing.groups.some((group) => group.workflows.some((workflow) => visibleWorkflowIds.has(workflow.id)))
  ).length;
}

export function workflowLibrarySelectableWorkflowIds(
  workflows: WorkflowAppWorkflowDescriptor[],
  appListings: WorkflowLibraryAppListing[],
  mode: WorkflowLibraryViewMode,
) {
  if (mode === "workflows") return workflows.map((workflow) => workflow.id);
  const visibleWorkflowIds = new Set(workflows.map((workflow) => workflow.id));
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (workflowId: string) => {
    if (!visibleWorkflowIds.has(workflowId) || seen.has(workflowId)) return;
    seen.add(workflowId);
    ids.push(workflowId);
  };
  for (const listing of appListings) {
    for (const group of listing.groups) {
      for (const workflow of group.workflows) push(workflow.id);
    }
  }
  for (const workflow of workflows) push(workflow.id);
  return ids;
}

export function workflowLibraryAppQueryWorkflowIds(
  appListings: WorkflowLibraryAppListing[],
  workflows: WorkflowAppWorkflowDescriptor[],
  query: string,
) {
  const matches = new Set<string>();
  for (const workflow of workflows) {
    if (
      workflow.id.toLowerCase().includes(query) ||
      workflow.title.toLowerCase().includes(query) ||
      workflow.description?.toLowerCase().includes(query)
    ) {
      matches.add(workflow.id);
    }
  }
  for (const listing of appListings) {
    const appMatches = textMatches(query, listing.id, listing.label, listing.description);
    for (const group of listing.groups) {
      const groupMatches = appMatches || textMatches(query, group.id, group.label);
      if (!groupMatches) continue;
      for (const workflow of group.workflows) matches.add(workflow.id);
    }
  }
  return matches;
}

export function textMatches(query: string, ...values: Array<string | undefined>) {
  return values.some((value) => value?.toLowerCase().includes(query));
}

export function readWorkflowAppManifests(rootDir: string): TuiWorkflowAppManifest[] {
  const appsDir = path.join(rootDir, ".dromio", "apps");
  if (!existsSync(appsDir) || !statSync(appsDir).isDirectory()) return [];
  try {
    return readdirSync(appsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".app.json"))
      .map((entry) => readWorkflowAppManifest(path.join(appsDir, entry.name)))
      .filter((manifest): manifest is TuiWorkflowAppManifest => Boolean(manifest))
      .sort((left, right) => left.label.localeCompare(right.label));
  } catch {
    return [];
  }
}

export function readWorkflowAppManifest(filePath: string): TuiWorkflowAppManifest | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) return undefined;
    if (parsed.version !== 1) return undefined;
    if (typeof parsed.id !== "string" || typeof parsed.label !== "string") return undefined;
    if (typeof parsed.defaultWorkflow !== "string") return undefined;
    if (!Array.isArray(parsed.workflowGroups)) return undefined;
    const workflowGroups = parsed.workflowGroups
      .map(parseWorkflowAppWorkflowGroup)
      .filter((group): group is TuiWorkflowAppWorkflowGroup => Boolean(group));
    if (workflowGroups.length === 0) return undefined;
    return {
      defaultWorkflow: parsed.defaultWorkflow,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      id: parsed.id,
      label: parsed.label,
      workflowGroups,
    };
  } catch {
    return undefined;
  }
}

export function parseWorkflowAppWorkflowGroup(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || typeof value.label !== "string") return undefined;
  if (!Array.isArray(value.workflows)) return undefined;
  const workflows = value.workflows.filter((workflow): workflow is string => typeof workflow === "string");
  if (workflows.length === 0) return undefined;
  return {
    id: value.id,
    label: value.label,
    workflows,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
