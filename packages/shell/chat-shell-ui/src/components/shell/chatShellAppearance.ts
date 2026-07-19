import type {CSSProperties} from "react";

import type {ChatShellAppearance} from "../../contracts/chatShellManifest";

export type ResolvedChatShellAppearance = {
  readonly attributes: {
    readonly "data-chat-shell-color-mode": "dark" | "light" | "system";
    readonly "data-chat-shell-density": "compact" | "comfortable";
    readonly "data-chat-shell-radius": "default" | "sharp" | "rounded";
    readonly "data-chat-shell-type-scale": "default" | "compact" | "large";
  };
  readonly frameStyle: CSSProperties;
  readonly rootStyle: CSSProperties;
  readonly viewportStyle: CSSProperties;
};

type CssVariableStyle = CSSProperties & Record<`--${string}`, string | number | undefined>;

export const defaultChatShellAppearance = {
  colorMode: "dark",
  density: "comfortable",
  radius: {
    frame: "1rem",
    frameSm: "20px",
    mode: "default",
    scale: 1,
  },
  shell: {
    viewportHeight: "calc(100dvh - 1rem)",
    viewportHeightLg: "min(48rem, calc(100dvh - 3rem))",
    viewportHeightMd: "min(36rem, calc(100dvh - 3rem))",
    viewportHeightSm: "min(620px, calc(100dvh - 3rem))",
    viewportMaxWidth: "80rem",
  },
  tokens: {},
  typography: {
    scale: "default",
  },
} satisfies Required<Pick<ChatShellAppearance, "colorMode" | "density">> & {
  readonly radius: Required<NonNullable<ChatShellAppearance["radius"]>>;
  readonly shell: Required<Pick<NonNullable<ChatShellAppearance["shell"]>, "viewportHeight" | "viewportHeightLg" | "viewportHeightMd" | "viewportHeightSm" | "viewportMaxWidth">>;
  readonly tokens: NonNullable<ChatShellAppearance["tokens"]>;
  readonly typography: Required<Pick<NonNullable<ChatShellAppearance["typography"]>, "scale">>;
};

const tokenVariableMap = {
  accent: ["--color-accent", "--accent", "--chat-shell-color-accent"],
  accentForeground: ["--color-accent-foreground", "--accent-foreground", "--chat-shell-color-accent-foreground"],
  background: ["--color-background", "--background", "--chat-shell-color-background"],
  backgroundAlt: ["--color-background-alt", "--background-alt", "--chat-shell-color-background-alt"],
  brand: ["--color-brand", "--brand", "--ring", "--chat-shell-color-brand"],
  border: ["--color-border", "--border", "--chat-shell-color-border"],
  foreground: ["--color-foreground", "--foreground", "--chat-shell-color-foreground"],
  foregroundSubtle: ["--color-foreground-subtle", "--foreground-subtle", "--chat-shell-color-foreground-subtle"],
  inputBorderFocused: ["--color-input-border-focused", "--input-border-focused", "--chat-shell-color-input-border-focused"],
  surface: ["--color-surface", "--surface", "--chat-shell-color-surface"],
  surfaceHover: ["--color-surface-hover", "--surface-hover", "--chat-shell-color-surface-hover"],
  windowBg: ["--color-window-bg", "--window-bg", "--chat-shell-color-window-bg"],
  windowBorder: ["--color-window-border", "--window-border", "--chat-shell-color-window-border"],
  windowShadow: ["--color-window-shadow", "--chat-shell-color-window-shadow"],
} satisfies Record<keyof NonNullable<ChatShellAppearance["tokens"]>, readonly string[]>;

export function getChatShellAppearance(appearance: ChatShellAppearance | undefined): ResolvedChatShellAppearance {
  const colorMode = appearance?.colorMode ?? defaultChatShellAppearance.colorMode;
  const density = appearance?.density ?? defaultChatShellAppearance.density;
  const radiusMode = appearance?.radius?.mode ?? defaultChatShellAppearance.radius.mode;
  const typeScale = appearance?.typography?.scale ?? defaultChatShellAppearance.typography.scale;
  const rootStyle: CssVariableStyle = {
    "--chat-shell-density-scale": density === "compact" ? 0.92 : 1,
    "--chat-shell-radius-scale": appearance?.radius?.scale ?? defaultChatShellAppearance.radius.scale,
    "--chat-shell-type-scale": typeScale === "compact" ? 0.95 : typeScale === "large" ? 1.08 : 1,
  };
  const viewportStyle: CssVariableStyle = {};
  const frameStyle: CssVariableStyle = {};

  assign(rootStyle, "--chat-shell-font-family", appearance?.typography?.fontFamily);
  assign(rootStyle, "--chat-shell-mono-font-family", appearance?.typography?.monoFontFamily);
  assign(rootStyle, "--chat-shell-base-font-size", appearance?.typography?.baseFontSize);

  assign(viewportStyle, "--chat-shell-viewport-height", appearance?.shell?.viewportHeight ?? defaultChatShellAppearance.shell.viewportHeight);
  assign(viewportStyle, "--chat-shell-viewport-height-sm", appearance?.shell?.viewportHeightSm ?? defaultChatShellAppearance.shell.viewportHeightSm);
  assign(viewportStyle, "--chat-shell-viewport-height-md", appearance?.shell?.viewportHeightMd ?? defaultChatShellAppearance.shell.viewportHeightMd);
  assign(viewportStyle, "--chat-shell-viewport-height-lg", appearance?.shell?.viewportHeightLg ?? defaultChatShellAppearance.shell.viewportHeightLg);
  assign(viewportStyle, "--chat-shell-viewport-max-width", appearance?.shell?.viewportMaxWidth ?? defaultChatShellAppearance.shell.viewportMaxWidth);
  assign(viewportStyle, "--chat-shell-viewport-max-height", appearance?.shell?.viewportMaxHeight);
  assign(viewportStyle, "--chat-shell-viewport-min-height", appearance?.shell?.viewportMinHeight);

  assign(frameStyle, "--chat-shell-frame-radius", resolveFrameRadius(appearance));
  assign(frameStyle, "--chat-shell-frame-radius-sm", appearance?.radius?.frameSm ?? defaultChatShellAppearance.radius.frameSm);

  for (const [tokenName, variableNames] of Object.entries(tokenVariableMap)) {
    const value = appearance?.tokens?.[tokenName as keyof NonNullable<ChatShellAppearance["tokens"]>];

    for (const variableName of variableNames) {
      assign(rootStyle, variableName, value);
    }
  }

  return {
    attributes: {
      "data-chat-shell-color-mode": colorMode,
      "data-chat-shell-density": density,
      "data-chat-shell-radius": radiusMode,
      "data-chat-shell-type-scale": typeScale,
    },
    frameStyle,
    rootStyle,
    viewportStyle,
  };
}

function resolveFrameRadius(appearance: ChatShellAppearance | undefined) {
  if (appearance?.radius?.frame) {
    return appearance.radius.frame;
  }

  const mode = appearance?.radius?.mode ?? defaultChatShellAppearance.radius.mode;
  if (mode === "sharp") {
    return "0px";
  }
  if (mode === "rounded") {
    return "24px";
  }

  return defaultChatShellAppearance.radius.frame;
}

function assign(style: CssVariableStyle, variableName: string, value: string | number | undefined) {
  if (value !== undefined) {
    style[variableName as `--${string}`] = value;
  }
}
