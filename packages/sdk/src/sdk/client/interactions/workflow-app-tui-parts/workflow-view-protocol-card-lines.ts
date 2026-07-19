import { THEME } from "./style.js";
import type { ProtocolLine } from "./workflow-view-protocol-lines.js";

const CARD_INNER_WIDTH = 36;
const CARD_CONTENT_WIDTH = CARD_INNER_WIDTH - 2;

export type CardLine = {
  fg: string;
  text: string;
};

export function terminalCard(input: {
  accent: string;
  badge?: string;
  body: CardLine[];
  title: string;
}): ProtocolLine[] {
  return [
    cardBorderLine("top", input.title, input.accent, input.badge),
    ...input.body.map((line) => cardContentLine(line.text, line.fg)),
    cardBorderLine("bottom", undefined, input.accent),
  ];
}

export function dividerCardLines(fg: string): CardLine[] {
  return [{ fg, text: "─".repeat(CARD_CONTENT_WIDTH) }];
}

export function chipLine(values: Array<string | undefined>): CardLine {
  const chips = values
    .filter((value): value is string => Boolean(value))
    .map((value) => `[${value}]`);
  return {
    fg: THEME.info,
    text: chips.join(" "),
  };
}

export function buttonLine(primary: string, secondary: string): CardLine {
  return {
    fg: THEME.success,
    text: `[ ${primary} ]  [ ${secondary} ]`,
  };
}

export function wrappedCardText(value: string, fg: string): CardLine[] {
  return wrapTextToWidth(value, CARD_CONTENT_WIDTH).map((text) => ({ fg, text }));
}

export function intersperseBlankLines(groups: ProtocolLine[][]): ProtocolLine[] {
  return groups.flatMap((lines, index) => index === 0 ? lines : [{ text: "" }, ...lines]);
}

function cardBorderLine(
  edge: "bottom" | "top",
  title: string | undefined,
  fg: string,
  badge?: string,
): ProtocolLine {
  if (edge === "bottom") {
    return { fg, text: `└${"─".repeat(CARD_INNER_WIDTH)}┘` };
  }
  const left = title ? `─ ${title} ` : "─";
  const right = badge ? ` ${badge} ─` : "─";
  const fillerWidth = Math.max(0, CARD_INNER_WIDTH - left.length - right.length);
  return {
    fg,
    text: `┌${left}${"─".repeat(fillerWidth)}${right}┐`,
  };
}

function cardContentLine(text: string, fg: string): ProtocolLine {
  return {
    fg,
    text: `│ ${padCardContent(text)} │`,
  };
}

function padCardContent(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const clipped = compact.length > CARD_CONTENT_WIDTH
    ? `${compact.slice(0, CARD_CONTENT_WIDTH - 1)}…`
    : compact;
  return clipped.padEnd(CARD_CONTENT_WIDTH, " ");
}

function wrapTextToWidth(value: string, width: number): string[] {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= width) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    const breakAt = remaining.lastIndexOf(" ", width);
    const end = breakAt > Math.floor(width / 2) ? breakAt : width;
    lines.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) lines.push(remaining);
  return lines;
}
