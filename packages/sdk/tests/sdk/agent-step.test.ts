import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  createArtifactStorePort,
  createDatasetPort,
  createSqliteWorkflowRuntimeStore,
} from "@dromio/workflow/workflow-control-plane";
import { done, loop, createRuntimeStep } from "@dromio/workflow/core";
import {
  createDataset,
  type AgentTurnInput,
  type AgentTurnPort,
} from "@dromio/workflow/product";

const opportunitySchema = z.object({
  company: z.string(),
  role: z.string(),
  url: z.string(),
});

const opportunitiesDataset = createDataset({
  key: ["url"],
  name: "opportunities",
  schema: opportunitySchema,
});

const RAW_PAGE_BODY = "very large gathered page body that must never enter run state";

function stubAgentPort(calls: { prompts: string[] }): AgentTurnPort {
  return {
    async run(input: AgentTurnInput) {
      calls.prompts.push(input.prompt);
      return {
        output: {
          opportunities: [
            { company: "Fluidstack", role: "Staff Engineer", url: "https://jobs/1" },
          ],
        },
        rounds: 2,
        stopped: "completed",
        transcript: [
          { content: RAW_PAGE_BODY, role: "assistant", round: 1 },
          { content: "structured", role: "assistant", round: 2 },
        ],
      } as Awaited<ReturnType<AgentTurnPort["run"]>>;
    },
  };
}

describe("gather-shaped step through context.use ports", () => {
  test("agent gathers, transcript stored as ref, rows upserted — run state carries refs only", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dromio-agent-step-"));
    const dbPath = path.join(directory, "runtime.sqlite");

    try {
      const runtimeStore = createSqliteWorkflowRuntimeStore(dbPath);
      const calls = { prompts: [] as string[] };
      const use = {
        agent: stubAgentPort(calls),
        artifacts: createArtifactStorePort({ runId: "run_gather_1", runtimeStore }),
        datasets: createDatasetPort({
          definitions: [opportunitiesDataset],
          runtimeStore,
        }).datasets,
      };

      const gather = loop<typeof use, string>({
        id: "gather-source",
        steps: [
          createRuntimeStep("gather", async (context) => {
            const turn = await context.use.agent.run({
              maxRounds: 4,
              prompt: `Gather opportunities from ${context.input}`,
            });
            const ref = await context.use.artifacts.put({
              kind: "agent-transcript",
              text: JSON.stringify(turn.transcript),
              title: "Gather transcript",
            });
            return done({ output: turn.output, transcriptRef: ref });
          }),
          createRuntimeStep("upsert", async (context) => {
            const rows = (context.state.output as {
              opportunities: Array<z.infer<typeof opportunitySchema>>;
            }).opportunities;
            const result = await context.use.datasets.opportunities.upsert(rows);
            return done({ inserted: result.inserted });
          }),
        ],
        use,
      });

      const session = await gather.start("hn-whos-hiring", { runId: "run_gather_1" });

      expect(session.status).toBe("completed");
      expect(calls.prompts).toEqual(["Gather opportunities from hn-whos-hiring"]);
      expect((session.state as Record<string, unknown>).inserted).toBe(1);

      const sessionJson = JSON.stringify(session.snapshot ? session.snapshot() : session);
      expect(sessionJson).not.toContain(RAW_PAGE_BODY);

      const transcriptRef = (session.state as {
        transcriptRef: { artifactId: string };
      }).transcriptRef;
      const artifacts = createArtifactStorePort({ runtimeStore });
      const stored = await artifacts.get(transcriptRef.artifactId);
      expect(String(stored.content)).toContain(RAW_PAGE_BODY);

      const datasets = createDatasetPort({
        definitions: [opportunitiesDataset],
        runtimeStore,
      }).datasets;
      const rows = await datasets.opportunities.query({ filter: { url: "https://jobs/1" } });
      expect(rows).toEqual([
        { company: "Fluidstack", role: "Staff Engineer", url: "https://jobs/1" },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
