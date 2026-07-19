import {
  ARTIFACT_BYTE_CONTENT_ENCODING,
  ARTIFACT_CONTENT_ENCODING_METADATA_KEY,
} from "./artifact-content-codec.js";
import { createArtifactStorePort } from "./artifact-store-port.js";
import {
  DatasetSchemaMismatchError,
  DatasetVersionMismatchError,
} from "./dataset-errors.js";
import type {
  DatasetStoreDefinition,
  WorkflowRuntimeStore,
} from "./types.js";

export type RuntimeStoreConformanceFixture = {
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly dataset: DatasetStoreDefinition;
  readonly itemId: string;
  readonly ownerId: string;
};

export type RuntimeStoreConformanceWriteProof = {
  readonly artifactId: string;
  readonly inserted: number;
  readonly updated: number;
  readonly uri: string;
};

export type RuntimeStoreConformanceReadProof = {
  readonly artifactId: string;
  readonly byteIdentical: true;
  readonly datasetCount: number;
  readonly datasetOwnerId: string;
};

export type SignalRuntimeStoreConformanceProof = {
  claimed: true;
  delivered: true;
  idempotent: true;
};

export async function proveSignalRuntimeStoreConformance(
  runtimeStore: WorkflowRuntimeStore,
  namespace: string,
): Promise<SignalRuntimeStoreConformanceProof> {
  const now = "2026-07-14T15:30:00.000Z";
  const signalId = `${namespace}.confirmed`;
  const correlation = { id: `${namespace}-123` };
  const occurrenceInput = {
    correlation,
    correlationHash: `${namespace}-correlation-hash`,
    createdAt: now,
    id: `${namespace}-occurrence`,
    idempotencyKey: `${namespace}-idempotency-key`,
    occurredAt: now,
    payload: { receipt: `${namespace}-receipt` },
    payloadHash: `${namespace}-payload-hash`,
    signalId,
    updatedAt: now,
  };
  const first = await runtimeStore.putSignalOccurrence(occurrenceInput);
  const replay = await runtimeStore.putSignalOccurrence({
    ...occurrenceInput,
    id: `${namespace}-duplicate`,
  });
  assertEqual(first.created, true, "signal occurrence creation");
  assertEqual(replay.created, false, "signal occurrence idempotency");
  await runtimeStore.syncSignalWaits({
    now,
    runId: `${namespace}-run`,
    waits: [{
      contractFingerprint: `${namespace}-contract`,
      correlation,
      correlationHash: occurrenceInput.correlationHash,
      createdAt: now,
      runId: `${namespace}-run`,
      signalId,
      status: "pending",
      stepId: `${namespace}-wait`,
      token: `${namespace}-token`,
      updatedAt: now,
    }],
  });
  const claim = await runtimeStore.claimNextSignalDelivery({
    leaseMs: 30_000,
    now,
    workerId: `${namespace}-worker`,
  });
  if (!claim) throw new Error("Runtime-store conformance expected a signal delivery claim.");
  assertEqual(claim.occurrence.id, occurrenceInput.id, "signal claim occurrence");
  await runtimeStore.completeSignalDelivery({
    now,
    occurrenceId: claim.occurrence.id,
    runId: claim.wait.runId,
    waitToken: claim.wait.token,
  });
  const delivered = await runtimeStore.getSignalOccurrence(claim.occurrence.id);
  assertEqual(delivered?.status, "delivered", "signal delivery status");
  return { claimed: true, delivered: true, idempotent: true };
}

export function createRuntimeStoreConformanceFixture(input: {
  readonly namespace: string;
  readonly ownerId: string;
}): RuntimeStoreConformanceFixture {
  const namespace = input.namespace.replace(/[^a-z0-9_]/g, "_");
  if (!/^[a-z][a-z0-9_]*$/.test(namespace)) {
    throw new Error(`Runtime-store conformance namespace is invalid: ${input.namespace}.`);
  }
  return {
    artifactId: `artifact_${namespace}`,
    bytes: Uint8Array.from([0, 1, 2, 127, 128, 255]),
    dataset: {
      key: ["ownerId", "itemId"],
      name: `${namespace}_items`,
      schemaFingerprint: `${namespace}-schema-v1`,
      version: 1,
    },
    itemId: `${namespace}-item`,
    ownerId: input.ownerId,
  };
}

export async function writeRuntimeStoreConformanceFixture(
  runtimeStore: WorkflowRuntimeStore,
  fixture: RuntimeStoreConformanceFixture,
): Promise<RuntimeStoreConformanceWriteProof> {
  const upsert = requireCapability(runtimeStore.upsertDatasetRows, "upsertDatasetRows");
  const inserted = await upsert.call(runtimeStore, {
    ...fixture.dataset,
    rows: [
      { itemId: fixture.itemId, ownerId: fixture.ownerId, text: "descale the kettle" },
      { itemId: `${fixture.itemId}-second`, ownerId: fixture.ownerId, text: "buy filters" },
    ],
  });
  const updated = await upsert.call(runtimeStore, {
    ...fixture.dataset,
    rows: [
      { itemId: fixture.itemId, ownerId: fixture.ownerId, text: "descale the kettle today" },
    ],
  });
  assertEqual(inserted.inserted, 2, "dataset inserted count");
  assertEqual(updated.updated, 1, "dataset updated count");

  const artifacts = createArtifactStorePort({
    idGenerator: { id: () => fixture.artifactId },
    runtimeStore,
  });
  const ref = await artifacts.put({
    bytes: fixture.bytes,
    kind: "binary.capture",
    mediaType: "application/octet-stream",
    title: "Runtime-store conformance",
  });
  assertEqual(ref.uri, `artifact:${fixture.artifactId}`, "artifact URI");
  assertEqual(
    ref.metadata?.[ARTIFACT_CONTENT_ENCODING_METADATA_KEY],
    ARTIFACT_BYTE_CONTENT_ENCODING,
    "artifact byte encoding",
  );
  return {
    artifactId: ref.artifactId,
    inserted: inserted.inserted,
    updated: updated.updated,
    uri: ref.uri ?? "",
  };
}

export async function readRuntimeStoreConformanceFixture(
  runtimeStore: WorkflowRuntimeStore,
  fixture: RuntimeStoreConformanceFixture,
): Promise<RuntimeStoreConformanceReadProof> {
  const query = requireCapability(runtimeStore.queryDatasetRows, "queryDatasetRows");
  const rows = await query.call(runtimeStore, fixture.dataset, {
    filter: { ownerId: fixture.ownerId },
  });
  assertEqual(rows.length, 2, "dataset filtered row count");
  assertEqual(rows[0]?.text, "descale the kettle today", "dataset updated row");

  const count = await requireCapability(runtimeStore.countDatasetRows, "countDatasetRows")
    .call(runtimeStore, fixture.dataset);
  assertEqual(count, 2, "dataset count");
  const freshness = await requireCapability(runtimeStore.datasetFreshness, "datasetFreshness")
    .call(runtimeStore, fixture.dataset);
  if (!freshness) throw new Error("Runtime-store conformance expected dataset freshness.");
  const registry = await requireCapability(runtimeStore.listDatasets, "listDatasets")
    .call(runtimeStore);
  const registered = registry.find((entry) => entry.name === fixture.dataset.name);
  assertEqual(registered?.rowCount, 2, "dataset registry row count");

  await assertDatasetMismatch(runtimeStore, {
    ...fixture.dataset,
    version: fixture.dataset.version + 1,
  }, DatasetVersionMismatchError);
  await assertDatasetMismatch(runtimeStore, {
    ...fixture.dataset,
    schemaFingerprint: `${fixture.dataset.schemaFingerprint}-changed`,
  }, DatasetSchemaMismatchError);

  const stored = await createArtifactStorePort({ runtimeStore }).get(fixture.artifactId);
  if (!(stored.content instanceof Uint8Array) || !equalBytes(stored.content, fixture.bytes)) {
    throw new Error("Runtime-store conformance artifact bytes changed during round-trip.");
  }
  assertEqual(stored.ref.mediaType, "application/octet-stream", "artifact media type");
  assertEqual(stored.ref.uri, `artifact:${fixture.artifactId}`, "artifact read URI");

  return {
    artifactId: fixture.artifactId,
    byteIdentical: true,
    datasetCount: count,
    datasetOwnerId: fixture.ownerId,
  };
}

async function assertDatasetMismatch(
  runtimeStore: WorkflowRuntimeStore,
  definition: DatasetStoreDefinition,
  errorType: typeof DatasetSchemaMismatchError | typeof DatasetVersionMismatchError,
): Promise<void> {
  const upsert = requireCapability(runtimeStore.upsertDatasetRows, "upsertDatasetRows");
  try {
    await upsert.call(runtimeStore, { ...definition, rows: [] });
  } catch (error) {
    if (error instanceof errorType) return;
    throw error;
  }
  throw new Error(`Runtime-store conformance expected ${errorType.name}.`);
}

function requireCapability<T>(capability: T | undefined, name: string): NonNullable<T> {
  if (!capability) throw new Error(`Runtime store lacks conformance capability ${name}.`);
  return capability;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `Runtime-store conformance ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
