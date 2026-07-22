import { describe, expect, test } from "bun:test";
import {
  canonicalPackageName,
  packageDirectories,
  selectCanonicalPublishTarget,
} from "./package-closure.js";
import {
  assertPackedPackageDependencyClosure,
  assertPackedPackageRuntimePayload,
} from "./package-payload.js";

describe("Workflow release ownership", () => {
  test("pins the canonical 0.2.5 package to the Kernel foundation closure", async () => {
    const versions = Object.fromEntries(await Promise.all(
      packageDirectories.map(async (directory) => {
        const manifest = await Bun.file(
          new URL(`../${directory}/package.json`, import.meta.url),
        ).json() as { name: string; version: string };
        return [manifest.name, manifest.version] as const;
      }),
    ));

    expect(versions).toEqual({
      "@dromio/chat-shell-ui": "0.1.11",
      "@dromio/execution": "0.1.43",
      "@dromio/protocols": "0.2.1",
      "@dromio/thread-service": "0.2.1",
      "@dromio/trigger": "0.1.44",
      "@dromio/workflow": "0.2.5",
      "@dromio/workflow-canvas-protocol": "0.1.3",
      "@dromio/workflow-kernel": "0.1.8",
      "@dromio/workflow-room-protocol": "0.1.45",
    });
  });

  test("owns every external package imported by the canonical runtime", async () => {
    const manifest = await Bun.file(new URL("../packages/sdk/package.json", import.meta.url)).json() as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(manifest.dependencies?.["cron-parser"]).toBe("5.5.0");
    expect(manifest.dependencies?.typescript).toBe("5.9.3");
    expect(manifest.devDependencies?.["cron-parser"]).toBeUndefined();
    expect(manifest.devDependencies?.typescript).toBeUndefined();
  });

  test("keeps MCP and terminal UI integrations optional in headless installs", async () => {
    const manifest = await Bun.file(new URL("../packages/sdk/package.json", import.meta.url)).json() as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    const optionalIntegrations = [
      "@modelcontextprotocol/sdk",
      "@opentui/core",
      "@opentui/solid",
    ];

    for (const name of optionalIntegrations) {
      expect(manifest.dependencies?.[name]).toBeUndefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true);
    }
    expect(manifest.exports?.["./workflow-control-plane/mcp"]).toBeDefined();
  });

  test("publishes only the canonical Workflow package from the build closure", () => {
    const closure = [
      { name: "@dromio/protocols", version: "0.2.1" },
      { name: canonicalPackageName, version: "0.2.5" },
      { name: "@dromio/thread-service", version: "0.2.1" },
    ];

    expect(selectCanonicalPublishTarget(closure)).toEqual([
      { name: canonicalPackageName, version: "0.2.5" },
    ]);
  });

  test("rejects a closure without the canonical package", () => {
    expect(() =>
      selectCanonicalPublishTarget([
        { name: "@dromio/protocols" },
        { name: "@dromio/thread-service" },
      ]),
    ).toThrow("found 0");
  });

  test("rejects a duplicate canonical package entry", () => {
    expect(() =>
      selectCanonicalPublishTarget([
        { name: canonicalPackageName, source: "first" },
        { name: canonicalPackageName, source: "second" },
      ]),
    ).toThrow("found 2");
  });

  test("rejects an immutable package whose declared runtime payload was not packed", () => {
    expect(() =>
      assertPackedPackageRuntimePayload(
        {
          exports: {
            ".": {
              import: "./dist/index.js",
              types: "./dist/index.d.ts",
            },
          },
          name: "@dromio/execution",
          version: "0.1.42",
        },
        ["package/LICENSE", "package/package.json"],
      ),
    ).toThrow("missing declared target ./dist/index.js");
  });

  test("accepts a package only when every concrete export target is present", () => {
    expect(() =>
      assertPackedPackageRuntimePayload(
        {
          exports: {
            ".": {
              import: "./dist/index.js",
              types: "./dist/index.d.ts",
            },
            "./schemas/*": "./schemas/*",
          },
          name: "@dromio/execution",
          version: "0.1.43",
        },
        [
          "package/LICENSE",
          "package/package.json",
          "package/dist/index.d.ts",
          "package/dist/index.js",
        ],
      ),
    ).not.toThrow();
  });

  test("rejects bare runtime and declaration imports missing from the packed manifest", () => {
    expect(() =>
      assertPackedPackageDependencyClosure(
        {
          dependencies: { zod: "4.4.3" },
          name: canonicalPackageName,
          version: "0.2.3",
        },
        [
          {
            path: "dist/index.js",
            source: [
              'import { z } from "zod";',
              'import ts from "typescript";',
              'const cron = require("cron-parser");',
              'type State = import("src/packages/chatshell-response-protocol/types").ConversationState;',
              'const example = "import hidden from \\\"string-only\\\"";',
            ].join("\n"),
          },
        ],
      )
    ).toThrow("cron-parser (dist/index.js); src (dist/index.js); typescript (dist/index.js)");
  });

  test("accepts dependencies, peers, builtins, relatives, and self imports", () => {
    expect(() =>
      assertPackedPackageDependencyClosure(
        {
          dependencies: { "cron-parser": "5.5.0", typescript: "5.9.3" },
          name: canonicalPackageName,
          peerDependencies: { react: "^19.0.0" },
          version: "0.2.3",
        },
        [
          {
            path: "dist/index.js",
            source: [
              'import "./chunk.js";',
              'import "bun:sqlite";',
              'import "node:fs";',
              'import "path";',
              'import "@dromio/workflow/product";',
              'import ts from "typescript";',
              'export { CronExpressionParser } from "cron-parser";',
              'const React = require("react/jsx-runtime");',
              'const lazy = import("react");',
            ].join("\n"),
          },
          {
            path: "dist/index.d.ts",
            source: 'export type Node = import("react").ReactNode;',
          },
        ],
      )
    ).not.toThrow();
  });
});
