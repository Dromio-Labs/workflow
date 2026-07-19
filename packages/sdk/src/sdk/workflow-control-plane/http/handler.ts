import {
  json,
  readJson,
} from "../../shared/transport/serialization.js";
import {
  triggerInputJsonRender,
} from "../trigger-json-render.js";
import { ControlPlaneError } from "../control-plane.js";
import type {
  WorkflowControlPlane,
} from "../types.js";
import {
  createOpenApiDocument,
} from "./openapi.js";
import {
  bearerToken,
  eventStreamResponse,
  objectBody,
  safeHttpEnvelope,
} from "./responses.js";
import {
  numberQuery,
} from "./routes.js";
import {
  swaggerResponse,
} from "./swagger.js";
import type {
  CreateWorkflowControlPlaneHttpAdapterInput,
  RouteMatch,
} from "./types.js";

export async function handleRoute(
  input: CreateWorkflowControlPlaneHttpAdapterInput,
  request: Request,
  match: RouteMatch,
): Promise<Response> {
  const controlPlane = input.controlPlane;
  switch (match.route) {
    case "answerQuestion": {
      await authorizeRoute(controlPlane, request, match);
      const body = objectBody(await readJson(request));
      return json({
        run: await controlPlane.answerQuestion(match.runId, {
          questionId: match.questionId,
          value: body.value,
        }),
      });
    }
    case "getOpenApi":
      await authorizeRoute(controlPlane, request, match);
      return json(await createOpenApiDocument(controlPlane, request));
    case "getRun":
      await authorizeRoute(controlPlane, request, match);
      return json({ run: await controlPlane.getRun(match.runId) });
    case "getRunEvents":
      await authorizeRoute(controlPlane, request, match);
      return eventStreamResponse(controlPlane.watchRun(match.runId, {
        fromIndex: numberQuery(request, "fromIndex"),
      }));
    case "getSignal":
      await authorizeRoute(controlPlane, request, match);
      return json({ signal: await controlPlane.getSignal(match.signalId) });
    case "getSignalOccurrence":
      await authorizeRoute(controlPlane, request, match);
      return json({ receipt: await controlPlane.getSignalOccurrence(match.occurrenceId) });
    case "getSwagger":
      if (input.swagger?.auth !== "public") {
        await authorizeRoute(controlPlane, request, match);
      }
      return swaggerResponse(await createOpenApiDocument(controlPlane, request));
    case "getTrigger": {
      await authorizeRoute(controlPlane, request, match);
      const trigger = await controlPlane.getTrigger(match.triggerId);
      return json({ trigger });
    }
    case "getTriggerForm": {
      await authorizeRoute(controlPlane, request, match);
      const trigger = await controlPlane.getTrigger(match.triggerId);
      return json({
        action: trigger.config?.path ?? `/api/triggers/${encodeURIComponent(trigger.id)}`,
        auth: {
          mode: trigger.auth?.mode ?? "bearer",
        },
        jsonRender: triggerInputJsonRender(trigger.input),
        jsonSchema: trigger.input?.jsonSchema,
        label: trigger.label,
        method: trigger.config?.method ?? "POST",
        triggerId: trigger.id,
        workflowId: trigger.workflowId,
      });
    }
    case "getTriggerJob":
      await authorizeRoute(controlPlane, request, match);
      return json({ job: await controlPlane.getTriggerJob(match.jobId) });
    case "getTriggerJobEvents":
      await authorizeRoute(controlPlane, request, match);
      return eventStreamResponse(controlPlane.watchTriggerJob(match.jobId, {
        fromIndex: numberQuery(request, "fromIndex"),
      }));
    case "invokeTrigger": {
      const url = new URL(request.url);
      const result = await controlPlane.enqueueTrigger({
        bearerToken: bearerToken(request),
        http: safeHttpEnvelope(request),
        idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
        input: await readJson(request),
        source: "http",
        triggerId: match.triggerId,
      });
      if (url.searchParams.get("wait") === "true") {
        return waitForTriggerJob(controlPlane, result, Number(url.searchParams.get("timeoutMs") ?? 10_000));
      }
      return json({
        job: result.job,
        jobId: result.job.id,
        runId: result.job.runId ?? null,
        status: result.job.status,
        triggerId: result.job.triggerId,
        workflowId: result.job.workflowId,
      }, result.created ? 202 : 200);
    }
    case "publishSignalOccurrence": {
      const idempotencyKey = request.headers.get("idempotency-key");
      if (!idempotencyKey) {
        throw new ControlPlaneError(
          "IDEMPOTENCY_KEY_REQUIRED",
          "Idempotency-Key header is required.",
          400,
        );
      }
      const body = objectBody(await readJson(request));
      const result = await controlPlane.publishSignalOccurrence({
        bearerToken: bearerToken(request),
        correlation: body.correlation,
        idempotencyKey,
        occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
        payload: body.payload,
        signalId: match.signalId,
      });
      return json(result, result.created ? 202 : 200);
    }
    case "retryTriggerJob": {
      await authorizeRoute(controlPlane, request, match);
      const body = objectBody(await readJson(request));
      return json({
        job: await controlPlane.retryTriggerJob({
          jobId: match.jobId,
          retryDelayMs: typeof body.retryDelayMs === "number" ? body.retryDelayMs : undefined,
        }),
      });
    }
    case "deadLetterTriggerJob": {
      await authorizeRoute(controlPlane, request, match);
      const body = objectBody(await readJson(request));
      return json({
        job: await controlPlane.deadLetterTriggerJob({
          error: typeof body.error === "string" ? body.error : undefined,
          jobId: match.jobId,
        }),
      });
    }
    case "cancelTriggerJob": {
      await authorizeRoute(controlPlane, request, match);
      const body = objectBody(await readJson(request));
      return json({
        job: await controlPlane.cancelTriggerJob({
          jobId: match.jobId,
          reason: typeof body.reason === "string" ? body.reason : undefined,
        }),
      });
    }
    case "resumeHook": {
      await authorizeRoute(controlPlane, request, match);
      const body = objectBody(await readJson(request));
      return json({
        run: await controlPlane.resumeHook({
          token: match.token,
          value: body.value,
        }),
      });
    }
    case "resumeRun":
      await authorizeRoute(controlPlane, request, match);
      return json({ run: await controlPlane.resumeRun(match.runId) });
    case "startRun": {
      await authorizeRoute(controlPlane, request, match);
      const body = objectBody(await readJson(request));
      if (typeof body.workflowId !== "string" || typeof body.input !== "string") {
        throw new ControlPlaneError(
          "INVALID_RUN_INPUT",
          "workflowId and string input are required.",
          422,
        );
      }
      return json({
        run: await controlPlane.startRun({
          input: body.input,
          runId: typeof body.runId === "string" ? body.runId : undefined,
          triggerId: typeof body.triggerId === "string" ? body.triggerId : undefined,
          workflowId: body.workflowId,
        }),
      });
    }
    case "listRuns":
      await authorizeRoute(controlPlane, request, match);
      return json({ runs: await controlPlane.listRuns() });
    case "listSignals":
      await authorizeRoute(controlPlane, request, match);
      return json({ signals: await controlPlane.listSignals() });
    case "listTriggerJobs":
      await authorizeRoute(controlPlane, request, match);
      return json({ jobs: await controlPlane.listTriggerJobs() });
    case "listTriggers":
      await authorizeRoute(controlPlane, request, match);
      return json({ triggers: await controlPlane.listTriggers() });
    case "listWorkflows":
      await authorizeRoute(controlPlane, request, match);
      return json({ workflows: await controlPlane.listWorkflows() });
  }
}

async function authorizeRoute(
  controlPlane: WorkflowControlPlane,
  request: Request,
  match: RouteMatch,
): Promise<void> {
  const token = bearerToken(request);
  if (match.route === "getOpenApi" || match.route === "getSwagger") {
    return controlPlane.authorize({ bearerToken: token, capability: "openapi.read" });
  }
  if (match.route === "getSignal" || match.route === "listSignals") {
    return controlPlane.authorize({ bearerToken: token, capability: "signals.read" });
  }
  if (match.route === "getSignalOccurrence") {
    return controlPlane.authorize({ bearerToken: token, capability: "signal-occurrences.read" });
  }
  if (match.route === "getTrigger" || match.route === "getTriggerForm") {
    return controlPlane.authorize({
      bearerToken: token,
      capability: `trigger.read:${match.triggerId}`,
      triggerId: match.triggerId,
    });
  }
  if (match.route === "listTriggers") {
    return controlPlane.authorize({ bearerToken: token, capability: "triggers.read" });
  }
  if (
    match.route === "getTriggerJob" ||
    match.route === "getTriggerJobEvents" ||
    match.route === "listTriggerJobs"
  ) {
    return controlPlane.authorize({ bearerToken: token, capability: "jobs.read" });
  }
  if (
    match.route === "retryTriggerJob" ||
    match.route === "deadLetterTriggerJob" ||
    match.route === "cancelTriggerJob"
  ) {
    return controlPlane.authorize({ bearerToken: token, capability: "jobs.write" });
  }
  if (match.route === "getRun" || match.route === "getRunEvents" || match.route === "listRuns") {
    return controlPlane.authorize({ bearerToken: token, capability: "runs.read" });
  }
  if (
    match.route === "answerQuestion" ||
    match.route === "resumeHook" ||
    match.route === "resumeRun" ||
    match.route === "startRun"
  ) {
    return controlPlane.authorize({ bearerToken: token, capability: "runs.write" });
  }
  if (match.route === "listWorkflows") {
    return controlPlane.authorize({ bearerToken: token, capability: "workflows.read" });
  }
}

async function waitForTriggerJob(
  controlPlane: WorkflowControlPlane,
  result: Awaited<ReturnType<WorkflowControlPlane["enqueueTrigger"]>>,
  timeoutMs: number,
): Promise<Response> {
  const timeoutAt = Date.now() + Math.max(0, Math.min(timeoutMs, 30_000));
  let job = result.job;
  while (Date.now() <= timeoutAt) {
    job = await controlPlane.getTriggerJob(job.id);
    if (job.runId) {
      const run = await controlPlane.getRun(job.runId);
      if (["cancelled", "completed", "failed"].includes(run.status)) {
        return json({ job, run }, result.created ? 202 : 200);
      }
    }
    if (["completed", "dead", "failed"].includes(job.status)) return json({ job }, result.created ? 202 : 200);
    await sleep(100);
  }
  return json({ job }, result.created ? 202 : 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
