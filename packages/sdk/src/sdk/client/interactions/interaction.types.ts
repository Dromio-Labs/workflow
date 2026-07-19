import type { EventRecord, HookRequest } from "../../core/loop/index.js";
import type {
  CandidateEvaluation,
  EvaluationBar,
} from "../../core/index.js";
import type { Question } from "../../product/intent/index.js";
import type {
  RuntimeActionDescriptor,
  RuntimeActionResult,
  RuntimeRerunInput,
  RuntimeSessionSnapshot,
} from "../../core/runtime/index.js";
import type { IntentClient } from "../transport/index.js";

export type InteractionQuestion = Question & {
  allowCustom?: boolean;
  hookId: string;
  hookToken: string;
};

export type InteractionValidationError = {
  code: string;
  message: string;
  questionId?: string;
};

export type ProjectQuestionsResult = {
  errors: InteractionValidationError[];
  questions: InteractionQuestion[];
};

export type InteractionMessage = {
  eventIndex: number;
  id: string;
  role: "assistant" | "system" | "user";
  text: string;
  timestamp: string;
  type: string;
};

export type InteractionTimelineItem = {
  event: EventRecord;
  id: string;
  index: number;
  label: string;
  status: "done" | "error" | "running" | "waiting";
  timestamp: string;
  type: string;
};

export type QuestionResolutionFeedback = {
  confidence: number;
  eventIndex: number;
  id: string;
  kind: "answer" | "approve" | "cancel" | "confirmation" | "question" | "revision" | "suggestion" | "unclear";
  message?: string;
  normalizedValue?: unknown;
  questionId: string;
  resolverId?: string;
  status: "accepted" | "needs_input" | "revision" | "cancelled";
  suggestedValue?: unknown;
  targetRequirementIds?: string[];
};

export type CandidateEvaluationFeedback = CandidateEvaluation & {
  eventIndex: number;
  id: string;
};

export type EvaluationBarFeedback = EvaluationBar & {
  eventIndex: number;
  id: string;
};

export type InteractionAction = RuntimeActionDescriptor & {
  available: boolean;
};

export type QuestionFlowStage = "answering" | "review" | "submitted";

export type QuestionSummaryItem = {
  label: string;
  questionId: string;
  value: unknown;
};

export type CreateQuestionFlowInput = {
  client: IntentClient;
  session: RuntimeSessionSnapshot;
};

export type QuestionFlow = {
  readonly activeId: string | undefined;
  readonly answers: Record<string, unknown>;
  readonly canSubmit: boolean;
  readonly errors: InteractionValidationError[];
  readonly questions: InteractionQuestion[];
  readonly stage: QuestionFlowStage;
  readonly summary: QuestionSummaryItem[];
  activate(questionId: string): void;
  answer(questionId: string, value: unknown): void;
  next(): void;
  previous(): void;
  select(questionId: string, value: unknown): void;
  setCustomAnswer(questionId: string, value: unknown): void;
  setText(questionId: string, value: string): void;
  submit(): Promise<RuntimeSessionSnapshot>;
  toggle(questionId: string, value: string): void;
  updateSession(session: RuntimeSessionSnapshot): void;
};

export type InteractionActions = {
  readonly descriptors: InteractionAction[];
  apply(actionKey: string, input?: unknown): Promise<RuntimeActionResult>;
  cancel(input?: { reason?: string }): Promise<RuntimeActionResult>;
  pause(input?: { reason?: string }): Promise<RuntimeActionResult>;
  rerunFromCheckpoint(input: Omit<RuntimeRerunInput, "sessionId">): Promise<RuntimeActionResult>;
  resume(): Promise<RuntimeActionResult>;
  update(descriptors: RuntimeActionDescriptor[]): void;
};

export type CreateInteractionInput = {
  client: IntentClient;
  session: RuntimeSessionSnapshot;
};

export type Interaction = {
  readonly actions: InteractionActions;
  readonly candidateEvaluations: CandidateEvaluationFeedback[];
  readonly evaluationBars: EvaluationBarFeedback[];
  readonly messages: InteractionMessage[];
  readonly pendingHooks: HookRequest[];
  readonly questionResolutions: QuestionResolutionFeedback[];
  readonly questionFlow: QuestionFlow;
  readonly questions: InteractionQuestion[];
  readonly session: RuntimeSessionSnapshot;
  readonly status: RuntimeSessionSnapshot["status"];
  readonly timeline: InteractionTimelineItem[];
  answer(questionId: string, value: unknown): Promise<RuntimeSessionSnapshot | void>;
  applyEvents(events: EventRecord[]): void;
  refresh(): Promise<RuntimeSessionSnapshot>;
  setCustomAnswer(questionId: string, value: unknown): void;
  setText(questionId: string, value: string): void;
  stream(input?: { fromIndex?: number }): AsyncIterable<EventRecord>;
  submit(): Promise<RuntimeSessionSnapshot>;
  toggle(questionId: string, value: string): void;
};
