import type { JsonObject, JsonValue } from "../shared/json.js";

export type ClientSurfaceActor = {
  displayName?: string;
  id: string;
  kind: "agent" | "service" | "user";
};

export type ClientSurfaceEnvelope<TPayload extends JsonObject = JsonObject> = {
  actor: ClientSurfaceActor;
  payload: TPayload;
  receivedAt: string;
  surfaceSessionId: string;
  traceId?: string;
};

export type ClientSurfaceCommand<TPayload extends JsonObject = JsonObject> = {
  commandId: string;
  kind: string;
  payload: TPayload;
};

export type ClientSurfaceEvent<TPayload extends JsonObject = JsonObject> = {
  eventId: string;
  kind: string;
  payload: TPayload;
};

export type ClientSurfaceRenderResult<TOutput extends JsonValue = JsonValue> = {
  output: TOutput;
  surfaceSessionId: string;
};

export type ClientSurfaceAdapter<
  TInbound extends JsonObject = JsonObject,
  TRendered extends JsonValue = JsonValue,
> = {
  id: string;
  label: string;
  parseInbound(envelope: ClientSurfaceEnvelope<TInbound>): ClientSurfaceCommand[];
  publish(event: ClientSurfaceEvent): Promise<void> | void;
  render(event: ClientSurfaceEvent): Promise<ClientSurfaceRenderResult<TRendered>> | ClientSurfaceRenderResult<TRendered>;
};
