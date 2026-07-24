import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRuntimeStoreConformanceFixture,
  proveConditionalRuntimeStoreConformance,
  readRuntimeStoreConformanceFixture,
  writeRuntimeStoreConformanceFixture,
  proveSignalRuntimeStoreConformance,
} from "../../src/sdk/workflow-control-plane/runtime-store-conformance.js";
import { createSqliteWorkflowRuntimeStore } from "@dromio/workflow/workflow-control-plane";

describe("workflow runtime store capability conformance", () => {
  it("runs the shared dataset and artifact contract against SQLite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dromio-runtime-conformance-"));
    try {
      const fixture = createRuntimeStoreConformanceFixture({
        namespace: "sqlite_conformance",
        ownerId: "user-sqlite-proof",
      });
      const first = createSqliteWorkflowRuntimeStore(join(directory, "runtime.sqlite"));
      const write = await writeRuntimeStoreConformanceFixture(first, fixture);
      const second = createSqliteWorkflowRuntimeStore(join(directory, "runtime.sqlite"));
      const read = await readRuntimeStoreConformanceFixture(second, fixture);
      const conditional = await proveConditionalRuntimeStoreConformance(
        second,
        "sqlite_conditional",
      );
      const signal = await proveSignalRuntimeStoreConformance(second, "sqlite_conformance");

      expect(write.inserted).toBe(2);
      expect(write.updated).toBe(1);
      expect(read).toEqual({
        artifactId: fixture.artifactId,
        byteIdentical: true,
        datasetCount: 2,
        datasetOwnerId: fixture.ownerId,
      });
      expect(signal).toEqual({ claimed: true, delivered: true, idempotent: true });
      expect(conditional).toEqual({
        artifactInsertOnce: true,
        atomicWrites: true,
        conditionSnapshot: true,
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rolls back every dataset when a later write fails", async () => {
    const store = createSqliteWorkflowRuntimeStore(":memory:");
    const aggregate = {
      key: ["ownerId", "id"],
      name: "rollback_aggregates",
      schemaFingerprint: "rollback-aggregates-v1",
      version: 1,
    };
    const events = {
      key: ["ownerId", "id"],
      name: "rollback_events",
      schemaFingerprint: "rollback-events-v1",
      version: 1,
    };
    await store.upsertDatasetRows?.({
      ...aggregate,
      rows: [{ id: "aggregate-1", ownerId: "owner-1", version: 1 }],
    });

    expect(() => store.commitDatasetRows?.({
      conditions: [{
        definition: aggregate,
        id: "aggregate-version",
        key: { id: "aggregate-1", ownerId: "owner-1" },
        match: { equals: 1, field: "version", kind: "field" },
      }],
      writes: [
        {
          ...aggregate,
          rows: [{ id: "aggregate-1", ownerId: "owner-1", version: 2 }],
        },
        {
          ...events,
          rows: [{ ownerId: "owner-1", type: "invalid-missing-id" }],
        },
      ],
    })).toThrow("Dataset key values must be JSON primitives");

    expect(await store.queryDatasetRows?.(aggregate, {
      filter: { id: "aggregate-1", ownerId: "owner-1" },
    })).toEqual([{ id: "aggregate-1", ownerId: "owner-1", version: 1 }]);
    expect(await store.countDatasetRows?.(events)).toBe(0);
  });
});
