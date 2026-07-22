import type {
  EventRecord,
  LoopCheckpoint,
  LoopGraphProjection,
  LoopHydrateOptions, LoopHydrationSnapshot, LoopSessionDurableSnapshot,
  LoopRerunOptions,
  HookRequest,
  HookResume,
  Question,
  WorkflowRunArtifactRef,
} from "../../../core/index.js";
import type {
  ModelWorkerSource,
} from "../../../product/model/index.js";
import type {
  WorkflowWorkspaceFrame,
  WorkflowWorkspaceTestInput,
  WorkflowWorkspaceTestResult,
} from "../../../product/workflow-document/index.js";
import type {
  TerminalQuestionInput,
  TerminalQuestionOutput,
} from "../terminal-questions.js";
import type {
  WorkflowTriggerDescriptor,
  WorkflowTriggerInputDescriptor,
} from "@dromio/workflow-room-protocol";

export type WorkflowAppQuestion = Question & {
  allowCustom?: boolean;
};

export type WorkflowAppSession = {
  answers?: Record<string, unknown>;
  checkpoints?: Array<LoopCheckpoint<unknown>>;
  pendingHooks?: HookRequest[];
  pendingQuestions: WorkflowAppQuestion[];
  parentCheckpointId?: string;
  parentRunId?: string;
  resumeHook?(input: HookResume): Promise<unknown> | unknown;
  rerunFromCheckpoint?(input: LoopRerunOptions<unknown>): Promise<WorkflowAppSession>;
  runId: string;
  state?: unknown;
  status: string;
  answer(input: { questionId: string; value: unknown }): Promise<unknown> | unknown;
  resume(): Promise<unknown> | unknown;
};

export type RunnableWorkflowAppWorkflow<
  TInput,
  TSession extends WorkflowAppSession,
> = {
  graph(): LoopGraphProjection;
  id: string;
  start(input: TInput, options?: {
    answers?: Record<string, unknown>;
    onEvent?: (event: EventRecord) => void;
    questionResolvers?: unknown;
    runId?: string;
  }): Promise<TSession> | TSession;
  hydrate?(snapshot: LoopHydrationSnapshot<TInput>, options?: LoopHydrateOptions): Promise<TSession> | TSession;
};

export type WorkflowAppInputDescriptor = WorkflowTriggerInputDescriptor;
export type WorkflowAppTriggerDescriptor = WorkflowTriggerDescriptor;

export type WorkflowAppCommand = {
  description?: string;
  name: string;
  usage?: string;
};

export type WorkflowAppCommandDescriptor = WorkflowAppCommand & {
  workflowId: string;
};

export type WorkflowAppConfigFieldDescriptor = {
  description?: string;
  env?: string | readonly string[];
  id: string;
  inputKey?: string;
  label?: string;
  required?: boolean;
  source?: "config" | "default" | "env" | "missing" | "optional" | "request";
  type?: "boolean" | "number" | "path" | "string" | "url";
  value?: boolean | number | string;
};

export type WorkflowAppConfigurationDescriptor = {
  configPath?: string;
  editTemplate?: Record<string, unknown>;
  fields: WorkflowAppConfigFieldDescriptor[];
};

export type WorkflowAppResultFormatter<TSession extends WorkflowAppSession = WorkflowAppSession> = (
  session: TSession,
) => string | undefined;

export type WorkflowAppEntry<
  TInput = string,
  TSession extends WorkflowAppSession = WorkflowAppSession,
> = {
  commands?: WorkflowAppCommand[];
  configuration?: WorkflowAppConfigurationDescriptor;
  description?: string;
  input?: WorkflowAppInputDescriptor;
  result?: {
    artifactName?: string;
    format?: WorkflowAppResultFormatter<TSession>;
  };
  triggers?: readonly WorkflowAppTriggerDescriptor[];
  title?: string;
  workflow: RunnableWorkflowAppWorkflow<TInput, TSession>;
  workspace?: WorkflowAppWorkspaceSource;
};

export type WorkflowAppWorkspaceSource = {
  acceptProposal?(): WorkflowWorkspaceFrame;
  compile?(): RunnableWorkflowAppWorkflow<unknown, WorkflowAppSession> | undefined;
  frame(): WorkflowWorkspaceFrame;
  publish?(input?: { version?: string }): WorkflowWorkspaceFrame;
  rejectProposal?(): WorkflowWorkspaceFrame;
  redo?(): WorkflowWorkspaceFrame;
  test?(input: WorkflowWorkspaceTestInput): Promise<WorkflowWorkspaceTestResult>;
  undo?(): WorkflowWorkspaceFrame;
};

export type WorkflowAppConfig = {
  defaultWorkflow?: string;
  id?: string;
  modelRouter?: WorkflowAppModelRouter;
  title?: string;
  workflows: Record<string, WorkflowAppEntry>;
};

export type WorkflowAppModelWorkerOption = {
  capabilities?: string[];
  id: string;
  label?: string;
  model?: string;
  worker?: string;
};

export type WorkflowAppModelWorkerTarget = {
  operation?: string;
  runId?: string;
  stepId: string;
  workflowId?: string;
};

export type WorkflowAppModelWorkerSelection = {
  overridden?: boolean;
  requested: WorkflowAppModelWorkerOption;
  selected: WorkflowAppModelWorkerOption;
  target: WorkflowAppModelWorkerTarget;
};

export type WorkflowAppModelRouter = {
  options(): WorkflowAppModelWorkerOption[];
  select(input: WorkflowAppModelWorkerTarget & { modelId: string }): void;
  selection(input: {
    requested: string;
    target: WorkflowAppModelWorkerTarget;
  }): WorkflowAppModelWorkerSelection;
  use?(modelId: string): ModelWorkerSource;
};

export type WorkflowAppWorkflowDescriptor = {
  commands?: WorkflowAppCommandDescriptor[];
  configuration?: WorkflowAppConfigurationDescriptor;
  description?: string;
  graph?: LoopGraphProjection;
  id: string;
  input?: WorkflowAppInputDescriptor;
  title: string;
  triggers: WorkflowAppTriggerDescriptor[];
};

export type WorkflowApp = {
  defaultWorkflowId: string;
  getWorkflow(id?: string): WorkflowAppEntry;
  graph(id?: string): LoopGraphProjection;
  id: string;
  listCommands(): WorkflowAppCommandDescriptor[];
  listWorkflows(): WorkflowAppWorkflowDescriptor[];
  registerWorkflow?(id: string, entry: WorkflowAppEntry): WorkflowAppWorkflowDescriptor;
  title: string;
  workflowIds(): string[];
  workspaceFrame(id?: string): WorkflowWorkspaceFrame | undefined;
  modelRouter?: WorkflowAppModelRouter;
};

export type WorkflowAppRun = {
  artifactError?: string;
  attachments?: WorkflowAppInputAttachment[];
  artifacts: WorkflowAppArtifact[];
  events: EventRecord[];
  input: string;
  origin?: WorkflowAppRunOrigin;
  runId: string;
  session: WorkflowAppSession;
  status: string;
  workflowId: string;
};

export type WorkflowAppRunSnapshot = {
  answers?: Record<string, unknown>;
  artifactError?: string;
  artifactRefs?: WorkflowRunArtifactRef[];
  attachments?: WorkflowAppInputAttachment[];
  artifacts: WorkflowAppArtifact[];
  checkpoints?: Array<LoopCheckpoint<unknown>>;
  durable?: LoopSessionDurableSnapshot;
  events: EventRecord[];
  input: string;
  origin?: WorkflowAppRunOrigin;
  pendingHooks?: HookRequest[];
  pendingQuestions: WorkflowAppQuestion[];
  parentCheckpointId?: string;
  parentRunId?: string;
  result?: string;
  runId: string;
  state?: unknown;
  status: string;
  workflowId: string;
};

export type WorkflowAppRunOrigin = {
  occurrenceId?: string;
  threadId?: string;
  triggerId?: string;
  triggerJobId?: string;
  type: "block" | "event" | "http" | "manual" | "schedule" | "webhook";
};

export type WorkflowAppRunSuspendedInteraction = {
  id: string;
  kind: string;
  summary: string;
  title?: string;
  token?: string;
};

export type WorkflowAppRunSuspendedThreadEvent = {
  interactions: WorkflowAppRunSuspendedInteraction[];
  runId: string;
  type: "run.suspended";
  workflowId: string;
};

export type WorkflowAppThreadEventEmitInput = {
  event: WorkflowAppRunSuspendedThreadEvent;
  threadId: string;
};

export type WorkflowAppThreadEventSink = {
  emit(input: WorkflowAppThreadEventEmitInput): void;
};

export type WorkflowAppArtifact = {
  kind: string;
  mediaType?: string;
  name: string;
  path?: string;
};

export type WorkflowAppInputAttachment = {
  label: string;
  mediaType: string;
  name: string;
  path?: string;
  size?: number;
};

export type WorkflowAppEndHookInput = {
  artifactName: string;
  run: WorkflowAppRunSnapshot;
};

export type WorkflowAppEndHook = (
  input: WorkflowAppEndHookInput,
) => Promise<WorkflowAppArtifact[] | void> | WorkflowAppArtifact[] | void;

export type WorkflowAppRuntimeOptions = {
  endHooks?: WorkflowAppEndHook[];
  threadEvents?: WorkflowAppThreadEventSink;
};

export type WorkflowAppRuntime = {
  answerQuestion(runId: string, input: { questionId: string; value: unknown }): Promise<WorkflowAppRun>;
  app: WorkflowApp;
  formatResult(runId: string): string;
  getRun(runId: string): WorkflowAppRun;
  hydrateRun?(snapshot: WorkflowAppRunSnapshot): Promise<WorkflowAppRun>;
  listRuns(): WorkflowAppRun[];
  listModelWorkers(): WorkflowAppModelWorkerOption[];
  listWorkflows(): WorkflowAppWorkflowDescriptor[];
  selectModelWorker(input: WorkflowAppSelectModelWorkerInput): WorkflowAppRun | undefined;
  resumeHook(input: WorkflowAppResumeHookInput): Promise<WorkflowAppRun>;
  rerunFromStep(runId: string, input: WorkflowAppRerunFromStepInput): Promise<WorkflowAppRun>;
  resumeRun(runId: string): Promise<WorkflowAppRun>;
  startRun(input: WorkflowAppStartRunInput): Promise<WorkflowAppRun>;
  subscribe(runId: string, listener: (event: EventRecord) => void): () => void;
};

export type WorkflowAppCliWritable = {
  columns?: number;
  isTTY?: boolean;
  write(chunk: string): unknown;
};

export type WorkflowTaskReporterPreset = "compact" | "none";

export type WorkflowCliCommandStatus = "completed" | "failed" | "skipped";

export type WorkflowCliStepStatus = WorkflowCliCommandStatus | "waiting";

export type WorkflowCliActivityStatus = "error" | "info" | "ok" | "running" | "warning";

export type WorkflowCliActivity = {
  children?: readonly string[];
  phase: string;
  status: WorkflowCliActivityStatus;
  stepId?: string;
  text: string;
};

export type WorkflowCliCommandDetail = {
  command: string;
  output?: string;
  status: WorkflowCliCommandStatus;
};

export type WorkflowCliRendererOptions = {
  color?: boolean | "auto";
  commandColumnWidth?: number;
  commandOutput?: "hidden" | "summary" | "full";
  failureDetail?: "first-line" | "full";
  showArtifacts?: boolean;
  showCommands?: boolean | "summary" | "verbose";
  showTimings?: boolean;
  style?: "compact" | "detailed";
  title?: string;
};

export type WorkflowTaskReporterOptions = WorkflowCliRendererOptions & {
  dryRun?: boolean | ((input: unknown) => boolean);
  renderer?: WorkflowCliRenderer;
};

export type WorkflowAppCliReporterStart = {
  argv: readonly string[];
  cli: WorkflowAppCliReporterDefinition;
  input?: unknown;
  stderr: WorkflowAppCliWritable;
  stdout: WorkflowAppCliWritable;
  workflowId: string;
};

export type WorkflowAppCliReporterComplete = WorkflowAppCliReporterStart & {
  durationMs: number;
  formattedResult: string;
  run: WorkflowAppRun;
};

export type WorkflowAppCliReporterError = Omit<WorkflowAppCliReporterStart, "input"> & {
  error: Error;
  usage?: string;
};

export type WorkflowAppCliReporter = {
  onComplete?(input: WorkflowAppCliReporterComplete): void;
  onError?(input: WorkflowAppCliReporterError): void;
  onEvent?(event: EventRecord): void;
  onStart?(input: WorkflowAppCliReporterStart): void;
};

export type WorkflowCliRendererStart = WorkflowAppCliReporterStart & {
  dryRun?: boolean;
};

export type WorkflowCliRendererStepStart = {
  label?: string;
  parentStepId?: string;
  stepId: string;
};

export type WorkflowCliRendererCommandStart = {
  command: string;
  stepId?: string;
};

export type WorkflowCliRendererCommandFinish = WorkflowCliCommandDetail & {
  stepId: string;
};

export type WorkflowCliRendererStepFinish = {
  durationMs?: unknown;
  label?: string;
  message?: string;
  parentStepId?: string;
  status: WorkflowCliStepStatus;
  stepId?: string;
};

export type WorkflowCliRendererComplete = WorkflowAppCliReporterComplete;

export type WorkflowCliRendererError = WorkflowAppCliReporterError;

export type WorkflowCliRenderer = {
  activity(input: WorkflowCliActivity): void;
  complete(input: WorkflowCliRendererComplete): void;
  dispose(): void;
  error(input: WorkflowCliRendererError): void;
  finishCommand(input: WorkflowCliRendererCommandFinish): void;
  finishStep(input: WorkflowCliRendererStepFinish): void;
  start(input: WorkflowCliRendererStart): void;
  startCommand(input: WorkflowCliRendererCommandStart): void;
  startStep(input: WorkflowCliRendererStepStart): void;
};

export type WorkflowAppCliDefinition<TInput = unknown> = {
  app: WorkflowApp;
  command?: string;
  encodeInput(input: TInput): string;
  endHooks?: WorkflowAppEndHook[];
  env?: Array<() => void>;
  origin?: WorkflowAppRunOrigin | ((input: TInput) => WorkflowAppRunOrigin);
  parseArgs(argv: readonly string[]): TInput;
  reporter?: WorkflowAppCliReporter | WorkflowTaskReporterPreset;
  title?: string;
  usage?: string | (() => string);
  workflowId: string;
};

export type WorkflowAppCliReporterDefinition = Pick<
  WorkflowAppCliDefinition<never>,
  "app" | "command" | "title" | "usage" | "workflowId"
>;

export type RunWorkflowAppCliOptions = {
  argv?: readonly string[];
  exit?: boolean;
  input?: TerminalQuestionInput;
  interactive?: boolean;
  stderr?: WorkflowAppCliWritable;
  stdout?: WorkflowAppCliWritable;
};

export type RunWorkflowAppCliResultOptions = Omit<RunWorkflowAppCliOptions, "exit">;

export type WorkflowAppCliResult = {
  error?: Error;
  exitCode: number;
  run?: WorkflowAppRun;
};

export type WorkflowAppSelectModelWorkerInput = WorkflowAppModelWorkerTarget & {
  modelId: string;
  requestedModelId?: string;
};

export type WorkflowAppHookResumeSource = {
  adapter?: string;
  capabilities?: string[];
  participant?: string;
};

export type WorkflowAppResumeHookInput = {
  source?: WorkflowAppHookResumeSource;
  token: string;
  value: unknown;
};

export type WorkflowAppRerunFromStepInput = {
  stepId: string;
};

export type WorkflowAppStartRunInput = {
  answers?: Record<string, unknown>;
  attachments?: WorkflowAppInputAttachment[];
  input: string;
  onEvent?: (event: EventRecord) => void;
  origin?: WorkflowAppRunOrigin;
  questionResolvers?: unknown;
  runId?: string;
  triggerId?: string;
  workflowId?: string;
};

export type WorkflowAppResolvedStartInput = {
  command?: WorkflowAppCommandDescriptor;
  input: string;
  triggerId?: string;
  workflowId: string;
};

export type RunWorkflowCliAppOptions = {
  argv?: string[];
  defaultPrompt?: string;
  emptyAnswerHint?: false | string;
  input?: TerminalQuestionInput;
  interactive?: boolean;
  maxNonInteractiveAutoAnswers?: number;
  output?: TerminalQuestionOutput;
  renderer?: "dashboard" | "log" | "none";
};

export type RunWorkflowAppOptions = {
  cli?: RunWorkflowCliAppOptions;
  defaultPrompt?: string;
  mode?: "auto" | "cli" | "tui";
  tui?: import("../workflow-app-tui.js").RunWorkflowTuiAppOptions;
};

export type NormalizedCliArgs = {
  error?: string;
  interactive?: boolean;
  prompt: string;
  sessionId?: string;
  workflowId?: string;
};
