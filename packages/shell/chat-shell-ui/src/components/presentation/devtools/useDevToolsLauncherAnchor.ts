import {useEffect, type RefObject} from "react";

export function useDevToolsLauncherAnchor(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    const mainPanel = root?.querySelector<HTMLElement>(
      '[data-testid="chat-shell-main-panel"]',
    );
    if (!root || !mainPanel) {
      return;
    }

    const updateAnchor = () => {
      const panelLeft = mainPanel.getBoundingClientRect().left;
      root.style.setProperty(
        "--chat-shell-devtools-left",
        `${Math.max(16, Math.round(panelLeft + 16))}px`,
      );
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(updateAnchor);

    resizeObserver?.observe(root);
    resizeObserver?.observe(mainPanel);
    window.addEventListener("resize", updateAnchor);
    updateAnchor();

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateAnchor);
    };
  }, [rootRef]);
}
