export const DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS = 120_000;

const MAX_OPENAI_COMPATIBLE_TIMEOUT_MS = 300_000;

export function resolveOpenAiCompatibleTimeoutMs(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_OPENAI_COMPATIBLE_TIMEOUT_MS;
  }
  return Math.max(1, Math.min(MAX_OPENAI_COMPATIBLE_TIMEOUT_MS, Math.floor(value)));
}

export function createOpenAiCompatibleDeadline(
  parentSignal: AbortSignal | undefined,
  requestedTimeoutMs: number | undefined,
) {
  const timeoutMs = resolveOpenAiCompatibleTimeoutMs(requestedTimeoutMs);
  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(abortReason(parentSignal));
    }
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`provider timed out after ${timeoutMs}ms`));
    }
  }, timeoutMs);

  return {
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal,
    timeoutMs,
  };
}

export function abortReason(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  if (reason !== undefined) return new Error(String(reason));
  return new Error("provider request was aborted");
}

export function providerErrorMessage(error: unknown, signal: AbortSignal | undefined) {
  const cause = signal?.aborted ? abortReason(signal) : error;
  return cause instanceof Error ? cause.message : String(cause);
}

export function waitForAbort<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function readResponseText(
  response: Response,
  signal: AbortSignal | undefined,
) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  try {
    while (true) {
      const { done, value } = await waitForAbort(reader.read(), signal);
      if (done) break;
      content += decoder.decode(value, { stream: true });
    }
    return content + decoder.decode();
  } finally {
    if (signal?.aborted) {
      void reader.cancel(signal.reason).catch(() => undefined);
    }
    try {
      reader.releaseLock();
    } catch {
      // Cancellation releases a reader whose pending read outlived the race.
    }
  }
}
