import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRuntimeStoreConformanceFixture,
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
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
