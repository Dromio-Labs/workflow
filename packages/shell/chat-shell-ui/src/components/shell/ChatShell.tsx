"use client";

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent} from "react";
import type {PanelImperativeHandle} from "react-resizable-panels";

import type {ChatShellMenuItem, ChatShellSidePanel, ChatShellSidePanelSurface} from "../../contracts/chatShellManifest";
import {ShellPresentationPatchSchema, ShellPresentationPolicySchema, ShellPresentationPreferencesSchema} from "../../contracts/chatShellPresentation";
import {resolveShellPresentationControls} from "../presentation/resolveShellPresentationControls";
import {ChatShellPresentationDevTools} from "../presentation/ChatShellPresentationDevTools";
import {projectControlPlaneConversationState} from "../../runtime/controlPlaneConversation";
import type {ChatShellComposerSubmitPayload, ChatShellEvent, ChatShellProps} from "./ChatShell.types";
import {
  buildActiveShellProjection,
  createChatShellRegistry,
  getOptionalShellSlot,
  getPrimaryShellSlot,
} from "./chatShellRegistry";
import {resolveChatShellExtensionRegistrations} from "./rendererRegistration";
import {ShellFrame} from "./ShellFrame";
import {
  builtInSidePanelRenderers,
  renderSidePanelComposer,
  renderSidePanelDefaultContent,
  renderSidePanelSurface,
} from "./shellSlots";
import {getChatShellAppearance} from "./chatShellAppearance";
import {IconRendererProvider} from "../ui/Icon";
import {useShellKeyboardShortcuts} from "./useShellKeyboardShortcuts";
import {getShellWebShortcutLabel} from "./shellShortcuts";

const statusContentLeftPadding = 31;
const statusClosedPadding = 16;
const statusPushBreakpoint = 650;
const sidePanelContentGutter = 16;

export function ChatShell(props: ChatShellProps) {
  if (props.devtools?.enabled) {
    return (
      <ChatShellPresentationDevTools
        initialPatch={props.presentation}
        manifest={props.manifest}
        options={props.devtools}
        policy={props.presentationPolicy}
        preferences={props.presentationPreferences}
      >
        {(presentation, mode) => (
          <ChatShellView
            {...props}
            manifest={mode === "edit" ? props.devtools?.authoringManifest ?? props.manifest : props.manifest}
            presentation={presentation}
            presentationPreferences={mode === "edit" ? undefined : props.presentationPreferences}
          />
        )}
      </ChatShellPresentationDevTools>
    );
  }

  return <ChatShellView {...props} />;
}

export function ChatShellView({
  extensions,
  initialFullscreen,
  manifest,
  onEvent,
  onFullscreenChange,
  presentation,
  presentationPolicy,
  presentationPreferences,
  renderers,
  conversationStateOverride,
}: ChatShellProps) {
  const resolvedRegistration = useMemo(
    () => resolveChatShellExtensionRegistrations({extensions, manifest, renderers}),
    [extensions, manifest, renderers],
  );
  const resolvedManifest = resolvedRegistration.manifest;
  const resolvedRenderers = resolvedRegistration.renderers;
  const resolvedPresentation = useMemo(
    () => presentation ? ShellPresentationPatchSchema.parse(presentation) : undefined,
    [presentation],
  );
  const resolvedPresentationPreferences = useMemo(
    () => presentationPreferences
      ? ShellPresentationPreferencesSchema.parse(presentationPreferences)
      : undefined,
    [presentationPreferences],
  );
  const resolvedPresentationPolicy = useMemo(
    () => presentationPolicy
      ? ShellPresentationPolicySchema.parse(presentationPolicy)
      : undefined,
    [presentationPolicy],
  );
  const registry = useMemo(() => createChatShellRegistry(resolvedManifest), [resolvedManifest]);
  const {controlPlane, layout, registries, runtime, slots} = registry;
  const navActions = useMemo(
    () => registries.navActions.map((action) => action.id === "new-chat"
      ? {...action, shortcut: getShellWebShortcutLabel("new-chat")}
      : action),
    [registries.navActions],
  );
  const appearance = useMemo(() => getChatShellAppearance(resolvedManifest.appearance), [resolvedManifest.appearance]);
  const sidebarConfig = layout.sidebar;
  const sidePanelConfig = layout.sidePanel;
  const embeddedFrame = layout.frame === "embedded";
  const chrome = registries.chrome;
  const presentationControls = useMemo(
    () => resolveShellPresentationControls({
      manifest: resolvedManifest,
      patch: resolvedPresentation,
      policy: resolvedPresentationPolicy,
      preferences: resolvedPresentationPreferences,
    }),
    [resolvedManifest, resolvedPresentation, resolvedPresentationPolicy, resolvedPresentationPreferences],
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTransitioning, setSidebarTransitioning] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(sidebarConfig.defaultWidth);
  // Embedded hosts own the surrounding chrome, so the shell always fills its
  // container; the windowed/fullscreen toggle only exists in windowed mode.
  const [appFullscreen, setAppFullscreen] = useState(embeddedFrame || (initialFullscreen ?? false));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState(controlPlane.activeThreadId);
  const [statusOpen, setStatusOpen] = useState(layout.statusPanel.defaultOpen);
  const [sidePanelOpen, setSidePanelOpen] = useState(sidePanelConfig.defaultOpen);
  const [sidePanelWidth, setSidePanelWidth] = useState(sidePanelConfig.defaultWidth);
  const [sidePanelActiveSurfaceId, setSidePanelActiveSurfaceId] = useState(() => getConfiguredSidePanelSurfaceId(chrome.sidePanel));
  const [sidePanelTabMenuOpen, setSidePanelTabMenuOpen] = useState(false);
  const [sidePanelResizing, setSidePanelResizing] = useState(false);
  const [conversationWidth, setConversationWidth] = useState<number | null>(null);
  const [statusRailWidth, setStatusRailWidth] = useState(0);
  const compactLayout = useMediaQuery("(max-width: 767px)");
  const conversationRegionRef = useRef<HTMLDivElement>(null);
  const statusRailContentRef = useRef<HTMLDivElement>(null);
  const fullscreenViewportRef = useRef<HTMLDivElement>(null);
  const fullscreenTransitionFromRef = useRef<DOMRect | null>(null);
  const fullscreenAnimationRef = useRef<Animation | null>(null);
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const workspaceRegionRef = useRef<HTMLElement>(null);
  const sidePanelTabTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const lastExpandedSidebarWidthRef = useRef(sidebarConfig.defaultWidth);
  const sidebarAnimationRef = useRef<number | null>(null);
  const sidebarAnimatingRef = useRef(false);
  const activeProjection = useMemo(
    () => buildActiveShellProjection({
      activeThreadId: activeTaskId,
      controlPlane,
      runtimeConversation: runtime.conversation,
      status: registries.status,
      window: chrome,
    }),
    [activeTaskId, chrome, controlPlane, registries.status, runtime.conversation],
  );
  const backendConversationState = useMemo(
    () => projectControlPlaneConversationState(controlPlane, activeProjection.conversation.threadId),
    [controlPlane, activeProjection.conversation.threadId],
  );
  const conversation = useMemo(
    () => ({
      ...activeProjection.conversation,
      isStreaming: conversationStateOverride?.isStreaming ?? activeProjection.conversation.runtimeState === "streaming",
      pendingApprovals: conversationStateOverride?.pendingApprovals,
      runtimeState: conversationStateOverride?.runtimeState ?? activeProjection.conversation.runtimeState,
      state: conversationStateOverride?.state ?? backendConversationState,
    }),
    [
      activeProjection.conversation,
      backendConversationState,
      conversationStateOverride?.isStreaming,
      conversationStateOverride?.pendingApprovals,
      conversationStateOverride?.state,
    ],
  );
  const shellSlots = useMemo(() => ({
    composer: getPrimaryShellSlot(slots, "composer"),
    overlays: getOptionalShellSlot(slots, "overlays"),
    settings: getPrimaryShellSlot(slots, "settings"),
    sidebar: getPrimaryShellSlot(slots, "sidebar"),
    sidePanel: getOptionalShellSlot(slots, "sidePanel"),
    statusRail: getOptionalShellSlot(slots, "statusRail"),
    timeline: getPrimaryShellSlot(slots, "timeline"),
    windowChrome: getPrimaryShellSlot(slots, "windowChrome"),
  }), [slots]);
  const sidePanelRendererRegistry = useMemo(
    () => ({
      ...builtInSidePanelRenderers,
      ...resolvedRenderers?.sidePanel,
    }),
    [resolvedRenderers?.sidePanel],
  );
  const sidePanelActiveSurface = useMemo(() => {
    const surface = chrome.sidePanel.surfaces.find((candidate) => candidate.surfaceId === sidePanelActiveSurfaceId);

    if (!surface) {
      throw new Error(`Side panel active surface "${sidePanelActiveSurfaceId}" is not registered in the manifest.`);
    }

    return surface;
  }, [chrome.sidePanel.surfaces, sidePanelActiveSurfaceId]);
  const sidePanelTabMenuSurfaces = useMemo(() => {
    const ids = chrome.sidePanel.tabMenuSurfaceIds;

    if (!ids?.length) {
      return chrome.sidePanel.surfaces;
    }

    return ids.map((id) => {
      const surface = chrome.sidePanel.surfaces.find((candidate) => candidate.surfaceId === id);

      if (!surface) {
        throw new Error(`Side panel tab menu references missing surface "${id}".`);
      }

      return surface;
    });
  }, [chrome.sidePanel.surfaces, chrome.sidePanel.tabMenuSurfaceIds]);
  const statusShouldPushContent = !compactLayout && (conversationWidth === null || conversationWidth >= statusPushBreakpoint);
  const sidePanelPushPadding = sidePanelOpen ? sidePanelWidth + sidePanelContentGutter : 0;
  const measuredStatusPadding = statusRailWidth > 0 ? statusRailWidth + sidePanelContentGutter : statusClosedPadding;
  const statusContentPadding = statusOpen && statusShouldPushContent ? measuredStatusPadding : statusClosedPadding;
  const conversationPaddingRight = compactLayout ? 0 : sidePanelOpen ? sidePanelPushPadding : statusContentPadding;
  const composerPaddingRight = compactLayout ? 0 : sidePanelOpen ? sidePanelPushPadding : statusContentPadding;
  const shellLayout = useMemo(
    () => ({
      composerPaddingLeft: compactLayout ? 0 : statusContentLeftPadding,
      composerPaddingRight,
      conversationPaddingLeft: compactLayout ? 0 : statusContentLeftPadding,
      conversationPaddingRight,
      disablePaddingTransition: sidePanelResizing,
      statusOpen,
    }),
    [compactLayout, composerPaddingRight, conversationPaddingRight, sidePanelResizing, statusOpen],
  );

  useLayoutEffect(() => {
    setActiveTaskId(controlPlane.activeThreadId);
  }, [controlPlane.activeThreadId]);

  useEffect(() => {
    setSidebarWidth(sidebarConfig.defaultWidth);
    lastExpandedSidebarWidthRef.current = sidebarConfig.defaultWidth;
  }, [sidebarConfig.defaultWidth]);

  useEffect(() => {
    setStatusOpen(layout.statusPanel.defaultOpen);
  }, [layout.statusPanel.defaultOpen]);

  useEffect(() => {
    setSidePanelOpen(sidePanelConfig.defaultOpen);
    setSidePanelWidth(sidePanelConfig.defaultWidth);
  }, [sidePanelConfig.defaultOpen, sidePanelConfig.defaultWidth]);

  useEffect(() => {
    setSidePanelActiveSurfaceId(getConfiguredSidePanelSurfaceId(chrome.sidePanel));
  }, [chrome.sidePanel]);

  useEffect(() => {
    onFullscreenChange?.(appFullscreen);

    return () => onFullscreenChange?.(false);
  }, [appFullscreen, onFullscreenChange]);

  useEffect(() => {
    const element = conversationRegionRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => setConversationWidth(element.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setConversationWidth(entry.contentRect.width);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = statusRailContentRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => setStatusRailWidth(Math.round(element.getBoundingClientRect().width));
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const from = fullscreenTransitionFromRef.current;
    const element = fullscreenViewportRef.current;
    fullscreenTransitionFromRef.current = null;

    if (!from || !element) {
      return undefined;
    }

    fullscreenAnimationRef.current?.cancel();

    const to = element.getBoundingClientRect();
    if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) {
      return undefined;
    }

    const animation = element.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        {transform: "translate(0, 0) scale(1, 1)"},
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );

    fullscreenAnimationRef.current = animation;
    animation.addEventListener("finish", () => {
      if (fullscreenAnimationRef.current === animation) {
        fullscreenAnimationRef.current = null;
      }
    }, {once: true});

    return () => {
      if (fullscreenAnimationRef.current === animation) {
        animation.cancel();
        fullscreenAnimationRef.current = null;
      }
    };
  }, [appFullscreen]);

  useLayoutEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) {
      return undefined;
    }

    if (sidebarAnimationRef.current !== null) {
      window.cancelAnimationFrame(sidebarAnimationRef.current);
    }

    const from = panel.getSize().inPixels;
    const to = sidebarCollapsed ? sidebarConfig.collapsedWidth : lastExpandedSidebarWidthRef.current;
    if (Math.abs(from - to) < 0.5) {
      resizePanelIfMounted(panel, to);
      if (!sidebarCollapsed) {
        setSidebarWidth(Math.round(to));
      }
      sidebarAnimatingRef.current = false;
      setSidebarTransitioning(false);
      return undefined;
    }

    const duration = 300;
    const startedAt = performance.now();
    sidebarAnimatingRef.current = true;
    setSidebarTransitioning(true);

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + (to - from) * eased;
      if (!resizePanelIfMounted(panel, next)) {
        sidebarAnimatingRef.current = false;
        sidebarAnimationRef.current = null;
        setSidebarTransitioning(false);
        return;
      }

      if (progress < 1) {
        sidebarAnimationRef.current = window.requestAnimationFrame(animate);
        return;
      }

      resizePanelIfMounted(panel, to);
      if (!sidebarCollapsed) {
        setSidebarWidth(Math.round(to));
      }
      sidebarAnimatingRef.current = false;
      sidebarAnimationRef.current = null;
      setSidebarTransitioning(false);
    };

    sidebarAnimationRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (sidebarAnimationRef.current !== null) {
        window.cancelAnimationFrame(sidebarAnimationRef.current);
        sidebarAnimationRef.current = null;
      }
      sidebarAnimatingRef.current = false;
    };
  }, [sidebarCollapsed, sidebarConfig.collapsedWidth]);

  const handleSidebarResize = (size: {inPixels: number}) => {
    if (sidebarAnimatingRef.current) {
      return;
    }

    if (!sidebarCollapsed && size.inPixels >= sidebarConfig.minWidth) {
      // react-resizable-panels exposes continuous resize here, without a pointer-up
      // callback at this boundary. Keep sidebar resize local to avoid intent spam.
      lastExpandedSidebarWidthRef.current = Math.round(size.inPixels);
      setSidebarWidth(Math.round(size.inPixels));
    }
  };

  const emitEvent = useCallback((event: ChatShellEvent) => {
    return onEvent?.(event);
  }, [onEvent]);

  const handleMenuSelect = useCallback((menuId: string, item: ChatShellMenuItem) => {
    emitEvent({item, menuId, type: "menu.select"});
  }, [emitEvent]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarTransitioning(true);
    setSidebarCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      emitEvent({collapsed: nextCollapsed, type: "sidebar.toggle"});
      return nextCollapsed;
    });
  }, [emitEvent]);

  const handleSelectTask = (taskId: string) => {
    setActiveTaskId(taskId);
    emitEvent({taskId, type: "task.select"});
  };

  const submitComposerPayload = useCallback(async (payload: ChatShellComposerSubmitPayload) => {
    await onEvent?.({
      payload,
      type: "composer.submit",
    });
  }, [onEvent]);

  const handleToggleSidePanel = useCallback(() => {
    setSidePanelOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setStatusOpen(false);
        emitEvent({open: false, type: "status.toggle"});
      }
      emitEvent({
        surfaceId: sidePanelActiveSurfaceId,
        type: nextOpen ? "sidePanel.open" : "sidePanel.close",
      });
      return nextOpen;
    });
  }, [emitEvent, sidePanelActiveSurfaceId]);

  const triggerShellAction = useCallback((actionId: string, surface?: string) => {
    emitEvent({actionId, surface, type: "action.trigger"});
    if (actionId === "new-chat") {
      window.requestAnimationFrame(focusPrimaryComposer);
    }
  }, [emitEvent]);

  const keyboardShortcutHandlers = useMemo(() => ({
    "new-chat": () => triggerShellAction("new-chat", "keyboard"),
    "toggle-sidebar": handleToggleSidebar,
    "toggle-side-panel": handleToggleSidePanel,
  }), [handleToggleSidePanel, handleToggleSidebar, triggerShellAction]);

  useShellKeyboardShortcuts(keyboardShortcutHandlers);

  const openSidePanel = useCallback(() => {
    setSidePanelOpen((open) => {
      if (open) {
        return open;
      }

      setStatusOpen(false);
      emitEvent({open: false, type: "status.toggle"});
      emitEvent({surfaceId: sidePanelActiveSurfaceId, type: "sidePanel.open"});
      return true;
    });
  }, [emitEvent, sidePanelActiveSurfaceId]);

  const closeSidePanel = useCallback(() => {
    setSidePanelOpen((open) => {
      if (!open) {
        return open;
      }

      emitEvent({surfaceId: sidePanelActiveSurfaceId, type: "sidePanel.close"});
      return false;
    });
  }, [emitEvent, sidePanelActiveSurfaceId]);

  const handleSidePanelResizeStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!sidePanelOpen) {
      return;
    }

    const workspaceRegion = workspaceRegionRef.current;
    if (!workspaceRegion) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSidePanelResizing(true);
    let finalWidth = sidePanelWidth;

    const resizeFromClientX = (clientX: number) => {
      const rect = workspaceRegion.getBoundingClientRect();
      const maxWidth = Math.min(sidePanelConfig.maxWidth, rect.width - 320);
      const nextWidth = clamp(rect.right - clientX, sidePanelConfig.minWidth, Math.max(sidePanelConfig.minWidth, maxWidth));
      finalWidth = Math.round(nextWidth);
      setSidePanelWidth(finalWidth);
    };

    resizeFromClientX(event.clientX);

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      resizeFromClientX(pointerEvent.clientX);
    };
    const handlePointerUp = () => {
      setSidePanelResizing(false);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      emitEvent({surfaceId: sidePanelActiveSurfaceId, type: "sidePanel.resize", width: finalWidth});
      emitEvent({panelId: "sidePanel", type: "panel.resize", width: finalWidth});
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp, {once: true});
  };

  const openSidePanelSurface = useCallback((surfaceId: string) => {
    if (!chrome.sidePanel.surfaces.some((surface) => surface.surfaceId === surfaceId)) {
      throw new Error(`Side panel surface "${surfaceId}" is not registered in the manifest.`);
    }

    setSidePanelActiveSurfaceId(surfaceId);
    setSidePanelTabMenuOpen(false);
    emitEvent({surfaceId, type: "sidePanel.select"});
  }, [chrome.sidePanel.surfaces, emitEvent]);

  const handleToggleFullscreen = () => {
    if (embeddedFrame) {
      return;
    }
    const element = fullscreenViewportRef.current;
    if (element) {
      fullscreenTransitionFromRef.current = element.getBoundingClientRect();
    }
    fullscreenAnimationRef.current?.cancel();
    setAppFullscreen((fullscreen) => {
      const nextFullscreen = !fullscreen;
      emitEvent({fullscreen: nextFullscreen, type: "window.fullscreen.toggle"});
      return nextFullscreen;
    });
  };

  const handleOpenSettings = () => {
    settingsReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsOpen(true);
    emitEvent({open: true, type: "settings.open"});
  };

  const handleCloseSettings = () => {
    setSettingsOpen(false);
    emitEvent({open: false, type: "settings.close"});
    window.requestAnimationFrame(() => {
      const returnTarget = settingsReturnFocusRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
        return;
      }

      document.querySelector<HTMLElement>("[data-chat-shell-primary-focus]")?.focus();
    });
  };

  const handleToggleStatus = () => {
    setStatusOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setSidePanelOpen(false);
        if (sidePanelOpen) {
          emitEvent({surfaceId: sidePanelActiveSurfaceId, type: "sidePanel.close"});
        }
      }
      emitEvent({open: nextOpen, type: "status.toggle"});
      return nextOpen;
    });
  };

  const sidePanelContent = useMemo(
    () => renderSidePanelSurface({
      registry: sidePanelRendererRegistry,
      rendererProps: {
        activeSurface: sidePanelActiveSurface,
        closeSidePanel,
        composer: registries.composer,
        emitEvent,
        helpers: {
          renderComposer: () => renderSidePanelComposer({
            composer: registries.composer,
            controls: presentationControls,
            onComposerSubmit: submitComposerPayload,
            onMenuSelect: handleMenuSelect,
          }),
          renderDefaultContent: () => renderSidePanelDefaultContent({surface: sidePanelActiveSurface}),
        },
        layout: {
          compact: compactLayout,
          open: sidePanelOpen,
          resizing: sidePanelResizing,
          width: sidePanelWidth,
        },
        onComposerSubmit: submitComposerPayload,
        onMenuSelect: handleMenuSelect,
        openSidePanel,
        selectSurface: openSidePanelSurface,
        surface: sidePanelActiveSurface,
        surfaces: chrome.sidePanel.surfaces,
      },
    }),
    [
      chrome.sidePanel.surfaces,
      closeSidePanel,
      compactLayout,
      emitEvent,
      handleMenuSelect,
      openSidePanel,
      openSidePanelSurface,
      registries.composer,
      sidePanelActiveSurface,
      sidePanelOpen,
      sidePanelRendererRegistry,
      sidePanelResizing,
      sidePanelWidth,
      submitComposerPayload,
    ],
  );

  const slotActions = useMemo(() => ({
    closeSettings: handleCloseSettings,
    closeSidePanel,
    openSettings: handleOpenSettings,
    openSidePanel,
    selectMenu: handleMenuSelect,
    selectSidePanelSurface: openSidePanelSurface,
    selectTask: handleSelectTask,
    submitComposer: submitComposerPayload,
    toggleFullscreen: handleToggleFullscreen,
    toggleSidebar: handleToggleSidebar,
    toggleSidePanel: handleToggleSidePanel,
    toggleStatus: handleToggleStatus,
    triggerAction: triggerShellAction,
  }), [
    closeSidePanel,
    emitEvent,
    handleMenuSelect,
    handleCloseSettings,
    handleOpenSettings,
    handleSelectTask,
    handleToggleFullscreen,
    handleToggleSidePanel,
    handleToggleSidebar,
    handleToggleStatus,
    openSidePanel,
    openSidePanelSurface,
    submitComposerPayload,
    triggerShellAction,
  ]);

  return (
    <IconRendererProvider renderers={resolvedRenderers?.icons}>
      <ShellFrame
        activeSidePanelSurface={sidePanelActiveSurface}
        appearance={appearance}
        appFullscreen={appFullscreen}
        compactLayout={compactLayout}
        embedded={embeddedFrame}
        composer={registries.composer}
        conversation={conversation}
        conversationRegionRef={conversationRegionRef}
        emitEvent={emitEvent}
        fullscreenViewportRef={fullscreenViewportRef}
        layout={layout}
        manifest={resolvedManifest}
        navActions={navActions}
        onActionTrigger={triggerShellAction}
        onBackFromSettings={handleCloseSettings}
        onCloseSidePanelMenu={() => setSidePanelTabMenuOpen(false)}
        onComposerSubmit={submitComposerPayload}
        onMenuSelect={handleMenuSelect}
        onOpenSettings={handleOpenSettings}
        onSettingsChange={(settingId, value) => emitEvent({settingId, type: "settings.change", value})}
        onSelectSidePanelSurface={openSidePanelSurface}
        onSelectTask={handleSelectTask}
        onSidebarResize={handleSidebarResize}
        onSidePanelResizeStart={handleSidePanelResizeStart}
        onStatusSelect={(statusId) => emitEvent({statusId, type: "status.select"})}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleSidePanel={handleToggleSidePanel}
        onToggleSidePanelMenu={() => setSidePanelTabMenuOpen((open) => !open)}
        onToggleSidebar={handleToggleSidebar}
        onToggleStatus={handleToggleStatus}
        settings={registries.settings}
        settingsOpen={settingsOpen}
        shellLayout={shellLayout}
        shellRenderers={resolvedRenderers?.shell}
        sidePanelContent={sidePanelContent}
        slotActions={slotActions}
        sidePanelMenuOpen={sidePanelTabMenuOpen}
        sidePanelMenuSurfaces={sidePanelTabMenuSurfaces}
        sidePanelOpen={sidePanelOpen}
        sidePanelResizing={sidePanelResizing}
        sidePanelTabTriggerRef={sidePanelTabTriggerRef}
        sidePanelWidth={sidePanelWidth}
        sidebar={registries.sidebar}
        sidebarCollapsed={sidebarCollapsed}
        sidebarPanelRef={sidebarPanelRef}
        sidebarTransitioning={sidebarTransitioning}
        sidebarWidth={sidebarWidth}
        slots={shellSlots}
        status={activeProjection.activeStatus}
        statusOpen={statusOpen}
        statusRailContentRef={statusRailContentRef}
        tasks={activeProjection.tasks}
        user={registries.user}
        window={activeProjection.activeWindow}
        presentationControls={presentationControls}
        workspaceRegionRef={workspaceRegionRef}
      />
    </IconRendererProvider>
  );
}

function getConfiguredSidePanelSurfaceId(panel: ChatShellSidePanel) {
  if (!panel.surfaces.some((surface: ChatShellSidePanelSurface) => surface.surfaceId === panel.initialSurfaceId)) {
    throw new Error(`Side panel initial surface "${panel.initialSurfaceId}" is not registered in the manifest.`);
  }

  return panel.initialSurfaceId;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function resizePanelIfMounted(panel: PanelImperativeHandle, size: number) {
  try {
    panel.resize(size);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Group chat-shell-root-panels not found")) {
      return false;
    }

    throw error;
  }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => getMediaQueryMatch(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function getMediaQueryMatch(query: string) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(query).matches;
}

function focusPrimaryComposer(): void {
  document
    .querySelector<HTMLElement>("[data-chat-shell-primary-focus]")
    ?.focus();
}
