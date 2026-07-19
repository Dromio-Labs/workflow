import type {HTMLAttributes} from "react";

import type {ResolvedShellControl} from "./resolveShellPresentationControls";

export function getPresentedShellControlAttributes(
  control: ResolvedShellControl,
): HTMLAttributes<HTMLElement> & Record<`data-shell-control-${string}`, string | boolean> {
  return {
    "data-shell-control-configurable": control.policy.userConfigurable,
    "data-shell-control-id": control.id,
    "data-shell-control-label": control.label,
    "data-shell-control-required": control.policy.required ?? false,
    "data-shell-control-state": control.resolution.state,
  };
}

export function isShellControlVisible(control: ResolvedShellControl) {
  return control.resolution.state !== "hidden";
}
