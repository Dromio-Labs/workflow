const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Readonly<Record<string, number | string>>,
  parent?: SVGElement,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  parent?.appendChild(element);
  return element;
}

export function svgText(
  parent: SVGElement,
  x: number,
  y: number,
  text: string,
  attributes: Readonly<Record<string, number | string>> = {},
) {
  const element = svgElement("text", { x, y, ...attributes }, parent);
  element.textContent = text;
  return element;
}

export function clearSvg(svg: SVGSVGElement) {
  svg.replaceChildren();
}

export function clamp(value: number, minimum: number, maximum: number) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

export function easeOut(value: number) {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3);
}

export function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(random: () => number, minimum: number, maximum: number) {
  return minimum + random() * (maximum - minimum);
}

export function splinePath(points: readonly { x: number; y: number }[]) {
  if (points.length === 0) return "";
  let path = `M${points[0]!.x.toFixed(1)},${points[0]!.y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    path += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${(p1.y + (p2.y - p0.y) / 6).toFixed(1)}`;
    path += ` ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${(p2.y - (p3.y - p1.y) / 6).toFixed(1)}`;
    path += ` ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return path;
}
