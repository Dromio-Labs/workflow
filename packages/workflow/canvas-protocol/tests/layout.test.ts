import { describe, expect, test } from "bun:test";
import {
  computeWorkflowRenderLayout,
  workflowNodeRanks,
  workflowRenderLayoutProfiles,
  type WorkflowRenderModel,
} from "../src/index.js";

function model(): WorkflowRenderModel {
  return {
    edges: [
      { id: "start-a", metadata: {}, semantic: { branch: { id: "a", label: "A" }, role: "branch" }, source: "start", target: "a" },
      { id: "start-b", metadata: {}, semantic: { branch: { id: "b", label: "B" }, role: "branch" }, source: "start", target: "b" },
      { id: "a-deep", metadata: {}, semantic: { role: "sequence" }, source: "a", target: "deep" },
      { id: "deep-join", metadata: {}, semantic: { policy: "all", role: "join" }, source: "deep", target: "join" },
      { id: "b-join", metadata: {}, semantic: { policy: "all", role: "join" }, source: "b", target: "join" },
      { id: "join-end", metadata: {}, semantic: { role: "sequence" }, source: "join", target: "end" },
    ],
    id: "fork",
    label: "Fork",
    loops: [],
    nodes: ["start", "a", "b", "deep", "join", "end"].map((id) => ({
      id,
      kind: id === "start" ? "trigger" as const : id === "end" ? "end" as const : "step" as const,
      label: id,
      metadata: {},
      ports: [],
      semantic: id === "start"
        ? { inputMode: "none" as const, role: "trigger" as const, triggerType: "manual" as const }
        : id === "end"
          ? { outcome: "result" as const, role: "terminal" as const }
          : { role: "action" as const },
    })),
    readOnly: true,
    warnings: [],
  };
}

describe("workflow canvas layout", () => {
  test("places joins after the deepest incoming branch", () => {
    const ranks = workflowNodeRanks(model());
    expect(ranks.get("a")).toBe(1);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("deep")).toBe(2);
    expect(ranks.get("join")).toBe(3);
  });

  test("is deterministic and routes fork and join buses orthogonally", () => {
    const first = computeWorkflowRenderLayout(model(), workflowRenderLayoutProfiles.web);
    const second = computeWorkflowRenderLayout(model(), workflowRenderLayoutProfiles.web);
    expect(second).toEqual(first);
    expect(first.edges.filter((edge) => edge.kind === "fork")).toHaveLength(2);
    expect(first.edges.some((edge) => edge.kind === "join")).toBe(true);
    for (const edge of first.edges) {
      for (let index = 1; index < edge.points.length; index += 1) {
        const previous = edge.points[index - 1]!;
        const point = edge.points[index]!;
        expect(previous.x === point.x || previous.y === point.y).toBe(true);
      }
    }
  });

  test("uses renderer measurements without storing them in the model", () => {
    const layout = computeWorkflowRenderLayout(model(), workflowRenderLayoutProfiles.web, {
      a: { height: 80, width: 320 },
    });
    expect(layout.boxes.find((box) => box.id === "a")?.width).toBe(320);
    expect("position" in model().nodes[0]!).toBe(false);
  });

  test("excludes loop back-edges from ranks", () => {
    const loopModel = model();
    loopModel.loops = [{ backTo: "a", end: "deep", id: "retry", start: "a" }];
    loopModel.edges.push({ id: "deep-a", metadata: {}, semantic: { role: "loop" }, source: "deep", target: "a" });

    const ranks = workflowNodeRanks(loopModel);

    expect(ranks.get("a")).toBe(1);
    expect(ranks.get("deep")).toBe(2);
  });

  test("contains recursively laid-out child nodes without overlap", () => {
    const child = model();
    const parent = model();
    const parentNode = parent.nodes.find((node) => node.id === "a")!;
    parentNode.kind = "workflow";
    parentNode.childWorkflow = {
      id: child.id,
      label: child.label,
      model: child,
    };

    const layout = computeWorkflowRenderLayout(parent);
    const group = layout.boxes.find((box) => box.kind === "child-group")!;
    const children = layout.boxes.filter((box) => box.parentId === group.id);

    expect(children.length).toBeGreaterThan(0);
    for (const box of children) {
      expect(box.x).toBeGreaterThanOrEqual(group.x);
      expect(box.y).toBeGreaterThanOrEqual(group.y);
      expect(box.x + box.width).toBeLessThanOrEqual(group.x + group.width);
      expect(box.y + box.height).toBeLessThanOrEqual(group.y + group.height);
    }
    const nodeBoxes = children.filter((box) => !box.kind.endsWith("group"));
    for (const [index, left] of nodeBoxes.entries()) {
      for (const right of nodeBoxes.slice(index + 1)) {
        const overlaps = left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  test("scales geometry through renderer profiles", () => {
    const web = computeWorkflowRenderLayout(model(), workflowRenderLayoutProfiles.web);
    const terminal = computeWorkflowRenderLayout(model(), workflowRenderLayoutProfiles.terminal);

    expect(web.boxes.map((box) => box.id)).toEqual(terminal.boxes.map((box) => box.id));
    expect(web.boxes[0]?.width).not.toBe(terminal.boxes[0]?.width);
  });

  test("preserves explicit router and merge edge semantics", () => {
    const routerModel: WorkflowRenderModel = {
      edges: [
        { id: "route-note", label: "note", metadata: {}, semantic: { role: "route", route: { id: "note", label: "note", selected: true } }, source: "router", target: "note" },
        { id: "route-voice", label: "voice", metadata: {}, semantic: { role: "route", route: { id: "voice", label: "voice", selected: false } }, source: "router", target: "voice" },
        { id: "merge-note", metadata: {}, semantic: { mode: "exclusive", role: "merge" }, source: "note", target: "done" },
        { id: "merge-voice", metadata: {}, semantic: { mode: "exclusive", role: "merge" }, source: "voice", target: "done" },
      ],
      id: "router",
      label: "Router",
      loops: [],
      nodes: ["router", "note", "voice", "done"].map((id) => ({
        id,
        kind: "step" as const,
        label: id,
        metadata: {},
        ports: [],
        semantic: { role: "action" },
      })),
      readOnly: true,
      warnings: [],
    };

    const layout = computeWorkflowRenderLayout(routerModel, workflowRenderLayoutProfiles.web);
    expect(layout.edges.filter((edge) => edge.kind === "route")).toHaveLength(2);
    expect(layout.edges.filter((edge) => edge.kind === "merge")).toHaveLength(2);
    expect(layout.edges.find((edge) => edge.id === "route-note")?.label).toBe("note");
  });
});
