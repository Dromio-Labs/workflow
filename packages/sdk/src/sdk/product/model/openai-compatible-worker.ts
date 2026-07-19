import type {
  InferOperationContractSource,
  OperationContractSourceLike,
} from "../../core/prompted-operation/contracts.js";
import {
  createOpenAiCompatibleChatModel,
  type OpenAiCompatibleChatModelConfig,
} from "../intent/openai-compatible.js";
import type {
  ModelWorkerCompleteInput,
  ModelWorkerPort,
} from "./model-worker.js";

export class OpenAiCompatibleModelWorker implements ModelWorkerPort {
  private readonly model: ModelWorkerPort;

  constructor(config: OpenAiCompatibleChatModelConfig = {}) {
    this.model = createOpenAiCompatibleChatModel(config);
  }

  complete(input: ModelWorkerCompleteInput) {
    return this.model.complete(input);
  }

  completeJson<TSchema extends OperationContractSourceLike>(
    input: ModelWorkerCompleteInput & { schema: TSchema },
  ): Promise<InferOperationContractSource<TSchema>>;
  completeJson(input: ModelWorkerCompleteInput): Promise<unknown>;
  completeJson(input: ModelWorkerCompleteInput) {
    return this.model.completeJson(input);
  }
}

export function createOpenAiCompatibleModelWorker(
  config: OpenAiCompatibleChatModelConfig = {},
): ModelWorkerPort {
  return new OpenAiCompatibleModelWorker(config);
}
