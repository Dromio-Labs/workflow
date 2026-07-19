import {useCallback, useMemo, useState, type ReactNode} from "react";

import {
  type ChatShellEvent,
  type ChatShellIconRenderer,
  type ChatShellRendererRegistry,
  type ChatShellSidePanelRenderer,
  type ChatShellSlotRenderer,
} from "../chat-shell";
import {ChatShellManifestSchema, type ChatShellManifest} from "../chat-shell-contracts";
import {mockChatShellManifests, type MockChatShellManifestName} from "../chat-shell-mock-backend";
import {DemoChatShell} from "./DemoChatShell";
import {
  createInitialByoBackendSnapshot,
  createManifestFromBackendSnapshot,
  handleBackendControlPlaneEvent,
  type BackendSnapshot,
} from "./byoBackendControlPlane";

type ShowcaseMode = "stock" | "runtime" | "appearance" | "renderers" | "byo";
type AppearancePreset = "default" | "compact-light" | "dense-console";

const runtimeVariants: MockChatShellManifestName[] = ["streaming", "complete", "empty", "error"];
const appearancePresets: AppearancePreset[] = ["default", "compact-light", "dense-console"];

export function ChatShellShowcase({initialMode = "stock"}: {readonly initialMode?: ShowcaseMode}) {
  const [mode, setMode] = useState<ShowcaseMode>(initialMode);
  const [runtimeVariant, setRuntimeVariant] = useState<MockChatShellManifestName>("streaming");
  const [appearancePreset, setAppearancePreset] = useState<AppearancePreset>("default");
  const [eventLog, setEventLog] = useState<string[]>(["showcase.ready"]);
  const [backendSnapshot, setBackendSnapshot] = useState<BackendSnapshot>(() => createInitialByoBackendSnapshot());
  const [shellFullscreen, setShellFullscreen] = useState(false);

  const manifest = useMemo(() => {
    if (mode === "byo") {
      return createManifestFromBackendSnapshot(backendSnapshot);
    }

    if (mode === "runtime") {
      return withShowcaseSizing(mockChatShellManifests[runtimeVariant]);
    }

    if (mode === "appearance") {
      return createAppearanceManifest(appearancePreset);
    }

    if (mode === "renderers") {
      return createRendererManifest();
    }

    return withShowcaseSizing(mockChatShellManifests.default);
  }, [appearancePreset, backendSnapshot, mode, runtimeVariant]);

  const renderers = useMemo<ChatShellRendererRegistry | undefined>(() => {
    if (mode !== "renderers") {
      return undefined;
    }

    return showcaseRenderers;
  }, [mode]);

  const handleEvent = useCallback((event: ChatShellEvent) => {
    if (mode === "byo") {
      setBackendSnapshot((current) => {
        const result = handleBackendControlPlaneEvent(current, event);
        setEventLog((entries) => [result.eventLogEntry, ...entries].slice(0, 8));
        return result.snapshot;
      });
      return;
    }

    setEventLog((entries) => [formatEvent(event), ...entries].slice(0, 8));
  }, [mode]);

  return (
    <main className={shellFullscreen ? "chat-shell-showcase chat-shell-showcase-fullscreen" : "chat-shell-showcase"}>
      {!shellFullscreen ? (
        <aside className="chat-shell-showcase-sidebar" aria-label="ChatShell showcase controls">
          <div className="chat-shell-showcase-heading">
            <span>ChatShell v8</span>
            <strong>Component workbench</strong>
          </div>

          <ControlGroup label="Mode">
            <SegmentedControl
              options={[
                ["stock", "Stock"],
                ["runtime", "States"],
                ["appearance", "Theme"],
                ["renderers", "Renderers"],
                ["byo", "BYO backend"],
              ]}
              value={mode}
              onChange={setMode}
            />
          </ControlGroup>

          {mode === "runtime" ? (
            <ControlGroup label="Runtime state">
              <SegmentedControl
                options={runtimeVariants.map((variant) => [variant, variant])}
                value={runtimeVariant}
                onChange={setRuntimeVariant}
              />
            </ControlGroup>
          ) : null}

          {mode === "appearance" ? (
            <ControlGroup label="Appearance preset">
              <SegmentedControl
                options={appearancePresets.map((preset) => [preset, preset])}
                value={appearancePreset}
                onChange={setAppearancePreset}
              />
            </ControlGroup>
          ) : null}

          {mode === "renderers" ? (
            <div className="chat-shell-showcase-note">
              Custom side-panel renderer, wrapped window chrome slot, and terminal icon override are active.
            </div>
          ) : null}

          {mode === "byo" ? (
            <div className="chat-shell-showcase-note">
              Composer submit is reduced by a local backend simulator, parsed with Zod, then replaces manifest state.
            </div>
          ) : null}

          <ControlGroup label="Event log">
            <ol className="chat-shell-showcase-events" aria-label="Recent ChatShell events">
              {eventLog.map((entry, index) => (
                <li key={`${entry}-${index}`}>{entry}</li>
              ))}
            </ol>
          </ControlGroup>
        </aside>
      ) : null}

      <section className="chat-shell-showcase-preview" aria-label="ChatShell preview">
        <DemoChatShell
          initialFullscreen={shellFullscreen}
          key={mode}
          manifest={manifest}
          onEvent={handleEvent}
          onFullscreenChange={setShellFullscreen}
          renderers={renderers}
          simulateStreaming={mode === "stock" && runtimeVariant === "streaming"}
        />
      </section>
    </main>
  );
}

function ControlGroup({children, label}: {readonly children: ReactNode; readonly label: string}) {
  return (
    <section className="chat-shell-showcase-control">
      <h2>{label}</h2>
      {children}
    </section>
  );
}

function SegmentedControl<T extends string>({
  onChange,
  options,
  value,
}: {
  readonly onChange: (value: T) => void;
  readonly options: Array<readonly [T, string]>;
  readonly value: T;
}) {
  return (
    <div className="chat-shell-showcase-segments">
      {options.map(([optionValue, label]) => (
        <button
          aria-pressed={value === optionValue}
          key={optionValue}
          onClick={() => onChange(optionValue)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function createAppearanceManifest(preset: AppearancePreset) {
  const base = structuredClone(mockChatShellManifests.complete);

  if (preset === "compact-light") {
    base.appearance = {
      ...base.appearance,
      colorMode: "light",
      density: "compact",
      radius: {
        ...base.appearance?.radius,
        frame: "8px",
        frameSm: "8px",
        mode: "sharp",
      },
      tokens: {
        accent: "#1f7a5c",
        brand: "#1f7a5c",
        windowBg: "rgba(255, 255, 255, 0.96)",
      },
      typography: {
        ...base.appearance?.typography,
        scale: "compact",
      },
    };
  }

  if (preset === "dense-console") {
    base.appearance = {
      ...base.appearance,
      colorMode: "dark",
      density: "compact",
      radius: {
        ...base.appearance?.radius,
        frame: "10px",
        frameSm: "10px",
      },
      tokens: {
        accent: "#f2c94c",
        brand: "#f2c94c",
        surface: "rgba(255, 255, 255, 0.055)",
        windowBg: "rgba(9, 10, 11, 0.96)",
      },
      typography: {
        ...base.appearance?.typography,
        monoFontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        scale: "compact",
      },
    };
  }

  return withShowcaseSizing(base);
}

function createRendererManifest() {
  const manifest = structuredClone(mockChatShellManifests.complete);

  manifest.layout.sidePanel.defaultOpen = true;
  manifest.registries.chrome.sidePanel.initialSurfaceId = "showcase-inspector";
  manifest.registries.chrome.sidePanel.surfaces = [
    {
      content: {
        body: "This surface is declared in the manifest and rendered by the host app.",
        items: [
          {label: "rendererId", value: "side-panel.showcase-inspector"},
          {label: "surfaceKind", value: "showcase-inspector"},
          {label: "ownership", value: "backend id, frontend implementation"},
        ],
        title: "Renderer inspector",
      },
      icon: "target",
      label: "Inspector",
      rendererId: "side-panel.showcase-inspector",
      surfaceId: "showcase-inspector",
      surfaceKind: "showcase-inspector",
    },
    ...manifest.registries.chrome.sidePanel.surfaces,
  ];
  manifest.registries.chrome.sidePanel.tabMenuSurfaceIds = ["showcase-inspector", "review", "terminal", "browser", "files", "side-chat"];
  manifest.registries.layoutSlots = manifest.registries.layoutSlots.map((slot) => slot.region === "windowChrome"
    ? {
        ...slot,
        rendererId: "shell.showcase.window-chrome",
      }
    : slot);

  return ChatShellManifestSchema.parse(withShowcaseSizing(manifest));
}

function withShowcaseSizing(manifest: ChatShellManifest) {
  return ChatShellManifestSchema.parse({
    ...manifest,
    appearance: {
      ...manifest.appearance,
      shell: {
        ...manifest.appearance?.shell,
        viewportHeight: "640px",
        viewportHeightLg: "640px",
        viewportHeightMd: "620px",
        viewportHeightSm: "620px",
        viewportMaxWidth: "100%",
      },
    },
  });
}

const showcaseSidePanelRenderer: ChatShellSidePanelRenderer = ({helpers, layout, surface}) => (
  <section className="chat-shell-showcase-custom-panel" aria-label="Showcase inspector">
    <header>
      <span>{surface.surfaceKind}</span>
      <strong>{surface.content.title}</strong>
    </header>
    <p>{surface.content.body}</p>
    <dl>
      {surface.content.items?.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
      <div>
        <dt>width</dt>
        <dd>{layout.width}px</dd>
      </div>
    </dl>
    <div className="chat-shell-showcase-custom-panel-default">
      {helpers.renderDefaultContent()}
    </div>
  </section>
);

const showcaseWindowChromeRenderer: ChatShellSlotRenderer = ({helpers, layout}) => (
  <div className="chat-shell-showcase-window-wrapper" data-fullscreen={String(layout.fullscreen)}>
    <div className="chat-shell-showcase-window-label">shell slot wrapper</div>
    {helpers.renderDefault()}
  </div>
);

const terminalIconRenderer: ChatShellIconRenderer = ({className}) => (
  <span aria-hidden="true" className={`${className} chat-shell-showcase-terminal-icon`}>$</span>
);

const showcaseRenderers: ChatShellRendererRegistry = {
  icons: {
    terminal: terminalIconRenderer,
  },
  shell: {
    "shell.showcase.window-chrome": showcaseWindowChromeRenderer,
  },
  sidePanel: {
    "side-panel.showcase-inspector": showcaseSidePanelRenderer,
  },
};

function formatEvent(event: ChatShellEvent) {
  if (event.type === "composer.submit") {
    return `composer.submit "${event.payload.prompt}"`;
  }

  if ("surfaceId" in event) {
    return `${event.type} ${event.surfaceId}`;
  }

  if ("taskId" in event) {
    return `${event.type} ${event.taskId}`;
  }

  return event.type;
}
