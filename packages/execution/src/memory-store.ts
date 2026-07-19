import type { ExecutionAttempt, ExecutionRun, ExecutionStore, ExecutionTransaction } from "./types.js";

interface State {
  readonly runs: Map<string, ExecutionRun>;
  readonly attempts: Map<string, ExecutionAttempt[]>;
  readonly fencing: Map<string, number>;
}

export class MemoryExecutionStore implements ExecutionStore {
  private state: State = { runs: new Map(), attempts: new Map(), fencing: new Map() };
  private pending: Promise<void> = Promise.resolve();

  async transaction<Result>(work: (transaction: ExecutionTransaction) => Result): Promise<Result> {
    const previous = this.pending;
    let release: () => void = () => undefined;
    this.pending = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const draft = structuredClone(this.state);
      const result = work(transactionFor(draft));
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }

  async listRuns(): Promise<readonly ExecutionRun[]> {
    return structuredClone([...this.state.runs.values()]);
  }

  async listAttempts(runId: string): Promise<readonly ExecutionAttempt[]> {
    return structuredClone(this.state.attempts.get(runId) ?? []);
  }
  async purgeThread(threadId: string): Promise<number> { let count = 0; for (const [id, run] of this.state.runs) if (run.payload?.threadId === threadId) { this.state.runs.delete(id); this.state.attempts.delete(id); this.state.fencing.delete(id); count += 1; } return count; }
}

function transactionFor(state: State): ExecutionTransaction {
  return {
    getRun: (id) => state.runs.get(id),
    findByIdempotency: (tenantId, applicationId, key) => [...state.runs.values()].find((run) => run.tenantId === tenantId && run.applicationId === applicationId && run.idempotencyKey === key),
    listRuns: () => [...state.runs.values()],
    putRun: (run) => state.runs.set(run.id, structuredClone(run)),
    listAttempts: (runId) => structuredClone(state.attempts.get(runId) ?? []),
    putAttempt: (attempt) => {
      const attempts = state.attempts.get(attempt.runId) ?? [];
      const index = attempts.findIndex((candidate) => candidate.id === attempt.id);
      if (index === -1) attempts.push(structuredClone(attempt));
      else attempts[index] = structuredClone(attempt);
      state.attempts.set(attempt.runId, attempts);
    },
    nextFencingToken: (runId) => {
      const token = (state.fencing.get(runId) ?? 0) + 1;
      state.fencing.set(runId, token);
      return token;
    },
  };
}
