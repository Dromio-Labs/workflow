import type {
  ShellControlCapability,
  ShellControlId,
  ShellControlPolicy,
  ShellPresentationPatch,
  ShellPresentationPreferences,
} from "../../contracts/chatShellPresentation";

export type ResolvedShellControlState =
  | {readonly state: "hidden"}
  | {readonly reason: string; readonly state: "disabled"}
  | {readonly state: "visible"};

export type ResolveShellControlInput = {
  readonly capability: ShellControlCapability;
  readonly contentAvailable: boolean;
  readonly controlId: ShellControlId;
  readonly patch?: ShellPresentationPatch;
  readonly policy: ShellControlPolicy;
  readonly preferences?: ShellPresentationPreferences;
};

export function resolveShellControlState({
  capability,
  contentAvailable,
  controlId,
  patch,
  policy,
  preferences,
}: ResolveShellControlInput): ResolvedShellControlState {
  if (capability.state === "unsupported") {
    return {state: "hidden"};
  }

  const productVisibility = patch?.controls[controlId]?.visibility ?? policy.defaultVisibility;
  const preferredVisibility = policy.userConfigurable
    ? preferences?.controls[controlId]
    : undefined;
  const visibility = policy.required
    ? "visible"
    : preferredVisibility ?? productVisibility;

  if (visibility === "hidden" || (visibility === "auto" && !contentAvailable)) {
    return {state: "hidden"};
  }

  if (capability.state === "temporarily-unavailable") {
    return {reason: capability.reason, state: "disabled"};
  }

  return {state: "visible"};
}
