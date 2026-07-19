import type {PointerEvent as ReactPointerEvent, ReactNode, RefObject} from "react";
import {Group as PanelGroup, Panel, type PanelImperativeHandle} from "react-resizable-panels";

import type {
  ChatShellComposerConfig,
  ChatShellAction,
  ChatShellLayoutConfig,
  ChatShellManifest,
  ChatShellMenuItem,
  ChatShellSettings,
  ChatShellSidebar,
  ChatShellSlot,
  ChatShellSlotRegion,
  ChatShellStatus,
  ChatShellTasks,
  ChatShellUser,
  ChatShellWindow,
} from "../../contracts/chatShellManifest";
import {MainContent, type ShellContentLayout} from "../conversation/MainContent";
import {Composer} from "../conversation/Composer";
import type {ProjectedConversationConfig} from "../projection/ProjectedConversation";
import {SettingsLayout} from "../settings/SettingsLayout";
import {LeftSidebar} from "../sidebar/LeftSidebar";
import type {ChatShellComposerSubmitPayload, ChatShellEventHandler, ChatShellSlotActions, ChatShellSlotRendererProps, ChatShellSlotRendererRegistry} from "./ChatShell.types";
import {MacTopOverlay} from "./MacTopOverlay";
import {ResizeSeparator, SidePanelResizeHandle} from "./ResizeControls";
import {SideOptionsRail, SidePanelTabs, sidePanelDivider, sidePanelSurface} from "./SidePanel";
import {StatusRail} from "./StatusRail";
import {WindowChrome} from "./WindowChrome";
import type {ResolvedChatShellAppearance} from "./chatShellAppearance";
import type {ResolvedShellControls} from "../presentation/resolveShellPresentationControls";
import {
  getPresentedShellControlAttributes,
  isShellControlVisible,
} from "../presentation/presentedShellControl";

export type ShellFrameProps = {
  readonly activeSidePanelSurface: Parameters<typeof SideOptionsRail>[0]["activeSurface"];
  readonly appearance: ResolvedChatShellAppearance;
  readonly appFullscreen: boolean;
  readonly compactLayout: boolean;
  readonly embedded?: boolean;
  readonly composer: ChatShellComposerConfig;
  readonly conversation: ProjectedConversationConfig;
  readonly conversationRegionRef: RefObject<HTMLDivElement | null>;
  readonly fullscreenViewportRef: RefObject<HTMLDivElement | null>;
  readonly layout: ChatShellLayoutConfig;
  readonly manifest: ChatShellManifest;
  readonly navActions: ChatShellAction[];
  readonly onActionTrigger: (actionId: string, surface?: string) => void | Promise<void>;
  readonly onComposerSubmit: (payload: ChatShellComposerSubmitPayload) => void | Promise<void>;
  readonly onMenuSelect: (menuId: string, item: ChatShellMenuItem) => void;
  readonly onOpenSettings: () => void;
  readonly onSettingsChange: (settingId: string, value: boolean | string) => void;
  readonly onStatusSelect: (statusId: string) => void;
  readonly onSelectSidePanelSurface: (surfaceId: string) => void;
  readonly onSelectTask: (taskId: string) => void;
  readonly onSidePanelResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onToggleFullscreen: () => void;
  readonly onToggleSidePanel: () => void;
  readonly onToggleSidebar: () => void;
  readonly onToggleStatus: () => void;
  readonly settings: ChatShellSettings;
  readonly settingsOpen: boolean;
  readonly shellLayout: ShellContentLayout;
  readonly sidePanelContent: ReactNode;
  readonly slotActions: ChatShellSlotActions;
  readonly sidePanelMenuOpen: boolean;
  readonly sidePanelMenuSurfaces: Parameters<typeof SidePanelTabs>[0]["menuSurfaces"];
  readonly sidePanelOpen: boolean;
  readonly sidePanelResizing: boolean;
  readonly sidePanelTabTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly sidePanelWidth: number;
  readonly sidebarCollapsed: boolean;
  readonly sidebarPanelRef: RefObject<PanelImperativeHandle | null>;
  readonly sidebarTransitioning: boolean;
  readonly sidebarWidth: number;
  readonly sidebar: ChatShellSidebar;
  readonly slots: {
    readonly composer: ChatShellSlot;
    readonly overlays?: ChatShellSlot;
    readonly settings: ChatShellSlot;
    readonly sidebar: ChatShellSlot;
    readonly sidePanel?: ChatShellSlot;
    readonly statusRail?: ChatShellSlot;
    readonly timeline: ChatShellSlot;
    readonly windowChrome: ChatShellSlot;
  };
  readonly status: ChatShellStatus;
  readonly statusOpen: boolean;
  readonly statusRailContentRef: RefObject<HTMLDivElement | null>;
  readonly tasks: ChatShellTasks;
  readonly user: ChatShellUser;
  readonly window: ChatShellWindow;
  readonly presentationControls: ResolvedShellControls;
  readonly workspaceRegionRef: RefObject<HTMLElement | null>;
  readonly onBackFromSettings: () => void;
  readonly onCloseSidePanelMenu: () => void;
  readonly onSidebarResize: (size: {inPixels: number}) => void;
  readonly onToggleSidePanelMenu: () => void;
  readonly emitEvent: ChatShellEventHandler;
  readonly shellRenderers?: ChatShellSlotRendererRegistry;
};

export function ShellFrame(props: ShellFrameProps) {
  const sidebarConfig = props.layout.sidebar;
  const sidebarVisible = isShellControlVisible(props.presentationControls.sidebar);
  const sidePanelVisible = isShellControlVisible(props.presentationControls["side-panel"]);
  const statusRailVisible = isShellControlVisible(props.presentationControls["status-rail"]);
  const slotLayout = {
    compact: props.compactLayout,
    fullscreen: props.appFullscreen,
    settingsOpen: props.settingsOpen,
    sidebarCollapsed: props.sidebarCollapsed,
    sidebarWidth: props.sidebarWidth,
    sidePanelOpen: props.sidePanelOpen,
    sidePanelResizing: props.sidePanelResizing,
    sidePanelWidth: props.sidePanelWidth,
    statusOpen: props.statusOpen,
  };
  const createSlotHost = (slot: ChatShellSlot | undefined, defaultContent: ReactNode) => slot ? (
    <ShellSlotHost
      defaultContent={defaultContent}
      actions={props.slotActions}
      emitEvent={props.emitEvent}
      layout={slotLayout}
      manifest={props.manifest}
      registry={props.manifest.registries}
      renderers={props.shellRenderers}
      slot={slot}
    />
  ) : null;
  const composerContent = createSlotHost(
    props.slots.composer,
    <Composer composer={props.composer} controls={props.presentationControls} isStreaming={props.conversation.isStreaming} layout={props.shellLayout} onActionTrigger={props.onActionTrigger} onMenuSelect={props.onMenuSelect} onSubmit={props.onComposerSubmit} />,
  );
  const settingsContent = createSlotHost(
    props.slots.settings,
    <SettingsLayout
      onBack={props.onBackFromSettings}
      onMenuSelect={props.onMenuSelect}
      onSettingsChange={props.onSettingsChange}
      onToggleFullscreen={props.onToggleFullscreen}
      settings={props.settings}
      user={props.user}
    />,
  );
  const sidebarContent = createSlotHost(
    props.slots.sidebar,
    <LeftSidebar
      collapsed={props.sidebarCollapsed}
      navActions={props.navActions}
      onActionTrigger={props.onActionTrigger}
      onMenuSelect={props.onMenuSelect}
      onOpenSettings={props.onOpenSettings}
      onSelectTask={props.onSelectTask}
      sidebar={props.sidebar}
      tasks={props.tasks}
      user={props.user}
      width={props.sidebarWidth}
      controls={props.presentationControls}
    />,
  );
  const windowChromeContent = createSlotHost(
    props.slots.windowChrome,
    <WindowChrome
      collapsedSidebar={props.sidebarCollapsed}
      compactLayout={props.compactLayout}
      onActionTrigger={props.onActionTrigger}
      onMenuSelect={props.onMenuSelect}
      onToggleSidePanel={props.onToggleSidePanel}
      onToggleStatus={props.onToggleStatus}
      sidebarWidth={props.compactLayout ? 0 : props.sidebarCollapsed ? sidebarConfig.collapsedWidth : props.sidebarWidth}
      sidePanelOpen={props.sidePanelOpen}
      sidePanelResizing={props.sidePanelResizing}
      sidePanelTabs={
        <SidePanelTabs
          activeSurface={props.activeSidePanelSurface}
          inactiveTab={props.window.sidePanel.inactiveTab}
          menuOpen={props.sidePanelMenuOpen}
          menuSurfaces={props.sidePanelMenuSurfaces}
          onCollapse={props.onToggleSidePanel}
          onCloseMenu={props.onCloseSidePanelMenu}
          onOpenSurface={props.onSelectSidePanelSurface}
          onToggleMenu={props.onToggleSidePanelMenu}
          triggerRef={props.sidePanelTabTriggerRef}
        />
      }
      sidePanelWidth={props.sidePanelWidth}
      statusOpen={props.statusOpen}
      window={props.window}
      controls={props.presentationControls}
    />,
  );
  const timelineContent = createSlotHost(
    props.slots.timeline,
    <MainContent
      composer={props.composer}
      composerContent={composerContent}
      conversation={props.conversation}
      layout={props.shellLayout}
      onApprovalResponse={(requestId, decision) =>
        props.emitEvent({decision, requestId, type: "approval.respond"})
      }
      onActionTrigger={props.onActionTrigger}
      onMenuSelect={props.onMenuSelect}
      onComposerSubmit={props.onComposerSubmit}
      presentationControls={props.presentationControls}
    />,
  );
  const statusRailContent = createSlotHost(
    props.slots.statusRail,
    <StatusRail compact={props.compactLayout} contentRef={props.statusRailContentRef} control={props.presentationControls["status-rail"]} onMenuSelect={props.onMenuSelect} onStatusSelect={props.onStatusSelect} open={props.statusOpen} status={props.status} />,
  );
  const sidePanelContent = createSlotHost(
    props.slots.sidePanel,
    <>
      <SidePanelResizeHandle disabled={!props.sidePanelOpen} onPointerDown={props.onSidePanelResizeStart} />
      <SideOptionsRail activeSurface={props.activeSidePanelSurface} surfaceContent={props.sidePanelContent} />
    </>,
  );
  const overlaysContent = createSlotHost(
    props.slots.overlays,
    <MacTopOverlay
      collapsed={props.sidebarCollapsed}
      control={props.presentationControls["chrome.window-controls"]}
      onNewTask={() => undefined}
      onToggleSidebar={props.onToggleSidebar}
      onToggleFullscreen={props.onToggleFullscreen}
    />,
  );

  return (
    <div
      {...props.appearance.attributes}
      className={props.appFullscreen ? "hero-visual-theme chat-shell-layout chat-shell-layout-fullscreen flex h-full min-h-0 w-full flex-col items-center" : "hero-visual-theme chat-shell-layout flex w-full flex-col items-center gap-6"}
      data-testid="chat-shell-root"
      style={props.appearance.rootStyle}
    >
      <div
        className={props.appFullscreen ? "hero-visual-theme chat-shell-viewport chat-shell-viewport-fullscreen relative h-full min-h-0 min-w-0 w-full" : "hero-visual-theme chat-shell-viewport relative my-2 min-h-0 min-w-0 w-full max-w-7xl sm:mb-4 sm:mt-8"}
        ref={props.fullscreenViewportRef}
        style={props.appearance.viewportStyle}
      >
        <div className={props.appFullscreen ? "chat-shell-frame chat-shell-frame-fullscreen relative h-full overflow-hidden border border-window-border bg-window-bg shadow-[var(--color-window-shadow)] backdrop-blur-2xl" : "chat-shell-frame relative h-full overflow-hidden rounded-2xl border border-window-border bg-window-bg shadow-[var(--color-window-shadow)] backdrop-blur-2xl sm:rounded-[20px]"} style={props.appearance.frameStyle}>
          {props.settingsOpen ? (
            settingsContent
          ) : (
            <>
              <PanelGroup
                className="h-full w-full bg-background-alt"
                id="chat-shell-root-panels"
                orientation="horizontal"
                resizeTargetMinimumSize={{coarse: 28, fine: 12}}
              >
                {!props.compactLayout && sidebarVisible ? (
                  <>
                    <Panel
                      className="min-h-0"
                      collapsedSize={sidebarConfig.collapsedWidth}
                      collapsible
                      defaultSize={sidebarConfig.defaultWidth}
                      groupResizeBehavior="preserve-pixel-size"
                      id="chat-shell-sidebar-panel"
                      maxSize={sidebarConfig.maxWidth}
                      minSize={props.sidebarTransitioning || props.sidebarCollapsed ? sidebarConfig.collapsedWidth : sidebarConfig.minWidth}
                      onResize={props.onSidebarResize}
                      panelRef={props.sidebarPanelRef}
                    >
                      <div {...getPresentedShellControlAttributes(props.presentationControls.sidebar)} aria-label="Threads" className="h-full min-h-0 overflow-hidden" role="navigation">
                        {sidebarContent}
                      </div>
                    </Panel>
                    <ResizeSeparator disabled={props.sidebarCollapsed} label="Resize sidebar" />
                  </>
                ) : null}
                <Panel className="min-h-0 min-w-0" id="chat-shell-main-panel" minSize={props.compactLayout ? 0 : 360}>
                  <div className="chat-shell-main-gutter flex h-full min-w-0 flex-1 flex-col p-1.5 sm:p-2 md:pl-0">
                    <div className="flex flex-col h-full border border-border rounded-xl bg-background overflow-hidden">
                      {windowChromeContent}
                      <section aria-label="Workspace" className="relative flex flex-col min-h-0 flex-1 overflow-hidden" ref={props.workspaceRegionRef}>
                        <PanelGroup
                          className="relative min-h-0 min-w-0 flex-1"
                          id="chat-shell-workspace-panels"
                          orientation="horizontal"
                          resizeTargetMinimumSize={{coarse: 28, fine: 12}}
                        >
                          <Panel
                            className="min-h-0 min-w-0"
                            elementRef={props.conversationRegionRef}
                            id="chat-shell-conversation-panel"
                            minSize={props.compactLayout ? 0 : 320}
                          >
                            <div className="relative flex h-full min-w-0 flex-1 overflow-hidden">
                              <div className="flex min-w-0 flex-1 flex-col">
                                {timelineContent}
                              </div>
                              {statusRailVisible ? statusRailContent : null}
                            </div>
                          </Panel>
                        </PanelGroup>
                        {sidePanelVisible ? <div
                          {...getPresentedShellControlAttributes(props.presentationControls["side-panel"])}
                          aria-hidden={!props.sidePanelOpen}
                          inert={!props.sidePanelOpen}
                          className={[
                            "absolute bottom-0 right-0 top-0 z-20 min-h-0 overflow-hidden border-l shadow-[-18px_0_32px_rgba(0,0,0,0.18)]",
                            props.sidePanelResizing ? "" : "transition-[opacity,transform,width] duration-300 ease-out",
                            props.sidePanelOpen ? "opacity-100 translate-x-0" : "pointer-events-none opacity-0 translate-x-full",
                          ].join(" ")}
                          style={{
                            backgroundColor: sidePanelSurface,
                            borderColor: sidePanelDivider,
                            width: props.compactLayout ? `min(100%, ${props.sidePanelWidth}px)` : props.sidePanelWidth,
                          }}
                        >
                          {sidePanelContent}
                        </div> : null}
                      </section>
                    </div>
                  </div>
                </Panel>
              </PanelGroup>
              {props.embedded ? null : overlaysContent}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const builtInRendererByRegion = {
  composer: "shell.composer",
  overlays: "shell.overlays.mac-top",
  settings: "shell.settings",
  sidebar: "shell.sidebar",
  sidePanel: "shell.side-panel",
  statusRail: "shell.status-rail",
  timeline: "shell.timeline",
  windowChrome: "shell.window-chrome",
} satisfies Record<ChatShellSlotRegion, ChatShellSlot["rendererId"]>;

function ShellSlotHost({
  actions,
  defaultContent,
  emitEvent,
  layout,
  manifest,
  registry,
  renderers,
  slot,
}: {
  readonly actions: ChatShellSlotActions;
  readonly defaultContent: ReactNode;
  readonly emitEvent: ChatShellEventHandler;
  readonly layout: ChatShellSlotRendererProps["layout"];
  readonly manifest: ChatShellManifest;
  readonly registry: ChatShellManifest["registries"];
  readonly renderers?: ChatShellSlotRendererRegistry;
  readonly slot: ChatShellSlot;
}) {
  const expectedBuiltInRenderer = builtInRendererByRegion[slot.region];

  if (slot.rendererId === expectedBuiltInRenderer) {
    return (
      <div data-shell-slot-id={slot.id} data-shell-slot-renderer={slot.rendererId} data-shell-slot-region={slot.region} style={{display: "contents"}}>
        {defaultContent}
      </div>
    );
  }

  const renderer = renderers?.[slot.rendererId];

  if (!renderer) {
    throw new Error(`Shell slot "${slot.id}" in region "${slot.region}" references unregistered renderer "${slot.rendererId}". Register it with ChatShell renderers.shell.`);
  }

  return (
    <div data-shell-slot-id={slot.id} data-shell-slot-renderer={slot.rendererId} data-shell-slot-region={slot.region} style={{display: "contents"}}>
      {renderer({
        actions,
        emitEvent,
        helpers: {
          renderDefault: () => defaultContent,
        },
        layout,
        manifest,
        registry,
        slot,
      })}
    </div>
  );
}
