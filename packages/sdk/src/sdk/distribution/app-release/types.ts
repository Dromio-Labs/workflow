import type {
  TriggerDescriptor,
} from "../../workflow-control-plane/types.js";

export type WorkflowAppReleaseStatus = "draft" | "published" | "deprecated";

export type WorkflowAppVisibility = "private" | "workspace" | "public";

export const DROMIO_COMPILE_ARTIFACT_METADATA_KEY =
  "dromioCompileArtifact";

export type WorkflowAppBundleWorkflow = {
  description?: string;
  label: string;
  metadata?: Record<string, unknown>;
  nodeCount?: number;
  source: string;
  workflowId: string;
};

export type WorkflowAppBundleTrigger = Pick<
  TriggerDescriptor,
  | "auth"
  | "config"
  | "description"
  | "enabled"
  | "id"
  | "input"
  | "label"
  | "source"
  | "type"
  | "workflowId"
>;

export type WorkflowAppBundleEntrypoint = {
  apiBasePath?: string;
  binaryName: string;
  command?: string[];
  runtime: "bun" | "node" | "native";
};

export type WorkflowAppBundleManifest = {
  app: {
    description?: string;
    name: string;
    slug: string;
  };
  bundle: {
    createdAt: string;
    distPath?: string;
    entrypoint: WorkflowAppBundleEntrypoint;
    name: string;
  };
  release: {
    channel: string;
    version: string;
  };
  schemaVersion: 1;
  triggers?: WorkflowAppBundleTrigger[];
  workflows: WorkflowAppBundleWorkflow[];
};

export type CreateWorkflowAppBundleManifestInput = {
  appDescription?: string;
  appName: string;
  appSlug: string;
  bundleName?: string;
  channel?: string;
  createdAt?: string;
  distPath?: string;
  entrypoint: WorkflowAppBundleEntrypoint;
  triggers?: WorkflowAppBundleTrigger[];
  version: string;
  workflows: WorkflowAppBundleWorkflow[];
};

export type WorkflowRegisteredApp = {
  appId: string;
  createdAt: string;
  description?: string;
  displayName: string;
  orgSlug: string;
  sdkName?: string;
  slug: string;
  updatedAt: string;
  visibility: WorkflowAppVisibility;
};

export type WorkflowRegisterAppInput = {
  description?: string;
  displayName: string;
  orgSlug: string;
  sdkName?: string;
  slug: string;
  visibility?: WorkflowAppVisibility;
};

export type WorkflowGetAppInput = {
  orgSlug: string;
  slug: string;
};

export type WorkflowCreateReleaseInput = {
  appSlug: string;
  bundle: WorkflowAppBundleManifest;
  channel?: string;
  notes?: string;
  orgSlug: string;
  triggers?: WorkflowAppBundleTrigger[];
  version: string;
  workflows: WorkflowAppBundleWorkflow[];
};

export type WorkflowReleaseArtifactKind = "bundle" | "binary" | "manifest" | "runtime-state" | "source";

export type WorkflowReleaseArtifact = {
  artifactId: string;
  createdAt: string;
  kind: WorkflowReleaseArtifactKind;
  mediaType: string;
  name: string;
  platform?: string;
  sha256: string;
  size: number;
  url: string;
};

export type WorkflowAppRelease = {
  appId: string;
  appSlug: string;
  artifacts: WorkflowReleaseArtifact[];
  bundle: WorkflowAppBundleManifest;
  channel: string;
  createdAt: string;
  notes?: string;
  orgSlug: string;
  publishedAt?: string;
  releaseId: string;
  status: WorkflowAppReleaseStatus;
  triggers: WorkflowAppBundleTrigger[];
  updatedAt: string;
  version: string;
  workflows: WorkflowAppBundleWorkflow[];
};

export type WorkflowUploadReleaseArtifactInput = {
  appSlug: string;
  artifact: {
    content?: BodyInit | Uint8Array | string;
    contentBase64?: string;
    filePath?: string;
    kind: WorkflowReleaseArtifactKind;
    mediaType?: string;
    name: string;
    platform?: string;
    sha256?: string;
    size?: number;
    url?: string;
  };
  orgSlug: string;
  version: string;
};

export type WorkflowPublishReleaseInput = {
  appSlug: string;
  orgSlug: string;
  version: string;
};

export type WorkflowPromoteReleaseInput = {
  alias: string;
  appSlug: string;
  orgSlug: string;
  version: string;
};

export type WorkflowReleaseAliasResult = {
  alias: string;
  appSlug: string;
  orgSlug: string;
  promotedAt: string;
  version: string;
};

export type WorkflowListReleasesInput = {
  appSlug: string;
  orgSlug: string;
};

export type WorkflowAppReleaseRegistry = {
  createRelease(input: WorkflowCreateReleaseInput): Promise<WorkflowAppRelease>;
  getApp(input: WorkflowGetAppInput): Promise<WorkflowRegisteredApp | null>;
  listReleases(input: WorkflowListReleasesInput): Promise<WorkflowAppRelease[]>;
  promoteRelease(input: WorkflowPromoteReleaseInput): Promise<WorkflowReleaseAliasResult>;
  publishRelease(input: WorkflowPublishReleaseInput): Promise<WorkflowAppRelease>;
  registerApp(input: WorkflowRegisterAppInput): Promise<WorkflowRegisteredApp>;
  uploadArtifact(input: WorkflowUploadReleaseArtifactInput): Promise<WorkflowReleaseArtifact>;
};

export type LocalWorkflowAppReleaseRegistryConfig = {
  rootDir: string;
};

export type HttpWorkflowAppReleaseRegistryConfig = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  token?: string;
};
