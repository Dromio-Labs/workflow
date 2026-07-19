export interface DromioThreadApiCapabilitiesV1 {
  readonly schemaVersion: "dromio.thread-api-capabilities.v1";
  readonly apiVersion: "v1";
  readonly transports: {
    readonly http: true;
    readonly sse: true;
    readonly websocket: boolean;
  };
  readonly features: {
    readonly explicitThreads: true;
    readonly privateUserFeed: true;
    readonly files: boolean;
    readonly search: boolean;
    readonly semanticSearch: boolean;
    readonly steering: boolean;
    readonly exports: true;
    readonly sharing: true;
  };
  readonly limits: {
    readonly maxFileBytes?: number;
  };
}
