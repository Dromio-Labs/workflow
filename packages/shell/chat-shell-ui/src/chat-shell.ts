"use client";

export {ChatShell} from "./components/shell/ChatShell";
export {SettingsShell} from "./components/settings/SettingsShell";
export type {SettingsShellNavItem, SettingsShellNavSection} from "./components/settings/SettingsShell";
export {WorkflowSidebar} from "./components/sidebar/WorkflowSidebar";
export type {WorkflowSidebarItem, WorkflowSidebarProps} from "./components/sidebar/WorkflowSidebar";
export {DromioMarkdown} from "./components/projection/markdown";
export type {DromioMarkdownProps} from "./components/projection/markdown/DromioMarkdown";
export {
  chatShellBuiltInSidePanelRendererIds,
  chatShellBuiltInSlotRendererIds,
  defineChatShellExtension,
  defineChatShellRenderers,
  defineChatShellSidePanelRenderers,
  defineChatShellSlotRenderers,
} from "./components/shell/rendererRegistration";
export type {
  ChatShellBuiltInSidePanelRendererId,
  ChatShellBuiltInSlotRendererId,
} from "./components/shell/rendererRegistration";
export type {ChatShellDevToolsOptions} from "./components/presentation/ChatShellPresentationDevTools";
export type {
  ChatShellComposerAttachment,
  ChatShellComposerSubmitPayload,
  ChatShellEvent,
  ChatShellEventHandler,
  ChatShellExtension,
  ChatShellIconRenderer,
  ChatShellIconRendererProps,
  ChatShellIconRendererRegistry,
  ChatShellProps,
  ChatShellRendererRegistry,
  ChatShellSidePanelRenderer,
  ChatShellSidePanelExtensionSurface,
  ChatShellSidePanelRendererProps,
  ChatShellSidePanelRendererRegistry,
  ChatShellSlotActions,
  ChatShellSlotExtensionRegistration,
  ChatShellSlotRenderer,
  ChatShellSlotRendererProps,
  ChatShellSlotRendererRegistry,
} from "./components/shell/ChatShell.types";
