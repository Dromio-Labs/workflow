import type { DromioActorReference, DromioJsonObject, DromioPrincipalReference, DromioResourceReference } from "./identity.js";

export interface DromioEncryptionKeyReferenceV1 {
  readonly provider: string;
  readonly keyId: string;
  readonly version: number;
}

export interface DromioThreadAccessGrantV1 {
  readonly schemaVersion: "dromio.thread-access-grant.v1";
  readonly id: string;
  readonly threadId: string;
  readonly principal: DromioPrincipalReference;
  readonly role: "viewer" | "contributor" | "moderator";
  readonly grantedBy: DromioActorReference;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface DromioUserThreadStateV1 {
  readonly schemaVersion: "dromio.user-thread-state.v1";
  readonly tenantId: string;
  readonly applicationId: string;
  readonly threadId: string;
  readonly userId: string;
  readonly lastReadItemOrdinal: number;
  readonly manuallyUnreadFromOrdinal?: number;
  readonly pinnedAt?: string;
  readonly pinRank?: number;
  readonly hiddenAt?: string;
  readonly mutedUntil?: string;
  readonly notificationLevel: "all" | "mentions" | "important" | "none";
  readonly lastViewedAt?: string;
  readonly version: number;
  readonly updatedAt: string;
}

export interface DromioFileV1 {
  readonly schemaVersion: "dromio.file.v1";
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly kind: "file" | "artifact";
  readonly status: "pending_upload" | "processing" | "ready" | "quarantined" | "failed" | "deleted";
  readonly objectKey: string;
  readonly mediaType: string;
  readonly name: string;
  readonly size: number;
  readonly checksum: string;
  readonly encryption?: {
    readonly schemaVersion: "dromio.file-encryption.v1";
    readonly key: DromioEncryptionKeyReferenceV1;
  };
  readonly version: number;
  readonly createdBy: DromioActorReference;
  readonly createdAt: string;
  readonly metadata?: DromioJsonObject;
}

export interface DromioFileUploadPartV1 {
  readonly partNumber: number;
  readonly size: number;
  readonly checksum: string;
  readonly objectKey: string;
}

export interface DromioFileUploadV1 {
  readonly schemaVersion: "dromio.file-upload.v1";
  readonly id: string;
  readonly fileId: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly status: "pending" | "completing" | "completed" | "aborted" | "expired";
  readonly expectedSize: number;
  readonly expectedChecksum: string;
  readonly parts: readonly DromioFileUploadPartV1[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly version: number;
}

export interface DromioFileReferenceV1 {
  readonly schemaVersion: "dromio.file-reference.v1";
  readonly id: string;
  readonly fileId: string;
  readonly threadId: string;
  readonly kind: "attachment" | "artifact" | "export";
  readonly createdBy: DromioActorReference;
  readonly createdAt: string;
}

export interface DromioThreadExportV1 {
  readonly schemaVersion: "dromio.thread-export.v1";
  readonly id: string;
  readonly threadId: string;
  readonly throughSequence: number;
  readonly format: "dromio-json" | "jsonl" | "html";
  readonly includeFiles: boolean;
  readonly includeAudit: boolean;
  readonly status: "queued" | "running" | "ready" | "failed" | "expired";
  readonly createdAt: string;
  readonly artifactId?: string;
  readonly artifactChecksum?: string;
  readonly artifactSize?: number;
  readonly completedAt?: string;
  readonly expiresAt?: string;
}

export interface DromioUsageRecordV1 {
  readonly schemaVersion: "dromio.usage-record.v1";
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly correlationId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly providerId: string;
  readonly threadId?: string;
  readonly turnId?: string;
  readonly modelId?: string;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly toolId?: string;
  readonly toolUnits?: number;
  readonly amount?: string;
  readonly currency?: string;
  readonly reconcilesUsageRecordIds?: readonly string[];
  readonly status: "estimated" | "final" | "reconciled";
  readonly occurredAt: string;
}

export interface DromioAuditRecordV1 {
  readonly schemaVersion: "dromio.audit-record.v1";
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly actor: DromioActorReference;
  readonly action: string;
  readonly target: DromioResourceReference;
  readonly outcome: "allowed" | "denied" | "failed";
  readonly reasonCode?: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface DromioThreadShareLinkV1 {
  readonly schemaVersion: "dromio.thread-share-link.v1";
  readonly id: string;
  readonly threadId: string;
  readonly tokenDigest: string;
  readonly role: "viewer" | "contributor";
  readonly createdBy: DromioActorReference;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface DromioThreadDraftV1 {
  readonly schemaVersion: "dromio.thread-draft.v1";
  readonly threadId: string;
  readonly userId: string;
  readonly content: readonly import("./resources.js").DromioContentPart[];
  readonly updatedAt: string;
  readonly version: number;
}

export interface DromioRetentionPolicyV1 {
  readonly schemaVersion: "dromio.retention-policy.v1";
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly retainForDays: number;
  readonly archiveAfterDays?: number;
  readonly deleteAfterDays?: number;
  readonly backupRetentionDays?: number;
  readonly updatedAt: string;
  readonly updatedBy: DromioActorReference;
}

export interface DromioLegalHoldV1 {
  readonly schemaVersion: "dromio.legal-hold.v1";
  readonly id: string;
  readonly threadId: string;
  readonly reason: string;
  readonly placedAt: string;
  readonly placedBy: DromioActorReference;
  readonly releasedAt?: string;
  readonly releasedBy?: DromioActorReference;
}

export interface DromioPurgeReceiptV1 {
  readonly schemaVersion: "dromio.purge-receipt.v1";
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly threadId: string;
  readonly deletedResources: Readonly<Record<string, number>>;
  readonly propagationTargets: readonly string[];
  readonly propagation: Readonly<Record<string, {
    readonly status: "pending" | "completed" | "failed" | "not_configured";
    readonly completedAt?: string;
    readonly deletedResources?: Readonly<Record<string, number>>;
    readonly errorCode?: string;
  }>>;
  readonly status: "pending" | "completed";
  readonly purgedAt: string;
  readonly purgedBy: DromioActorReference;
  readonly completedAt?: string;
}

export interface DromioThreadAuthorityReceiptV1 {
  readonly schemaVersion: "dromio.thread-authority-receipt.v1";
  readonly id: string;
  readonly threadId: string;
  readonly source: "legacy_runtime" | "thread_service";
  readonly authority: "thread_service";
  readonly importedCounts: Readonly<Record<string, number>>;
  readonly sourceDigest: string;
  readonly migrationReportId?: string;
  readonly projectionDigest?: string;
  readonly verifiedAt: string;
  readonly activatedAt: string;
}

export interface DromioBackupPurgeLedgerEntryV1 {
  readonly schemaVersion: "dromio.backup-purge-ledger-entry.v1";
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly threadId: string;
  readonly purgeReceipt: DromioPurgeReceiptV1;
  readonly backupExpiresAt: string;
  readonly recordedAt: string;
}

export interface DromioRestorePurgeReceiptV1 {
  readonly schemaVersion: "dromio.restore-purge-receipt.v1";
  readonly id: string;
  readonly restoreId: string;
  readonly ledgerEntryId: string;
  readonly threadId: string;
  readonly deletedResources: Readonly<Record<string, number>>;
  readonly propagationTargets: readonly string[];
  readonly enforcedAt: string;
}

export interface DromioLegacyMigrationReferenceV1 { readonly kind: "message" | "turn" | "artifact" | "feedback" | "parent_thread"; readonly sourceId: string; readonly targetId?: string; readonly status: "resolved" | "missing"; }
export interface DromioLegacyMigrationReportV1 { readonly schemaVersion: "dromio.legacy-migration-report.v1"; readonly id: string; readonly stageId: string; readonly tenantId: string; readonly applicationId: string; readonly threadId: string; readonly status: "staged" | "verified" | "activated" | "rolled_back"; readonly sourceDigest: string; readonly projectionDigest: string; readonly importedCounts: Readonly<Record<string, number>>; readonly unsupportedFields: readonly string[]; readonly droppedSensitiveFields: readonly string[]; readonly references: readonly DromioLegacyMigrationReferenceV1[]; readonly createdAt: string; readonly verifiedAt?: string; readonly activatedAt?: string; readonly rolledBackAt?: string; }
