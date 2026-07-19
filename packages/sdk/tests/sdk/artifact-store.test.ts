import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ArtifactContentNotFoundError,
  createArtifactStorePort,
  createSqliteWorkflowRuntimeStore,
  type StoredWorkflowRunSnapshot,
} from "@dromio/workflow/workflow-control-plane";
import type {
  AgentTurnResult,
} from "@dromio/workflow/product";

describe("workflow artifact content store", () => {
  test("stores JSON outside run state and links only the artifact ref to the run snapshot", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-artifact-store-json-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    try {
      const store = createSqliteWorkflowRuntimeStore(dbPath);
      await store.putWorkflowRun(runSnapshot("run_artifact_json"));
      const artifacts = createArtifactStorePort({ runId: "run_artifact_json", runtimeStore: store });
      const payload = {
        gatheredPages: [
          {
            body: "large gathered page body that must not enter the run snapshot",
            url: "https://example.test/docs",
          },
        ],
      };

      const ref = await artifacts.put({
        kind: "gathered.pages",
        mediaType: "application/json",
        metadata: { source: "crawler" },
        title: "Gathered pages",
        value: payload,
      });
      const stored = await artifacts.get(ref);
      const run = await store.getWorkflowRun("run_artifact_json");
      const runJson = JSON.stringify(run);

      expect(ref.artifactId).toMatch(/^artifact_[a-f0-9]{32}$/);
      expect(ref.uri).toBe(`artifact:${ref.artifactId}`);
      expect(stored.content).toBe(JSON.stringify(payload));
      expect(run?.artifactRefs).toEqual([ref]);
      expect(runJson).toContain(ref.artifactId);
      expect(runJson).not.toContain("large gathered page body");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("keeps artifact content and linked refs after recreating sqlite-backed store objects", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-artifact-store-restart-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    try {
      const firstStore = createSqliteWorkflowRuntimeStore(dbPath);
      await firstStore.putWorkflowRun(runSnapshot("run_artifact_restart"));
      const firstPort = createArtifactStorePort({ runId: "run_artifact_restart", runtimeStore: firstStore });
      const ref = await firstPort.put({
        kind: "agent.transcript",
        mediaType: "application/json",
        title: "Support transcript",
        text: "{\"turns\":[\"persist me\"]}",
      });

      const secondStore = createSqliteWorkflowRuntimeStore(dbPath);
      const secondPort = createArtifactStorePort({ runtimeStore: secondStore });
      const stored = await secondPort.get(ref.artifactId);
      const linked = await secondStore.listArtifactRefs?.("run_artifact_restart");
      const run = await secondStore.getWorkflowRun("run_artifact_restart");

      expect(stored.content).toBe("{\"turns\":[\"persist me\"]}");
      expect(linked).toEqual([ref]);
      expect(run?.artifactRefs).toEqual([ref]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("round-trips bytes through the sqlite store's base64 string encoding", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-artifact-store-bytes-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    try {
      const store = createSqliteWorkflowRuntimeStore(dbPath);
      const artifacts = createArtifactStorePort({ runtimeStore: store });
      const bytes = Uint8Array.from([0, 1, 2, 127, 128, 255]);

      const ref = await artifacts.put({
        bytes,
        kind: "binary.capture",
        mediaType: "application/octet-stream",
        title: "Binary capture",
      });
      const raw = await store.getArtifactContent?.(ref.artifactId);
      const stored = await artifacts.get(ref);

      expect(raw?.content).toBe(Buffer.from(bytes).toString("base64"));
      expect(stored.content).toBeInstanceOf(Uint8Array);
      expect(Array.from(stored.content as Uint8Array)).toEqual(Array.from(bytes));
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("throws a typed not-found error for unknown artifact ids", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-artifact-store-missing-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    try {
      const artifacts = createArtifactStorePort({
        runtimeStore: createSqliteWorkflowRuntimeStore(dbPath),
      });

      await expect(artifacts.get("artifact_missing")).rejects.toThrow(ArtifactContentNotFoundError);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("stores a slice-1 agent transcript artifact and returns the same transcript", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-artifact-store-transcript-"));
    const dbPath = path.join(directory, "runtime.sqlite");
    try {
      const store = createSqliteWorkflowRuntimeStore(dbPath);
      const artifacts = createArtifactStorePort({ runtimeStore: store });
      const result: AgentTurnResult<{ answer: string }> = {
        output: { answer: "The account was credited." },
        rounds: 2,
        stopped: "completed",
        transcript: [
          {
            content: "I will inspect the customer ledger.",
            role: "assistant",
            round: 1,
            toolCalls: [{
              callId: "call_ledger",
              input: { customerId: "cus_123", range: "last-30-days" },
              toolId: "ledger.lookup",
            }],
          },
          {
            content: "Found the credit memo.",
            role: "tool",
            round: 1,
            status: "completed",
            toolCallId: "call_ledger",
            toolId: "ledger.lookup",
          },
          {
            content: "The account was credited.",
            role: "assistant",
            round: 2,
          },
        ],
      };

      const ref = await artifacts.put({
        kind: "agent.transcript",
        mediaType: "application/json",
        title: "Agent turn transcript",
        text: JSON.stringify(result.transcript),
      });
      const stored = await artifacts.get(ref);

      expect(JSON.parse(String(stored.content))).toEqual(result.transcript);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function runSnapshot(runId: string): StoredWorkflowRunSnapshot {
  return {
    artifacts: [],
    events: [],
    input: "store artifact content",
    pendingQuestions: [],
    runId,
    status: "running",
    workflowId: "artifact-store-test",
  };
}
