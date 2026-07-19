import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";

import { runScopedModelWorkerChild } from "../../src/sdk/product/model/scoped-worker-child.js";

describe("scoped model worker child", () => {
	test("clears the timeout when child use completes", async () => {
		const signals: string[] = [];
		let timeoutCount = 0;

		await expect(
			runScopedModelWorkerChild({
				onTimeout: () => {
					timeoutCount += 1;
				},
				spawnChild: () => fakeChild(signals, 0),
				timeoutMessage: "model worker timed out",
				timeoutMs: 10,
				use: async () => "ok",
			}),
		).resolves.toBe("ok");

		await delay(30);

		expect(timeoutCount).toBe(0);
		expect(signals).toEqual([]);
	});

	test("terminates and escalates a timed-out child", async () => {
		const signals: string[] = [];

		await expect(
			runScopedModelWorkerChild({
				killGraceMs: 5,
				spawnChild: () => fakeChild(signals),
				timeoutMessage: "model worker timed out",
				timeoutMs: 5,
				use: () => new Promise<string>(() => undefined),
			}),
		).rejects.toThrow("model worker timed out");

		expect(signals).toContain("SIGTERM");

		await delay(15);

		expect(signals).toContain("SIGKILL");
	});
});

function fakeChild(
	signals: string[],
	exitCode: number | null = null,
): ChildProcess {
	return {
		exitCode,
		kill(signal?: NodeJS.Signals | number) {
			signals.push(String(signal));
			return true;
		},
		signalCode: null,
	} as unknown as ChildProcess;
}

function delay(ms: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
