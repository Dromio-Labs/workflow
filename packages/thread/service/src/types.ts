import type {
  DromioActorContextV1,
  DromioCommandReceiptV1,
  DromioJsonObject,
  DromioJsonValue,
  DromioModelSelectionV1,
  DromioMessageItem,
  DromioInteractionRequestV1,
  DromioThreadAccessGrantV1,
  DromioThreadEventV1,
  DromioThreadItemV1,
  DromioThreadV1,
  DromioTurnV1,
  DromioUserThreadStateV1,
  DromioThreadDraftV1,
  DromioThreadExportV1,
  DromioThreadShareLinkV1,
  DromioRetentionPolicyV1,
  DromioLegalHoldV1,
  DromioPurgeReceiptV1,
  DromioAuditRecordV1,
  DromioUsageRecordV1,
  DromioThreadAuthorityReceiptV1,
  DromioToolCallItem,
  DromioUserEventV1,
} from "@dromio/protocols";
import type { DromioContentPart } from "@dromio/protocols";

export interface ThreadScope {
  readonly tenantId: string;
  readonly applicationId: string;
}

export interface ThreadCommandContext {
  readonly actor: DromioActorContextV1;
  readonly commandId: string;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly source?: import("@dromio/protocols").DromioResourceProvenance["source"];
  readonly execution?: {
    readonly runId: string;
    readonly attemptId: string;
    readonly fencingToken: number;
    readonly leaseExpiresAt: string;
  };
}

export interface CreateThreadInput {
  readonly title?: string;
  readonly labels?: readonly string[];
  readonly metadata?: DromioJsonObject;
  readonly metadataSchema?: string;
  readonly metadataIndex?: Readonly<Record<string, "string" | "number" | "boolean">>;
}

export interface UpdateThreadInput {
  readonly title?: string;
  readonly labels?: readonly string[];
  readonly metadata?: DromioJsonObject;
  readonly metadataSchema?: string;
  readonly metadataIndex?: Readonly<Record<string, "string" | "number" | "boolean">>;
  readonly expectedVersion?: number;
}
export interface ForkThreadInput { readonly sourceThreadId: string; readonly throughTurnId?: string; readonly title?: string; readonly metadata?: DromioJsonObject; }

export interface CreateTurnInput {
  readonly threadId: string;
  readonly content: DromioMessageItem["content"];
  readonly modelSelection?: DromioModelSelectionV1;
  readonly expectedVersion?: number;
  readonly retryOfTurnId?: string;
  readonly regeneratedFromTurnId?: string;
}

export interface TransitionTurnInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly status: "running" | "waiting_for_approval" | "waiting_for_input" | "completed" | "failed" | "cancelling" | "cancelled";
  readonly statusReason?: string;
  readonly executionRunId?: string;
  readonly expectedVersion?: number;
}

export interface AppendAssistantOutputInput { readonly threadId: string; readonly turnId: string; readonly messageId?: string; readonly text: string; readonly final?: boolean; }
export interface SteerTurnInput { readonly threadId: string; readonly turnId: string; readonly content: readonly DromioContentPart[]; }
export interface StartToolCallInput { readonly id?: string; readonly threadId: string; readonly turnId: string; readonly toolId: string; readonly toolVersion?: string; readonly capabilityId?: string; readonly arguments: DromioJsonObject; readonly effect: DromioToolCallItem["effect"]; readonly recoveryPolicy: DromioToolCallItem["recoveryPolicy"]; readonly idempotencyKey?: string; readonly approvalRequestId?: string; }
export interface CompleteToolCallInput { readonly threadId: string; readonly itemId: string; readonly status: "completed" | "failed" | "cancelled"; readonly result?: DromioJsonValue; readonly artifactIds?: readonly string[]; }

interface CreateInteractionBase { readonly id?: string; readonly threadId: string; readonly turnId: string; readonly itemId: string; readonly expiresAt?: string; }
export type CreateInteractionInput =
  | (CreateInteractionBase & { readonly kind: "approval"; readonly operation: string; readonly toolVersion: string; readonly capabilityId?: string; readonly argumentsDigest: string; readonly risk?: string; readonly requestedPermissions: readonly string[] })
  | (CreateInteractionBase & { readonly kind: "question" | "form"; readonly prompt: string; readonly answerSchema: DromioJsonObject });
export interface ResolveInteractionInput { readonly interactionId: string; readonly decision?: "approved" | "denied"; readonly answer?: DromioJsonValue; }
export interface ReviseMessageInput { readonly threadId: string; readonly messageId: string; readonly content: readonly DromioContentPart[]; }
export interface MigrateMessageInput extends ReviseMessageInput { readonly expectedRevision: number; }
export interface GrantThreadAccessInput { readonly threadId: string; readonly principal: DromioThreadAccessGrantV1["principal"]; readonly role: DromioThreadAccessGrantV1["role"]; readonly expiresAt?: string; }
export interface CreateShareLinkInput { readonly threadId: string; readonly tokenDigest: string; readonly role: DromioThreadShareLinkV1["role"]; readonly expiresAt?: string; }
export interface SaveDraftInput { readonly threadId: string; readonly content: readonly DromioContentPart[]; readonly expectedVersion?: number; }
export interface CreateExportInput { readonly threadId: string; readonly format: DromioThreadExportV1["format"]; readonly includeFiles?: boolean; readonly includeAudit?: boolean; }
export interface SetRetentionPolicyInput { readonly retainForDays: number; readonly archiveAfterDays?: number; readonly deleteAfterDays?: number; readonly backupRetentionDays?: number; }
export interface PlaceLegalHoldInput { readonly threadId: string; readonly reason: string; }
export type UpdateUserThreadStateInput = Partial<Pick<DromioUserThreadStateV1, "lastReadItemOrdinal" | "manuallyUnreadFromOrdinal" | "hiddenAt" | "mutedUntil" | "notificationLevel" | "lastViewedAt">> & {
  readonly pinnedAt?: string | null;
  readonly pinRank?: number | null;
  readonly expectedVersion?: number;
};

export interface ThreadSnapshot {
  readonly thread: DromioThreadV1;
  readonly items: readonly DromioThreadItemV1[];
  readonly turns: readonly DromioTurnV1[];
  readonly interactions: readonly DromioInteractionRequestV1[];
  readonly throughSequence: number;
}

export interface ThreadListPage {
  readonly data: readonly DromioThreadV1[];
  readonly userStates?: readonly DromioUserThreadStateV1[];
  readonly nextCursor?: string;
}

export interface ThreadListQuery extends ThreadScope {
  readonly status?: DromioThreadV1["status"];
  readonly parentThreadId?: string;
  readonly labels?: readonly string[];
  readonly createdById?: string;
  readonly updatedAfter?: string;
  readonly updatedBefore?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly cursor?: string;
  readonly limit?: number;
}

export type ThreadReceipt<Resource> = DromioCommandReceiptV1<Resource>;

export interface ThreadEventPage {
  readonly events: readonly DromioThreadEventV1[];
  readonly throughSequence: number;
}

export interface UserEventPage {
  readonly events: readonly DromioUserEventV1[];
  readonly throughSequence: number;
  readonly hasMore: boolean;
}

export interface ThreadExportSnapshot {
  readonly exportId: string;
  readonly throughSequence: number;
  readonly thread: DromioThreadV1;
  readonly items: readonly DromioThreadItemV1[];
  readonly turns: readonly DromioTurnV1[];
  readonly audit: readonly DromioAuditRecordV1[];
}

export interface ThreadOutboxEntry {
  readonly id: string;
  readonly topic: "thread.events" | "user.events" | "execution.commands" | "governance.jobs";
  readonly aggregateId: string;
  readonly payload: DromioJsonObject;
  readonly createdAt: string;
  readonly attempts: number;
  readonly publishedAt?: string;
}

export interface StoredCommandReceipt {
  readonly scope: ThreadScope;
  readonly idempotencyKey: string;
  readonly commandName: string;
  readonly inputDigest: string;
  readonly receipt: ThreadReceipt<DromioThreadV1 | DromioTurnV1 | DromioThreadItemV1 | DromioInteractionRequestV1 | DromioThreadAccessGrantV1 | DromioUserThreadStateV1 | DromioThreadShareLinkV1 | DromioThreadDraftV1 | DromioThreadExportV1 | DromioRetentionPolicyV1 | DromioLegalHoldV1 | DromioPurgeReceiptV1 | DromioAuditRecordV1 | DromioUsageRecordV1 | DromioThreadAuthorityReceiptV1>;
}
