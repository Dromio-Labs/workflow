import type {
  DromioBrowserApprovalMode,
  DromioBrowserEffectClass,
  DromioBrowserFeatureGroup,
  DromioBrowserPermissionClass,
  DromioBrowserRecoveryPolicy,
} from "./browser.js";

const browserOperationNames = {
  inspect: [
    "bounding-box", "check", "count", "diff-snapshot", "diff-url",
    "get-attribute", "get-by-alt-text", "get-by-label", "get-by-placeholder",
    "get-by-role", "get-by-test-id", "get-by-text", "get-by-title", "get-text",
    "inner-html", "input-value", "inspect", "is-checked", "is-enabled",
    "is-visible", "nth", "read", "snapshot", "styles", "title", "url", "wait",
    "wait-for-function", "wait-for-load-state", "wait-for-url",
  ],
  interaction: [
    "back", "click", "confirm", "deny", "double-click", "dialog", "drag",
    "fill", "focus", "forward", "highlight", "hover", "keyboard", "key-down",
    "key-up", "mouse-down", "mouse-move", "mouse-up", "navigate", "press",
    "reload", "scroll", "scroll-into-view", "select", "swipe", "tap", "type",
    "uncheck", "wheel",
  ],
  tabs: [
    "frame-select", "main-frame", "tab-close", "tab-list", "tab-new",
    "tab-switch", "window-new",
  ],
  files: [
    "annotated-screenshot", "download", "pdf", "screenshot", "upload",
    "wait-for-download",
  ],
  state: [
    "auth-delete", "auth-list", "auth-login", "auth-save", "auth-show",
    "clipboard-read", "clipboard-write", "cookies-clear", "cookies-get",
    "cookies-set", "history-push", "profile-clean", "profile-clear",
    "profile-list", "profile-load", "profile-rename", "profile-save",
    "profile-show", "storage-clear", "storage-get", "storage-set",
  ],
  diagnostics: [
    "console-list", "errors-list", "react-inspect", "react-renders-start",
    "react-renders-stop", "react-suspense", "react-tree", "vitals",
  ],
  network: [
    "credentials-set", "har-start", "har-stop", "headers-set", "request-detail",
    "requests-list", "route-add", "route-remove",
  ],
  emulation: [
    "device-list", "device-set", "geolocation-set", "media-set", "offline-set",
    "viewport-set",
  ],
  recording: [
    "profile-start", "profile-stop", "recording-restart", "recording-start",
    "recording-stop", "stream-disable", "stream-enable", "stream-status",
    "trace-start", "trace-stop",
  ],
  remote: ["attach"],
} as const satisfies Record<DromioBrowserFeatureGroup, readonly string[]>;

type BrowserOperationNames = typeof browserOperationNames;
export type DromioBrowserOperationId = {
  [Feature in keyof BrowserOperationNames]:
    `browser.${Feature}.${BrowserOperationNames[Feature][number]}`;
}[keyof BrowserOperationNames];

export interface DromioBrowserOperationContract {
  readonly id: DromioBrowserOperationId;
  readonly feature: DromioBrowserFeatureGroup;
  readonly effect: DromioBrowserEffectClass;
  readonly permission: DromioBrowserPermissionClass;
  readonly approval: DromioBrowserApprovalMode;
  readonly recovery: DromioBrowserRecoveryPolicy;
  readonly transientInput: boolean;
  readonly producesArtifacts: boolean;
}

const readOperations = new Set<string>([
  ...browserOperationNames.inspect,
  "tab-list", "auth-list", "auth-show", "cookies-get", "profile-list",
  "profile-show", "storage-get", "console-list", "errors-list", "react-inspect",
  "react-suspense", "react-tree", "vitals", "device-list", "request-detail",
  "requests-list", "stream-status",
]);

const transientOperations = new Set<string>([
  "auth-login", "auth-save", "clipboard-read", "clipboard-write", "cookies-get",
  "cookies-set", "credentials-set", "fill", "headers-set", "keyboard", "storage-get",
  "storage-set", "type", "upload",
]);

const artifactOperations = new Set<string>([
  "annotated-screenshot", "download", "pdf", "screenshot", "profile-stop",
  "recording-stop", "trace-stop",
]);

const permissionByFeature = {
  inspect: "browser.read",
  interaction: "browser.interact",
  tabs: "browser.sessions",
  files: "browser.files",
  state: "browser.state",
  diagnostics: "browser.diagnostics",
  network: "browser.network",
  emulation: "browser.state",
  recording: "browser.diagnostics",
  remote: "browser.host",
} as const satisfies Record<DromioBrowserFeatureGroup, DromioBrowserPermissionClass>;

function effectFor(feature: DromioBrowserFeatureGroup, name: string): DromioBrowserEffectClass {
  if (artifactOperations.has(name)) return "artifact";
  if (readOperations.has(name)) return feature === "diagnostics" ? "diagnostic" : "read";
  if (feature === "interaction") return "interaction";
  if (feature === "tabs" || feature === "recording" || feature === "remote") return "lifecycle";
  return "mutation";
}

export const dromioBrowserOperationContracts = Object.entries(browserOperationNames)
  .flatMap(([feature, names]) => names.map((name) => {
    const typedFeature = feature as DromioBrowserFeatureGroup;
    const effect = effectFor(typedFeature, name);
    const isRead = effect === "read" || effect === "diagnostic";
    return {
      id: `browser.${feature}.${name}` as DromioBrowserOperationId,
      feature: typedFeature,
      effect,
      permission: permissionByFeature[typedFeature],
      approval: isRead ? "automatic" : "approval-required",
      recovery: isRead ? "safe-retry" : "never-retry",
      transientInput: transientOperations.has(name),
      producesArtifacts: artifactOperations.has(name),
    } satisfies DromioBrowserOperationContract;
  })) as readonly DromioBrowserOperationContract[];

export const dromioBrowserOperationIds = dromioBrowserOperationContracts
  .map(({ id }) => id) as readonly DromioBrowserOperationId[];

export function findDromioBrowserOperation(
  operationId: string,
): DromioBrowserOperationContract | undefined {
  return dromioBrowserOperationContracts.find(({ id }) => id === operationId);
}
