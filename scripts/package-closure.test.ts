import { describe, expect, test } from "bun:test";
import {
  canonicalPackageName,
  selectCanonicalPublishTarget,
} from "./package-closure.js";

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
});
