import type {ChatShellManifest} from "../../../contracts/chatShellManifest";
import {
  chatShellPresentationSchemaVersion,
  type ShellControlId,
  type ShellPresentationPatch,
  type ShellPresentationPolicy,
  type ShellPresentationPreferences,
} from "../../../contracts/chatShellPresentation";
import {resolveShellPresentationControls} from "../resolveShellPresentationControls";
import {shellControlIds} from "../shellControlCatalog";

export type AuthoringChoice = "inherit" | "visible" | "hidden";
export type AuthoringResult = "shown" | "hidden" | "sample" | "unsupported";

export type ControlAuthoringState = {
  readonly baseline: "shown" | "hidden" | "unsupported";
  readonly canHide: boolean;
  readonly canShow: boolean;
  readonly draft: AuthoringChoice;
  readonly result: AuthoringResult;
};

export function createEmptyPresentationPatch(): ShellPresentationPatch {
  return {controls: {}, schemaVersion: chatShellPresentationSchemaVersion};
}

export function mergePresentationPatches(
  baseline: ShellPresentationPatch | undefined,
  overrides: ShellPresentationPatch,
): ShellPresentationPatch {
  return {
    controls: {...baseline?.controls, ...overrides.controls},
    schemaVersion: chatShellPresentationSchemaVersion,
  };
}

export function createAuthoringCanvasPatch(): ShellPresentationPatch {
  return {
    controls: Object.fromEntries(shellControlIds.map((controlId) => [
      controlId,
      {visibility: "visible" as const},
    ])),
    schemaVersion: chatShellPresentationSchemaVersion,
  };
}

export function resolveControlAuthoringStates({
  authoringManifest,
  baselinePatch,
  draftOverrides,
  manifest,
  policy,
  preferences,
}: {
  readonly authoringManifest?: ChatShellManifest;
  readonly baselinePatch?: ShellPresentationPatch;
  readonly draftOverrides: ShellPresentationPatch;
  readonly manifest: ChatShellManifest;
  readonly policy?: ShellPresentationPolicy;
  readonly preferences?: ShellPresentationPreferences;
}): Readonly<Record<ShellControlId, ControlAuthoringState>> {
  const effectivePatch = mergePresentationPatches(baselinePatch, draftOverrides);
  const baseline = resolveShellPresentationControls({manifest, patch: baselinePatch, policy, preferences});
  const effective = resolveShellPresentationControls({manifest, patch: effectivePatch, policy, preferences});
  const authoring = resolveShellPresentationControls({
    manifest: authoringManifest ?? manifest,
    patch: effectivePatch,
    policy,
    preferences,
  });

  return Object.fromEntries(shellControlIds.map((controlId) => {
    const unsupported = manifest.capabilities?.controls[controlId]?.state === "unsupported";
    const baselineState = unsupported
      ? "unsupported"
      : baseline[controlId].resolution.state === "hidden" ? "hidden" : "shown";
    const draft = draftOverrides.controls[controlId]?.visibility ?? "inherit";
    const configurable = baseline[controlId].policy.userConfigurable && !unsupported;
    const result = resolveAuthoringResult({
      authoringVisible: authoring[controlId].resolution.state !== "hidden",
      effectiveVisible: effective[controlId].resolution.state !== "hidden",
      unsupported,
    });

    return [controlId, {
      baseline: baselineState,
      canHide: configurable && !baseline[controlId].policy.required,
      canShow: configurable,
      draft,
      result,
    }];
  })) as Record<ShellControlId, ControlAuthoringState>;
}

function resolveAuthoringResult({
  authoringVisible,
  effectiveVisible,
  unsupported,
}: {
  readonly authoringVisible: boolean;
  readonly effectiveVisible: boolean;
  readonly unsupported: boolean;
}): AuthoringResult {
  if (unsupported) return "unsupported";
  if (effectiveVisible) return "shown";
  if (authoringVisible) return "sample";
  return "hidden";
}
