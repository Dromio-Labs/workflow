import type {
  CreateHttpAdapterInput,
  HttpRouteParams,
  IntentHttpAdapter,
} from "./http.types.js";
import { createHttpRoutes } from "./routes.js";
import { jsonError } from "./serialization.js";

type RouteMatch = {
  handler: keyof ReturnType<typeof createHttpRoutes>;
  params?: HttpRouteParams;
};

export function createHttpAdapter(input: CreateHttpAdapterInput): IntentHttpAdapter {
  const basePath = normalizeBasePath(input.basePath ?? "/api");
  const routes = createHttpRoutes(input);
  return {
    routes,
    async fetch(request) {
      try {
        const match = matchRoute(request, basePath, Boolean(input.artifacts));
        if (!match) return jsonError("NOT_FOUND", "Not found.", 404);
        return routes[match.handler](request, match.params);
      } catch (error) {
        return jsonError("BAD_REQUEST", error instanceof Error ? error.message : String(error), 400);
      }
    },
  };
}

function matchRoute(
  request: Request,
  basePath: string,
  artifactsEnabled: boolean,
): RouteMatch | null {
  const url = new URL(request.url);
  const path = stripBasePath(url.pathname, basePath);
  if (artifactsEnabled && request.method === "POST" && path === "/artifacts") {
    return { handler: "uploadArtifact" };
  }
  const artifact = path.match(/^\/artifacts\/([^/]+)$/);
  if (artifactsEnabled && request.method === "GET" && artifact?.[1]) {
    return {
      handler: "downloadArtifact",
      params: { artifactId: decodeURIComponent(artifact[1]) },
    };
  }
  if (request.method === "GET" && path === "/workflows") {
    return { handler: "listWorkflows" };
  }
  const workflowRun = path.match(/^\/workflows\/([^/]+)\/runs$/);
  if (request.method === "POST" && workflowRun?.[1]) {
    return {
      handler: "runWorkflow",
      params: { workflowKey: decodeURIComponent(workflowRun[1]) },
    };
  }
  if (request.method === "GET" && path === "/sessions") {
    return { handler: "listSessions" };
  }
  const sessionPath = path.match(/^\/sessions\/([^/]+)(?:\/(events(?:\/stream)?|checkpoints|reruns|actions(?:\/([^/]+))?))?$/);
  if (sessionPath?.[1]) {
    const params = {
      actionKey: sessionPath[3] ? decodeURIComponent(sessionPath[3]) : undefined,
      sessionId: decodeURIComponent(sessionPath[1]),
    };
    const suffix = sessionPath[2];
    if (request.method === "GET" && !suffix) return { handler: "getSession", params };
    if (request.method === "GET" && suffix === "events") return { handler: "listEvents", params };
    if (request.method === "GET" && suffix === "events/stream") return { handler: "streamEvents", params };
    if (request.method === "GET" && suffix === "checkpoints") return { handler: "listCheckpoints", params };
    if (request.method === "POST" && suffix === "reruns") return { handler: "rerunFromCheckpoint", params };
    if (request.method === "GET" && suffix === "actions") return { handler: "listActions", params };
    if (request.method === "POST" && suffix?.startsWith("actions/")) return { handler: "applyAction", params };
  }
  const hookResume = path.match(/^\/hooks\/([^/]+)\/resume$/);
  if (request.method === "POST" && hookResume?.[1]) {
    return {
      handler: "resumeHook",
      params: { token: decodeURIComponent(hookResume[1]) },
    };
  }
  return null;
}

function normalizeBasePath(value: string) {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function stripBasePath(pathname: string, basePath: string) {
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length);
  }
  return pathname;
}
