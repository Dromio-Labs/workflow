import type { CreateHttpAdapterInput } from "./http.types.js";
import { createHttpAdapter } from "./http.js";

type ExpressLikeRouter = {
  all(path: string, handler: (request: unknown, response: unknown) => void): unknown;
};

type ExpressLikeFactory = {
  Router(): ExpressLikeRouter;
};

type ExpressLikeRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  params?: Record<string, string>;
  url?: string;
};

type ExpressLikeResponse = {
  setHeader(name: string, value: string): unknown;
  status(code: number): ExpressLikeResponse;
  send(body: unknown): unknown;
};

export function createExpressRouter(
  input: CreateHttpAdapterInput & { express?: ExpressLikeFactory },
) {
  const express = input.express ?? optionalExpress();
  const router = express.Router();
  const adapter = createHttpAdapter(input);
  router.all("*", async (req, res) => {
    const response = await adapter.fetch(requestFromExpress(req as ExpressLikeRequest));
    await writeExpressResponse(response, res as ExpressLikeResponse);
  });
  return router;
}

function optionalExpress(): ExpressLikeFactory {
  throw new Error("Pass an Express module as createExpressRouter({ express, runtime }) to avoid a required SDK dependency on Express.");
}

function requestFromExpress(request: ExpressLikeRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  const url = request.originalUrl ?? request.url ?? "/";
  const body = request.body === undefined ? undefined : JSON.stringify(request.body);
  return new Request(`http://express.local${url}`, {
    body,
    headers,
    method: request.method ?? "GET",
  });
}

async function writeExpressResponse(response: Response, res: ExpressLikeResponse) {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(await response.text());
}
