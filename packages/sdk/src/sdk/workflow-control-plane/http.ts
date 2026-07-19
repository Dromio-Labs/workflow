import {
  ControlPlaneError,
} from "./control-plane.js";
import {
  handleRoute,
} from "./http/handler.js";
import {
  jsonErrorResponse,
} from "./http/responses.js";
import {
  matchRoute,
  normalizeBasePath,
} from "./http/routes.js";
import type {
  CreateWorkflowControlPlaneHttpAdapterInput,
  WorkflowControlPlaneHttpAdapter,
} from "./http/types.js";

export type {
  CreateWorkflowControlPlaneHttpAdapterInput,
  WorkflowControlPlaneHttpAdapter,
} from "./http/types.js";

export function createWorkflowControlPlaneHttpAdapter(
  input: CreateWorkflowControlPlaneHttpAdapterInput,
): WorkflowControlPlaneHttpAdapter {
  const basePath = normalizeBasePath(input.basePath ?? "/api");

  return {
    async fetch(request) {
      try {
        const match = matchRoute(request, basePath);
        if (!match) return jsonErrorResponse(request, "NOT_FOUND", "Not found.", 404);
        return await handleRoute(input, request, match);
      } catch (error) {
        if (error instanceof ControlPlaneError) {
          return jsonErrorResponse(request, error.code, error.message, error.status);
        }
        return jsonErrorResponse(request, "INTERNAL_ERROR", error instanceof Error ? error.message : String(error), 500);
      }
    },
  };
}
