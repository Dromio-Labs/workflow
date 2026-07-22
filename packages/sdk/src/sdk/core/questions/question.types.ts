import type { EventPayload } from "../loop/index.js";

export type QuestionOption = {
  description?: string;
  label: string;
  recommended?: boolean;
  value: string;
};

export type Question = {
  allowCustom?: boolean;
  answerSchema?: unknown;
  id: string;
  options?: QuestionOption[];
  prompt: string;
  requirementId?: string;
  resolverId?: string;
  title?: string;
  type: "choice" | "multi" | "text" | "confirm";
};

export type QuestionConstraints = {
  answerSchema?: unknown;
  id?: string;
  options?: QuestionOption[];
  prompt?: string;
  requirementId?: string;
  resolverId?: string;
  title?: string;
  type?: Question["type"];
};

export type QuestionResolution =
  | {
      confidence: number;
      kind: "answer" | "approve" | "question";
      message?: string;
      normalizedValue?: unknown;
      status: "accepted";
    }
  | {
      confidence: number;
      followUpQuestion?: Question;
      kind: "unclear" | "suggestion" | "confirmation";
      message: string;
      status: "needs_input";
      suggestedValue?: unknown;
    }
  | {
      confidence: number;
      kind: "revision";
      message: string;
      status: "revision";
      targetRequirementIds: string[];
    }
  | {
      confidence: number;
      kind: "cancel";
      message?: string;
      status: "cancelled";
    };

export type QuestionResolutionInput = {
  answers: Record<string, unknown>;
  history?: QuestionResolutionHistoryItem[];
  onEvent?: (event: EventPayload) => void | Promise<void>;
  question: Question;
  state: Record<string, unknown>;
  trace?: {
    parentSpanId?: string;
    spanId?: string;
    traceId?: string;
  };
  utterance: unknown;
};

export type QuestionResolutionHistoryItem = {
  resolution: QuestionResolution;
  utterance: unknown;
};

export type QuestionResolver = {
  id: string;
  resolve(input: QuestionResolutionInput): Promise<QuestionResolution> | QuestionResolution;
};

export type QuestionResolverRegistry = Record<string, (input: QuestionResolutionInput) =>
  Promise<QuestionResolution> | QuestionResolution>;
