import { createWorkflowFieldAmbientScene } from "./ambient.js";
import { clearSvg, hashSeed } from "./dom.js";
import { workflowFieldLayout, workflowFieldModel } from "./geometry.js";
import { createWorkflowFieldGraphScene } from "./graph.js";
import { projectWorkflowFieldVisualState } from "./projection.js";
import { addWorkflowFieldDefinitions } from "./styles.js";
import type {
  WorkflowFieldSvgGraphScene,
  WorkflowFieldSvgInput,
  WorkflowFieldSvgRenderer,
  WorkflowFieldSvgScene,
} from "./types.js";

export function createWorkflowFieldSvgRenderer(
  svg: SVGSVGElement,
  initialInput: WorkflowFieldSvgInput,
): WorkflowFieldSvgRenderer {
  let input = initialInput;
  let ambient!: WorkflowFieldSvgScene;
  let graph!: WorkflowFieldSvgGraphScene;
  let animationFrame = 0;
  let previousFrame = performance.now();
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  function mount() {
    clearSvg(svg);
    const variant = input.variant ?? "full";
    const renderedModel = workflowFieldModel(input.model, variant);
    const layout = workflowFieldLayout(input.model, variant);
    svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${input.model.label} animated workflow`);
    addWorkflowFieldDefinitions(svg);
    ambient = createWorkflowFieldAmbientScene(svg, layout.width, layout.height, hashSeed(input.model.id));
    svg.dataset.variant = variant;
    graph = createWorkflowFieldGraphScene(svg, renderedModel, layout, variant);
    graph.setState(projectWorkflowFieldVisualState(renderedModel, input.run));
  }

  function frame(now: number) {
    const deltaSeconds = Math.min((now - previousFrame) / 1000, 0.05);
    previousFrame = now;
    ambient.update(now, deltaSeconds);
    graph.update(now, deltaSeconds);
    animationFrame = requestAnimationFrame(frame);
  }

  mount();
  if (!reducedMotion) animationFrame = requestAnimationFrame(frame);
  else {
    ambient.update(previousFrame, 0);
    graph.update(previousFrame, 0);
  }

  return {
    dispose() {
      cancelAnimationFrame(animationFrame);
      ambient.dispose();
      graph.dispose();
      clearSvg(svg);
    },
    update(nextInput) {
      const modelChanged = nextInput.model.id !== input.model.id;
      const variantChanged = nextInput.variant !== input.variant;
      input = nextInput;
      if (modelChanged || variantChanged) {
        ambient.dispose();
        graph.dispose();
        mount();
        return;
      }
      const renderedModel = workflowFieldModel(input.model, input.variant ?? "full");
      graph.setState(projectWorkflowFieldVisualState(renderedModel, input.run));
    },
  };
}
