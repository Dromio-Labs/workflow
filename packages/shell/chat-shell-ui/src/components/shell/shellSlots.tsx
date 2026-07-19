import type {ReactNode} from "react";

import type {ChatShellSlot} from "../../contracts/chatShellManifest";
import {Composer} from "../conversation/Composer";
import type {ResolvedShellControls} from "../presentation/resolveShellPresentationControls";
import type {ChatShellSidePanelRendererProps, ChatShellSidePanelRendererRegistry} from "./ChatShell.types";
import {SidePanelContent, sidePanelComposerLayout} from "./SidePanel";

export function assertSlotRenderer(slot: ChatShellSlot, rendererId: ChatShellSlot["rendererId"]) {
  if (slot.rendererId !== rendererId) {
    throw new Error(`Shell slot "${slot.id}" registered renderer "${slot.rendererId}" but expected "${rendererId}".`);
  }
}

export const builtInSidePanelRenderers = {
  "side-panel.composer": (props) => props.helpers.renderComposer(),
  "side-panel.default-content": (props) => props.helpers.renderDefaultContent(),
} satisfies ChatShellSidePanelRendererRegistry;

export function renderSidePanelComposer(props: Pick<ChatShellSidePanelRendererProps, "composer" | "onComposerSubmit" | "onMenuSelect"> & {readonly controls: ResolvedShellControls}): ReactNode {
  return (
    <div className="chat-shell-side-panel-composer flex h-full min-h-0 flex-col justify-end px-6 pb-4">
      <Composer
        composer={props.composer}
        controls={props.controls}
        layout={sidePanelComposerLayout}
        onMenuSelect={props.onMenuSelect}
        onSubmit={props.onComposerSubmit}
        variant="side-panel"
      />
    </div>
  );
}

export function renderSidePanelDefaultContent(props: Pick<ChatShellSidePanelRendererProps, "surface">): ReactNode {
  return (
    <div className="chat-shell-side-panel-default-content h-full overflow-y-auto px-8 pb-6 pt-6">
      <SidePanelContent surface={props.surface} />
    </div>
  );
}

export function renderSidePanelSurface({
  registry,
  rendererProps,
}: {
  registry: ChatShellSidePanelRendererRegistry;
  rendererProps: ChatShellSidePanelRendererProps;
}): ReactNode {
  const renderer = registry[rendererProps.surface.rendererId];

  if (!renderer) {
    throw new Error(`Side panel surface "${rendererProps.surface.surfaceId}" references unregistered renderer "${rendererProps.surface.rendererId}".`);
  }

  return renderer(rendererProps);
}
