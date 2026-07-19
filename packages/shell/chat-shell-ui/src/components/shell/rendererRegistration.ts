import type {
  ChatShellExtension,
  ChatShellRendererRegistry,
  ChatShellSidePanelRendererRegistry,
  ChatShellSlotRendererRegistry,
} from "./ChatShell.types";
import type {
  ChatShellManifest,
  ChatShellSidePanelRendererId,
  ChatShellSlotRendererId,
} from "../../contracts/chatShellManifest";

export const chatShellBuiltInSidePanelRendererIds = {
  composer: "side-panel.composer",
  defaultContent: "side-panel.default-content",
} as const satisfies Record<string, ChatShellSidePanelRendererId>;

export type ChatShellBuiltInSidePanelRendererId =
  (typeof chatShellBuiltInSidePanelRendererIds)[keyof typeof chatShellBuiltInSidePanelRendererIds];

export const chatShellBuiltInSlotRendererIds = {
  composer: "shell.composer",
  overlays: "shell.overlays.mac-top",
  settings: "shell.settings",
  sidebar: "shell.sidebar",
  sidePanel: "shell.side-panel",
  statusRail: "shell.status-rail",
  timeline: "shell.timeline",
  windowChrome: "shell.window-chrome",
} as const satisfies Record<string, ChatShellSlotRendererId>;

export type ChatShellBuiltInSlotRendererId =
  (typeof chatShellBuiltInSlotRendererIds)[keyof typeof chatShellBuiltInSlotRendererIds];

export function defineChatShellRenderers<const TRenderers extends ChatShellRendererRegistry>(
  renderers: TRenderers,
): TRenderers {
  return renderers;
}

export function defineChatShellSidePanelRenderers<const TRenderers extends ChatShellSidePanelRendererRegistry>(
  renderers: TRenderers,
): TRenderers {
  return renderers;
}

export function defineChatShellSlotRenderers<const TRenderers extends ChatShellSlotRendererRegistry>(
  renderers: TRenderers,
): TRenderers {
  return renderers;
}

export function defineChatShellExtension<const TExtension extends ChatShellExtension>(
  extension: TExtension,
): TExtension {
  return extension;
}

export function resolveChatShellExtensionRegistrations({
  extensions,
  manifest,
  renderers,
}: {
  extensions?: ChatShellExtension | readonly ChatShellExtension[];
  manifest: ChatShellManifest;
  renderers?: ChatShellRendererRegistry;
}): {
  manifest: ChatShellManifest;
  renderers?: ChatShellRendererRegistry;
} {
  const extensionList = normalizeExtensions(extensions);

  if (extensionList.length === 0) {
    return {manifest, renderers};
  }

  let nextManifest = manifest;
  let nextRenderers: ChatShellRendererRegistry = {};

  extensionList.forEach((extension) => {
    nextManifest = applyExtensionToManifest(nextManifest, extension);
    nextRenderers = mergeRendererRegistries(nextRenderers, collectExtensionRenderers(extension));
  });

  nextRenderers = mergeRendererRegistries(nextRenderers, renderers);

  return {
    manifest: nextManifest,
    renderers: hasRendererRegistries(nextRenderers) ? nextRenderers : undefined,
  };
}

function normalizeExtensions(extensions?: ChatShellExtension | readonly ChatShellExtension[]) {
  if (!extensions) {
    return [];
  }

  return Array.isArray(extensions) ? extensions : [extensions];
}

function applyExtensionToManifest(manifest: ChatShellManifest, extension: ChatShellExtension): ChatShellManifest {
  const sidePanelSurfaces = extension.sidePanel?.surfaces?.map(({renderer: _renderer, ...surface}) => surface) ?? [];
  const shellSlots = extension.shell?.slots?.map(({renderer: _renderer, ...slot}, index) => ({
    ...slot,
    id: slot.id ?? `${slot.region}.${slot.rendererId}`,
    order: slot.order ?? getNextSlotOrder(manifest, slot.region, index),
  })) ?? [];

  if (sidePanelSurfaces.length === 0 && shellSlots.length === 0 && !extension.sidePanel?.initialSurfaceId && !extension.sidePanel?.tabMenuSurfaceIds) {
    return manifest;
  }

  const nextSurfaces = appendUniqueById(
    manifest.registries.chrome.sidePanel.surfaces,
    sidePanelSurfaces,
    "surfaceId",
  );
  const nextTabMenuSurfaceIds = extension.sidePanel?.tabMenuSurfaceIds
    ? appendUniqueValues(manifest.registries.chrome.sidePanel.tabMenuSurfaceIds ?? [], extension.sidePanel.tabMenuSurfaceIds)
    : manifest.registries.chrome.sidePanel.tabMenuSurfaceIds
      ? appendUniqueValues(manifest.registries.chrome.sidePanel.tabMenuSurfaceIds, sidePanelSurfaces.map((surface) => surface.surfaceId))
      : manifest.registries.chrome.sidePanel.tabMenuSurfaceIds;
  const nextLayoutSlots = appendUniqueById(
    manifest.registries.layoutSlots,
    shellSlots,
    "id",
  );

  return {
    ...manifest,
    registries: {
      ...manifest.registries,
      chrome: {
        ...manifest.registries.chrome,
        sidePanel: {
          ...manifest.registries.chrome.sidePanel,
          initialSurfaceId: extension.sidePanel?.initialSurfaceId ?? manifest.registries.chrome.sidePanel.initialSurfaceId,
          surfaces: nextSurfaces,
          tabMenuSurfaceIds: nextTabMenuSurfaceIds,
        },
      },
      layoutSlots: nextLayoutSlots,
    },
  };
}

function collectExtensionRenderers(extension: ChatShellExtension): ChatShellRendererRegistry {
  const sidePanelRenderers = extension.sidePanel?.surfaces?.reduce<ChatShellSidePanelRendererRegistry>((registry, surface) => {
    if (surface.renderer) {
      registry[surface.rendererId] = surface.renderer;
    }

    return registry;
  }, {});
  const shellRenderers = extension.shell?.slots?.reduce<ChatShellSlotRendererRegistry>((registry, slot) => {
    if (slot.renderer) {
      registry[slot.rendererId] = slot.renderer;
    }

    return registry;
  }, {});

  return mergeRendererRegistries(
    {
      icons: extension.icons,
      shell: shellRenderers,
      sidePanel: sidePanelRenderers,
    },
    extension.renderers,
  );
}

function mergeRendererRegistries(
  base?: ChatShellRendererRegistry,
  override?: ChatShellRendererRegistry,
): ChatShellRendererRegistry {
  return {
    icons: {
      ...base?.icons,
      ...override?.icons,
    },
    shell: {
      ...base?.shell,
      ...override?.shell,
    },
    sidePanel: {
      ...base?.sidePanel,
      ...override?.sidePanel,
    },
  };
}

function hasRendererRegistries(renderers: ChatShellRendererRegistry) {
  return Boolean(
    Object.keys(renderers.icons ?? {}).length ||
    Object.keys(renderers.shell ?? {}).length ||
    Object.keys(renderers.sidePanel ?? {}).length,
  );
}

function appendUniqueById<const TItem extends Record<TKey, string>, const TKey extends keyof TItem>(
  existing: readonly TItem[],
  additions: readonly TItem[],
  key: TKey,
): TItem[] {
  const seen = new Set(existing.map((item) => item[key]));
  const next = [...existing];

  additions.forEach((item) => {
    const id = item[key];
    if (seen.has(id)) {
      return;
    }

    seen.add(id);
    next.push(item);
  });

  return next;
}

function appendUniqueValues(existing: readonly string[], additions: readonly string[]) {
  const seen = new Set(existing);
  const next = [...existing];

  additions.forEach((value) => {
    if (seen.has(value)) {
      return;
    }

    seen.add(value);
    next.push(value);
  });

  return next;
}

function getNextSlotOrder(manifest: ChatShellManifest, region: string, index: number) {
  const existingOrders = manifest.registries.layoutSlots
    .filter((slot) => slot.region === region)
    .map((slot) => slot.order);

  return (existingOrders.length ? Math.max(...existingOrders) + 1 : index) + index;
}
