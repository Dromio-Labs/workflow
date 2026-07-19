import {
  defineOperationContract,
  type OperationContract,
  type SafeParseLike,
} from "./contracts.js";

type SafeParseData<TResult> = TResult extends { data: infer TValue; success: true } ? TValue : never;

type InferSafeParseSchema<TSchema> =
  TSchema extends { safeParse(value: unknown): infer TResult }
    ? SafeParseData<TResult>
    : never;

export function zodOperationContract<
  const TId extends string,
  TSchema extends { safeParse(value: unknown): unknown },
>(id: TId, schema: TSchema): OperationContract<InferSafeParseSchema<TSchema>, TId> {
  return defineOperationContract({
    id,
    schema: schema as SafeParseLike<InferSafeParseSchema<TSchema>>,
  });
}
