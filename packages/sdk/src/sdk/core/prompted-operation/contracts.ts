import { z } from "zod";

export type OperationContractIssue = {
  message: string;
  path?: PropertyKey[];
};

export type OperationContractResult<TValue> =
  | { data: TValue; success: true }
  | { issues: OperationContractIssue[]; success: false };

export type OperationContract<TValue, TId extends string = string> = {
  id: TId;
  jsonSchema?: unknown;
  safeParse(value: unknown): OperationContractResult<TValue>;
};

export type OperationContractSourceLike = {
  id?: string;
  safeParse(value: unknown): unknown;
};

export type InferOperationContract<TContract> =
  TContract extends OperationContract<infer TValue> ? TValue : never;

export type InferOperationContractSource<TSource> =
  TSource extends OperationContract<infer TValue> ? TValue
    : TSource extends { safeParse(value: unknown): infer TResult }
      ? TResult extends { data: infer TValue; success: true } ? TValue : never
    : never;

export type SafeParseLike<TValue> = {
  safeParse(value: unknown):
    | { data: TValue; success: true }
    | { error?: { issues?: Array<{ message?: string; path?: PropertyKey[] }> }; success: false };
};

export function defineOperationContract<
  const TId extends string,
  TValue,
>(input: {
  id: TId;
  jsonSchema?: unknown;
  parse?: (value: unknown) => TValue;
  schema?: SafeParseLike<TValue>;
}): OperationContract<TValue, TId> {
  return {
    id: input.id,
    jsonSchema: input.jsonSchema ?? (input.schema ? jsonSchemaFromContractSource(input.schema) : undefined),
    safeParse(value) {
      if (input.schema) {
        const result = input.schema.safeParse(value);
        if (result.success) return { data: result.data, success: true };
        return {
          issues: (result.error?.issues ?? [{ message: "Contract validation failed." }]).map((issue) => ({
            message: issue.message ?? "Contract validation failed.",
            path: issue.path,
          })),
          success: false,
        };
      }
      if (!input.parse) {
        return { data: value as TValue, success: true };
      }
      try {
        return { data: input.parse(value), success: true };
      } catch (error) {
        return {
          issues: [{
            message: error instanceof Error ? error.message : String(error),
          }],
          success: false,
        };
      }
    },
  };
}

export function passthroughOperationContract<const TId extends string, TValue = unknown>(
  id: TId,
): OperationContract<TValue, TId> {
  return defineOperationContract<TId, TValue>({ id });
}

export function normalizeOperationContract<
  const TId extends string,
  TSource extends OperationContractSourceLike,
>(
  id: TId,
  source: TSource,
): OperationContract<InferOperationContractSource<TSource>, TId | string> {
  if (isOperationContract(source)) {
    return source as OperationContract<InferOperationContractSource<TSource>, string>;
  }
  return defineOperationContract({
    id,
    jsonSchema: jsonSchemaFromContractSource(source),
    schema: source as SafeParseLike<InferOperationContractSource<TSource>>,
  });
}

export function jsonSchemaFromContractSource(source: { safeParse(value: unknown): unknown }): unknown | undefined {
  try {
    return z.toJSONSchema(source as never);
  } catch {
    return undefined;
  }
}

function isOperationContract(value: OperationContractSourceLike): value is OperationContract<unknown> {
  return typeof value.id === "string";
}

export function parseOperationContract<TValue>(
  contract: OperationContract<TValue>,
  value: unknown,
): TValue {
  const result = contract.safeParse(value);
  if (result.success) return result.data;
  throw new Error(
    `Operation contract ${contract.id} failed: ${result.issues.map((issue) =>
      issue.path?.length ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message
    ).join("; ")}`,
  );
}
