import { createSqliteWorkflowRuntimeStore } from "../../../src/sdk/workflow-control-plane/sqlite-runtime-store.js";

const [databasePath, workerId, now] = process.argv.slice(2);
if (!databasePath || !workerId || !now) {
	throw new Error("Expected database path, worker id, and clock arguments.");
}

const store = createSqliteWorkflowRuntimeStore(databasePath);
process.stdout.write("ready\n");

const command = await Bun.stdin.text();
if (!command.includes("claim")) throw new Error("Expected claim command on stdin.");

const claimed: Array<{ attempts: number; occurrenceId: string; waitToken: string }> = [];
while (true) {
	const delivery = await store.claimNextSignalDelivery({
		leaseMs: 60_000,
		now,
		workerId,
	});
	if (!delivery) break;
	claimed.push({
		attempts: delivery.occurrence.attempts,
		occurrenceId: delivery.occurrence.id,
		waitToken: delivery.wait.token,
	});
}

process.stdout.write(`${JSON.stringify(claimed)}\n`);
