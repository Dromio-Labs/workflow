import type { DromioJsonObject, DromioThreadV1 } from "@dromio/protocols";
import { ThreadServiceError } from "./errors.js";
import type { ThreadListQuery } from "./types.js";

const fieldName = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

export function normalizeLabels(labels: readonly string[] | undefined): readonly string[] {
  if (!labels) return [];
  const normalized = labels.map((label) => label.trim());
  if (normalized.some((label) => !label || label.length > 64) || normalized.length > 32 || new Set(normalized).size !== normalized.length) invalid("Thread labels must be unique non-empty strings of at most 64 characters.");
  return normalized;
}

export function validateThreadMetadata(input: { readonly metadata?: DromioJsonObject; readonly metadataSchema?: string; readonly metadataIndex?: Readonly<Record<string, "string" | "number" | "boolean">> }): void {
  if (input.metadataSchema !== undefined && !input.metadataSchema.trim()) invalid("Thread metadataSchema must be a non-empty identifier.");
  for (const [key, type] of Object.entries(input.metadataIndex ?? {})) {
    if (!fieldName.test(key)) invalid(`Metadata index field ${key} is invalid.`);
    const value = input.metadata?.[key];
    if (value !== undefined && typeof value !== type) invalid(`Metadata field ${key} must be ${type}.`);
  }
}

export function validateThreadListQuery(query: Omit<ThreadListQuery, "tenantId" | "applicationId">): void {
  normalizeLabels(query.labels);
  if (query.updatedAfter && !validTimestamp(query.updatedAfter)) invalid("updatedAfter must be an ISO timestamp.");
  if (query.updatedBefore && !validTimestamp(query.updatedBefore)) invalid("updatedBefore must be an ISO timestamp.");
  if (query.updatedAfter && query.updatedBefore && query.updatedAfter >= query.updatedBefore) invalid("updatedAfter must be earlier than updatedBefore.");
  for (const [key, value] of Object.entries(query.metadata ?? {})) if (!fieldName.test(key) || !["string", "number", "boolean"].includes(typeof value)) invalid(`Metadata filter ${key} is invalid.`);
}

export function matchesThreadQuery(thread: DromioThreadV1, query: ThreadListQuery): boolean {
  if (query.status && thread.status !== query.status) return false;
  if (query.parentThreadId && thread.parentThreadId !== query.parentThreadId) return false;
  if (query.createdById && thread.createdBy.id !== query.createdById) return false;
  if (query.updatedAfter && thread.updatedAt <= query.updatedAfter) return false;
  if (query.updatedBefore && thread.updatedAt >= query.updatedBefore) return false;
  if (query.labels?.some((label) => !thread.labels.includes(label))) return false;
  for (const [key, value] of Object.entries(query.metadata ?? {})) if (thread.metadataIndex?.[key] !== typeof value || thread.metadata?.[key] !== value) return false;
  return true;
}

function validTimestamp(value: string): boolean { return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function invalid(message: string): never { throw new ThreadServiceError({ code: "validation_failed", message }); }
