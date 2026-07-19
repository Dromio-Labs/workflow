import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  createElement,
} from "react";
import {
  renderToStaticMarkup,
} from "react-dom/server";
import {
  projectRuntimeSessionToWorkflowRoomRun,
  projectWorkflowPlayback,
  type WorkflowViewSnapshot,
} from "@dromio/workflow/client";
import type {
  EventRecord,
} from "@dromio/workflow/core";
import {
  WorkflowTracePresenter,
} from "@dromio/workflow/react";
import {
  interactiveWorkflowViewCapabilities,
  processImagesRenderModel,
} from "@dromio/workflow-room-protocol";

describe("workflow trace playback", () => {
  test("preserves trace context in the workflow-room event projection", () => {
    const event = eventRecord("step.started", 0, "resolve-config", {
      attributes: { attempt: 1, phase: "configuration" },
      kind: "internal",
      name: "Resolve config",
      parentSpanId: "run:run-playback",
      spanId: "step:resolve-config:attempt:1",
      status: "unset",
      traceId: "run-playback",
    });
    const session: Parameters<typeof projectRuntimeSessionToWorkflowRoomRun>[0] = {
      checkpoints: [],
      events: [event],
      input: {},
      pendingHooks: [],
      pendingQuestions: [],
      runId: "run-playback",
      state: {},
      status: "running",
      workflowKey: "process-images",
    };

    expect(projectRuntimeSessionToWorkflowRoomRun(session).events[0]?.trace).toEqual(event.trace);
  });

  test("projects deterministic historical graph state and timespan", () => {
    const snapshot = playbackSnapshot();
    const projection = projectWorkflowPlayback({ positionMs: 1_000, snapshot });

    expect(projection.durationMs).toBe(3_000);
    expect(projection.elapsedMs).toBe(1_000);
    expect(projection.progress).toBeCloseTo(1 / 3);
    expect(projection.visibleEvents.map((item) => item.event.type)).toEqual([
      "run.started",
      "step.started",
    ]);
    expect(projection.visualState.statuses["resolve-config"]).toBe("running");
    expect(projection.render.nodes.find((node) => node.id === "resolve-config")?.status).toBe("running");
    expect(projection.trace.nodes[0]?.traceId).toBe("run-playback");
  });

  test("uses event indexes when timestamps collide", () => {
    const snapshot = playbackSnapshot();
    const run = snapshot.run!;
    snapshot.run = {
      ...run,
      events: [...run.events].reverse().map((event) => ({
        ...event,
        timestamp: "2026-07-17T10:00:00.000Z",
      })),
    };

    const projection = projectWorkflowPlayback({ snapshot });
    expect(projection.events.map((item) => item.event.index)).toEqual([0, 1, 2, 3]);
  });

  test("keeps untimed protocol events inspectable", () => {
    const snapshot = playbackSnapshot();
    snapshot.run = {
      ...snapshot.run!,
      events: snapshot.run!.events.map(({ timestamp: _timestamp, ...event }) => event),
    };

    const projection = projectWorkflowPlayback({ positionMs: 0, snapshot });
    expect(projection.timed).toBe(false);
    expect(projection.visibleEvents).toHaveLength(4);
    expect(projection.durationMs).toBe(0);
  });

  test("renders the public React presenter with graph, controls, timeline, and inspection", () => {
    const html = renderToStaticMarkup(createElement(WorkflowTracePresenter, {
      snapshot: playbackSnapshot(),
    }));

    expect(html).toContain('data-dromio-workflow-trace-presenter="run-playback"');
    expect(html).toContain('data-dromio-workflow-canvas="process-images"');
    expect(html).not.toContain("data-dromio-workflow-preview");
    expect(html).toContain("Drag to pan");
    expect(html).toContain("Workflow trace");
    expect(html).toContain("Replay");
    expect(html).toContain('aria-label="Playback position"');
    expect(html).toContain("Timeline · 4 events");
    expect(html).toContain("3.00s / 3.00s");
    expect(html).toContain("Raw snapshot");
  });
});

function playbackSnapshot(): WorkflowViewSnapshot {
  return {
    capabilities: interactiveWorkflowViewCapabilities,
    pendingHooks: [],
    render: processImagesRenderModel,
    run: {
      events: [
        roomEvent("run.started", 0, undefined, 0, {
          kind: "internal",
          name: "Process images",
          spanId: "run:run-playback",
          status: "unset",
          traceId: "run-playback",
        }),
        roomEvent("step.started", 1, "resolve-config", 100, {
          kind: "internal",
          name: "Resolve config",
          parentSpanId: "run:run-playback",
          spanId: "step:resolve-config:attempt:1",
          status: "unset",
          traceId: "run-playback",
        }),
        roomEvent("step.completed", 2, "resolve-config", 1_100, {
          kind: "internal",
          name: "Resolve config",
          parentSpanId: "run:run-playback",
          spanId: "step:resolve-config:attempt:1",
          status: "ok",
          traceId: "run-playback",
        }),
        roomEvent("run.completed", 3, undefined, 3_000, {
          kind: "internal",
          name: "Process images",
          spanId: "run:run-playback",
          status: "ok",
          traceId: "run-playback",
        }),
      ],
      pendingHooks: [],
      runId: "run-playback",
      status: "completed",
      workflowId: "process-images",
    },
    version: "workflow-view/v1",
  };
}

function roomEvent(
  type: string,
  index: number,
  stepId: string | undefined,
  offsetMs: number,
  trace: NonNullable<WorkflowViewSnapshot["run"]>["events"][number]["trace"],
) {
  return {
    index,
    message: type,
    runId: "run-playback",
    ...(stepId ? { stepId } : {}),
    timestamp: new Date(Date.parse("2026-07-17T10:00:00.000Z") + offsetMs).toISOString(),
    trace,
    type,
  };
}

function eventRecord(
  type: string,
  index: number,
  stepId: string,
  trace: NonNullable<EventRecord["trace"]>,
): EventRecord {
  return {
    correlationId: `correlation-${index}`,
    index,
    message: type,
    runId: "run-playback",
    stepId,
    timestamp: "2026-07-17T10:00:00.000Z",
    trace,
    type,
  };
}
