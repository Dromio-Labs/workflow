import type { DromioThreadV1 } from "@dromio/protocols";
import { ThreadServiceError } from "./errors.js";
import type { ThreadListQuery } from "./types.js";

const cursorLifetimeMs = 24 * 60 * 60 * 1_000;

interface ThreadCursorV1 {
  readonly v: 1;
  readonly updatedAt: string;
  readonly id: string;
  readonly querySignature: string;
  readonly expiresAt: number;
}

export function encodeThreadCursor(thread: DromioThreadV1, query: ThreadListQuery, now = Date.now()): string {
  return encode({ v: 1, updatedAt: thread.updatedAt, id: thread.id, querySignature: signature(query), expiresAt: now + cursorLifetimeMs });
}

export function decodeThreadCursor(cursor: string | undefined, query: ThreadListQuery, now = Date.now()): Pick<ThreadCursorV1, "updatedAt" | "id"> | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(fromBase64Url(cursor)), (character) => character.charCodeAt(0)))) as Partial<ThreadCursorV1>;
    if (value.v !== 1 || typeof value.updatedAt !== "string" || typeof value.id !== "string" || typeof value.expiresAt !== "number" || value.expiresAt <= now || value.querySignature !== signature(query)) throw new Error("invalid");
    return { updatedAt: value.updatedAt, id: value.id };
  } catch {
    throw new ThreadServiceError({ code: "cursor_expired", message: "The pagination cursor is invalid, expired, or belongs to another query." });
  }
}

function encode(value: ThreadCursorV1): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): string { const base = value.replaceAll("-", "+").replaceAll("_", "/"); return `${base}${"=".repeat((4 - base.length % 4) % 4)}`; }

function signature(query: ThreadListQuery): string {
  return JSON.stringify({
    status: query.status ?? null,
    parentThreadId: query.parentThreadId ?? null,
    labels: [...(query.labels ?? [])].sort(),
    createdById: query.createdById ?? null,
    updatedAfter: query.updatedAfter ?? null,
    updatedBefore: query.updatedBefore ?? null,
    metadata: Object.fromEntries(Object.entries(query.metadata ?? {}).sort(([left], [right]) => left.localeCompare(right))),
  });
}
