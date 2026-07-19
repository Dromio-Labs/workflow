import type {ChatShellManifest, ChatShellMenu} from "../../contracts/chatShellManifest";
import type {
  ShellControlCapability,
  ShellControlId,
  ShellPresentationPatch,
  ShellPresentationPolicy,
  ShellPresentationPreferences,
} from "../../contracts/chatShellPresentation";
import {resolveShellControlState, type ResolvedShellControlState} from "./resolveShellPresentation";
import {
  shellControlCatalog,
  shellControlIds,
  type ShellControlDefinition,
} from "./shellControlCatalog";

export type ResolvedShellControl = ShellControlDefinition & {
  readonly resolution: ResolvedShellControlState;
};

export type ResolvedShellControls = Readonly<Record<ShellControlId, ResolvedShellControl>>;

export function resolveShellPresentationControls({
  manifest,
  patch,
  policy,
  preferences,
}: {
  readonly manifest: ChatShellManifest;
  readonly patch?: ShellPresentationPatch;
  readonly policy?: ShellPresentationPolicy;
  readonly preferences?: ShellPresentationPreferences;
}): ResolvedShellControls {
  const contentAvailable = getContentAvailability(manifest);

  return Object.fromEntries(shellControlIds.map((controlId) => {
    const definition = shellControlCatalog[controlId];
    const capability = manifest.capabilities?.controls[controlId] ?? availableCapability;
    const resolvedPolicy = policy?.controls[controlId] ?? definition.policy;

    return [controlId, {
      ...definition,
      policy: resolvedPolicy,
      resolution: resolveShellControlState({
        capability,
        contentAvailable: contentAvailable[controlId],
        controlId,
        patch,
        policy: resolvedPolicy,
        preferences,
      }),
    }];
  })) as Record<ShellControlId, ResolvedShellControl>;
}

function getContentAvailability(manifest: ChatShellManifest): Record<ShellControlId, boolean> {
  const {chrome, composer, sidebar, status} = manifest.registries;
  const sidePanelAvailable = chrome.sidePanel.surfaces.length > 0;
  const statusAvailable = status.sections.length > 0;

  return {
    "chrome.app-picker": chrome.appPicker?.sections.some((section) => section.items.length > 0) ?? false,
    "chrome.branch": chrome.branch.length > 0,
    "chrome.more": menuHasItems(chrome.moreMenu),
    "chrome.window-controls": manifest.layout.frame !== "embedded",
    "chrome.workspace": chrome.workspace.length > 0,
    "chrome.side-panel": sidePanelAvailable,
    "chrome.status": statusAvailable,
    "chrome.terminal": true,
    "composer.add": menuHasItems(composer.addMenu),
    "composer.approval": menuHasItems(composer.approvalMenu),
    "composer.context": Boolean(composer.contextUsage),
    "composer.model": menuHasItems(composer.modelMenu) || composer.modelMenu.id === "model-menu-readonly",
    "composer.reasoning": menuHasItems(composer.reasoningMenu),
    "composer.speed": menuHasItems(composer.speedMenu),
    "side-panel": sidePanelAvailable,
    "sidebar": true,
    "sidebar.archive": true,
    "sidebar.filter": Boolean(sidebar.filter),
    "sidebar.user": true,
    "status-rail": statusAvailable,
  };
}

function menuHasItems(menu: ChatShellMenu) {
  return menu.sections.some((section) => section.items.length > 0);
}

const availableCapability: ShellControlCapability = {state: "available"};
