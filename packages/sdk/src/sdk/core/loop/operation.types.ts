export type StepOperationDetailValue =
  | boolean
  | number
  | string
  | null
  | readonly boolean[]
  | readonly number[]
  | readonly string[];

export type StepOperationDetail = Readonly<Record<string, StepOperationDetailValue>>;

export type StepOperationInput = {
  detail?: StepOperationDetail;
  id: string;
  idempotencyKey?: string;
  label?: string;
};

export type StepOperationProgress = {
  detail?: StepOperationDetail;
  message: string;
};

export type StepOperationContext = {
  readonly attempt: number;
  readonly idempotencyKey: string;
  readonly operationId: string;
  progress(input: StepOperationProgress): void;
};
