import {
  dromioBrowserOperationContracts,
  type DromioBrowserOperationId,
} from "./browser-operations.js";

export interface DromioBrowserToolSchema {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly required?: readonly string[];
}

const text = (description: string, maxLength = 4_096) => ({
  type: "string", minLength: 1, maxLength, description,
});
const number = (description: string, minimum?: number, maximum?: number) => ({
  type: "number", description, ...(minimum === undefined ? {} : { minimum }),
  ...(maximum === undefined ? {} : { maximum }),
});
const boolean = (description: string) => ({ type: "boolean", description });
const empty = (): DromioBrowserToolSchema => ({ type: "object", additionalProperties: false, properties: {} });
const fields = (
  properties: DromioBrowserToolSchema["properties"],
  required: readonly string[] = [],
): DromioBrowserToolSchema => ({
  type: "object", additionalProperties: false, properties,
  ...(required.length > 0 ? { required } : {}),
});

function schemaFor(id: DromioBrowserOperationId): DromioBrowserToolSchema {
  const name = id.split(".").at(-1)!;
  if (["click", "fill"].includes(name)) {
    return fields({
      observationId: text("Fresh semantic observation ID.", 256),
      ref: text("Element reference from the same observation.", 64),
      ...(name === "fill" ? { text: text("Transient field text.") } : {}),
    }, name === "fill" ? ["observationId", "ref", "text"] : ["observationId", "ref"]);
  }
  if (name === "navigate" || name === "history-push" || name === "wait-for-url") {
    return fields({ url: text("HTTP(S) URL.", 8_192), timeoutMs: number("Bounded timeout in milliseconds.", 1, 30_000) }, ["url"]);
  }
  if (["get-by-role", "get-by-text"].includes(name)) {
    const key = name === "get-by-role" ? "role" : "text";
    return fields({ [key]: text(`Accessible ${key}.`, 256) }, [key]);
  }
  if (["get-by-alt-text", "get-by-label", "get-by-placeholder", "get-by-test-id", "get-by-title"].includes(name)) {
    return fields({ value: text("Exact selector value.", 256) }, ["value"]);
  }
  if (["bounding-box", "check", "count", "get-attribute", "inner-html", "input-value", "is-visible", "styles", "focus", "highlight", "hover", "scroll-into-view", "select", "tap", "double-click", "drag", "uncheck"].includes(name)) {
    return fields({
      selector: text("CSS selector.", 1_024),
      ...(name === "get-attribute" ? { attribute: text("Attribute name.", 128) } : {}),
      ...(name === "select" ? { value: text("Option value.", 1_024) } : {}),
    }, name === "get-attribute" ? ["selector", "attribute"] : name === "select" ? ["selector", "value"] : ["selector"]);
  }
  if (name === "nth") return fields({ index: number("Zero-based result index.", 0, 199) }, ["index"]);
  if (["read", "snapshot", "inspect", "get-text", "title", "url"].includes(name)) return fields({ maxBytes: number("Maximum text bytes.", 1, 1_000_000) });
  if (name === "diff-snapshot") return fields({ beforeText: text("Prior sanitized page text.", 64_000), maxBytes: number("Maximum text bytes.", 1, 1_000_000) }, ["beforeText"]);
  if (name === "diff-url") return fields({ beforeUrl: text("Prior URL.", 8_192) }, ["beforeUrl"]);
  if (name === "wait") return fields({ durationMs: number("Wait duration.", 0, 10_000) });
  if (["wait-for-function", "wait-for-load-state"].includes(name)) return fields({ condition: text("Named safe condition.", 64), timeoutMs: number("Bounded timeout.", 1, 30_000) }, name === "wait-for-function" ? ["condition"] : []);
  if (["key-down", "key-up", "press"].includes(name)) return fields({ key: text("Keyboard key.", 64) }, ["key"]);
  if (["keyboard", "type", "clipboard-write"].includes(name)) return fields({ text: text("Transient input text.") }, ["text"]);
  if (["mouse-down", "mouse-move", "mouse-up", "wheel"].includes(name)) return fields({ x: number("Viewport x coordinate."), y: number("Viewport y coordinate."), deltaX: number("Horizontal wheel delta."), deltaY: number("Vertical wheel delta.") }, ["x", "y"]);
  if (name === "scroll") return fields({ deltaX: number("Horizontal scroll delta."), deltaY: number("Vertical scroll delta.") });
  if (name === "swipe") return fields({ fromX: number("Start x."), fromY: number("Start y."), toX: number("End x."), toY: number("End y.") }, ["fromX", "fromY", "toX", "toY"]);
  if (["confirm", "deny", "dialog"].includes(name)) return fields({ text: text("Optional prompt response."), policy: { enum: ["accept", "dismiss"] } });
  if (["tab-switch", "tab-close", "frame-select"].includes(name)) return fields({ tabId: text("Scoped tab ID.", 128), frameId: text("Scoped frame ID.", 128) }, name === "frame-select" ? ["frameId"] : ["tabId"]);
  if (["tab-new", "window-new"].includes(name)) return fields({ url: text("Optional initial HTTP(S) URL.", 8_192), label: text("Stable tab label.", 128) });
  if (["screenshot", "annotated-screenshot"].includes(name)) return fields({ fullPage: boolean("Capture the full document."), maxBytes: number("Maximum snapshot text bytes.", 1, 1_000_000) });
  if (name === "pdf") return fields({ landscape: boolean("Use landscape layout."), scale: number("Print scale.", 0.1, 2) });
  if (name === "upload") return fields({ observationId: text("Fresh observation ID.", 256), ref: text("File input reference.", 64), fileIds: { type: "array", minItems: 1, maxItems: 10, items: text("Scoped file ID.", 256) } }, ["observationId", "ref", "fileIds"]);
  if (["download", "wait-for-download"].includes(name)) return fields({ url: text("HTTP(S) download URL.", 8_192), timeoutMs: number("Bounded download wait.", 1, 30_000) }, ["url"]);
  if (name === "cookies-get") return fields({ urls: { type: "array", maxItems: 20, items: text("HTTP(S) URL.", 8_192) } });
  if (name === "cookies-set") return fields({ cookies: { type: "array", minItems: 1, maxItems: 50, items: { type: "object" } } }, ["cookies"]);
  if (["storage-get", "storage-clear"].includes(name)) return fields({ storage: { enum: ["local", "session"] }, key: text("Storage key.", 1_024) });
  if (name === "storage-set") return fields({ storage: { enum: ["local", "session"] }, key: text("Storage key.", 1_024), value: text("Transient storage value.", 16_384) }, ["key", "value"]);
  if (["auth-delete", "auth-login", "auth-save", "auth-show", "profile-clean", "profile-clear", "profile-load", "profile-rename", "profile-save", "profile-show"].includes(name)) return fields({ name: text("Scoped profile or auth-state name.", 128) }, ["name"]);
  if (name === "credentials-set") return fields({ username: text("Transient username.", 1_024), password: text("Transient password.", 4_096) }, ["username", "password"]);
  if (name === "headers-set") return fields({ headers: { type: "object", additionalProperties: { type: "string", maxLength: 8_192 }, maxProperties: 50 } }, ["headers"]);
  if (["request-detail"].includes(name)) return fields({ requestId: text("Scoped request ID.", 256) }, ["requestId"]);
  if (name === "route-add") return fields({ pattern: text("Bounded HTTP(S) route pattern.", 2_048), action: { enum: ["continue", "block", "mock"] }, status: number("Mock status.", 100, 599), body: text("Transient mock body.", 65_536) }, ["pattern", "action"]);
  if (name === "device-set") return fields({ deviceId: { enum: ["desktop", "phone", "tablet"] } }, ["deviceId"]);
  if (name === "viewport-set") return fields({ width: number("Viewport width.", 64, 7680), height: number("Viewport height.", 64, 4320), deviceScaleFactor: number("Device scale.", 0.5, 4), mobile: boolean("Enable mobile emulation.") }, ["width", "height"]);
  if (name === "geolocation-set") return fields({ latitude: number("Latitude.", -90, 90), longitude: number("Longitude.", -180, 180), accuracy: number("Accuracy metres.", 0, 10_000) }, ["latitude", "longitude"]);
  if (name === "media-set") return fields({ media: { enum: ["screen", "print"] }, features: { type: "array", maxItems: 20, items: { type: "object" } } });
  if (name === "offline-set") return fields({ offline: boolean("Whether network access is disabled.") }, ["offline"]);
  if (name === "attach") return fields({ backend: { enum: ["managed", "remote"] } }, ["backend"]);
  return empty();
}

export const dromioBrowserOperationInputSchemas = Object.fromEntries(
  dromioBrowserOperationContracts.map(({ id }) => [id, schemaFor(id)]),
) as Readonly<Record<DromioBrowserOperationId, DromioBrowserToolSchema>>;

export const dromioBrowserOperationOutputSchema = {
  description: "JSON-compatible result defined by the canonical browser operation.",
} as const;
