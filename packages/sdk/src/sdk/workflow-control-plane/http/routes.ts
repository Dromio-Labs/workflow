import type {
  RouteMatch,
} from "./types.js";

export function matchRoute(request: Request, basePath: string): RouteMatch | null {
  const url = new URL(request.url);
  const path = stripBasePath(url.pathname, basePath);
  if (request.method === "GET" && path === "/workflows") return { route: "listWorkflows" };
  if (request.method === "GET" && path === "/runs") return { route: "listRuns" };
  if (request.method === "POST" && path === "/runs") return { route: "startRun" };
  if (request.method === "GET" && path === "/signals") return { route: "listSignals" };
  if (request.method === "GET" && path === "/triggers") return { route: "listTriggers" };
  if (request.method === "GET" && path === "/trigger-jobs") return { route: "listTriggerJobs" };
  if (request.method === "GET" && path === "/openapi.json") return { route: "getOpenApi" };
  if (request.method === "GET" && path === "/swagger") return { route: "getSwagger" };

  const occurrence = path.match(/^\/signal-occurrences\/([^/]+)$/);
  if (request.method === "GET" && occurrence?.[1]) {
    return { occurrenceId: decodeURIComponent(occurrence[1]), route: "getSignalOccurrence" };
  }

  const signal = path.match(/^\/signals\/([^/]+)(?:\/(occurrences))?$/);
  if (signal?.[1]) {
    const signalId = decodeURIComponent(signal[1]);
    if (request.method === "GET" && !signal[2]) return { route: "getSignal", signalId };
    if (request.method === "POST" && signal[2] === "occurrences") {
      return { route: "publishSignalOccurrence", signalId };
    }
  }

  const trigger = path.match(/^\/triggers\/([^/]+)(?:\/(input-form))?$/);
  if (trigger?.[1]) {
    const triggerId = decodeURIComponent(trigger[1]);
    if (request.method === "GET" && trigger[2] === "input-form") return { route: "getTriggerForm", triggerId };
    if (request.method === "GET" && !trigger[2]) return { route: "getTrigger", triggerId };
    if (request.method === "POST" && !trigger[2]) return { route: "invokeTrigger", triggerId };
  }

  const job = path.match(/^\/trigger-jobs\/([^/]+)(?:\/(events))?$/);
  if (request.method === "GET" && job?.[1]) {
    const jobId = decodeURIComponent(job[1]);
    return job[2] === "events" ? { route: "getTriggerJobEvents", jobId } : { route: "getTriggerJob", jobId };
  }

  const jobAction = path.match(/^\/trigger-jobs\/([^/]+)\/(retry|dead-letter|cancel)$/);
  if (request.method === "POST" && jobAction?.[1] && jobAction[2]) {
    const jobId = decodeURIComponent(jobAction[1]);
    if (jobAction[2] === "retry") return { route: "retryTriggerJob", jobId };
    if (jobAction[2] === "dead-letter") return { route: "deadLetterTriggerJob", jobId };
    return { route: "cancelTriggerJob", jobId };
  }

  const run = path.match(/^\/runs\/([^/]+)(?:\/(events))?$/);
  if (request.method === "GET" && run?.[1]) {
    const runId = decodeURIComponent(run[1]);
    return run[2] === "events" ? { route: "getRunEvents", runId } : { route: "getRun", runId };
  }

  const questionAnswer = path.match(/^\/runs\/([^/]+)\/questions\/([^/]+)\/answer$/);
  if (request.method === "POST" && questionAnswer?.[1] && questionAnswer[2]) {
    return {
      questionId: decodeURIComponent(questionAnswer[2]),
      route: "answerQuestion",
      runId: decodeURIComponent(questionAnswer[1]),
    };
  }

  const runAction = path.match(/^\/runs\/([^/]+)\/(resume)$/);
  if (request.method === "POST" && runAction?.[1]) {
    return { route: "resumeRun", runId: decodeURIComponent(runAction[1]) };
  }

  const hookResume = path.match(/^\/hooks\/([^/]+)\/resume$/);
  if (request.method === "POST" && hookResume?.[1]) {
    return { route: "resumeHook", token: decodeURIComponent(hookResume[1]) };
  }

  return null;
}

export function normalizeBasePath(value: string) {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function numberQuery(request: Request, key: string) {
  const value = new URL(request.url).searchParams.get(key);
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stripBasePath(pathname: string, basePath: string) {
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return pathname;
}
