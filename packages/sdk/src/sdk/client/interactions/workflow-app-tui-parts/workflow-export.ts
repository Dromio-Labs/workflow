import { type WorkflowTuiExportFieldDescriptor } from "../workflow-app-tui.js";
import { type WorkflowApp } from "../workflow-app.js";
import { clampIndex } from "./routing-keyboard.js";
import { WORKFLOW_EXPORT_STEPS } from "./style.js";
import { platform, release } from "node:os";
import * as path from "node:path";

export function defaultWorkflowExportFields(): WorkflowTuiExportFieldDescriptor[] {
  return [
    {
      description: "Output folder name under dist and default app slug.",
      id: "bundleName",
      label: "Bundle",
      placeholder: "search-api",
      required: true,
      step: "app",
    },
    {
      description: "Human readable app name shown in registries.",
      id: "appName",
      label: "App name",
      placeholder: "Search PDFs API",
      required: true,
      step: "app",
    },
    {
      description: "Immutable release version for the exported app.",
      id: "version",
      label: "Version",
      placeholder: "0.1.0",
      required: true,
      step: "app",
    },
    {
      description: "Organization that owns the local or platform release.",
      id: "orgSlug",
      label: "Org slug",
      placeholder: "acme",
      step: "registry",
    },
    {
      description: "Local release registry path. Leave empty for bundle-only export.",
      id: "registryDir",
      label: "Local registry",
      placeholder: ".dromio/releases",
      step: "registry",
      type: "path",
    },
    {
      description: "Workflow registry URL for app registration and artifacts.",
      id: "platformUrl",
      label: "Platform URL",
      placeholder: "https://platform.example.com",
      step: "registry",
      type: "url",
    },
    {
      description: "Bearer token for the platform. Empty uses INTENT_PLATFORM_TOKEN.",
      id: "platformToken",
      label: "Platform token",
      placeholder: "env INTENT_PLATFORM_TOKEN",
      step: "registry",
    },
    {
      description: "Release channel recorded in the manifest and registry.",
      id: "channel",
      label: "Channel",
      placeholder: "stable",
      required: true,
      step: "release",
    },
    { id: "compile", label: "Compile binary", step: "release", type: "boolean" },
    { id: "publish", label: "Publish release", step: "release", type: "boolean" },
    {
      description: "Alias to promote after publishing, for example latest or stable.",
      id: "promoteAlias",
      label: "Promote alias",
      placeholder: "latest",
      step: "release",
    },
  ];
}

export function workflowExportInitialValues(
  fields: WorkflowTuiExportFieldDescriptor[],
  workflowIds: string[],
  app: WorkflowApp,
): Record<string, string> {
  const first = app.listWorkflows().find((workflow) => workflow.id === workflowIds[0]);
  const baseName = workflowIds.length === 1
    ? slugFromTitle(first?.title ?? workflowIds[0] ?? app.id)
    : slugFromTitle(`${app.id}-bundle`);
  const defaults: Record<string, string> = {
    appName: workflowIds.length === 1 ? `${first?.title ?? "Workflow"} API` : `${app.title} Export`,
    bundleName: baseName,
    channel: "stable",
    compile: "true",
    publish: "false",
    platformUrl: process.env.INTENT_PLATFORM_URL ?? "",
    registryDir: "",
    version: "0.1.0",
  };
  return Object.fromEntries(fields.map((field) => [field.id, defaults[field.id] ?? ""]));
}

export function workflowExportValidationError(
  fields: WorkflowTuiExportFieldDescriptor[],
  values: Record<string, string>,
): { fieldId: string; message: string } | undefined {
  const fieldIds = new Set(fields.map((field) => field.id));
  const hasField = (fieldId: string) => fieldIds.has(fieldId);
  const value = (fieldId: string) => (values[fieldId] ?? "").trim();
  const booleanValue = (fieldId: string) => value(fieldId) === "true";
  const required = fields.find((field) => field.required && !value(field.id));
  if (required) return { fieldId: required.id, message: `${required.label} is required.` };

  const registryDir = value("registryDir");
  const platformUrl = value("platformUrl");
  const platformToken = value("platformToken");
  const hasRegistryTarget = Boolean(registryDir || platformUrl);
  if (hasField("registryDir") && hasField("platformUrl") && registryDir && platformUrl) {
    return { fieldId: "platformUrl", message: "Choose a local registry or a platform URL, not both." };
  }
  if (hasField("platformToken") && hasField("platformUrl") && platformToken && !platformUrl) {
    return { fieldId: "platformUrl", message: "Platform token requires a platform URL." };
  }
  if (hasRegistryTarget && hasField("orgSlug") && !value("orgSlug")) {
    return { fieldId: "orgSlug", message: "Org slug is required when exporting to a registry." };
  }
  if (hasField("publish") && booleanValue("publish") && !hasRegistryTarget) {
    return { fieldId: "publish", message: "Publishing requires a local registry or platform URL." };
  }
  if (hasField("promoteAlias") && value("promoteAlias") && !booleanValue("publish")) {
    return { fieldId: "publish", message: "Turn Publish release on before promoting an alias." };
  }
  if (hasField("promoteAlias") && value("promoteAlias") && !hasRegistryTarget) {
    return { fieldId: "promoteAlias", message: "Promoting an alias requires a registry target." };
  }
  return undefined;
}

export function workflowExportStepFields(
  fields: WorkflowTuiExportFieldDescriptor[],
  stepIndex: number,
): WorkflowTuiExportFieldDescriptor[] {
  const step = WORKFLOW_EXPORT_STEPS[clampIndex(stepIndex, WORKFLOW_EXPORT_STEPS.length)];
  return fields.filter((field) => (field.step ?? "app") === step);
}

export function workflowExportStepIndex(step: WorkflowTuiExportFieldDescriptor["step"]) {
  const index = WORKFLOW_EXPORT_STEPS.indexOf(step ?? "app");
  return index >= 0 ? index : 0;
}

export function slugFromTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._+-]+/g, "-").replace(/^-+|-+$/g, "") || "workflow-export";
}
