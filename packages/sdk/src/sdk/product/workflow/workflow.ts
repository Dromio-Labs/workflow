import type {
  WorkflowBuilderConfig,
  WorkflowRunInput,
  WorkflowRunOutput,
} from "./workflow.types.js";
import {
  createWorkflowLoop,
} from "./workflow-loop.js";
import {
  acceptedQuestionAnswer,
  outputFromSession,
  rejectedQuestionResolution,
} from "./workflow-session.js";
import {
  EventQueue,
  eventStreamResponse,
} from "./workflow-stream.js";

export function createWorkflow<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>,
) {
  const workflowLoop = createWorkflowLoop(config);
  const sessions = new Map<string, Awaited<ReturnType<typeof workflowLoop.start>>>();
  return {
    graph() {
      return workflowLoop.graph();
    },

    async run(input: WorkflowRunInput): Promise<WorkflowRunOutput<TArtifact>> {
      const session = await workflowLoop.start(
        { prompt: input.prompt },
        {
          answers: input.answers,
          onEvent: input.onEvent,
          questionResolvers: input.questionResolvers,
          runId: input.runId,
        },
      );
      sessions.set(session.runId, session);
      while (session.status === "waiting") {
        let acceptedAnyAnswer = false;
        let attemptedAnyAnswer = false;
        let shouldReask = false;
        let shouldYieldToProduct = false;
        for (const question of [...session.pendingQuestions]) {
          if (question.id in session.answers) {
            continue;
          }
          if (input.answers && question.id in input.answers) {
            const beforeAnswerEvents = session.events.length;
            await session.answer({
              questionId: question.id,
              value: input.answers[question.id],
            });
            acceptedAnyAnswer = acceptedAnyAnswer || acceptedQuestionAnswer(session.events, beforeAnswerEvents, question.id);
            const rejected = rejectedQuestionResolution(session.events, beforeAnswerEvents, question.id);
            shouldReask = shouldReask || rejected?.status === "needs_input";
            shouldYieldToProduct = shouldYieldToProduct || Boolean(rejected && rejected.status !== "needs_input");
            attemptedAnyAnswer = true;
            if (rejected) break;
            continue;
          }
          if (input.onQuestion) {
            const value = await input.onQuestion(question);
            if (value !== undefined) {
              attemptedAnyAnswer = true;
              const beforeAnswerEvents = session.events.length;
              await session.answer({
                questionId: question.id,
                value,
              });
              acceptedAnyAnswer = acceptedAnyAnswer || acceptedQuestionAnswer(session.events, beforeAnswerEvents, question.id);
              const rejected = rejectedQuestionResolution(session.events, beforeAnswerEvents, question.id);
              shouldReask = shouldReask || rejected?.status === "needs_input";
              shouldYieldToProduct = shouldYieldToProduct || Boolean(rejected && rejected.status !== "needs_input");
              if (rejected) break;
            }
          }
        }
        if (shouldYieldToProduct) {
          break;
        }
        if (shouldReask) {
          if (input.onQuestion) {
            continue;
          }
          break;
        }
        if (acceptedAnyAnswer) {
          await session.resume();
          sessions.set(session.runId, session);
          continue;
        }
        if (!attemptedAnyAnswer || !input.onQuestion) {
          break;
        }
      }
      return outputFromSession<TArtifact>(session);
    },

    stream(input: WorkflowRunInput) {
      const queue = new EventQueue(input.fromIndex);
      let sessionPromise: Promise<Awaited<ReturnType<typeof workflowLoop.start>>> | undefined;
      const start = async () => {
        if (input.runId && sessions.has(input.runId)) {
          const session = sessions.get(input.runId)!;
          queue.pushMany(session.events);
          if (session.status !== "waiting") {
            queue.close();
          }
          sessionPromise = Promise.resolve(session);
          return;
        }
        sessionPromise = workflowLoop.start(
          { prompt: input.prompt },
          {
            answers: input.answers,
            onEvent(event) {
              queue.push(event);
              void input.onEvent?.(event);
            },
            questionResolvers: input.questionResolvers,
            runId: input.runId,
          },
        );
        const session = await sessionPromise;
        sessions.set(session.runId, session);
        if (session.status !== "waiting") {
          queue.close();
        }
      };
      void start().catch((error: unknown) => {
        queue.push({
          correlationId: `run:${input.runId ?? "unknown"}:workflow.failed`,
          index: 0,
          message: error instanceof Error ? error.message : String(error),
          runId: input.runId ?? "unknown",
          timestamp: new Date().toISOString(),
          type: "workflow.failed",
        });
        queue.close();
      });
      return {
        async answer(input: { questionId: string; value: unknown }) {
          const session = await sessionPromise;
          if (!session) throw new Error("Workflow session has not started.");
          const eventCount = session.events.length;
          await session.answer(input);
          queue.pushMany(session.events.slice(eventCount));
          sessions.set(session.runId, session);
          return outputFromSession<TArtifact>(session);
        },
        events: queue,
        async resumeHook(input: { token: string; value: unknown }) {
          const session = await sessionPromise;
          if (!session) throw new Error("Workflow session has not started.");
          const eventCount = session.events.length;
          await session.resumeHook(input);
          queue.pushMany(session.events.slice(eventCount));
          sessions.set(session.runId, session);
          if (session.status !== "waiting") {
            queue.close();
          }
          return outputFromSession<TArtifact>(session);
        },
        async resume() {
          const session = await sessionPromise;
          if (!session) throw new Error("Workflow session has not started.");
          const eventCount = session.events.length;
          await session.resume();
          queue.pushMany(session.events.slice(eventCount));
          sessions.set(session.runId, session);
          if (session.status !== "waiting") {
            queue.close();
          }
          return outputFromSession<TArtifact>(session);
        },
        async toEventStreamResponse() {
          return eventStreamResponse(queue);
        },
      };
    },
  };
}

export async function buildWorkflow<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>,
  input: WorkflowRunInput,
) {
  return createWorkflow(config).run(input);
}

export function streamWorkflow<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>,
  input: WorkflowRunInput,
) {
  return createWorkflow(config).stream(input);
}
