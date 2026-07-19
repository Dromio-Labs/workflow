import type {
  ActionBody,
  CreateHttpAdapterInput,
  HookResumeBody,
  HttpRouteParams,
  IntentHttpRoutes,
  RerunBody,
  WorkflowRunBody,
} from "./http.types.js";
import { eventStreamResponse } from "./sse.js";
import {
  json,
  jsonError,
  objectBody,
  readJson,
} from "./serialization.js";

export function createHttpRoutes(input: CreateHttpAdapterInput): IntentHttpRoutes {
  const actor = (request: Request) => input.actorFromRequest?.(request);

  return {
    async applyAction(request, params = {}) {
      const sessionId = requireParam(params, "sessionId");
      const actionKey = requireParam(params, "actionKey");
      const body = objectBody(await readJson(request)) as ActionBody;
      return json(await input.runtime.applyAction({
        actionKey,
        actor: await actor(request),
        input: body.input,
        sessionId,
      }));
    },

    async downloadArtifact(request, params = {}) {
      const artifactId = requireParam(params, "artifactId");
      return input.artifacts?.download(request, artifactId) ??
        jsonError("NOT_FOUND", "Artifact routes are not configured.", 404);
    },

    async getSession(request, params = {}) {
      const sessionId = requireParam(params, "sessionId");
      return json({ session: await input.runtime.getSession(sessionId, { actor: await actor(request) }) });
    },

    async listActions(request, params = {}) {
      const sessionId = requireParam(params, "sessionId");
      return json({ actions: await input.runtime.listActions(sessionId, { actor: await actor(request) }) });
    },

    async listCheckpoints(request, params = {}) {
      const sessionId = requireParam(params, "sessionId");
      return json({ checkpoints: await input.runtime.listCheckpoints(sessionId, { actor: await actor(request) }) });
    },

    async listEvents(request, params = {}) {
      const sessionId = requireParam(params, "sessionId");
      const fromIndex = numberQuery(request, "fromIndex");
      return json({ events: await input.runtime.listEvents(sessionId, { actor: await actor(request), fromIndex }) });
    },

    async listSessions(request) {
      return json({ sessions: await input.runtime.listSessions({ actor: await actor(request) }) });
    },

    async listWorkflows(request) {
      return json({ workflows: await input.runtime.listWorkflows({ actor: await actor(request) }) });
    },

    async rerunFromCheckpoint(request, params = {}) {
      const sessionId = requireParam(params, "sessionId");
      const body = objectBody(await readJson(request)) as RerunBody;
      if (!body.checkpointId) {
        return jsonError("BAD_REQUEST", "Missing checkpointId.", 400);
      }
      return json({
        session: await input.runtime.rerunFromCheckpoint({
          actor: await actor(request),
          checkpointId: body.checkpointId,
          input: body.input,
          sessionId,
          state: body.state,
        }),
      });
    },

    async resumeHook(request, params = {}) {
      const token = requireParam(params, "token");
      const body = objectBody(await readJson(request)) as HookResumeBody;
      return json({
        session: await input.runtime.resumeHook({
          actor: await actor(request),
          token,
          value: body.value,
        }),
      });
    },

    async runWorkflow(request, params = {}) {
      const workflowKey = requireParam(params, "workflowKey");
      const body = objectBody(await readJson(request)) as WorkflowRunBody;
      const inputValue = "input" in body ? body.input : body;
      return json({
        session: await input.runtime.startWorkflow(workflowKey, inputValue, {
          actor: await actor(request),
          answers: body.answers,
          runId: body.runId,
        }),
      }, 201);
    },

    async streamEvents(request, params = {}) {
      const sessionId = requireParam(params, "sessionId");
      const fromIndex = numberQuery(request, "fromIndex");
      return eventStreamResponse(input.runtime.streamEvents(sessionId, {
        actor: await actor(request),
        fromIndex,
      }));
    },

    async uploadArtifact(request) {
      return input.artifacts?.upload(request) ??
        jsonError("NOT_FOUND", "Artifact routes are not configured.", 404);
    },
  };
}

function requireParam<TName extends keyof HttpRouteParams>(
  params: HttpRouteParams,
  name: TName,
): string {
  const value = params[name];
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

function numberQuery(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key);
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
