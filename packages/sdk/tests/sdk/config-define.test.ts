import { describe, expect, it } from "bun:test";

import {
  browser,
  browserPlugin,
  defineApp,
  defineWorkflow,
  modelRegistry,
  provider,
} from "../../src/sdk/config/index.js";

describe("config-as-code definitions", () => {
  it("keeps advanced browser controls explicitly opt-in", () => {
    expect(browser({ driver: "brave-vnc", plugins: [] }).plugins).toEqual([]);
    const control = browserPlugin.control({
      preset: "agent-browser-parity",
      features: {
        inspect: "automatic",
        interaction: "approval-required",
        network: "disabled",
      },
      operations: { "browser.files.download": "approval-required" },
    });
    expect(browser({ driver: "brave-vnc", plugins: [control] }).plugins).toEqual([control]);
  });

  it("rejects duplicate browser-control policy sources", () => {
    const control = browserPlugin.control({ preset: "custom" });
    expect(() => browser({ driver: "brave-vnc", plugins: [control, control] }))
      .toThrow("same plugin more than once");
  });
  it("Given document and environment metadata, when defined, then builders preserve plain authored data", () => {
    const workflow = defineWorkflow({
      compileArtifact: "artifacts/review.json",
      document: "workflows/review.json",
      id: "review",
      title: "Review",
    });
    const app = defineApp({
      environments: {
        dev: {
          approvals: { writes: "required" },
          runtime: { model: "gpt-4.1-mini", provider: "openai" },
          sandbox: { filesystem: { mode: "bounded", writable: [".dromio"] } },
          storage: { dataPlane: "local" },
        },
      },
      name: "Review App",
      product: {
        architecture: { effect_mode: "off", mode: "strict", source_line_limit: 500 },
        entry: { workflows: "workflows/index.ts" },
        requires: { dromio: { sdk: ">=0.1.0 <0.2.0" } },
        version: "0.1.0",
      },
      workflows: [workflow],
    });

    expect(app.kind).toBe("app");
    expect(app.environments?.dev?.storage).toEqual({ dataPlane: "local" });
    expect(app.product?.version).toBe("0.1.0");
    expect(workflow).toEqual({
      compileArtifact: "artifacts/review.json",
      document: "workflows/review.json",
      id: "review",
      kind: "workflow",
      title: "Review",
    });
  });

  it("Given omitted artifact paths, when defined, then no convention defaults resolve yet", () => {
    const workflow = defineWorkflow({ id: "summarize", title: "Summarize" });

    expect(workflow).toEqual({ id: "summarize", kind: "workflow", title: "Summarize" });
    expect(workflow.document).toBeUndefined();
    expect(workflow.run).toBeUndefined();
  });

  it("Given generated environment help, when defined, then the reusable generator remains declarative", () => {
    const app = defineApp({
      dev: {
        envHelp: {
          LOCAL_SECRET: {
            description: "Local signing secret.",
            generate: { bytes: 32, type: "random-hex" },
          },
        },
        services: {},
      },
      name: "Generated Setup",
    });

    expect(app.dev?.envHelp?.LOCAL_SECRET?.generate).toEqual({
      bytes: 32,
      type: "random-hex",
    });
  });

  it("Given an OpenAI-compatible account endpoint, when defined, then its credential placeholders remain app-owned", () => {
    const configured = provider.openai("${DROMIO_LLM_MODEL:-example:model}", {
      apiKey: "${DROMIO_LLM_API_KEY}",
      baseUrl: "${DROMIO_LLM_BASE_URL}/v1",
      providerId: "account-endpoint",
    });

    expect(configured.env).toEqual({
      OPENAI_API_KEY: "${DROMIO_LLM_API_KEY}",
      OPENAI_API_MODE: "${OPENAI_API_MODE:-chat-completions}",
      OPENAI_BASE_URL: "${DROMIO_LLM_BASE_URL}/v1",
    });
  });

  it("Given provider-scoped models, when registered, then identity remains explicit", () => {
    const models = modelRegistry({
      default: { providerId: "gateway", modelId: "fast" },
      providers: [provider.openaiCompatible({
        id: "gateway",
        baseUrl: "https://gateway.example/v1",
        models: [
          { id: "fast", label: "Fast" },
          { id: "reasoner", label: "Reasoner" },
        ],
      })],
    });

    expect(models.default).toEqual({ providerId: "gateway", modelId: "fast" });
    expect(models.providers[0]?.models).toHaveLength(2);
  });

  it("accepts an environment-selected default with a registered fallback", () => {
    const models = modelRegistry({
      default: {
        providerId: "gateway",
        modelId: "${DROMIO_LLM_MODEL:-fast}",
      },
      providers: [provider.openaiCompatible({
        id: "gateway",
        apiKey: "${DROMIO_LLM_API_KEY}",
        baseUrl: "${DROMIO_LLM_BASE_URL}/v1",
        models: [
          { id: "fast", label: "Fast" },
          { id: "reasoner", label: "Reasoner" },
        ],
      })],
    });

    expect(models.default.modelId).toBe("${DROMIO_LLM_MODEL:-fast}");
  });

  it("rejects an environment-selected default whose fallback is not registered", () => {
    expect(() => modelRegistry({
      default: {
        providerId: "gateway",
        modelId: "${DROMIO_LLM_MODEL:-missing}",
      },
      providers: [provider.openaiCompatible({
        id: "gateway",
        apiKey: "${DROMIO_LLM_API_KEY}",
        baseUrl: "${DROMIO_LLM_BASE_URL}/v1",
        models: [{ id: "fast", label: "Fast" }],
      })],
    })).toThrow("Default model is not registered");
  });
});
