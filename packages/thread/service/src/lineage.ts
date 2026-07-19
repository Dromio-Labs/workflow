import type { DromioResourceProvenance } from "@dromio/protocols";
import type { ThreadCommandContext } from "./types.js";

export function correlation(context: ThreadCommandContext): { readonly correlationId: string; readonly requestId: string; readonly commandId: string } { return { correlationId: context.correlationId ?? context.commandId, requestId: context.requestId ?? context.commandId, commandId: context.commandId }; }

export function provenance(context: ThreadCommandContext, references: { readonly threadId?: string; readonly turnId?: string; readonly itemId?: string; readonly eventId?: string } = {}): DromioResourceProvenance { return { source: context.source ?? "chat", actor: context.actor.subject, applicationId: context.actor.applicationId, ...correlation(context), ...references, ...(context.execution ? { runId: context.execution.runId, attemptId: context.execution.attemptId } : {}) }; }
