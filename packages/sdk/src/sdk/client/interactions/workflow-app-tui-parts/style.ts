import { SyntaxStyle } from "@opentui/core";
import { release } from "node:os";

export const TUI_NAME = "dromio";

export const ANSI_RESET = "\x1b[0m";

export const ANSI_LOGO_LEFT = {
  bg: "\x1b[48;5;235m",
  fg: "\x1b[90m",
  shadow: "\x1b[38;5;235m",
} as const;

export const ANSI_LOGO_RIGHT = {
  bg: "\x1b[48;5;238m",
  fg: ANSI_RESET,
  shadow: "\x1b[38;5;238m",
} as const;

export type DromioLogoGlyph = "d" | "i" | "m" | "o" | "r";

export const DROMIO_LOGO_GLYPHS: Record<DromioLogoGlyph, readonly [string, string, string, string]> = {
  d: ["    ", "███▄ ", "█  █ ", "███▀ "],
  i: [" ▄ ", "▀█▀", " █ ", "▄█▄"],
  m: ["     ", "█▄ ▄█", "█ ▀ █", "█   █"],
  o: ["    ", "▄▀▀▄", "█  █", "▀▄▄▀"],
  r: ["    ", "█▀▀▄", "█▀▀▄", "█  █"],
};

export const DROMIO_LOGO_ROWS = {
  left: composeDromioLogoRows(["d", "r", "o"]),
  right: composeDromioLogoRows(["m", "i", "o"]),
} as const;

export const THEME = {
  accent: "#c084fc",
  background: "#11111b",
  backgroundAlt: "#181827",
  backgroundPanel: "#1b1b2d",
  border: "#2b3146",
  borderActive: "#c084fc",
  error: "#fca5a5",
  info: "#8bd3ff",
  muted: "#9aa4ba",
  selected: "#24243a",
  success: "#86efac",
  text: "#d9e2f2",
  warning: "#fbbf24",
};

export let workflowTuiSyntaxStyle: SyntaxStyle | undefined;

export function getWorkflowTuiSyntaxStyle() {
  workflowTuiSyntaxStyle ??= SyntaxStyle.fromTheme([
    { scope: ["default"], style: { foreground: THEME.text } },
    { scope: ["comment", "comment.documentation"], style: { foreground: THEME.muted, italic: true } },
    { scope: ["string", "symbol", "character", "character.special"], style: { foreground: THEME.success } },
    { scope: ["number", "boolean", "constant", "float"], style: { foreground: THEME.warning } },
    {
      scope: [
        "keyword",
        "keyword.return",
        "keyword.conditional",
        "keyword.repeat",
        "keyword.coroutine",
        "keyword.import",
        "keyword.export",
        "keyword.modifier",
        "keyword.exception",
      ],
      style: { foreground: THEME.accent },
    },
    { scope: ["keyword.type", "type", "type.definition", "class", "constructor", "module", "namespace"], style: { foreground: THEME.info } },
    { scope: ["keyword.function", "function", "function.method", "function.method.call", "function.call"], style: { foreground: THEME.info } },
    { scope: ["operator", "keyword.operator", "keyword.conditional.ternary", "punctuation.delimiter", "punctuation.special"], style: { foreground: THEME.info } },
    { scope: ["punctuation", "punctuation.bracket"], style: { foreground: THEME.muted } },
    { scope: ["variable", "variable.parameter", "property", "field", "parameter"], style: { foreground: THEME.text } },
    { scope: ["variable.builtin", "type.builtin", "function.builtin", "module.builtin", "constant.builtin"], style: { foreground: THEME.error } },
    { scope: ["markup.heading"], style: { foreground: THEME.accent, bold: true } },
    { scope: ["markup.raw", "markup.raw.block", "markup.raw.inline"], style: { foreground: THEME.success } },
    { scope: ["markup.link", "markup.link.label", "markup.link.url", "label"], style: { foreground: THEME.info, underline: true } },
    { scope: ["markup.list"], style: { foreground: THEME.info } },
    { scope: ["markup.quote"], style: { foreground: THEME.warning, italic: true } },
  ]);
  return workflowTuiSyntaxStyle;
}

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export const LAYOUT = {
  diagramMinVisibleWidth: 160,
  gutter: 2,
  shellPaddingBottom: 1,
  shellPaddingLeft: 2,
  shellPaddingRight: 2,
  shellPaddingTop: 1,
  sidebarMinVisibleWidth: 96,
  sidebarWidth: 40,
};

export const ACTIVE_RUN_SIDE_PANEL_WIDTH = 42;

export const ACTIVE_RUN_PANEL_GAP = 1;

export const ACTIVE_RUN_THREAD_CHROME_WIDTH = 4;

export const WORKFLOW_LIBRARY_TITLE_WIDTH = 26;

export const WORKFLOW_LIBRARY_META_WIDTH = 10;

export const SIDEBAR_LABEL_WIDTH = 11;

export const DIAGRAM_SCROLL_VERTICAL_CONTEXT = 8;

export const DIAGRAM_SCROLL_HORIZONTAL_CONTEXT = 24;

export const ACTIVITY_COLUMNS = {
  index: 6,
  status: 3,
  time: 18,
  type: 18,
  duration: 12,
};

export const WORKFLOW_DETAIL_PREVIEW_CHARS = 34;

export const WORKFLOW_DETAIL_EXPANDED_LINES = 4;

export const WORKFLOW_EXPORT_STEPS = ["app", "registry", "release"] as const;

export function composeDromioLogoRows(glyphs: readonly DromioLogoGlyph[]) {
  return [0, 1, 2, 3].map((rowIndex) => glyphs
    .map((glyph) => DROMIO_LOGO_GLYPHS[glyph][rowIndex])
    .join(" "));
}

export function formatDromioWordmark(options: { color: boolean }) {
  return DROMIO_LOGO_ROWS.left
    .map((left, index) => {
      const right = DROMIO_LOGO_ROWS.right[index] ?? "";
      const rendered = options.color
        ? `${drawDromioLogoLine(left, ANSI_LOGO_LEFT)} ${drawDromioLogoLine(right, ANSI_LOGO_RIGHT)}`
        : `${drawPlainDromioLogoLine(left)} ${drawPlainDromioLogoLine(right)}`;
      return `  ${rendered}`;
    })
    .join("\n");
}

export function drawDromioLogoLine(
  line: string,
  colors: { bg: string; fg: string; shadow: string },
) {
  const parts: string[] = [];
  for (const char of line) {
    if (char === "_") {
      parts.push(colors.bg, " ", ANSI_RESET);
      continue;
    }
    if (char === "^") {
      parts.push(colors.fg, colors.bg, "▀", ANSI_RESET);
      continue;
    }
    if (char === "~") {
      parts.push(colors.shadow, "▀", ANSI_RESET);
      continue;
    }
    if (char === " ") {
      parts.push(" ");
      continue;
    }
    parts.push(colors.fg, char, ANSI_RESET);
  }
  return parts.join("");
}

export function drawPlainDromioLogoLine(line: string) {
  const parts: string[] = [];
  for (const char of line) {
    if (char === "_") parts.push(" ");
    else if (char === "^" || char === "~") parts.push("▀");
    else parts.push(char);
  }
  return parts.join("");
}

export function shouldUseAnsiColor() {
  return Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined);
}
