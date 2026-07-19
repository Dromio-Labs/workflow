import type {RefinementCtx} from "zod";
import type {ChatShellCapabilities} from "./chatShellPresentation";

type ManifestPresentationFields = {
  readonly capabilities?: ChatShellCapabilities;
  readonly registries: {
    readonly chrome: {readonly appPicker?: object};
  };
};

export function validateManifestPresentation(
  manifest: ManifestPresentationFields,
  context: RefinementCtx,
): void {
  const appPickerCapability = manifest.capabilities?.controls["chrome.app-picker"];
  const appPicker = manifest.registries.chrome.appPicker;

  if (!appPicker && appPickerCapability?.state !== "unsupported") {
    context.addIssue({
      code: "custom",
      message: "A missing app picker requires explicit unsupported capability truth.",
      path: ["registries", "chrome", "appPicker"],
    });
  }

  if (appPicker && appPickerCapability?.state === "unsupported") {
    context.addIssue({
      code: "custom",
      message: "An unsupported app picker must not carry placeholder menu data.",
      path: ["registries", "chrome", "appPicker"],
    });
  }
}
