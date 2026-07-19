import type {ChatShellManifest} from "../../contracts/chatShellManifest";
import type {
  ShellControlId,
  ShellPresentationPatch,
  ShellPresentationPolicy,
  ShellPresentationPreferences,
} from "../../contracts/chatShellPresentation";
import {
  resolveShellPresentationControls,
  type ResolvedShellControl,
} from "./resolveShellPresentationControls";

export type {ResolvedShellControl};

export const windowChromeControlIds = [
  "chrome.app-picker",
  "chrome.status",
  "chrome.terminal",
  "chrome.side-panel",
] as const satisfies readonly ShellControlId[];

export type WindowChromeControlId = (typeof windowChromeControlIds)[number];

export type ResolvedWindowChromeControls = Readonly<
  Record<WindowChromeControlId, ResolvedShellControl>
>;

export function resolveWindowChromePresentation({
  manifest,
  patch,
  policy,
  preferences,
}: {
  readonly manifest: ChatShellManifest;
  readonly patch?: ShellPresentationPatch;
  readonly policy?: ShellPresentationPolicy;
  readonly preferences?: ShellPresentationPreferences;
}): ResolvedWindowChromeControls {
  const controls = resolveShellPresentationControls({manifest, patch, policy, preferences});

  return {
    "chrome.app-picker": controls["chrome.app-picker"],
    "chrome.side-panel": controls["chrome.side-panel"],
    "chrome.status": controls["chrome.status"],
    "chrome.terminal": controls["chrome.terminal"],
  };
}
