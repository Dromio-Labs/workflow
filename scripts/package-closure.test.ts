import { describe, expect, test } from "bun:test";
import {
  canonicalPackageName,
  selectCanonicalPublishTarget,
} from "./package-closure.js";
import { assertPackedPackageRuntimePayload } from "./package-payload.js";

describe("Workflow release ownership", () => {
  test("publishes only the canonical Workflow package from the build closure", () => {
    const closure = [
      { name: "@dromio/protocols", version: "0.2.0" },
      { name: canonicalPackageName, version: "0.2.0" },
      { name: "@dromio/thread-service", version: "0.2.0" },
    ];

    expect(selectCanonicalPublishTarget(closure)).toEqual([
      { name: canonicalPackageName, version: "0.2.0" },
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
});
