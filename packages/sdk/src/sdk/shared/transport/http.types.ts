import type {
  IntentRuntime,
  RuntimeSessionSnapshot,
} from "../../core/runtime/index.js";
import type { ArtifactHttpHandlers } from "./artifacts.js";

export type ActorFromRequest = (request: Request) => Promise<unknown> | unknown;

export type CreateHttpAdapterInput = {
  actorFromRequest?: ActorFromRequest;
  artifacts?: ArtifactHttpHandlers;
  basePath?: string;
  runtime: IntentRuntime;
};

export type HttpRouteParams = {
  actionKey?: string;
  artifactId?: string;
  sessionId?: string;
  token?: string;
  workflowKey?: string;
};

export type HttpRouteHandler = (
  request: Request,
  params?: HttpRouteParams,
) => Promise<Response> | Response;

export type IntentHttpRoutes = {
  applyAction: HttpRouteHandler;
  downloadArtifact: HttpRouteHandler;
  getSession: HttpRouteHandler;
  listActions: HttpRouteHandler;
  listCheckpoints: HttpRouteHandler;
  listEvents: HttpRouteHandler;
  listSessions: HttpRouteHandler;
  listWorkflows: HttpRouteHandler;
  rerunFromCheckpoint: HttpRouteHandler;
  resumeHook: HttpRouteHandler;
  runWorkflow: HttpRouteHandler;
  streamEvents: HttpRouteHandler;
  uploadArtifact: HttpRouteHandler;
};

export type IntentHttpAdapter = {
  fetch(request: Request): Promise<Response>;
  routes: IntentHttpRoutes;
};

export type JsonErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export type WorkflowRunBody = {
  input?: unknown;
  runId?: string;
  answers?: Record<string, unknown>;
};

export type HookResumeBody = {
  value?: unknown;
};

export type ActionBody = {
  input?: unknown;
};

export type RerunBody = {
  checkpointId?: string;
  input?: unknown;
  state?: Record<string, unknown>;
};

export type RuntimeSessionResponse = {
  session: RuntimeSessionSnapshot;
};
