import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defineSignal,
  signalCorrelationHash,
  type SignalWaitHookInput,
} from "@dromio/workflow";
import {
  createHook,
  createRuntimeStep,
  done,
  loop,
} from "@dromio/workflow/core";
import { createWorkflowApp } from "@dromio/workflow/client";
import {
  createSqliteWorkflowRuntimeStore,
  createWorkflowControlPlane,
  createWorkflowControlPlaneHttpAdapter,
  runSignalDeliveryPass,
  type AuthTokenVerifier,
  type SignalWaitSnapshot,
  type TriggerRegistryStore,
} from "@dromio/workflow/workflow-control-plane";
import { z } from "zod";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })
  ));
});

describe("durable typed signals", () => {
  test("publishes before a wait, survives restart, and resumes exactly one run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dromio-signals-"));
    directories.push(directory);
    const databasePath = join(directory, "runtime.sqlite");
    const first = harness(databasePath);

    const published = await first.http.fetch(signalRequest({
      correlation: { orderId: "order-123" },
      idempotencyKey: "stripe-event-123",
      payload: { transactionId: "txn-456" },
    }));
    expect(published.status).toBe(202);
    const receipt = (await published.json() as { receipt: { id: string } }).receipt;

    const replay = await first.http.fetch(signalRequest({
      correlation: { orderId: "order-123" },
      idempotencyKey: "stripe-event-123",
      payload: { transactionId: "txn-456" },
    }));
    expect(replay.status).toBe(200);

    const restarted = harness(databasePath);
    const run = await restarted.controlPlane.startRun({
      input: "order-123",
      runId: "run_signal_restart",
      workflowId: "payment",
    });
    expect(run.status).toBe("waiting");

    expect(await runSignalDeliveryPass({
      controlPlane: restarted.controlPlane,
      runtimeStore: restarted.store,
      workerId: "signal-worker-test",
    })).toBe(true);

    expect((await restarted.controlPlane.getRun(run.runId)).status).toBe("completed");
    expect((await restarted.controlPlane.getSignalOccurrence(receipt.id)).status)
      .toBe("delivered");
    expect(await runSignalDeliveryPass({
      controlPlane: restarted.controlPlane,
      runtimeStore: restarted.store,
      workerId: "signal-worker-test",
    })).toBe(false);
  });

  test("rejects invalid and conflicting idempotent publications", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dromio-signals-validation-"));
    directories.push(directory);
    const instance = harness(join(directory, "runtime.sqlite"));

    const invalid = await instance.http.fetch(signalRequest({
      correlation: { orderId: 123 },
      idempotencyKey: "invalid",
      payload: { transactionId: "txn-456" },
    }));
    expect(invalid.status).toBe(422);

    await instance.http.fetch(signalRequest({
      correlation: { orderId: "order-123" },
      idempotencyKey: "conflict",
      payload: { transactionId: "txn-456" },
    }));
    const conflict = await instance.http.fetch(signalRequest({
      correlation: { orderId: "order-123" },
      idempotencyKey: "conflict",
      payload: { transactionId: "txn-different" },
    }));
    expect(conflict.status).toBe(409);
  });

  test("matches a wait that exists before its occurrence and redacts its receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dromio-signals-wait-first-"));
    directories.push(directory);
    const instance = harness(join(directory, "runtime.sqlite"));
    const run = await instance.controlPlane.startRun({
      input: "order-wait-first",
      runId: "run_wait_first",
      workflowId: "payment",
    });
    expect(run.status).toBe("waiting");

    const published = await instance.http.fetch(signalRequest({
      correlation: { orderId: "order-wait-first" },
      idempotencyKey: "wait-first-event",
      payload: { transactionId: "txn-wait-first" },
    }));
    const receipt = (await published.json() as { receipt: { id: string } }).receipt;
    expect(await runSignalDeliveryPass({
      controlPlane: instance.controlPlane,
      runtimeStore: instance.store,
      workerId: "signal-worker-wait-first",
    })).toBe(true);

    const response = await instance.http.fetch(new Request(
      `http://local/api/signal-occurrences/${receipt.id}`,
    ));
    const body = await response.json() as { receipt: Record<string, unknown> };
    expect(body.receipt.status).toBe("delivered");
    expect(body.receipt).not.toHaveProperty("payload");
    expect(body.receipt).not.toHaveProperty("runId");
    expect(body.receipt).not.toHaveProperty("waitToken");
  });

  test("claims matching occurrences and waits FIFO without fan-out", async () => {
    const store = createSqliteWorkflowRuntimeStore(":memory:");
    const first = occurrence("fifo-occurrence-1", "fifo-key-1", "2026-07-14T15:30:00.000Z");
    const second = occurrence("fifo-occurrence-2", "fifo-key-2", "2026-07-14T15:30:01.000Z");
    await store.putSignalOccurrence(first);
    await store.putSignalOccurrence(second);
    await store.syncSignalWaits({
      now: first.createdAt,
      runId: "fifo-run-1",
      waits: [wait("fifo-wait-1", "fifo-run-1", first.createdAt)],
    });
    await store.syncSignalWaits({
      now: second.createdAt,
      runId: "fifo-run-2",
      waits: [wait("fifo-wait-2", "fifo-run-2", second.createdAt)],
    });

    const firstClaim = await store.claimNextSignalDelivery({
      leaseMs: 30_000,
      now: "2026-07-14T15:30:02.000Z",
      workerId: "fifo-worker",
    });
    const secondClaim = await store.claimNextSignalDelivery({
      leaseMs: 30_000,
      now: "2026-07-14T15:30:02.000Z",
      workerId: "fifo-worker",
    });
    expect([firstClaim?.occurrence.id, firstClaim?.wait.token]).toEqual([
      "fifo-occurrence-1",
      "fifo-wait-1",
    ]);
    expect([secondClaim?.occurrence.id, secondClaim?.wait.token]).toEqual([
      "fifo-occurrence-2",
      "fifo-wait-2",
    ]);
    expect(await store.claimNextSignalDelivery({
      leaseMs: 30_000,
      now: "2026-07-14T15:30:02.000Z",
      workerId: "fifo-worker",
    })).toBeUndefined();
  });

  test("reclaims an expired delivery lease after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dromio-signals-lease-"));
    directories.push(directory);
    const databasePath = join(directory, "runtime.sqlite");
    const first = createSqliteWorkflowRuntimeStore(databasePath);
    const stored = occurrence("lease-occurrence", "lease-key", "2026-07-14T15:30:00.000Z");
    await first.putSignalOccurrence(stored);
    await first.syncSignalWaits({
      now: stored.createdAt,
      runId: "lease-run",
      waits: [wait("lease-wait", "lease-run", stored.createdAt)],
    });
    const interrupted = await first.claimNextSignalDelivery({
      leaseMs: 1_000,
      now: stored.createdAt,
      workerId: "interrupted-worker",
    });
    expect(interrupted?.occurrence.attempts).toBe(1);

    const restarted = createSqliteWorkflowRuntimeStore(databasePath);
    const recovered = await restarted.claimNextSignalDelivery({
      leaseMs: 1_000,
      now: "2026-07-14T15:30:02.000Z",
      workerId: "recovery-worker",
    });
    expect(recovered?.occurrence.id).toBe("lease-occurrence");
    expect(recovered?.wait.token).toBe("lease-wait");
    expect(recovered?.occurrence.attempts).toBe(2);
  });

  test("documents signal schemas and enforces signal capabilities", async () => {
    const capabilities: string[] = [];
    const auth: AuthTokenVerifier = {
      verifyBearer({ capability, token }) {
        capabilities.push(capability);
        return token === "allowed";
      },
    };
    const instance = harness(":memory:", auth);
    expect((await instance.http.fetch(new Request("http://local/api/signals"))).status).toBe(401);
    const listed = await instance.http.fetch(new Request("http://local/api/signals", {
      headers: { authorization: "Bearer allowed" },
    }));
    expect(listed.status).toBe(200);

    const published = await instance.http.fetch(signalRequest({
      authorization: "Bearer allowed",
      correlation: { orderId: "order-auth" },
      idempotencyKey: "auth-event",
      payload: { transactionId: "txn-auth" },
    }));
    expect(published.status).toBe(202);
    expect(capabilities).toContain("signals.read");
    expect(capabilities).toContain("signal.publish:payment.confirmed");

    const openApi = await instance.http.fetch(new Request("http://local/api/openapi.json", {
      headers: { authorization: "Bearer allowed" },
    }));
    const document = await openApi.json() as { paths: Record<string, unknown> };
    expect(document.paths["/api/signals/payment.confirmed"]).toBeDefined();
    expect(document.paths["/api/signals/payment.confirmed/occurrences"]).toBeDefined();
    expect(document.paths["/api/signal-occurrences/{occurrenceId}"]).toBeDefined();
  });
});

const paymentConfirmed = defineSignal({
  correlation: z.object({ orderId: z.string() }),
  id: "payment.confirmed",
  payload: z.object({ transactionId: z.string() }),
});

function harness(databasePath: string, auth?: AuthTokenVerifier) {
  const store = createSqliteWorkflowRuntimeStore(databasePath);
  const app = createWorkflowApp({
    defaultWorkflow: "payment",
    id: "signal-test",
    workflows: {
      payment: {
        workflow: loop<unknown, string>({
          id: "payment",
          steps: [
            createRuntimeStep<unknown, string>("wait-for-payment", async (context) => {
              const correlation = { orderId: context.input };
              const value = await context.waitFor(createHook({
                id: paymentConfirmed.id,
                kind: "signal",
                schema: paymentConfirmed.descriptor,
              }), {
                contractFingerprint: paymentConfirmed.descriptor.contractFingerprint,
                correlation,
                correlationHash: signalCorrelationHash(correlation),
                signalId: paymentConfirmed.id,
              } satisfies SignalWaitHookInput<typeof correlation>);
              return done(value);
            }),
          ],
        }),
      },
    },
  });
  const controlPlane = createWorkflowControlPlane({
    app,
    auth,
    runtimeStore: store,
    signals: [paymentConfirmed],
    triggerStore: emptyTriggerStore(),
  });
  return {
    controlPlane,
    http: createWorkflowControlPlaneHttpAdapter({ controlPlane }),
    store,
  };
}

function signalRequest(input: {
  authorization?: string;
  correlation: unknown;
  idempotencyKey: string;
  payload: unknown;
}) {
  return new Request("http://local/api/signals/payment.confirmed/occurrences", {
    body: JSON.stringify({ correlation: input.correlation, payload: input.payload }),
    headers: {
      ...(input.authorization ? { authorization: input.authorization } : {}),
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    method: "POST",
  });
}

function occurrence(id: string, idempotencyKey: string, createdAt: string) {
  return {
    correlation: { orderId: "order-fifo" },
    correlationHash: signalCorrelationHash({ orderId: "order-fifo" }),
    createdAt,
    id,
    idempotencyKey,
    occurredAt: createdAt,
    payload: { transactionId: id },
    payloadHash: signalCorrelationHash({ transactionId: id }),
    signalId: paymentConfirmed.id,
    updatedAt: createdAt,
  };
}

function wait(token: string, runId: string, createdAt: string): SignalWaitSnapshot {
  const correlation = { orderId: "order-fifo" };
  return {
    contractFingerprint: paymentConfirmed.descriptor.contractFingerprint,
    correlation,
    correlationHash: signalCorrelationHash(correlation),
    createdAt,
    runId,
    signalId: paymentConfirmed.id,
    status: "pending",
    stepId: "wait-for-payment",
    token,
    updatedAt: createdAt,
  };
}

function emptyTriggerStore(): TriggerRegistryStore {
  return { async read() { return { triggers: [], version: 1 }; } };
}
