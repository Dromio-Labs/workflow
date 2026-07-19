import { svgElement } from "./dom.js";

export function addWorkflowFieldDefinitions(svg: SVGSVGElement) {
  const defs = svgElement("defs", {}, svg);
  const glow = svgElement("radialGradient", { id: "workflow-field-glow" }, defs);
  svgElement("stop", { offset: 0, "stop-color": "#8183f0", "stop-opacity": 0.5 }, glow);
  svgElement("stop", { offset: 0.6, "stop-color": "#8183f0", "stop-opacity": 0.14 }, glow);
  svgElement("stop", { offset: 1, "stop-color": "#8183f0", "stop-opacity": 0 }, glow);
  const style = svgElement("style", {}, defs);
  style.textContent = workflowFieldStyles;
}

const workflowFieldStyles = `
.workflow-field-grid line{stroke:rgba(165,180,252,.026);stroke-width:1}
.workflow-field-ambient path{stroke:#6366f1;stroke-opacity:.042;stroke-width:1}
.workflow-field-ambient circle{fill:#a5b4fc;fill-opacity:.17}
.workflow-field-edge-base{fill:none;stroke:#9497ff;stroke-opacity:.46;stroke-width:1.35}
.workflow-field-edge-flow{fill:none;stroke:#b0b2ff;stroke-opacity:.5;stroke-width:1.3;stroke-linecap:round;stroke-dasharray:2 13}
.workflow-field-edge-label{fill:#d5d8e7;font:600 10px ui-monospace,Menlo,Consolas,monospace}
.workflow-field-edge[data-selected=true] .workflow-field-edge-base{stroke:#a5b4fc;stroke-opacity:.9;stroke-width:2.4}
.workflow-field-edge[data-selected=true] .workflow-field-edge-flow{stroke-opacity:.8}
.workflow-field-edge[data-semantic=merge] .workflow-field-edge-base{stroke-dasharray:4 3}
.workflow-field-edge[data-status=completed] .workflow-field-edge-base{stroke:#3ddc97;stroke-opacity:.28}
.workflow-field-edge[data-status=completed] .workflow-field-edge-flow{stroke:#3ddc97;stroke-opacity:.4}
.workflow-field-edge[data-status=failed] .workflow-field-edge-base,.workflow-field-edge[data-status=failed] .workflow-field-edge-flow{stroke:#fb7185;stroke-opacity:.52}
.workflow-field-node{color:#a5b4fc}
.workflow-field-node-shape{fill:#0b0c11;stroke:currentColor;stroke-opacity:.82;stroke-width:1.35}
.workflow-field-node-label{fill:#d5d8e7;fill-opacity:.94;font:11px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.3px}
.workflow-field-node-ring{fill:none;stroke:#8183f0;stroke-opacity:0;stroke-width:1.4;stroke-dasharray:4 7}
.workflow-field-node-glow{fill:url(#workflow-field-glow);opacity:0}
.workflow-field-node-core{fill:#a5b4fc;fill-opacity:0}
.workflow-field-node[data-kind=trigger] .workflow-field-node-shape{fill:#0a0b0f;stroke:#8183f0;stroke-opacity:.5}
.workflow-field-node[data-kind=trigger] .workflow-field-node-label{fill:#a5b4fc;fill-opacity:.84;font-size:8px;text-anchor:middle}
.workflow-field-node[data-kind=initial] .workflow-field-node-shape{fill:#a5b4fc;fill-opacity:.58;stroke:none}
.workflow-field-node[data-kind=end] .workflow-field-node-shape{stroke-width:1.5}
.workflow-field-node[data-status=running]{color:#a5b4fc}
.workflow-field-node[data-status=running] .workflow-field-node-shape{stroke-opacity:.9}
.workflow-field-node[data-status=running] .workflow-field-node-ring{stroke-opacity:.76}
.workflow-field-node[data-status=running] .workflow-field-node-glow{opacity:.9}
.workflow-field-node[data-status=running] .workflow-field-node-core{fill-opacity:1}
.workflow-field-node[data-status=waiting]{color:#f0b45e}
.workflow-field-node[data-status=waiting] .workflow-field-node-ring{stroke:#f0b45e;stroke-opacity:.92;stroke-dasharray:3 5}
.workflow-field-node[data-status=waiting] .workflow-field-node-glow{opacity:.5}
.workflow-field-node[data-status=completed]{color:#3ddc97}
.workflow-field-node[data-status=completed] .workflow-field-node-shape{stroke-opacity:.92}
.workflow-field-node[data-status=failed]{color:#fb7185}
.workflow-field-node[data-status=failed] .workflow-field-node-shape{stroke-opacity:1}
svg[data-variant=mini] text,svg[data-variant=mini] .workflow-field-hud{display:none}
.workflow-field-container rect{fill:rgba(129,131,240,.026);stroke:#9fa1ff;stroke-opacity:.38;stroke-width:1.15;stroke-dasharray:3 6}
.workflow-field-container text{fill:#b8baff;fill-opacity:.78;font:600 9px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.8px;text-transform:uppercase}
.workflow-field-pulse{fill:#a5b4fc;fill-opacity:.92}
.workflow-field-evaluation-track{fill:none;stroke:#8183f0;stroke-opacity:.12;stroke-width:1}
.workflow-field-evaluation-arc{fill:none;stroke:#8183f0;stroke-linecap:round;stroke-width:1.8}
.workflow-field-evaluation-threshold{stroke:#a5b4fc;stroke-opacity:.55;stroke-width:1}
.workflow-field-evaluation-score{fill:#a5b4fc;font:10px ui-monospace,Menlo,Consolas,monospace;font-weight:700}
.workflow-field-evaluation-label,.workflow-field-evaluation-attempt{fill:#8183f0;fill-opacity:.72;font:7px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.5px}
.workflow-field-evaluation-attempt{fill-opacity:.46}
.workflow-field-evaluation[data-result=pass] .workflow-field-evaluation-arc{stroke:#3ddc97}
.workflow-field-evaluation[data-result=pass] .workflow-field-evaluation-score,.workflow-field-evaluation[data-result=pass] .workflow-field-evaluation-label{fill:#3ddc97}
.workflow-field-human-card rect{fill:#0a0b0f;fill-opacity:.95;stroke:#f0b45e;stroke-opacity:.56;stroke-width:1}
.workflow-field-human-card line{stroke:#f0b45e;stroke-opacity:.24;stroke-width:1}
.workflow-field-human-title{fill:#f0b45e;font:7.5px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.7px}
.workflow-field-human-copy{fill:#c9cbe0;font:8.5px ui-monospace,Menlo,Consolas,monospace}
.workflow-field-human-time{fill:#f0b45e;fill-opacity:.6;font:7.5px ui-monospace,Menlo,Consolas,monospace;text-anchor:end}
`;
