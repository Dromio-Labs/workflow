/** @jsxImportSource react */
import { defineCatalog, type Spec, type UIElement } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import {
  normalizeWorkflowJsonRenderDocument,
  type JsonValue,
  type WorkflowJsonRenderDocument,
} from "@dromio/workflow-room-protocol";
import { createRoot } from "react-dom/client";
import { z } from "zod";

declare global {
  interface Window {
    workflowGuiRenderJson(container: HTMLElement, value: JsonValue, title?: string): void;
    workflowGuiRenderTriggerForm(
      container: HTMLElement,
      document: WorkflowJsonRenderDocument,
      fields: TriggerFieldInput[],
      values: Record<string, JsonValue>,
    ): void;
  }
}

type TriggerFieldInput = {
  defaultValue?: JsonValue;
  description?: string;
  label?: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
  valueType?: string;
};

const valueKinds = ["array", "boolean", "null", "number", "object", "string", "truncated"] as const;

const activityJsonCatalog = defineCatalog(schema, {
  actions: {},
  components: {
    DataGroup: {
      description: "A named JSON object or array group.",
      props: z.object({
        count: z.number(),
        kind: z.enum(["array", "object"]),
        label: z.string().nullable(),
      }),
    },
    DataValue: {
      description: "A labeled scalar JSON value.",
      props: z.object({
        kind: z.enum(valueKinds),
        label: z.string().nullable(),
        value: z.string(),
      }),
    },
    TriggerField: {
      description: "Editable workflow trigger field.",
      props: z.object({
        description: z.string().nullable(),
        fieldType: z.string(),
        label: z.string(),
        name: z.string(),
        placeholder: z.string(),
        required: z.boolean(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        valueType: z.string(),
      }),
    },
    TriggerForm: {
      description: "Structured workflow trigger form.",
      props: z.object({ component: z.string() }),
    },
  },
});

const { registry: activityJsonRegistry } = defineRegistry(activityJsonCatalog, {
  components: {
    DataGroup: ({ props, children }) => (
      <section className="json-render-group" data-kind={props.kind}>
        {props.label ? (
          <header className="json-render-group-header">
            <strong>{props.label}</strong>
            <span>{props.count} {props.kind === "array" ? "items" : "fields"}</span>
          </header>
        ) : undefined}
        <div className="json-render-group-content">{children}</div>
      </section>
    ),
    DataValue: ({ props }) => (
      <div className="json-render-value" data-kind={props.kind}>
        {props.label ? <span className="json-render-value-label">{props.label}</span> : undefined}
        <span className="json-render-value-content">{props.value}</span>
      </div>
    ),
    TriggerField: ({ props }) => (
      <label className="structured-field">
        <span className="structured-field-label">
          {props.label}
          {props.required ? <span className="required-mark">Required</span> : undefined}
        </span>
        {props.description ? <span className="structured-field-description">{props.description}</span> : undefined}
        {props.fieldType === "textarea" || props.valueType === "json" ? (
          <textarea
            className="structured-control"
            data-field-name={props.name}
            data-value-type={props.valueType}
            defaultValue={String(props.value)}
            placeholder={props.placeholder}
            required={props.required}
            rows={3}
          />
        ) : (
          <input
            className="structured-control"
            data-field-name={props.name}
            data-value-type={props.valueType}
            defaultChecked={props.fieldType === "checkbox" ? Boolean(props.value) : undefined}
            defaultValue={props.fieldType === "checkbox" ? undefined : String(props.value)}
            placeholder={props.placeholder}
            required={props.required}
            type={props.fieldType === "checkbox" ? "checkbox" : props.fieldType === "number" ? "number" : "text"}
          />
        )}
      </label>
    ),
    TriggerForm: ({ props, children }) => (
      <div className="json-render-trigger-form" data-component={props.component}>{children}</div>
    ),
  },
});

const roots = new WeakMap<HTMLElement, ReturnType<typeof createRoot>>();

window.workflowGuiRenderJson = (container, value, title = "Event detail") => {
  const document = normalizeWorkflowJsonRenderDocument(value, {
    fallbackTitle: title,
  });
  rootFor(container).render(
    <JSONUIProvider registry={activityJsonRegistry}>
      <Renderer registry={activityJsonRegistry} spec={documentToSpec(document, title)} />
    </JSONUIProvider>,
  );
  requestAnimationFrame(() => window.dispatchEvent(new Event("workflow-gui-activity-layout-change")));
};

window.workflowGuiRenderTriggerForm = (container, document, fields, values) => {
  rootFor(container).render(
    <JSONUIProvider registry={activityJsonRegistry}>
      <Renderer registry={activityJsonRegistry} spec={triggerFormSpec(document, fields, values)} />
    </JSONUIProvider>,
  );
};

function rootFor(container: HTMLElement) {
  const current = roots.get(container);
  if (current) return current;
  const root = createRoot(container);
  roots.set(container, root);
  return root;
}

function triggerFormSpec(
  document: WorkflowJsonRenderDocument,
  fields: TriggerFieldInput[],
  values: Record<string, JsonValue>,
): Spec {
  const elements: Record<string, UIElement> = {};
  const children = fields.map((field, index) => {
    const id = `trigger-field-${index}`;
    const value = values[field.name] ?? field.defaultValue ?? "";
    elements[id] = {
      props: {
        description: field.description ?? null,
        fieldType: field.type ?? "text",
        label: field.label ?? field.name,
        name: field.name,
        placeholder: field.placeholder ?? "",
        required: field.required ?? false,
        value: typeof value === "object" ? JSON.stringify(value, null, 2) : value,
        valueType: field.valueType ?? field.type ?? "string",
      },
      type: "TriggerField",
    };
    return id;
  });
  elements.root = {
    children,
    props: { component: document.component },
    type: "TriggerForm",
  };
  return { elements, root: "root" };
}

function documentToSpec(document: WorkflowJsonRenderDocument, fallbackTitle: string): Spec {
  const elements: Record<string, UIElement> = {};
  const props = document.props ?? {};
  const value = document.component === "JsonInspector" && "value" in props
    ? props.value
    : props;
  const label = document.component === "JsonInspector"
    ? stringValue(props.title) ?? fallbackTitle
    : document.component;
  const root = appendJsonValue(elements, value ?? null, label, "root", 0);
  return { elements, root };
}

function appendJsonValue(
  elements: Record<string, UIElement>,
  value: JsonValue,
  label: string | null,
  key: string,
  depth: number,
): string {
  if (depth >= 6) {
    elements[key] = valueElement(label, "truncated", "Nested data continues in the JSON view.");
    return key;
  }
  if (Array.isArray(value)) {
    const children = value.slice(0, 40).map((item, index) =>
      appendJsonValue(elements, item, null, `${key}-${index}`, depth + 1)
    );
    appendTruncation(elements, children, key, value.length, "items");
    elements[key] = groupElement(label, "array", value.length, children);
    return key;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    const children = entries.slice(0, 40).map(([field, item], index) =>
      appendJsonValue(elements, item, field, `${key}-${index}`, depth + 1)
    );
    appendTruncation(elements, children, key, entries.length, "fields");
    elements[key] = groupElement(label, "object", entries.length, children);
    return key;
  }
  elements[key] = valueElement(label, scalarKind(value), scalarText(value));
  return key;
}

function appendTruncation(
  elements: Record<string, UIElement>,
  children: string[],
  key: string,
  total: number,
  label: "fields" | "items",
) {
  if (total <= children.length) return;
  const truncatedKey = `${key}-truncated`;
  elements[truncatedKey] = valueElement(null, "truncated", `${total - children.length} more ${label}`);
  children.push(truncatedKey);
}

function groupElement(
  label: string | null,
  kind: "array" | "object",
  count: number,
  children: string[],
): UIElement {
  return { children, props: { count, kind, label }, type: "DataGroup" };
}

function valueElement(
  label: string | null,
  kind: typeof valueKinds[number],
  value: string,
): UIElement {
  return { props: { kind, label, value }, type: "DataValue" };
}

function scalarKind(value: JsonValue): typeof valueKinds[number] {
  if (value === null) return "null";
  return typeof value as "boolean" | "number" | "string";
}

function scalarText(value: JsonValue): string {
  if (value === null) return "null";
  return String(value);
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
