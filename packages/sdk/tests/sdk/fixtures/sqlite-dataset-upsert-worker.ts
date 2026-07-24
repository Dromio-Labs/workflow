import { createSqliteWorkflowRuntimeStore } from "../../../src/sdk/workflow-control-plane/sqlite-runtime-store.js";

const DATASET_ROWS_PER_WORKER = 125;
const [databasePath, workerId] = process.argv.slice(2);
if (!databasePath || !workerId) {
	throw new Error("Expected database path and worker ID arguments.");
}

const store = createSqliteWorkflowRuntimeStore(databasePath);
process.stdout.write("ready\n");

const command = await Bun.stdin.text();
if (!command.includes("upsert")) throw new Error("Expected upsert command on stdin.");

const result = await store.upsertDatasetRows?.({
	key: ["ownerId", "itemId"],
	name: "concurrency_items",
	rows: Array.from({ length: DATASET_ROWS_PER_WORKER }, (_, index) => ({
		itemId: `${workerId}-item-${index}`,
		ownerId: workerId,
		value: index,
	})),
	schemaFingerprint: "concurrency-items-v1",
	version: 1,
});
if (!result) throw new Error("Dataset upserts are unavailable.");

process.stdout.write(`${JSON.stringify(result)}\n`);
