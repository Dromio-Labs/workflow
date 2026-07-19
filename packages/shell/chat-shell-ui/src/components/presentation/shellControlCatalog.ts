import type {ShellControlId, ShellControlPolicy} from "../../contracts/chatShellPresentation";

export type ShellControlDefinition = {
  readonly id: ShellControlId;
  readonly label: string;
  readonly policy: ShellControlPolicy;
};

export const shellControlCatalog = {
  "chrome.app-picker": defineControl("chrome.app-picker", "App picker", "auto"),
  "chrome.branch": defineControl("chrome.branch", "Branch picker", "visible"),
  "chrome.more": defineControl("chrome.more", "Workspace menu", "auto"),
  "chrome.workspace": defineControl("chrome.workspace", "Workspace picker", "visible"),
  "chrome.window-controls": defineControl("chrome.window-controls", "Window controls", "visible"),
  "chrome.status": defineControl("chrome.status", "Status panel", "auto"),
  "chrome.terminal": defineControl("chrome.terminal", "Terminal", "visible"),
  "chrome.side-panel": defineControl("chrome.side-panel", "Side-panel toggle", "auto"),
  "sidebar": defineControl("sidebar", "Sidebar", "visible"),
  "sidebar.archive": defineControl("sidebar.archive", "Archive", "visible"),
  "sidebar.filter": defineControl("sidebar.filter", "Chat filter", "auto"),
  "sidebar.user": defineControl("sidebar.user", "User and settings", "visible"),
  "composer.add": defineControl("composer.add", "Add context", "auto"),
  "composer.approval": defineControl("composer.approval", "Approval mode", "auto"),
  "composer.context": defineControl("composer.context", "Context usage", "auto"),
  "composer.model": defineControl("composer.model", "Model picker", "auto"),
  "composer.reasoning": defineControl("composer.reasoning", "Reasoning picker", "auto"),
  "composer.speed": defineControl("composer.speed", "Speed picker", "auto"),
  "status-rail": defineControl("status-rail", "Status rail", "auto"),
  "side-panel": defineControl("side-panel", "Side panel", "auto"),
} as const satisfies Record<ShellControlId, ShellControlDefinition>;

export const shellControlIds = Object.keys(shellControlCatalog) as ShellControlId[];

function defineControl(
  id: ShellControlId,
  label: string,
  defaultVisibility: ShellControlPolicy["defaultVisibility"],
): ShellControlDefinition {
  return {
    id,
    label,
    policy: {
      defaultVisibility,
      userConfigurable: true,
    },
  };
}
