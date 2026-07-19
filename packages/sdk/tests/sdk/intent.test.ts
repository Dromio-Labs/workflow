import { describe, expect, test } from "bun:test";

import {
  domain,
  intent,
  resolveIntent,
  type IntentContract,
} from "@dromio/workflow/product";

describe("resolveIntent questions", () => {
  test("re-enters the resolver with accumulated answers so dependent questions can appear", async () => {
    const workflowDomain = domain({
      id: "workflow",
      intent: {
        questionConstraintsForRequirement({ requirement }) {
          return {
            id: requirement.id,
            prompt: `What should ${requirement.label} be?`,
            requirementId: requirement.id,
            title: requirement.label,
            type: "text",
          };
        },
      },
      intents: [
        intent({ id: "notify", description: "Sends a notification." }),
      ],
    });
    const calls: Array<Record<string, unknown>> = [];

    const session = await resolveIntent({
      domain: workflowDomain,
      prompt: "Notify me.",
      resolver(input) {
        calls.push(input.answers ?? {});
        if (!input.answers?.channel) {
          return {
            kind: "intent_contract",
            requirements: [
              {
                id: "channel",
                label: "Channel",
                required: true,
                status: "missing",
                type: "string",
                value: null,
              },
            ],
            steps: [
              {
                id: "step_notify",
                label: "Notify",
                intent: "notify",
                requirementIds: ["channel"],
              },
            ],
          };
        }
        return {
          kind: "intent_contract",
          requirements: [
            {
              id: "channel",
              label: "Channel",
              required: true,
              status: "satisfied",
              type: "string",
              value: input.answers.channel,
            },
            {
              id: "destination",
              label: "Destination",
              required: true,
              status: "missing",
              type: "string",
              value: null,
            },
          ],
          steps: [
            {
              id: "step_notify",
              label: "Notify",
              intent: "notify",
              requirementIds: ["channel", "destination"],
            },
          ],
        };
      },
    });

    expect(session.questions.map((question) => question.id)).toEqual(["channel"]);

    const snapshot = await session.answer({
      questionId: "channel",
      value: "webhook",
    });

    expect(calls).toEqual([
      {},
      { channel: "webhook" },
    ]);
    expect(snapshot.questions.map((question) => question.id)).toEqual(["destination"]);
    expect(snapshot.contract.requirements.find((item) => item.id === "channel")).toMatchObject({
      status: "satisfied",
      value: "webhook",
    });
  });

  test("keeps resolved intent normalized after answers satisfy missing requirements", async () => {
    const workflowDomain = domain({
      id: "workflow",
      intent: {
        questionConstraintsForRequirement({ requirement }) {
          return {
            id: requirement.id,
            prompt: `What should ${requirement.label} be?`,
            requirementId: requirement.id,
            title: requirement.label,
            type: "text",
          };
        },
      },
      intents: [
        intent({ id: "read", description: "Reads data." }),
      ],
    });

    const session = await resolveIntent({
      domain: workflowDomain,
      prompt: "Read something.",
      resolver: (input) => ({
        kind: "intent_contract",
        requirements: [
          {
            id: "target",
            label: "Target",
            required: true,
            status: input.answers?.target ? "satisfied" : "missing",
            type: "string",
            value: input.answers?.target ?? null,
          },
        ],
        steps: [
          {
            id: "step_read",
            label: "Read",
            intent: "read",
            requirementIds: ["target"],
          },
        ],
      }),
    });

    const snapshot = await session.answer({
      questionId: "target",
      value: "ETH price",
    });

    expect(snapshot.status).toBe("resolved");
    expect(snapshot.questions).toEqual([]);
    expect(snapshot.contract).toEqual({
      kind: "intent_contract",
      requirements: [
        {
          id: "target",
          label: "Target",
          question: undefined,
          required: true,
          status: "satisfied",
          type: "string",
          value: "ETH price",
        },
      ],
      steps: [
        {
          id: "step_read",
          label: "Read",
          intent: "read",
          requirementIds: ["target"],
        },
      ],
    });
  });

  test("keeps LLM question wording while applying product constraints", async () => {
    const workflowDomain = domain({
      id: "workflow",
      intent: {
        questionConstraintsForRequirement({ requirement }) {
          if (requirement.id !== "destination") {
            return undefined;
          }
          return {
            id: requirement.id,
            requirementId: requirement.id,
            options: [
              { label: "Primary", value: "primary" },
              { label: "Secondary", value: "secondary" },
            ],
            title: "Destination",
            type: "choice",
          };
        },
      },
      intents: [
        intent({ id: "deliver", description: "Delivers a result." }),
      ],
    });
    const contract: IntentContract = {
      kind: "intent_contract",
      requirements: [
        {
          id: "destination",
          label: "Destination",
          question: {
            id: "destination",
            options: [
              { label: "Primary from LLM", value: "primary" },
              { label: "Unsupported option", value: "unsupported" },
            ],
            prompt: "Where should I send the result?",
            requirementId: "destination",
            title: "LLM title",
            type: "text",
          },
          required: true,
          status: "missing",
          type: "string",
          value: null,
        },
      ],
      steps: [
        {
          id: "step_deliver",
          label: "Deliver",
          intent: "deliver",
          requirementIds: ["destination"],
        },
      ],
    };

    const session = await resolveIntent({
      domain: workflowDomain,
      prompt: "Process this and deliver the result.",
      resolver: () => contract,
    });

    expect(session.questions).toEqual([
      {
        id: "destination",
        options: [
          { label: "Primary from LLM", value: "primary" },
        ],
        prompt: "Where should I send the result?",
        requirementId: "destination",
        title: "LLM title",
        type: "choice",
      },
    ]);
  });

  test("uses product prompt only when the LLM omitted question wording", async () => {
    const workflowDomain = domain({
      id: "workflow",
      intent: {
        questionConstraintsForRequirement({ requirement }) {
          return {
            id: requirement.id,
            prompt: `What should ${requirement.label} be?`,
            requirementId: requirement.id,
            title: requirement.label,
            type: "text",
          };
        },
      },
      intents: [
        intent({ id: "read", description: "Reads data." }),
      ],
    });

    const session = await resolveIntent({
      domain: workflowDomain,
      prompt: "Read a value.",
      resolver: () => ({
        kind: "intent_contract",
        requirements: [
          {
            id: "target",
            label: "Read target",
            required: true,
            status: "missing",
            type: "string",
            value: null,
          },
        ],
        steps: [
          {
            id: "step_read",
            label: "Read",
            intent: "read",
            requirementIds: ["target"],
          },
        ],
      }),
    });

    expect(session.questions[0]?.prompt).toBe("What should Read target be?");
  });
});
