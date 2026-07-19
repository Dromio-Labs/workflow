import {
  isJsonObject,
  isJsonValue,
  type JsonObject,
  type JsonValue,
} from "./json.js";
import {
  normalizeWorkflowJsonRenderDocument,
  type WorkflowJsonRenderDocument,
} from "./json-render.js";

export type WorkflowResultActionTemplate = {
  commandType: string;
  input?: JsonObject;
  label?: string;
};

export type WorkflowResultPresentation =
  | {
      kind: "json";
      title?: string;
      value: JsonValue;
    }
  | {
      kind: "markdown";
      title?: string;
      value: string;
    }
  | {
      actions?: Record<string, WorkflowResultActionTemplate>;
      catalogId?: string;
      document: JsonObject;
      kind: "json-render";
      state?: JsonValue;
      title?: string;
    };

export type NormalizeWorkflowResultPresentationOptions = {
  fallbackKind?: "json" | "json-render";
  title?: string;
};

export function isWorkflowResultPresentation(
  value: unknown,
): value is WorkflowResultPresentation {
  if (!isJsonObject(value) || typeof value.kind !== "string") return false;
  if (value.kind === "markdown") {
    return typeof value.value === "string";
  }
  if (value.kind === "json") {
    return isJsonValue(value.value);
  }
  return value.kind === "json-render" && isJsonObject(value.document);
}

export function normalizeWorkflowResultPresentation(
  value: unknown,
  options: NormalizeWorkflowResultPresentationOptions = {},
): WorkflowResultPresentation | undefined {
  if (value === undefined || value === null) return undefined;
  if (isWorkflowResultPresentation(value)) return value;
  if (isJsonRenderDocumentLike(value)) {
    return workflowJsonRenderResult(value, options.title);
  }
  if (typeof value === "string") {
    return {
      kind: "markdown",
      ...(options.title ? { title: options.title } : {}),
      value,
    };
  }
  if (!isJsonValue(value)) return undefined;
  if (options.fallbackKind === "json") {
    return {
      kind: "json",
      ...(options.title ? { title: options.title } : {}),
      value,
    };
  }
  return workflowJsonRenderResult({
    component: "JsonInspector",
    props: {
      title: options.title ?? "Workflow result",
      value,
    },
  }, options.title);
}

export function workflowResultToJsonRenderDocument(
  result: WorkflowResultPresentation,
): WorkflowJsonRenderDocument | undefined {
  if (result.kind === "json-render") {
    return normalizeWorkflowJsonRenderDocument(result.document, {
      fallbackTitle: result.title ?? "Workflow result",
    });
  }
  if (result.kind === "json") {
    return normalizeWorkflowJsonRenderDocument({
      component: "JsonInspector",
      props: {
        title: result.title ?? "Workflow result",
        value: result.value,
      },
    }, {
      fallbackTitle: result.title ?? "Workflow result",
    });
  }
  return undefined;
}

function workflowJsonRenderResult(
  document: unknown,
  title?: string,
): WorkflowResultPresentation {
  return {
    document: normalizeWorkflowJsonRenderDocument(document, {
      fallbackTitle: title ?? "Workflow result",
    }),
    kind: "json-render",
    ...(title ? { title } : {}),
  };
}

function isJsonRenderDocumentLike(value: unknown): value is JsonObject {
  return isJsonObject(value) && typeof value.component === "string";
}
