import type { WorkflowRenderLayoutProfile } from "./types.js";

export const workflowRenderLayoutProfiles = {
  dashboard: layoutProfile({
    direction: "LR",
    gap: { x: 80, y: 96 },
    minCanvasSize: { height: 480, width: 960 },
    nodeSize: { height: 104, width: 240 },
    start: { x: 36, y: 30 },
  }),
  reactPreview: layoutProfile({
    direction: "TB",
    gap: { x: 72, y: 56 },
    minCanvasSize: { height: 240, width: 760 },
    nodeSize: { height: 76, width: 184 },
    start: { x: 288, y: 0 },
  }),
  terminal: layoutProfile({
    direction: "TB",
    gap: { x: 8, y: 4 },
    minCanvasSize: { height: 12, width: 72 },
    nodeSize: { height: 3, width: 24 },
    start: { x: 0, y: 0 },
  }),
  web: layoutProfile({
    direction: "LR",
    gap: { x: 80, y: 112 },
    minCanvasSize: { height: 560, width: 960 },
    nodeSize: { height: 192, width: 192 },
    start: { x: 80, y: 96 },
  }),
} as const satisfies Record<string, WorkflowRenderLayoutProfile>;

function layoutProfile(
  input: Omit<WorkflowRenderLayoutProfile, "child" | "routeClearance"> & {
    child?: Partial<WorkflowRenderLayoutProfile["child"]>;
    routeClearance?: number;
  },
): WorkflowRenderLayoutProfile {
  return {
    ...input,
    child: {
      groupGap: input.child?.groupGap ?? Math.max(24, Math.round(input.gap.y * 0.65)),
      headerHeight: input.child?.headerHeight ?? Math.max(12, Math.round(input.nodeSize.height * 0.32)),
      loopInset: input.child?.loopInset ?? Math.max(6, Math.round(input.nodeSize.width * 0.08)),
      padding: input.child?.padding ?? Math.max(10, Math.round(input.nodeSize.width * 0.14)),
    },
    routeClearance: input.routeClearance ?? Math.max(4, Math.round(Math.min(input.gap.x, input.gap.y) * 0.2)),
  };
}
