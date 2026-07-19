import { describe, expect, test } from "bun:test";
import {
  createWorkflowAppWtermAdapter,
} from "@dromio/workflow/client";

describe("workflow app wterm adapter", () => {
  test("serves a browser terminal page for the configured base path", async () => {
    const adapter = createWorkflowAppWtermAdapter({
      args: ["run", "bin/tui.ts"],
      command: "bun",
      title: "Dogfood TUI",
    });

    const response = await adapter.fetch(new Request("http://localhost/terminal"));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/html");
    const body = await response!.text();
    expect(body).toContain("Dogfood TUI");
    expect(body).toContain("@wterm/dom");
    expect(body).toContain("@wterm/ghostty");
    expect(body).toContain("/terminal/pty");
    expect(body).toContain("terminal-fallback");
    expect(body).toContain("fallback-visible");
  });

  test("can forward workflow and session query params into PTY args", async () => {
    const adapter = createWorkflowAppWtermAdapter({
      args: ["run", "bin/tui.ts"],
      command: "bun",
      deepLinkParams: {
        session: true,
        workflow: true,
      },
    });

    const page = await adapter.fetch(new Request("http://localhost/terminal?workflow=process-images&session=run-123"));
    expect(await page!.text()).toContain("\"workflow\", \"session\"");

    let ptyData: { args: readonly string[] } | undefined;
    const response = await adapter.fetch(new Request("http://localhost/terminal/pty?workflow=process-images&session=run-123"), {
      upgrade(_request, options) {
        ptyData = options.data as { args: readonly string[] };
        return true;
      },
    });

    expect(response).toBeUndefined();
    expect(ptyData?.args).toEqual(["run", "bin/tui.ts", "--workflow", "process-images", "--session", "run-123"]);
  });

  test("guards the PTY endpoint behind localhost by default", async () => {
    const adapter = createWorkflowAppWtermAdapter({
      command: "bun",
    });

    const response = await adapter.fetch(new Request("http://example.com/terminal/pty"));
    expect(response?.status).toBe(403);
  });

  test("requires a Bun websocket server for PTY upgrades", async () => {
    const adapter = createWorkflowAppWtermAdapter({
      command: "bun",
    });

    const response = await adapter.fetch(new Request("http://localhost/terminal/pty"));
    expect(response?.status).toBe(501);
    expect(await response!.text()).toContain("WebSocket server");
  });

  test("supports bearer or query token authorization", async () => {
    const adapter = createWorkflowAppWtermAdapter({
      auth: {
        mode: "bearer",
        token: "dev-token",
      },
      command: "bun",
    });

    const denied = await adapter.fetch(new Request("http://localhost/terminal"));
    expect(denied?.status).toBe(401);

    const allowed = await adapter.fetch(new Request("http://localhost/terminal?token=dev-token"));
    expect(allowed?.status).toBe(200);
  });

  test("returns undefined for routes outside the adapter base path", async () => {
    const adapter = createWorkflowAppWtermAdapter({
      command: "bun",
    });

    const response = await adapter.fetch(new Request("http://localhost/apps"));
    expect(response).toBeUndefined();
  });
});
