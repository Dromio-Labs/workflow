import type { WorkflowRenderModel } from "./render.js";
import { layoutWorkflowModel } from "./layout/model.js";
import { workflowRenderLayoutProfiles } from "./layout/profiles.js";
import type {
  WorkflowRenderLayout,
  WorkflowRenderLayoutProfile,
  WorkflowRenderNodeMeasurements,
} from "./layout/types.js";

export { workflowNodeRanks } from "./layout/ranks.js";
export { workflowRenderLayoutProfiles } from "./layout/profiles.js";
export type * from "./layout/types.js";

export function computeWorkflowRenderLayout(
  model: WorkflowRenderModel,
  profile: WorkflowRenderLayoutProfile = workflowRenderLayoutProfiles.web,
  measurements: WorkflowRenderNodeMeasurements = {},
): WorkflowRenderLayout {
  return {
    ...layoutWorkflowModel(model, profile, measurements),
    profile,
  };
}
