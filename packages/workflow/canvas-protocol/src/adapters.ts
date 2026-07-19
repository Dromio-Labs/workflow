import type { WorkflowRenderModel } from "./render.js";

export type WorkflowRendererTarget =
  | "ansi"
  | "custom"
  | "json"
  | "mermaid"
  | "opentui"
  | "react";

export type WorkflowRendererAdapter<Options, Output> = {
  readonly id: string;
  readonly target: WorkflowRendererTarget;
  render(model: WorkflowRenderModel, options?: Options): Output;
};
