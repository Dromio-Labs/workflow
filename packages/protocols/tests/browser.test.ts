import { describe, expect, test } from "bun:test";
import {
  dromioBrowserFeatureGroups,
  dromioBrowserOperationContracts,
  dromioBrowserOperationIds,
  dromioBrowserOperationInputSchemas,
} from "../src/index.js";

describe("browser protocol registry", () => {
  test("has unique stable IDs and covers every feature group", () => {
    expect(new Set(dromioBrowserOperationIds).size).toBe(dromioBrowserOperationIds.length);
    expect(dromioBrowserOperationContracts.length).toBeGreaterThanOrEqual(120);
    expect(new Set(dromioBrowserOperationContracts.map(({ feature }) => feature)))
      .toEqual(new Set(dromioBrowserFeatureGroups));
  });

  test("keeps raw execution and provider controls out of the public protocol", () => {
    const serialized = JSON.stringify(dromioBrowserOperationContracts);
    expect(serialized).not.toContain("evaluate");
    expect(serialized).not.toContain("cdp");
    expect(serialized).not.toContain("javascript");
  });

  test("never marks state-changing operations safe for automatic retry", () => {
    for (const operation of dromioBrowserOperationContracts) {
      if (operation.effect !== "read" && operation.effect !== "diagnostic") {
        expect(operation.recovery).toBe("never-retry");
      }
    }
  });

  test("marks sensitive inputs as transient", () => {
    for (const id of [
      "browser.state.auth-login",
      "browser.state.cookies-set",
      "browser.network.credentials-set",
      "browser.files.upload",
    ]) {
      expect(dromioBrowserOperationContracts.find((entry) => entry.id === id)?.transientInput)
        .toBe(true);
    }
  });

  test("publishes one closed input schema per operation", () => {
    expect(Object.keys(dromioBrowserOperationInputSchemas).sort())
      .toEqual([...dromioBrowserOperationIds].sort());
    for (const schema of Object.values(dromioBrowserOperationInputSchemas)) {
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
