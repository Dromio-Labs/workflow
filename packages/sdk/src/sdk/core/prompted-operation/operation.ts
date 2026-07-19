import type { EventPayload } from "../loop/index.js";
import {
  type InferOperationContractSource,
  normalizeOperationContract,
  type OperationContractSourceLike,
  parseOperationContract,
} from "./contracts.js";
import { parseJsonObjectFromText } from "./json-output.js";
import type {
  PromptedOperationDefinition,
  PromptedOperationDefinitionInput,
  PromptedOperationResult,
  RunPromptedOperationInput,
} from "./operation.types.js";
import {
  operationTrace,
  promptedOperationEvent,
} from "./trace-events.js";

export function definePromptedOperation<
  const TId extends string,
  TInputSource extends OperationContractSourceLike,
  TOutputSource extends OperationContractSourceLike,
>(
  operation: PromptedOperationDefinitionInput<TInputSource, TOutputSource, TId>,
): PromptedOperationDefinition<
  InferOperationContractSource<TInputSource>,
  InferOperationContractSource<TOutputSource>,
  TId
> {
  const shouldParseJsonOutput = !hasContractId(operation.output);
  return {
    ...operation,
    input: normalizeOperationContract(`${operation.id}.input`, operation.input),
    output: normalizeOperationContract(`${operation.id}.output`, operation.output),
    parseOutput: operation.parseOutput ?? (shouldParseJsonOutput
      ? (rawOutput) => typeof rawOutput === "string"
        ? parseJsonObjectFromText(rawOutput, `${operation.id} output`)
        : rawOutput
      : undefined),
  };
}

function hasContractId(value: OperationContractSourceLike) {
  return typeof value.id === "string";
}

export async function runPromptedOperation<
  TInput,
  TOutput,
  TId extends string,
>(
  input: RunPromptedOperationInput<TInput, TOutput, TId>,
): Promise<PromptedOperationResult<TOutput>> {
  const { operation } = input;
  const startedAt = performance.now();
  const label = operation.label ?? operation.id;
  const trace = input.trace;
  const emit = async (event: EventPayload) => {
    await input.onEvent?.(event);
  };
  const traceFor = (status: "error" | "ok" | "unset" = "unset") =>
    operationTrace({
      name: label,
      operationId: operation.id,
      status,
      trace,
    });

  await emit(promptedOperationEvent({
    detail: {
      contractId: operation.input.id,
      operationId: operation.id,
      outputContractId: operation.output.id,
      stage: "start",
    },
    message: `Started ${label}.`,
    trace: traceFor("unset"),
    type: "operation.started",
  }));

  let parsedInput: TInput;
  try {
    parsedInput = parseOperationContract(operation.input, input.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit(promptedOperationEvent({
      detail: {
        issue: message,
        operationId: operation.id,
        stage: "input",
      },
      message,
      trace: traceFor("error"),
      type: "operation.failed",
    }));
    throw error;
  }

  const context = {
    emit,
    input: parsedInput,
    inputContractId: operation.input.id,
    inputJsonSchema: operation.input.jsonSchema,
    onEvent: input.onEvent,
    operationId: operation.id,
    outputContractId: operation.output.id,
    outputJsonSchema: operation.output.jsonSchema,
    trace,
  };

  let rawOutput: unknown;
  try {
    await emit(promptedOperationEvent({
      detail: {
        operationId: operation.id,
        stage: "execute",
      },
      message: `Executing ${label}.`,
      trace: traceFor("unset"),
      type: "operation.progress",
    }));
    rawOutput = await operation.execute(parsedInput, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit(promptedOperationEvent({
      detail: {
        issue: message,
        operationId: operation.id,
        stage: "execute",
      },
      message: `Failed ${label}: ${message}`,
      trace: traceFor("error"),
      type: "operation.failed",
    }));
    throw error;
  }

  let output: TOutput;
  try {
    const outputValue = operation.parseOutput
      ? operation.parseOutput(rawOutput, context)
      : rawOutput;
    output = parseOperationContract(operation.output, outputValue);
    await emit(promptedOperationEvent({
      detail: {
        operationId: operation.id,
        outputContractId: operation.output.id,
        stage: "parse-output",
      },
      message: `Parsed ${label} output.`,
      trace: traceFor("unset"),
      type: "output.parsed",
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit(promptedOperationEvent({
      detail: {
        issue: message,
        operationId: operation.id,
        outputContractId: operation.output.id,
        stage: "parse-output",
      },
      message,
      trace: traceFor("error"),
      type: "operation.failed",
    }));
    throw error;
  }

  await emit(promptedOperationEvent({
    detail: {
      durationMs: elapsed(startedAt),
      operationId: operation.id,
      stage: "complete",
    },
    message: `Completed ${label}.`,
    trace: traceFor("ok"),
    type: "operation.completed",
  }));
  return { output, rawOutput };
}

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
