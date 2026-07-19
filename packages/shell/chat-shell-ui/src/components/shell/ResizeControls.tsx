import type {PointerEvent as ReactPointerEvent} from "react";
import {Separator as PanelResizeHandle} from "react-resizable-panels";

export function ResizeSeparator({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}) {
  return (
    <PanelResizeHandle
      aria-label={label}
      className={[
        "group relative z-30 flex w-0 shrink-0 items-stretch justify-center bg-transparent outline-none transition-colors",
        disabled ? "pointer-events-none w-0" : "",
      ].join(" ")}
      disabled={disabled}
      style={{cursor: disabled ? "default" : "col-resize"}}
    >
      <span className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 bg-transparent" />
      <span className="my-2 w-px rounded-full bg-transparent transition-colors group-hover:bg-border-hover group-focus-visible:bg-input-border-focused group-data-[separator-active]:bg-input-border-focused" />
    </PanelResizeHandle>
  );
}

export function SidePanelResizeHandle({
  disabled,
  onPointerDown,
}: {
  disabled: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label="Resize side options panel"
      className={[
        "group absolute bottom-0 left-0 top-0 z-20 w-3 -translate-x-1/2 cursor-col-resize bg-transparent outline-none",
        disabled ? "pointer-events-none" : "",
      ].join(" ")}
      disabled={disabled}
      onPointerDown={onPointerDown}
      type="button"
    >
      <span className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-border-hover group-focus-visible:bg-input-border-focused" />
    </button>
  );
}
