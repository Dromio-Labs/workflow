import type { DromioApiErrorCode, DromioJsonObject } from "@dromio/protocols";

export class ThreadServiceError extends Error {
  readonly code: DromioApiErrorCode;
  readonly details?: DromioJsonObject;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: DromioApiErrorCode;
    readonly message: string;
    readonly details?: DromioJsonObject;
    readonly retryable?: boolean;
  }) {
    super(input.message);
    this.name = "ThreadServiceError";
    this.code = input.code;
    this.details = input.details;
    this.retryable = input.retryable ?? false;
  }
}

export function threadNotFound(threadId: string): ThreadServiceError {
  return new ThreadServiceError({
    code: "resource_not_found",
    message: `Thread ${threadId} was not found.`,
    details: { threadId },
  });
}

export function versionConflict(expected: number, actual: number): ThreadServiceError {
  return new ThreadServiceError({
    code: "version_conflict",
    message: `Expected thread version ${expected}, received ${actual}.`,
    details: { expected, actual },
  });
}
