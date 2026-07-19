import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  createDatasetPort,
  createSqliteWorkflowRuntimeStore,
  DatasetRowValidationError,
  DatasetVersionMismatchError,
} from "@dromio/workflow/workflow-control-plane";
import {
  createDataset,
} from "@dromio/workflow/product";

const pageSchema = z.object({
  status: z.enum(["draft", "indexed"]),
  title: z.string(),
  url: z.string(),
});

describe("workflow datasets", () => {
  test("upserts schema-valid rows and dedupes changed rows by dataset key", async () => {
    await withDataset(async ({ pages }) => {
      const inserted = await pages.upsert([
        { status: "draft", title: "First", url: "https://example.test/first" },
        { status: "draft", title: "Second", url: "https://example.test/second" },
      ]);
      const updated = await pages.upsert([
        { status: "indexed", title: "First updated", url: "https://example.test/first" },
      ]);
      const rows = await pages.query({ filter: { url: "https://example.test/first" } });

      expect(inserted).toEqual({ inserted: 2, updated: 0 });
      expect(updated).toEqual({ inserted: 0, updated: 1 });
      expect(await pages.count()).toBe(2);
      expect(rows).toEqual([
        { status: "indexed", title: "First updated", url: "https://example.test/first" },
      ]);
    });
  });

  test("rejects one invalid row in a batch without writing any rows", async () => {
    await withDataset(async ({ pages }) => {
      await pages.upsert([
        { status: "draft", title: "Existing", url: "https://example.test/existing" },
      ]);
      const invalidRows = [
        { status: "draft", title: "Valid candidate", url: "https://example.test/valid-candidate" },
        { status: "indexed", title: 42, url: "https://example.test/invalid" },
      ];
      const upsertUnknownRows = pages.upsert as (rows: readonly unknown[]) => Promise<unknown>;

      await expect(upsertUnknownRows(invalidRows)).rejects.toThrow(DatasetRowValidationError);
      expect(await pages.count()).toBe(1);
      expect(await pages.query({ filter: { url: "https://example.test/valid-candidate" } })).toEqual([]);
    });
  });

  test("survives recreating sqlite stores with rows, freshness, and registry intact", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-dataset-restart-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    try {
      const first = createDatasetPort({
        definitions: [pagesDataset],
        runtimeStore: createSqliteWorkflowRuntimeStore(dbPath),
      });
      await first.datasets.scout_pages.upsert([
        { status: "indexed", title: "Persisted", url: "https://example.test/persisted" },
      ]);

      const secondStore = createSqliteWorkflowRuntimeStore(dbPath);
      const second = createDatasetPort({
        definitions: [pagesDataset],
        runtimeStore: secondStore,
      });
      const rows = await second.datasets.scout_pages.query({
        filter: { url: "https://example.test/persisted" },
      });
      const registry = await secondStore.listDatasets?.();

      expect(rows).toEqual([
        { status: "indexed", title: "Persisted", url: "https://example.test/persisted" },
      ]);
      expect(await second.datasets.scout_pages.count()).toBe(1);
      expect(await second.datasets.scout_pages.freshness()).toEqual(expect.any(String));
      expect(registry).toEqual([{
        freshness: expect.any(String),
        name: "scout_pages",
        rowCount: 1,
        version: 1,
      }]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails loudly when reopening a dataset definition with a bumped version", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-dataset-version-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    try {
      createDatasetPort({
        definitions: [pagesDataset],
        runtimeStore: createSqliteWorkflowRuntimeStore(dbPath),
      });
      const bumped = createDataset({
        key: ["url"],
        name: "scout_pages",
        schema: pageSchema,
        version: 2,
      });

      expect(() =>
        createDatasetPort({
          definitions: [bumped],
          runtimeStore: createSqliteWorkflowRuntimeStore(dbPath),
        })
      ).toThrow(DatasetVersionMismatchError);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("lists registered datasets with row count and freshness", async () => {
    await withDataset(async ({ pages, store }) => {
      await pages.upsert([
        { status: "indexed", title: "Registry row", url: "https://example.test/registry" },
      ]);

      expect(await store.listDatasets?.()).toEqual([{
        freshness: expect.any(String),
        name: "scout_pages",
        rowCount: 1,
        version: 1,
      }]);
    });
  });
});

const pagesDataset = createDataset({
  key: ["url"],
  name: "scout_pages",
  schema: pageSchema,
});

async function withDataset(
  fn: (input: {
    pages: ReturnType<typeof createDatasetPort<[typeof pagesDataset]>>["datasets"]["scout_pages"];
    store: ReturnType<typeof createSqliteWorkflowRuntimeStore>;
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "dromio-dataset-"));
  try {
    const store = createSqliteWorkflowRuntimeStore(path.join(directory, "runtime.sqlite"));
    const port = createDatasetPort({ definitions: [pagesDataset], runtimeStore: store });
    await fn({ pages: port.datasets.scout_pages, store });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
