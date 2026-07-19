export type WorkbenchStarterTemplateContext = {
  packageName: string;
  registry: string;
};

export type WorkbenchStarterFile = {
  content: string;
  path: string;
};

import {
  npmrc,
  packageJson,
  triggersJson,
  tsconfigJson,
  workflowDocument,
} from "./workbench-template-json.js";

const catalogItemId = "starter.echo-message";

export function workbenchStarterFiles(
  context: WorkbenchStarterTemplateContext,
): WorkbenchStarterFile[] {
  return [
    file(".npmrc", npmrc(context)),
    jsonFile("package.json", packageJson(context)),
    jsonFile("tsconfig.json", tsconfigJson()),
    file("bin/cli.ts", cliEntrypoint()),
    file("bin/tui.ts", tuiEntrypoint()),
    file("bin/service.ts", serviceEntrypoint()),
    jsonFile(".dromio/triggers.json", triggersJson()),
    jsonFile(".dromio/workflows/echo.workflow.json", workflowDocument()),
    file("catalog/starter/echo-message/schema.ts", echoCatalogSchema()),
    file("catalog/starter/echo-message/step.ts", echoCatalogStep()),
    file("catalog/index.ts", catalogIndex()),
    file("workflows/echo/workflow.ts", echoWorkflow()),
    file("src/app.ts", appSource()),
    file("tests/echo-workflow.test.ts", echoWorkflowTest()),
  ];
}

function file(path: string, content: string): WorkbenchStarterFile {
  return {
    content: `${content.trim()}\n`,
    path,
  };
}

function jsonFile(path: string, value: unknown): WorkbenchStarterFile {
  return file(path, JSON.stringify(value, null, 2));
}

function tuiEntrypoint(): string {
  return `#!/usr/bin/env bun
import {
  runWorkflowTui,
} from "@dromio/workflow";
import {
  starterWorkflowApp,
} from "../src/app.js";

await runWorkflowTui(starterWorkflowApp, {
  commandName: "dromio-starter",
  emptyAnswerHint: "Press Enter to use the starter default.",
});`;
}

function cliEntrypoint(): string {
  return `#!/usr/bin/env bun
import {
  runWorkflowCli,
} from "@dromio/workflow";
import {
  starterWorkflowApp,
} from "../src/app.js";

await runWorkflowCli(starterWorkflowApp);`;
}

function serviceEntrypoint(): string {
  return `#!/usr/bin/env bun
import {
  createStaticBearerAuth,
  createWorkflowControlPlane,
} from "@dromio/workflow/workflow-control-plane/control-plane";
import {
  createWorkflowControlPlaneHttpAdapter,
} from "@dromio/workflow/workflow-control-plane/http";
import {
  createJsonTriggerStore,
} from "@dromio/workflow/workflow-control-plane/json-trigger-store";
import {
  createSqliteWorkflowRuntimeStore,
} from "@dromio/workflow/workflow-control-plane/sqlite-runtime-store";
import {
  starterWorkflowApp,
} from "../src/app.js";

const triggerToken = process.env.DROMIO_TRIGGER_TOKEN ?? "dev-dromio-starter-token";
const controlPlane = createWorkflowControlPlane({
  app: starterWorkflowApp,
  auth: createStaticBearerAuth({
    tokens: {
      [triggerToken]: ["*"],
    },
  }),
  runtimeStore: createSqliteWorkflowRuntimeStore(process.env.DROMIO_RUNTIME_DB_PATH ?? ".dromio/runtime.sqlite"),
  triggerStore: createJsonTriggerStore(process.env.DROMIO_TRIGGER_REGISTRY_PATH ?? ".dromio/triggers.json"),
});
const http = createWorkflowControlPlaneHttpAdapter({
  controlPlane,
  swagger: {
    auth: "public",
  },
});
const port = Number(process.env.PORT ?? "4323");
const server = Bun.serve({
  fetch: http.fetch,
  port,
});

console.log(\`Dromio starter service listening on \${server.url}\`);
console.log("Use DROMIO_TRIGGER_TOKEN to override the local bearer token.");`;
}

function echoCatalogSchema(): string {
  return `import {
  z,
} from "zod";

export const promptSchema = z.string().trim().min(1);
export const echoResultSchema = z.object({
  text: z.string(),
});`;
}

function echoCatalogStep(): string {
  return `import {
  step,
} from "@dromio/workflow";
import {
  echoResultSchema,
  promptSchema,
} from "./schema.js";

export const echoMessage = step({
  capabilities: ["starter", "text"],
  description: "Echoes a prompt into a structured text result.",
  examples: [{ userIntent: "echo this text back to me" }],
  id: "${catalogItemId}",
  input: { prompt: promptSchema },
  intents: ["echo a prompt", "test a starter workflow"],
  label: "Echo message",
  output: { echoResult: echoResultSchema },
  run(context) {
    return {
      echoResult: {
        text: \`Echo: \${context.input.prompt}\`,
      },
    };
  },
  tags: ["starter", "example"],
  verbs: ["echo", "transform"],
});`;
}

function catalogIndex(): string {
  return `import {
  catalog,
} from "@dromio/workflow";
import {
  echoMessage,
} from "./starter/echo-message/step.js";

export const starterCatalogItems = [
  echoMessage,
];

export const starterCatalog = catalog([
  ...starterCatalogItems,
]);`;
}

function echoWorkflow(): string {
  return `import {
  workflow,
} from "@dromio/workflow";
import {
  starterCatalogItems,
} from "../../catalog/index.js";
import {
  echoResultSchema,
  promptSchema,
} from "../../catalog/starter/echo-message/schema.js";

export const echoWorkflow = workflow({
  catalog: starterCatalogItems,
  document: new URL(
    "../../.dromio/workflows/echo.workflow.json",
    import.meta.url,
  ),
  input: { prompt: promptSchema },
  output: { echoResult: echoResultSchema },
});`;
}

function appSource(): string {
  return `import {
  workflowApp,
} from "@dromio/workflow";
import {
  echoWorkflow,
} from "../workflows/echo/workflow.js";

export const starterWorkflowApp = workflowApp({
  defaultWorkflow: echoWorkflow,
  id: "dromio-starter-workbench",
  title: "Dromio Starter Workbench",
  workflows: [echoWorkflow],
});`;
}

function echoWorkflowTest(): string {
  return `import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  starterWorkflowApp,
} from "../src/app.js";
import {
  starterCatalog,
} from "../catalog/index.js";
import {
  echoWorkflow,
} from "../workflows/echo/workflow.js";

type EchoState = {
  echoResult?: {
    text: string;
  };
};

describe("starter echo workflow", () => {
  test("registers a catalog-backed workflow app", () => {
    expect(starterCatalog.require("${catalogItemId}").label).toBe("Echo message");
    expect(starterWorkflowApp.workflowIds()).toEqual(["echo"]);
    expect(starterWorkflowApp.workspaceFrame("echo")?.validation.ok).toBe(true);
  });

  test("runs the starter workflow", async () => {
    const session = await echoWorkflow.start({ prompt: "hello starter" });
    const state = session.state as EchoState;
    expect(session.status).toBe("completed");
    expect(state.echoResult?.text).toBe("Echo: hello starter");
  });

  test("executes through the workspace test surface", async () => {
    const result = await echoWorkflow.workspace.test({
      input: { prompt: "workspace smoke" },
    });
    const state = result.state as EchoState;
    expect(result.status).toBe("completed");
    expect(state.echoResult?.text).toBe("Echo: workspace smoke");
  });
});`;
}
