import type {
  InferOperationContractSource,
  OperationContractSourceLike,
} from "../../core/prompted-operation/index.js";

export type RuntimeToolDescriptorLike = {
  readonly id: string;
  readonly workflowId?: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly effect?: "read" | "write" | "external" | string;
  readonly approval?: "never" | "on-risky" | "always" | string;
};

export type AgentTurnToolCallTranscript = {
  readonly callId: string;
  readonly toolId: string;
  readonly input: unknown;
};

export type AgentTurnTranscriptEntry =
  | {
      readonly content: string;
      readonly role: "assistant";
      readonly round: number;
      readonly toolCalls?: readonly AgentTurnToolCallTranscript[];
    }
  | {
      readonly content: string;
      readonly role: "tool";
      readonly round: number;
      readonly status: "completed" | "failed";
      readonly toolCallId: string;
      readonly toolId: string;
    };

export type AgentTurnStoppedReason = "completed" | "max-rounds";

export type AgentTurnInput<
  TOutputSchema extends OperationContractSourceLike = OperationContractSourceLike,
> = {
  readonly maxRounds?: number;
  readonly output?: TOutputSchema;
  readonly prompt: string;
  readonly system?: string;
  readonly tools?: readonly RuntimeToolDescriptorLike[] | readonly string[];
};

export type AgentTurnResult<TOutput = unknown> = {
  readonly output: TOutput;
  readonly rounds: number;
  readonly stopped: AgentTurnStoppedReason;
  readonly transcript: readonly AgentTurnTranscriptEntry[];
};

export type AgentTurnPort = {
  run<TOutputSchema extends OperationContractSourceLike>(
    input: AgentTurnInput<TOutputSchema> & { readonly output: TOutputSchema },
  ): Promise<AgentTurnResult<InferOperationContractSource<TOutputSchema>>>;
  run(input: AgentTurnInput): Promise<AgentTurnResult<unknown>>;
};
