import { isJsonObject, isJsonValue, type JsonObject, type JsonValue } from "./json.js";
import {
  DROMIO_WORKFLOW_RENDER_CATALOG_ID,
  dromioWorkflowJsonRenderCatalog,
  getWorkflowJsonRenderComponentSpec,
  workflowJsonRenderCatalogComponentNames,
  workflowJsonRenderDisplayModes,
  workflowJsonRenderInspectionPreference,
  workflowJsonRenderRequiredProps,
  type WorkflowJsonRenderDocument,
  type WorkflowJsonRenderInspectionOptions,
  type WorkflowJsonRenderInspectionPreference,
  type WorkflowJsonRenderPropSpec,
  type WorkflowJsonRenderViewMode,
} from "./json-render-catalog.js";

export * from "./json-render-catalog.js";

export type WorkflowJsonRenderValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type WorkflowJsonRenderValidation = {
  issues: WorkflowJsonRenderValidationIssue[];
  ok: boolean;
};

export type WorkflowJsonRenderSchema = JsonObject & {
  catalog: typeof DROMIO_WORKFLOW_RENDER_CATALOG_ID;
  component: string;
  props: JsonObject;
  requiredProps: JsonValue[];
  validation: "invalid" | "valid";
};

export type WorkflowJsonRenderInspection = {
  component: string;
  document: WorkflowJsonRenderDocument;
  jsonText: string;
  modes: typeof workflowJsonRenderDisplayModes;
  preference: WorkflowJsonRenderInspectionPreference;
  schema: WorkflowJsonRenderSchema;
  validation: WorkflowJsonRenderValidation;
};

export type WorkflowJsonRenderRendererInput<TContext = undefined> = {
  component: string;
  context?: TContext;
  document: WorkflowJsonRenderDocument;
  inspection: WorkflowJsonRenderInspection;
  props: JsonObject;
};

export type WorkflowJsonRenderComponentRenderer<TOutput, TContext = undefined> = (
  input: WorkflowJsonRenderRendererInput<TContext>
) => TOutput;

export type WorkflowJsonRenderRendererMap<TOutput, TContext = undefined> =
  Record<string, WorkflowJsonRenderComponentRenderer<TOutput, TContext> | undefined>;

export type WorkflowJsonRenderRegistry<TOutput, TContext = undefined> = {
  fallback?: WorkflowJsonRenderComponentRenderer<TOutput, TContext>;
  renderers: WorkflowJsonRenderRendererMap<TOutput, TContext>;
};

export type CreateWorkflowJsonRenderRegistryInput<TOutput, TContext = undefined> = {
  fallback?: WorkflowJsonRenderComponentRenderer<TOutput, TContext>;
  renderers: WorkflowJsonRenderRendererMap<TOutput, TContext>;
};

export type WorkflowJsonRenderRenderOptions<TContext = undefined> = WorkflowJsonRenderInspectionOptions & { context?: TContext };

export type WorkflowJsonRenderRenderResult<TOutput> =
  | {
    component: string;
    inspection: WorkflowJsonRenderInspection;
    ok: true;
    output: TOutput;
  }
  | {
    component: string;
    inspection: WorkflowJsonRenderInspection;
    ok: false;
    reason: "component_renderer_missing";
  };

export function createWorkflowJsonRenderRegistry<TOutput, TContext = undefined>(
  input: CreateWorkflowJsonRenderRegistryInput<TOutput, TContext>,
): WorkflowJsonRenderRegistry<TOutput, TContext> {
  return {
    fallback: input.fallback,
    renderers: { ...input.renderers },
  };
}

export function renderWorkflowJsonRenderDocument<TOutput, TContext = undefined>(
  registry: WorkflowJsonRenderRegistry<TOutput, TContext>,
  document: unknown,
  options: WorkflowJsonRenderRenderOptions<TContext> = {},
): WorkflowJsonRenderRenderResult<TOutput> {
  const inspection = inspectWorkflowJsonRenderDocument(document, options);
  const renderer = registry.renderers[inspection.component] ?? registry.fallback;
  if (!renderer) {
    return {
      component: inspection.component,
      inspection,
      ok: false,
      reason: "component_renderer_missing",
    };
  }
  return {
    component: inspection.component,
    inspection,
    ok: true,
    output: renderer({
      component: inspection.component,
      context: options.context,
      document: inspection.document,
      inspection,
      props: isJsonObject(inspection.document.props) ? inspection.document.props : {},
    }),
  };
}

export function inspectWorkflowJsonRenderDocument(
  document: unknown,
  options: WorkflowJsonRenderInspectionOptions = {},
): WorkflowJsonRenderInspection {
  const normalized = normalizeWorkflowJsonRenderDocument(document, options);
  const validation = validateWorkflowJsonRenderDocument(normalized);
  const component = componentName(normalized);
  const schema = schemaForWorkflowJsonRenderDocument(
    normalized,
    validation,
  );

  return {
    component,
    document: normalized,
    jsonText: JSON.stringify(normalized, null, 2),
    modes: workflowJsonRenderInspectionPreference.modes,
    preference: workflowJsonRenderInspectionPreference,
    schema,
    validation,
  };
}

export function normalizeWorkflowJsonRenderDocument(
  document: unknown,
  options: WorkflowJsonRenderInspectionOptions = {},
): WorkflowJsonRenderDocument {
  if (isJsonObject(document) && typeof document.component === "string") {
    return {
      ...document,
      component: document.component,
      props: isJsonObject(document.props) ? document.props : {},
    };
  }

  return {
    component: "JsonInspector",
    props: {
      title: options.fallbackTitle ?? "Workflow result",
      value: jsonInspectableValue(document),
    },
  };
}

export function schemaForWorkflowJsonRenderDocument(
  document: WorkflowJsonRenderDocument,
  validation = validateWorkflowJsonRenderDocument(document),
): WorkflowJsonRenderSchema {
  const component = componentName(document);
  return {
    catalog: DROMIO_WORKFLOW_RENDER_CATALOG_ID,
    component,
    props: propsSchema(document.props),
    requiredProps: componentRequiredProps(component),
    validation: validation.ok ? "valid" : "invalid",
  };
}

export function validateWorkflowJsonRenderDocument(
  document: unknown,
  path = "document",
): WorkflowJsonRenderValidation {
  const issues: WorkflowJsonRenderValidationIssue[] = [];

  if (!isJsonObject(document)) {
    return {
      issues: [{
        code: "json_render.document_invalid",
        message: "json-render document must be a JSON object.",
        path,
      }],
      ok: false,
    };
  }

  const component = document.component;
  if (typeof component !== "string" || !component.trim()) {
    issues.push({
      code: "json_render.component_missing",
      message: "json-render document needs a component name.",
      path: `${path}.component`,
    });
  } else if (!workflowJsonRenderCatalogComponentNames.has(component)) {
    issues.push({
      code: "json_render.component_unknown",
      message: `json-render component ${component} is not in catalog ${DROMIO_WORKFLOW_RENDER_CATALOG_ID}.`,
      path: `${path}.component`,
    });
  }

  if (document.props !== undefined && !isJsonObject(document.props)) {
    issues.push({
      code: "json_render.props_invalid",
      message: "json-render document props must be a JSON object when provided.",
      path: `${path}.props`,
    });
  }

  if (isJsonObject(document.props) && typeof component === "string") {
    validateKnownComponentProps(component, document.props, path, issues);
  }

  return {
    issues,
    ok: issues.length === 0,
  };
}

function validateKnownComponentProps(
  component: string,
  props: JsonObject,
  path: string,
  issues: WorkflowJsonRenderValidationIssue[],
) {
  const spec = getWorkflowJsonRenderComponentSpec(component);
  if (!spec) return;
  for (const [key, prop] of Object.entries(spec.props)) {
    validateKnownComponentProp(props, key, prop, `${path}.props`, issues);
  }
}

function componentRequiredProps(component: string): string[] {
  const spec = getWorkflowJsonRenderComponentSpec(component);
  return spec ? workflowJsonRenderRequiredProps(spec) : [];
}

function validateKnownComponentProp(
  props: JsonObject,
  key: string,
  spec: WorkflowJsonRenderPropSpec,
  path: string,
  issues: WorkflowJsonRenderValidationIssue[],
) {
  const value = props[key];
  if (value === undefined) {
    if (spec.required) addPropIssue(spec.type, key, path, issues, true);
    return;
  }
  if (propMatchesType(value, spec.type)) return;
  addPropIssue(spec.type, key, path, issues, Boolean(spec.required));
}

function propMatchesType(value: JsonValue | undefined, type: WorkflowJsonRenderPropSpec["type"]) {
  if (type === "json") return isJsonValue(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isJsonObject(value);
  if (type === "string") return typeof value === "string" && value.trim().length > 0;
  return typeof value === type;
}

function addPropIssue(
  type: WorkflowJsonRenderPropSpec["type"],
  key: string,
  path: string,
  issues: WorkflowJsonRenderValidationIssue[],
  required: boolean,
) {
  const suffix = required ? "required" : "invalid";
  issues.push({
    code: `json_render.prop_${type}_${suffix}`,
    message: propIssueMessage(key, type, required),
    path: `${path}.${key}`,
  });
}

function propIssueMessage(
  key: string,
  type: WorkflowJsonRenderPropSpec["type"],
  required: boolean,
) {
  if (type === "string") {
    return required
      ? `json-render prop ${key} must be a non-empty string.`
      : `json-render prop ${key} must be a string when provided.`;
  }
  if (type === "json") {
    return required
      ? `json-render prop ${key} must be JSON-serializable.`
      : `json-render prop ${key} must be JSON-serializable when provided.`;
  }
  const article = type === "array" || type === "object" ? "an" : "a";
  return required
    ? `json-render prop ${key} must be ${article} ${type}.`
    : `json-render prop ${key} must be ${article} ${type} when provided.`;
}

function componentName(document: WorkflowJsonRenderDocument): string {
  return typeof document.component === "string" && document.component.trim()
    ? document.component
    : "Unknown";
}

function propsSchema(props: WorkflowJsonRenderDocument["props"]): JsonObject {
  if (!isJsonObject(props)) return {};
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [key, jsonType(value)]),
  );
}

function jsonType(value: JsonValue): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function jsonInspectableValue(value: unknown): JsonValue {
  if (isJsonValue(value)) return value;
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return value.toString();
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
    };
  }
  return String(value);
}
