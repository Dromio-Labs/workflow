import {
  cleanEnv,
  html,
  isLocalHost,
  normalizeBasePath,
  positiveInteger,
  stripBasePath,
  text,
} from "./workflow-app-wterm-utils.js";
import { renderWtermPage } from "./workflow-app-wterm/page.js";

export type WorkflowAppWtermAuth =
  | {
      mode?: "none";
    }
  | {
      mode: "bearer";
      queryParam?: string;
      token: string;
    };

export type WorkflowAppWtermDeepLinkParams = {
  session?: boolean | string;
  workflow?: boolean | string;
};

export type CreateWorkflowAppWtermAdapterInput = {
  args?: readonly string[];
  auth?: WorkflowAppWtermAuth;
  basePath?: string;
  cols?: number;
  command: string;
  cwd?: string;
  deepLinkParams?: WorkflowAppWtermDeepLinkParams;
  env?: Record<string, string | undefined>;
  envForRequest?(url: URL): Record<string, string | undefined>;
  localOnly?: boolean;
  rows?: number;
  title?: string;
  wtermGhosttyImportUrl?: false | string;
  wtermGhosttyWasmUrl?: string;
  wtermImportUrl?: string;
};

export type WorkflowAppWtermSocketData = {
  adapterId: string;
  args: readonly string[];
  cols: number;
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  rows: number;
  subprocess?: ReturnType<typeof Bun.spawn>;
  terminal?: Bun.Terminal;
};

export type WorkflowAppWtermAdapter = {
  fetch(request: Request, server?: Pick<Bun.Server<WorkflowAppWtermSocketData>, "upgrade">): Promise<Response | undefined>;
  websocket: Bun.WebSocketHandler<WorkflowAppWtermSocketData>;
};

const DEFAULT_BASE_PATH = "/terminal";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 36;
const DEFAULT_WTERM_GHOSTTY_IMPORT_URL = "https://esm.sh/@wterm/ghostty@0.3.0?bundle";
const DEFAULT_WTERM_GHOSTTY_WASM_URL = "https://esm.sh/@wterm/ghostty@0.3.0/wasm/ghostty-vt.wasm";
const DEFAULT_WTERM_IMPORT_URL = "https://esm.sh/@wterm/dom@0.3.0?bundle";
const RESIZE_PATTERN = /^\x1b\[RESIZE:(\d+);(\d+)\]$/;

export function createWorkflowAppWtermAdapter(input: CreateWorkflowAppWtermAdapterInput): WorkflowAppWtermAdapter {
  const adapterId = crypto.randomUUID();
  const basePath = normalizeBasePath(input.basePath ?? DEFAULT_BASE_PATH, DEFAULT_BASE_PATH);
  const cols = positiveInteger(input.cols, DEFAULT_COLS);
  const rows = positiveInteger(input.rows, DEFAULT_ROWS);
  const localOnly = input.localOnly ?? true;

  return {
    async fetch(request, server) {
      const url = new URL(request.url);
      const path = stripBasePath(url.pathname, basePath);
      if (path === null) return undefined;
      if (localOnly && !isLocalHost(url.hostname)) {
        return text("wterm adapter is available on localhost only by default.\n", 403);
      }
      const authError = authorizeWtermRequest(request, input.auth);
      if (authError) return authError;

      if (request.method === "GET" && (path === "/" || path === "")) {
        return html(renderWtermPage({
          basePath,
          cols,
          ghosttyImportUrl: input.wtermGhosttyImportUrl === false
            ? undefined
            : input.wtermGhosttyImportUrl ?? DEFAULT_WTERM_GHOSTTY_IMPORT_URL,
          ghosttyWasmUrl: input.wtermGhosttyWasmUrl ?? DEFAULT_WTERM_GHOSTTY_WASM_URL,
          rows,
          title: input.title ?? "Intent TUI",
          wtermImportUrl: input.wtermImportUrl ?? DEFAULT_WTERM_IMPORT_URL,
        }));
      }
      if (request.method === "GET" && path === "/pty") {
        if (!server) return text("Bun WebSocket server is required for the wterm PTY endpoint.\n", 501);
        const upgraded = server.upgrade(request, {
          data: {
            adapterId,
            args: withDeepLinkArgs(input.args ?? [], url, input.deepLinkParams),
            cols,
            command: input.command,
            cwd: input.cwd,
            env: {
              ...input.env,
              ...input.envForRequest?.(url),
            },
            rows,
          } satisfies WorkflowAppWtermSocketData,
        });
        if (upgraded) return undefined;
        return text("WebSocket upgrade failed.\n", 400);
      }
      return text("Not found.\n", 404);
    },

    websocket: {
      close(ws) {
        killPty(ws.data);
      },
      message(ws, message) {
        if (ws.data.adapterId !== adapterId) {
          ws.close(1008, "Unexpected wterm adapter.");
          return;
        }
        const inputText = websocketMessageText(message);
        const resize = inputText.match(RESIZE_PATTERN);
        if (resize) {
          const nextCols = positiveInteger(Number(resize[1]), ws.data.cols);
          const nextRows = positiveInteger(Number(resize[2]), ws.data.rows);
          ws.data.cols = nextCols;
          ws.data.rows = nextRows;
          if (ws.data.terminal) {
            ws.data.terminal.resize(nextCols, nextRows);
          } else {
            spawnPty(ws);
          }
          return;
        }
        if (!ws.data.terminal) spawnPty(ws);
        ws.data.terminal?.write(inputText);
      },
    },
  };
}

function withDeepLinkArgs(
  args: readonly string[],
  url: URL,
  params: WorkflowAppWtermDeepLinkParams | undefined,
) {
  if (!params) return args;
  const result = [...args];
  const workflowParam = params.workflow === false ? undefined : typeof params.workflow === "string" ? params.workflow : "workflow";
  const sessionParam = params.session === false ? undefined : typeof params.session === "string" ? params.session : "session";
  const workflow = workflowParam ? url.searchParams.get(workflowParam)?.trim() : undefined;
  const session = sessionParam ? url.searchParams.get(sessionParam)?.trim() : undefined;
  if (workflow) result.push("--workflow", workflow);
  if (session) result.push("--session", session);
  return result;
}

function spawnPty(ws: Bun.ServerWebSocket<WorkflowAppWtermSocketData>) {
  if (ws.data.terminal) return;
  try {
    const terminal = new Bun.Terminal({
      cols: ws.data.cols,
      data(_terminal, chunk) {
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      },
      exit() {
        ws.data.terminal = undefined;
        if (ws.readyState === WebSocket.OPEN) ws.close();
      },
      name: "xterm-256color",
      rows: ws.data.rows,
    });
    const subprocess = Bun.spawn([ws.data.command, ...ws.data.args], {
      cwd: ws.data.cwd ?? process.cwd(),
      env: cleanEnv(ws.data.env),
      terminal,
    });
    ws.data.terminal = terminal;
    ws.data.subprocess = subprocess;
    void subprocess.exited.then(() => {
      ws.data.subprocess = undefined;
      terminal.close();
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\n\x1b[31mFailed to start terminal: ${message}\x1b[0m\r\n`);
      ws.close(1011, "Failed to start terminal.");
    }
  }
}

function killPty(data: WorkflowAppWtermSocketData) {
  const subprocess = data.subprocess;
  const terminal = data.terminal;
  data.subprocess = undefined;
  data.terminal = undefined;
  subprocess?.kill();
  terminal?.close();
}

function authorizeWtermRequest(request: Request, auth: WorkflowAppWtermAuth | undefined) {
  if (!auth || auth.mode === undefined || auth.mode === "none") return undefined;
  if (auth.mode !== "bearer") return undefined;
  const header = request.headers.get("authorization");
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = new URL(request.url);
  const queryToken = url.searchParams.get(auth.queryParam ?? "token");
  if (bearer === auth.token || queryToken === auth.token) return undefined;
  return text("Unauthorized.\n", 401, {
    "www-authenticate": "Bearer",
  });
}

function websocketMessageText(message: string | Buffer) {
  return typeof message === "string" ? message : message.toString("utf8");
}
