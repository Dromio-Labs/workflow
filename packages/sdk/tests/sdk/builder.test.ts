import { describe, expect, test } from "bun:test";

import { capabilities, capability } from "@dromio/workflow/product";
import type { IntentContract } from "@dromio/workflow/product";

describe("capabilities", () => {
  test("reports unsupported intent steps instead of silently dropping them", async () => {
    const catalog = capabilities({
      items: [
        capability({
          id: "source.read",
          intent: "read",
          title: "Read source",
        }),
      ],
    });

    const intent: IntentContract = {
      kind: "intent_contract",
      requirements: [
        {
          id: "source_id",
          label: "Source",
          required: true,
          status: "satisfied",
          type: "string",
          value: "source-1",
        },
        {
          id: "target_id",
          label: "Target",
          required: true,
          status: "satisfied",
          type: "string",
          value: "target-1",
        },
      ],
      steps: [
        {
          id: "step_read",
          label: "Read source",
          intent: "read",
          requirementIds: ["source_id"],
        },
        {
          id: "step_write",
          label: "Write target",
          intent: "write",
          requirementIds: ["target_id"],
        },
      ],
    };

    const match = await catalog.match(intent);

    expect(match.plan.items.map((item) => item.intent)).toEqual(["read"]);
    expect(match.missingCapabilities).toEqual([
      {
        intent: "write",
        label: "Write target",
        stepId: "step_write",
      },
    ]);
  });

  test("uses product-provided mappers for capability input", async () => {
    const catalog = capabilities({
      items: [
        capability({
          id: "source.read",
          mapInput: ({ requirementValue }) => ({
            source: requirementValue(["source_id", "source"]),
            mode: requirementValue("read_mode", "snapshot"),
          }),
          intent: "read",
          title: "Read source",
        }),
      ],
    });

    const intent: IntentContract = {
      kind: "intent_contract",
      requirements: [
        {
          id: "source_id",
          label: "Source",
          required: true,
          status: "satisfied",
          type: "string",
          value: "source-1",
        },
      ],
      steps: [
        {
          id: "step_read",
          label: "Read source",
          intent: "read",
          requirementIds: ["source_id"],
        },
      ],
    };

    const match = await catalog.match(intent);

    expect(match.plan.items[0]?.input).toEqual({
      mode: "snapshot",
      source: "source-1",
    });
    expect(match.missingCapabilities).toEqual([]);
  });

  test("does not invent intent-specific input when a capability has no mapper", async () => {
    const catalog = capabilities({
      items: [
        capability({
          id: "source.read",
          intent: "read",
          title: "Read source",
        }),
      ],
    });

    const intent: IntentContract = {
      kind: "intent_contract",
      requirements: [
        {
          id: "source_id",
          label: "Source",
          required: true,
          status: "satisfied",
          type: "string",
          value: "source-1",
        },
      ],
      steps: [
        {
          id: "step_read",
          label: "Read source",
          intent: "read",
          requirementIds: ["source_id"],
        },
      ],
    };

    const match = await catalog.match(intent);

    expect(match.plan.items[0]?.input).toEqual({});
  });

  test("keeps duplicate intent plan item ids and edges unique", async () => {
    const catalog = capabilities({
      items: [
        capability({
          id: "source.read",
          intent: "read",
          title: "Read source",
        }),
        capability({
          id: "target.notify",
          intent: "notify",
          title: "Notify target",
        }),
      ],
    });

    const intent: IntentContract = {
      kind: "intent_contract",
      requirements: [],
      steps: [
        {
          id: "step_read_primary",
          label: "Read primary source",
          intent: "read",
          requirementIds: [],
        },
        {
          id: "step_read_secondary",
          label: "Read secondary source",
          intent: "read",
          requirementIds: [],
        },
        {
          id: "step_notify_primary",
          label: "Notify primary target",
          intent: "notify",
          requirementIds: [],
        },
        {
          id: "step_notify_secondary",
          label: "Notify secondary target",
          intent: "notify",
          requirementIds: [],
        },
      ],
    };

    const match = await catalog.match(intent);
    const itemIds = match.plan.items.map((item) => item.id);
    const edgeIds = match.plan.edges.map((edge) => edge.id);

    expect(itemIds).toEqual([
      "node_step_read_primary",
      "node_step_read_secondary",
      "node_step_notify_primary",
      "node_step_notify_secondary",
    ]);
    expect(new Set(itemIds).size).toBe(itemIds.length);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
    for (const edge of match.plan.edges) {
      expect(itemIds).toContain(edge.from);
      expect(itemIds).toContain(edge.to);
    }
  });
});
