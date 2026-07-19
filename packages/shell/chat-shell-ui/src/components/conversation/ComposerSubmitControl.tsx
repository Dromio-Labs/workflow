import {useEffect, useState} from "react";

import type {ChatShellAction} from "../../contracts/chatShellManifest";
import {Icon} from "../ui/Icon";
import {ArrowUpIcon} from "./ComposerIcons";

const buttonClassName = "group/button inline-flex size-7 shrink-0 items-center justify-center gap-1 rounded-lg border border-transparent bg-brand bg-clip-padding text-[13px] text-foreground-inverse outline-none transition-all select-none hover:bg-brand/80 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export function ComposerSubmitControl({
  canSubmit,
  interruptAction,
  isStreaming,
  isSubmitting,
  onActionTrigger,
}: {
  canSubmit: boolean;
  interruptAction?: ChatShellAction;
  isStreaming: boolean;
  isSubmitting: boolean;
  onActionTrigger?: (actionId: string, surface?: string) => void | Promise<void>;
}) {
  const [isInterrupting, setIsInterrupting] = useState(false);

  useEffect(() => {
    if (!isStreaming) setIsInterrupting(false);
  }, [isStreaming]);

  if (isStreaming && interruptAction) {
    return (
      <button
        aria-label={isInterrupting ? "Stopping active turn" : interruptAction.label}
        className={buttonClassName}
        disabled={isInterrupting}
        onClick={async () => {
          setIsInterrupting(true);
          try {
            await onActionTrigger?.(interruptAction.id, "composer");
          } finally {
            setIsInterrupting(false);
          }
        }}
        type="button"
      >
        <Icon className="size-4" name={interruptAction.icon} />
        <span className="sr-only">{interruptAction.label}</span>
      </button>
    );
  }

  return (
    <button aria-label={isSubmitting ? "Sending" : "Send"} className={buttonClassName} disabled={!canSubmit} type="submit">
      <ArrowUpIcon className="size-4" />
      <span className="sr-only">Send</span>
    </button>
  );
}
