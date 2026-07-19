import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createArtifactHttpHandlers,
  createClient,
  createHttpAdapter,
} from "../../src/sdk/client/index.js";
import { createSqliteWorkflowRuntimeStore } from "../../src/sdk/workflow-control-plane/index.js";
import { createIntentRuntime } from "../../src/sdk/core/index.js";
import { artifactRefJsonSchema } from "../../src/sdk/product/index.js";

describe("artifact HTTP transport", () => {
  it("uploads raw bytes through client.artifacts and downloads decoded bytes", async () => {
    await withArtifactHttp(async ({ client, http }) => {
      const bytes = Uint8Array.from([0, 1, 2, 127, 128, 255]);
      const ref = await client.artifacts.upload({
        bytes,
        kind: "binary.capture",
        mediaType: "application/octet-stream",
        title: "Raw capture",
      });

      expect(ref).toMatchObject({
        kind: "binary.capture",
        mediaType: "application/octet-stream",
        title: "Raw capture",
        uri: `artifact:${ref.artifactId}`,
      });
      expect(client.artifacts.url(ref.artifactId)).toBe(
        `http://local/api/artifacts/${encodeURIComponent(ref.artifactId)}`,
      );

      const response = await http.fetch(new Request(client.artifacts.url(ref.artifactId)));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/octet-stream");
      expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
    });
  });

  it("accepts a multipart file field and preserves file metadata", async () => {
    await withArtifactHttp(async ({ http }) => {
      const body = new FormData();
      body.append("file", new Blob(["image-bytes"], { type: "image/png" }), "capture.png");
      const uploaded = await http.fetch(new Request("http://local/api/artifacts", {
        body,
        headers: { "x-dromio-artifact-kind": "image.capture" },
        method: "POST",
      }));
      const ref = await uploaded.json() as {
        readonly artifactId: string;
        readonly kind: string;
        readonly mediaType: string;
        readonly title: string;
      };

      expect(uploaded.status).toBe(201);
      expect(ref).toMatchObject({
        kind: "image.capture",
        mediaType: "image/png",
        title: "capture.png",
      });
      const downloaded = await http.fetch(
        new Request(`http://local/api/artifacts/${encodeURIComponent(ref.artifactId)}`),
      );
      expect(await downloaded.text()).toBe("image-bytes");
    });
  });

  it("enforces the configured cap and returns typed HTTP errors", async () => {
    await withArtifactHttp(async ({ http }) => {
      const tooLarge = await http.fetch(new Request("http://local/api/artifacts", {
        body: Uint8Array.from([1, 2, 3, 4]),
        headers: {
          "content-type": "application/octet-stream",
          "x-dromio-artifact-kind": "binary.capture",
        },
        method: "POST",
      }));
      const multipartBody = new FormData();
      multipartBody.append(
        "file",
        new Blob([Uint8Array.from([1, 2, 3, 4])]),
        "too-large.bin",
      );
      const multipartTooLarge = await http.fetch(new Request("http://local/api/artifacts", {
        body: multipartBody,
        method: "POST",
      }));
      const missingKind = await http.fetch(new Request("http://local/api/artifacts", {
        body: "ok",
        headers: { "content-type": "text/plain" },
        method: "POST",
      }));
      const missing = await http.fetch(
        new Request("http://local/api/artifacts/artifact_missing"),
      );

      expect(tooLarge.status).toBe(413);
      expect(await tooLarge.json()).toMatchObject({ error: { code: "ARTIFACT_TOO_LARGE" } });
      expect(multipartTooLarge.status).toBe(413);
      expect(missingKind.status).toBe(400);
      expect(await missingKind.json()).toMatchObject({ error: { code: "ARTIFACT_KIND_REQUIRED" } });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ error: { code: "ARTIFACT_NOT_FOUND" } });
    }, 3);
  });

  it("exports the artifact reference JSON Schema for trigger inputs", () => {
    expect(artifactRefJsonSchema).toMatchObject({
      required: ["artifactId", "kind"],
      type: "object",
    });
  });
});

async function withArtifactHttp(
  execute: (input: {
    readonly client: ReturnType<typeof createClient>;
    readonly http: ReturnType<typeof createHttpAdapter>;
  }) => Promise<void>,
  maxBytes?: number,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "dromio-artifact-http-"));
  try {
    const runtimeStore = createSqliteWorkflowRuntimeStore(join(directory, "runtime.sqlite"));
    const runtime = createIntentRuntime({ workflows: {} });
    const http = createHttpAdapter({
      artifacts: createArtifactHttpHandlers({
        ...(maxBytes ? { maxBytes } : {}),
        runtimeStore,
      }),
      runtime,
    });
    const client = createClient({
      baseUrl: "http://local/api",
      fetch: (request) => http.fetch(request as Request),
      headers: { authorization: "Bearer proof" },
    });
    await execute({ client, http });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
