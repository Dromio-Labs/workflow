import type { ChildProcess } from "node:child_process";
import { Effect } from "effect";

export type ScopedModelWorkerChildInput<
	TChild extends ChildProcess,
	TResult,
> = {
	killGraceMs?: number;
	onTimeout?: (error: Error, child: TChild) => Promise<void> | void;
	spawnChild: () => TChild;
	timeoutMessage: string;
	timeoutMs: number;
	use: (child: TChild) => Promise<TResult>;
};

type ScopedModelWorkerChild<TChild extends ChildProcess> = {
	child: TChild;
	release: () => void;
	timeout: Promise<never>;
};

export function runScopedModelWorkerChild<TChild extends ChildProcess, TResult>(
	input: ScopedModelWorkerChildInput<TChild, TResult>,
) {
	return Effect.runPromise(
		Effect.acquireUseRelease(
			Effect.sync(() => createScopedModelWorkerChild(input)),
			(resource) =>
				Effect.tryPromise({
					catch: toError,
					try: () =>
						Promise.race([input.use(resource.child), resource.timeout]),
				}),
			(resource) => Effect.sync(() => resource.release()),
		),
	);
}

function createScopedModelWorkerChild<TChild extends ChildProcess, TResult>(
	input: ScopedModelWorkerChildInput<TChild, TResult>,
): ScopedModelWorkerChild<TChild> {
	const child = input.spawnChild();
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	let release = () => undefined;
	let timedOut = false;

	const timeout = new Promise<never>((_, reject) => {
		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			const timeoutError = new Error(input.timeoutMessage);
			terminateChild(child, input.killGraceMs ?? 5000, (timer) => {
				killTimer = timer;
			});
			void Promise.resolve(input.onTimeout?.(timeoutError, child))
				.catch(() => undefined)
				.then(() => reject(timeoutError));
		}, input.timeoutMs);
		timeoutTimer.unref?.();

		release = () => {
			clearTimeout(timeoutTimer);
			if (killTimer && !timedOut) clearTimeout(killTimer);
			if (!timedOut && !hasChildExited(child)) {
				terminateChild(child, input.killGraceMs ?? 5000, () => undefined);
			}
		};
	});

	return {
		child,
		release,
		timeout,
	};
}

function terminateChild(
	child: ChildProcess,
	killGraceMs: number,
	assignKillTimer: (timer: ReturnType<typeof setTimeout>) => void,
) {
	if (!hasChildExited(child)) child.kill("SIGTERM");
	const killTimer = setTimeout(() => {
		if (!hasChildExited(child)) child.kill("SIGKILL");
	}, killGraceMs);
	killTimer.unref?.();
	assignKillTimer(killTimer);
}

function hasChildExited(child: ChildProcess) {
	return child.exitCode !== null || child.signalCode !== null;
}

function toError(cause: unknown) {
	return cause instanceof Error ? cause : new Error(String(cause));
}
