import {useEffect, useRef, type RefObject} from "react";

import type {ChatShellMenuItem, ChatShellStatus} from "../../contracts/chatShellManifest";
import {getPresentedShellControlAttributes} from "../presentation/presentedShellControl";
import type {ResolvedShellControl} from "../presentation/resolveShellPresentationControls";
import {RightStatusPanel} from "../status/RightStatusPanel";

export function StatusRail({
  compact = false,
  contentRef,
  control,
  onMenuSelect,
  onStatusSelect,
  open,
  status,
}: {
  compact?: boolean;
  contentRef?: RefObject<HTMLDivElement | null>;
  control: ResolvedShellControl;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onStatusSelect?: (statusId: string) => void;
  open: boolean;
  status: ChatShellStatus;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const triggers = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-slot="collapsible-trigger"]'));
    const cleanups = triggers.map((trigger, index) => {
      const section = trigger.closest<HTMLElement>('[data-slot="collapsible"]');
      const content = section?.querySelector<HTMLElement>('[data-slot="collapsible-content"]');
      if (!section || !content) {
        return () => undefined;
      }

      const contentId = content.id || `chat-shell-status-section-${index}`;
      content.id = contentId;
      trigger.setAttribute("aria-controls", contentId);

      const handleClick = () => {
        const nextOpen = trigger.getAttribute("aria-expanded") !== "true";
        const nextState = nextOpen ? "open" : "closed";
        trigger.setAttribute("aria-expanded", String(nextOpen));
        trigger.dataset.state = nextState;
        section.dataset.state = nextState;
        content.dataset.state = nextState;
        content.hidden = !nextOpen;
      };

      trigger.addEventListener("click", handleClick);
      return () => trigger.removeEventListener("click", handleClick);
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [status]);

  return (
    <div
      {...getPresentedShellControlAttributes(control)}
      aria-hidden={!open}
      className={[
        "absolute top-0 bottom-0 right-0 z-10 overflow-hidden transition-[width,opacity,transform] duration-300 ease-out",
        compact ? "max-w-full shadow-[-18px_0_32px_rgba(0,0,0,0.18)]" : "",
        open ? "w-80 opacity-100" : "w-0 opacity-0 pointer-events-none",
      ].join(" ")}
      inert={!open}
      ref={rootRef}
    >
      <div className="block w-80 max-w-full h-full overflow-hidden pt-3 pr-3" ref={contentRef}>
        <RightStatusPanel onMenuSelect={onMenuSelect} onStatusSelect={onStatusSelect} status={status} />
      </div>
    </div>
  );
}
