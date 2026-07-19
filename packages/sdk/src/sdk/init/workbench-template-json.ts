import type {
  WorkbenchStarterTemplateContext,
} from "./workbench-template.js";

const workflowId = "echo";
const catalogItemId = "starter.echo-message";

export function npmrc(context: WorkbenchStarterTemplateContext): string {
  const authHost = new URL(context.registry);
  const authPath = `${authHost.host}${authHost.pathname}`;
  return [
    `@dromio:registry=${context.registry}`,
    `//${authPath}:_authToken=\${NPM_TOKEN}`,
  ].join("\n");
}

export function packageJson(context: WorkbenchStarterTemplateContext) {
  return {
    name: context.packageName,
    private: true,
    type: "module",
    scripts: {
      check: "tsc --noEmit && dromio check && dromio validate --all && dromio compile --all",
      cli: "bun run bin/cli.ts",
      dev: "bun run bin/tui.ts",
      service: "bun run bin/service.ts",
      test: "bun test",
      tui: "bun run bin/tui.ts",
    },
    dependencies: {
      "@dromio/workflow": "^0.1.3",
      zod: "^4.1.12",
    },
    devDependencies: {
      "@types/bun": "latest",
      typescript: "^5.9.3",
    },
  };
}

export function tsconfigJson() {
  return {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022", "DOM"],
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["bun", "node"],
      forceConsistentCasingInFileNames: true,
    },
    include: ["bin/**/*.ts", "catalog/**/*.ts", "src/**/*.ts", "tests/**/*.ts", "workflows/**/*.ts"],
  };
}

export function triggersJson() {
  return {
    version: 1,
    triggers: [
      {
        auth: {
          mode: "bearer",
          tokenRef: "env:DROMIO_TRIGGER_TOKEN",
        },
        config: {
          method: "POST",
          path: "/api/triggers/starter.echo.http",
        },
        description: "Starts the starter echo workflow from an HTTP request body.",
        enabled: true,
        id: "starter.echo.http",
        input: {
          contentType: "application/json",
          jsonSchema: {
            properties: {
              prompt: {
                minLength: 1,
                type: "string",
              },
            },
            required: ["prompt"],
            type: "object",
          },
          mode: "body",
        },
        label: "Echo prompt",
        source: {
          triggerId: "http",
        },
        type: "http",
        workflowId,
      },
    ],
  };
}

export function workflowDocument() {
  return {
    description: "A minimal catalog-backed starter workflow.",
    edges: [
      {
        id: "prompt->echo-message",
        source: "prompt",
        target: "echo-message",
      },
      {
        id: "echo-message->echo-ready",
        source: "echo-message",
        target: "echo-ready",
      },
    ],
    end: {
      id: "echo-ready",
      label: "Echo ready",
      output: {
        echoResult: {
          jsonSchema: echoResultJsonSchema(),
        },
      },
      type: "result",
    },
    id: workflowId,
    label: "Echo",
    nodes: [
      {
        catalogItemId,
        id: "echo-message",
        label: "Echo message",
      },
    ],
    trigger: {
      id: "prompt",
      input: {
        prompt: {
          jsonSchema: {
            minLength: 1,
            type: "string",
          },
        },
      },
      label: "Prompt",
      type: "manual",
    },
    version: 1,
  };
}

function echoResultJsonSchema() {
  return {
    properties: {
      text: {
        type: "string",
      },
    },
    required: ["text"],
    type: "object",
  };
}
