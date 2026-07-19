import {
  clamp,
  randomBetween,
  seededRandom,
  splinePath,
  svgElement,
} from "./dom.js";
import type { WorkflowFieldSvgScene } from "./types.js";

type Mote = {
  element: SVGCircleElement;
  phase: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

export function createWorkflowFieldAmbientScene(
  svg: SVGSVGElement,
  width: number,
  height: number,
  seed: number,
): WorkflowFieldSvgScene {
  const random = seededRandom(seed);
  const grid = svgElement("g", { class: "workflow-field-grid" }, svg);
  const ambient = svgElement("g", { class: "workflow-field-ambient" }, svg);
  const gap = randomBetween(random, 64, 92);
  for (let x = randomBetween(random, 0, gap); x < width; x += gap * randomBetween(random, 0.82, 1.24)) {
    if (random() < 0.85) svgElement("line", { x1: x, y1: 0, x2: x, y2: height }, grid);
  }
  for (let y = randomBetween(random, 0, gap); y < height; y += gap * randomBetween(random, 0.82, 1.24)) {
    if (random() < 0.85) svgElement("line", { x1: 0, y1: y, x2: width, y2: y }, grid);
  }

  for (let index = 0; index < 8; index += 1) {
    const points: { x: number; y: number }[] = [];
    let x = randomBetween(random, -80, width * 0.18);
    let y = randomBetween(random, 0, height);
    while (x < width + 80) {
      y = clamp(y + randomBetween(random, -170, 170), -40, height + 40);
      points.push({ x, y });
      x += randomBetween(random, 180, 360);
    }
    if (points.length > 2) svgElement("path", { d: splinePath(points), fill: "none" }, ambient);
  }

  const motes: Mote[] = Array.from({ length: 20 }, () => {
    const element = svgElement("circle", {
      r: randomBetween(random, 0.8, 1.8).toFixed(1),
    }, ambient);
    return {
      element,
      phase: randomBetween(random, 0, Math.PI * 2),
      vx: randomBetween(random, -6, 6),
      vy: randomBetween(random, -4, 4),
      x: randomBetween(random, 0, width),
      y: randomBetween(random, 0, height),
    };
  });

  return {
    dispose() {
      grid.remove();
      ambient.remove();
    },
    update(now, deltaSeconds) {
      for (const mote of motes) {
        mote.x += (mote.vx + Math.sin(now / 2400 + mote.phase) * 4) * deltaSeconds;
        mote.y += (mote.vy + Math.cos(now / 2900 + mote.phase) * 3) * deltaSeconds;
        if (mote.x < -10) mote.x = width + 10;
        if (mote.x > width + 10) mote.x = -10;
        if (mote.y < -10) mote.y = height + 10;
        if (mote.y > height + 10) mote.y = -10;
        mote.element.setAttribute("cx", mote.x.toFixed(1));
        mote.element.setAttribute("cy", mote.y.toFixed(1));
      }
    },
  };
}
