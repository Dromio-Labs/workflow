import {
  createElement,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  WorkflowRunEvent,
  WorkflowViewSnapshot,
} from "@dromio/workflow-room-protocol";
import {
  projectWorkflowPlayback,
  type WorkflowPlaybackEvent,
} from "../client/interactions/workflow-playback.js";
import {
  WorkflowCanvas,
} from "./workflow-canvas.js";

export type WorkflowTracePresenterProps = {
  className?: string;
  defaultPlaybackRate?: number;
  defaultPlaying?: boolean;
  defaultPositionMs?: number;
  defaultSelectedEventId?: string;
  onPlaybackRateChange?(rate: number): void;
  onPlayingChange?(playing: boolean): void;
  onPositionChange?(positionMs: number): void;
  onSelectedEventChange?(event: WorkflowRunEvent | undefined): void;
  playbackRate?: number;
  playing?: boolean;
  positionMs?: number;
  renderEventDetails?(event: WorkflowRunEvent): ReactNode;
  selectedEventId?: string;
  showRaw?: boolean;
  snapshot: WorkflowViewSnapshot;
  style?: CSSProperties;
};

export function WorkflowTracePresenter(props: WorkflowTracePresenterProps): ReactElement {
  const complete = useMemo(() => projectWorkflowPlayback({ snapshot: props.snapshot }), [props.snapshot]);
  const position = useControllableState(
    props.positionMs,
    props.defaultPositionMs ?? complete.durationMs,
    props.onPositionChange,
  );
  const playing = useControllableState(props.playing, props.defaultPlaying ?? false, props.onPlayingChange);
  const playbackRate = useControllableState(
    props.playbackRate,
    props.defaultPlaybackRate ?? 1,
    props.onPlaybackRateChange,
  );
  const selectedId = useControllableState(
    props.selectedEventId,
    props.defaultSelectedEventId,
    (id) => props.onSelectedEventChange?.(complete.events.find((item) => item.id === id)?.event),
  );
  const projection = useMemo(() => projectWorkflowPlayback({
    positionMs: position.value,
    snapshot: props.snapshot,
  }), [position.value, props.snapshot]);
  const positionRef = useRef(projection.positionMs);
  positionRef.current = projection.positionMs;
  const selected = projection.events.find((item) => item.id === selectedId.value) ?? projection.currentEvent;
  const selectedNodeId = selected?.event.stepId ?? projection.visualState.activeNodeId;

  useEffect(() => {
    if (!playing.value || !projection.timed || projection.durationMs <= 0) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = Math.min(
        projection.durationMs,
        positionRef.current + Math.max(0, now - previous) * playbackRate.value,
      );
      previous = now;
      position.set(next);
      if (next >= projection.durationMs) {
        playing.set(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playbackRate.value, playing.value, projection.durationMs, projection.timed]);

  useEffect(() => {
    if (position.value <= complete.durationMs) return;
    position.set(complete.durationMs);
  }, [complete.durationMs, position.value]);

  function togglePlayback() {
    if (projection.positionMs >= projection.durationMs) position.set(0);
    playing.set(!playing.value);
  }

  function selectEvent(item: WorkflowPlaybackEvent) {
    selectedId.set(item.id);
    position.set(item.offsetMs);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== " " || isInteractiveTarget(event.target)) return;
    event.preventDefault();
    togglePlayback();
  }

  return createElement(
    "section",
    {
      className: props.className,
      "data-dromio-workflow-trace-presenter": props.snapshot.run?.runId ?? props.snapshot.render.id,
      onKeyDown: handleKeyDown,
      style: { ...presenterStyle, ...props.style },
    },
    createElement("header", { style: headerStyle },
      createElement("div", undefined,
        createElement("span", { style: eyebrowStyle }, "Workflow trace"),
        createElement("h2", { style: headingStyle }, props.snapshot.render.label),
      ),
      createElement("span", {
        "aria-live": "polite",
        "data-trace-phase": projection.visualState.phase,
        style: statusStyle,
      }, projection.visualState.phase),
    ),
    createElement("div", { style: canvasFrameStyle },
      createElement(WorkflowCanvas, {
        autoFit: true,
        model: projection.render,
        selectedNodeId,
        showInspector: true,
        style: { border: 0, minHeight: 520 },
      }),
    ),
    createElement("div", { "aria-label": "Trace playback controls", style: controlsStyle },
      createElement("button", {
        "aria-keyshortcuts": "Space",
        disabled: !projection.timed,
        onClick: togglePlayback,
        style: primaryButtonStyle,
        type: "button",
      }, playing.value ? "Pause" : projection.positionMs >= projection.durationMs ? "Replay" : "Play"),
      createElement("label", { style: scrubberStyle },
        createElement("span", { style: visuallyHiddenStyle }, "Playback position"),
        createElement("input", {
          "aria-label": "Playback position",
          disabled: !projection.timed,
          max: projection.durationMs,
          min: 0,
          onChange: (event) => {
            playing.set(false);
            position.set(Number(event.currentTarget.value));
          },
          step: Math.max(1, Math.round(projection.durationMs / 1000)),
          style: { width: "100%" },
          type: "range",
          value: projection.positionMs,
        }),
      ),
      createElement("output", { style: timeStyle },
        `${formatDuration(projection.elapsedMs)} / ${formatDuration(projection.durationMs)}`,
      ),
      createElement("label", { style: rateLabelStyle },
        createElement("span", { style: visuallyHiddenStyle }, "Playback speed"),
        createElement("select", {
          "aria-label": "Playback speed",
          onChange: (event: ChangeEvent<HTMLSelectElement>) => playbackRate.set(Number(event.currentTarget.value)),
          style: selectStyle,
          value: playbackRate.value,
        }, [0.5, 1, 2, 4].map((rate) => createElement("option", {
          key: rate,
          value: rate,
        }, `${rate}×`))),
      ),
    ),
    createElement("div", { style: lowerGridStyle },
      createElement("section", { "aria-label": "Trace timeline", style: panelStyle },
        createElement("h3", { style: subheadingStyle }, `Timeline · ${projection.events.length} events`),
        createElement("ol", { style: timelineStyle }, projection.events.map((item) =>
          createElement("li", { key: item.id },
            createElement("button", {
              "aria-current": selected?.id === item.id ? "step" : undefined,
              "data-event-visible": projection.visibleEvents.includes(item),
              onClick: () => selectEvent(item),
              style: timelineButtonStyle(selected?.id === item.id, projection.visibleEvents.includes(item)),
              type: "button",
            },
            createElement("span", { style: eventDotStyle(item.event.type) }),
            createElement("span", { style: eventCopyStyle },
              createElement("strong", undefined, item.event.message ?? eventLabel(item.event.type)),
              createElement("small", { style: mutedStyle }, item.event.stepId ?? item.event.type),
            ),
            createElement("time", { style: timeStyle }, formatDuration(item.offsetMs))),
          ),
        )),
      ),
      createElement("aside", { "aria-label": "Selected trace event", style: panelStyle },
        createElement("h3", { style: subheadingStyle }, "Event details"),
        selected
          ? props.renderEventDetails?.(selected.event) ?? createElement(DefaultEventDetails, { item: selected })
          : createElement("p", { style: mutedStyle }, "No event selected."),
        props.showRaw === false ? undefined : createElement("details", { style: rawStyle },
          createElement("summary", undefined, "Raw snapshot"),
          createElement("pre", { style: preStyle }, JSON.stringify(props.snapshot, null, 2)),
        ),
      ),
    ),
  );
}

function DefaultEventDetails({ item }: { item: WorkflowPlaybackEvent }) {
  return createElement("dl", { style: detailsStyle },
    detail("Type", item.event.type),
    detail("Step", item.event.stepId ?? "—"),
    detail("Elapsed", formatDuration(item.offsetMs)),
    detail("Timestamp", item.event.timestamp ?? "—"),
    item.event.trace ? detail("Trace", String(item.event.trace.traceId ?? "—")) : undefined,
    item.event.detail === undefined
      ? undefined
      : createElement("div", undefined,
          createElement("dt", { style: termStyle }, "Detail"),
          createElement("dd", { style: definitionStyle },
            createElement("pre", { style: preStyle }, JSON.stringify(item.event.detail, null, 2)),
          ),
        ),
  );
}

function detail(label: string, value: string) {
  return createElement("div", { key: label },
    createElement("dt", { style: termStyle }, label),
    createElement("dd", { style: definitionStyle }, value),
  );
}

function useControllableState<Value>(
  controlled: Value | undefined,
  initial: Value,
  onChange?: (value: Value) => void,
) {
  const [internal, setInternal] = useState(initial);
  const value = controlled === undefined ? internal : controlled;
  return {
    set(next: Value) {
      if (controlled === undefined) setInternal(next);
      onChange?.(next);
    },
    value,
  };
}

function formatDuration(value: number): string {
  const milliseconds = Math.max(0, Math.round(value));
  if (milliseconds < 1000) return `${milliseconds}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function eventLabel(type: string): string {
  return type.split(/[._-]/).map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : "").join(" ");
}

function isInteractiveTarget(target: EventTarget): boolean {
  return target instanceof HTMLElement && ["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
}

const presenterStyle: CSSProperties = { color: "#172033", display: "grid", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", gap: 16 };
const headerStyle: CSSProperties = { alignItems: "center", display: "flex", justifyContent: "space-between" };
const headingStyle: CSSProperties = { fontSize: 24, lineHeight: 1.15, margin: "4px 0 0" };
const eyebrowStyle: CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" };
const statusStyle: CSSProperties = { background: "#e2e8f0", borderRadius: 999, fontSize: 12, fontWeight: 700, padding: "6px 10px", textTransform: "capitalize" };
const canvasFrameStyle: CSSProperties = { border: "1px solid #d8dee8", borderRadius: 12, overflow: "auto" };
const controlsStyle: CSSProperties = { alignItems: "center", display: "grid", gap: 12, gridTemplateColumns: "auto minmax(140px, 1fr) auto auto" };
const primaryButtonStyle: CSSProperties = { background: "#172033", border: 0, borderRadius: 8, color: "white", cursor: "pointer", fontWeight: 700, padding: "9px 14px" };
const scrubberStyle: CSSProperties = { alignItems: "center", display: "flex" };
const rateLabelStyle: CSSProperties = { display: "flex" };
const selectStyle: CSSProperties = { background: "white", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 9px" };
const timeStyle: CSSProperties = { color: "#475569", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, whiteSpace: "nowrap" };
const lowerGridStyle: CSSProperties = { display: "grid", gap: 16, gridTemplateColumns: "minmax(280px, .9fr) minmax(320px, 1.1fr)" };
const panelStyle: CSSProperties = { border: "1px solid #d8dee8", borderRadius: 12, minWidth: 0, padding: 16 };
const subheadingStyle: CSSProperties = { fontSize: 14, margin: "0 0 12px" };
const timelineStyle: CSSProperties = { display: "grid", gap: 4, listStyle: "none", margin: 0, maxHeight: 360, overflow: "auto", padding: 0 };
const eventCopyStyle: CSSProperties = { display: "grid", gap: 2, minWidth: 0, textAlign: "left" };
const mutedStyle: CSSProperties = { color: "#64748b", fontSize: 12 };
const rawStyle: CSSProperties = { borderTop: "1px solid #e2e8f0", marginTop: 16, paddingTop: 12 };
const preStyle: CSSProperties = { background: "#0f172a", borderRadius: 8, color: "#e2e8f0", fontSize: 11, maxHeight: 280, overflow: "auto", padding: 12, whiteSpace: "pre-wrap" };
const detailsStyle: CSSProperties = { display: "grid", gap: 10, margin: 0 };
const termStyle: CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" };
const definitionStyle: CSSProperties = { margin: "3px 0 0", overflowWrap: "anywhere" };
const visuallyHiddenStyle: CSSProperties = { clip: "rect(0 0 0 0)", clipPath: "inset(50%)", height: 1, overflow: "hidden", position: "absolute", whiteSpace: "nowrap", width: 1 };

function timelineButtonStyle(selected: boolean, visible: boolean): CSSProperties {
  return { alignItems: "center", background: selected ? "#eff6ff" : "transparent", border: 0, borderRadius: 8, color: "inherit", cursor: "pointer", display: "grid", gap: 10, gridTemplateColumns: "10px minmax(0, 1fr) auto", opacity: visible ? 1 : .45, padding: "9px 8px", width: "100%" };
}

function eventDotStyle(type: string): CSSProperties {
  const background = type.includes("failed") ? "#dc2626" : type.includes("waiting") || type === "question.requested" ? "#d97706" : type.includes("started") ? "#0284c7" : "#16a34a";
  return { background, borderRadius: 999, height: 8, width: 8 };
}
