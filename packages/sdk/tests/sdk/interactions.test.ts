import { describe, expect, test } from "bun:test";
import type { CapturedFrame } from "@opentui/core";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { createClient } from "@dromio/workflow/client";
import {
  artifactEnd,
  createInteraction,
  createQuestionFlow,
  createTerminalTraceRenderer,
  createTraceStream,
  createWorkflowApp,
  createWorkflowAppClient,
  createWorkflowAppHttpAdapter,
  createWorkflowAppRuntime,
  createWorkflowRunStore,
  defaultTerminalQuestionAnswer,
  defaultFormatEvent,
  mergeEvents,
  parseWorkflowCliArgs,
  parseTerminalQuestionAnswer,
  projectActions,
  projectCandidateEvaluations,
  projectMessages,
  projectQuestions,
  projectQuestionResolutions,
  projectTraceTree,
  projectWorkflowGraphDiagram,
  projectWorkflowRun,
  renderTerminalWorkflowFrame,
  runWorkflowApp,
  runWorkflowCliApp,
  runTerminalWorkflow,
  projectTimeline,
  runTerminalQuestionLoop,
} from "@dromio/workflow/client";
import {
  createHook,
  type EventRecord,
  done,
  fail,
  loop,
  createRuntimeStep,
  workerItemEvent,
} from "@dromio/workflow/core";
import { createIntentRuntime } from "@dromio/workflow/core";
import {
  openTuiDefaultSelectedIndex,
  openTuiQuestionOptionAnswer,
  openTuiQuestionOptions,
  openTuiSelectedIndexForAnswer,
} from "@dromio/workflow/client/workflow-tui-test-surface";

describe("headless interactions", () => {
  test("projects events, questions, and actions into renderable state", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        ask: loop({
          id: "ask",
          steps: [
            createRuntimeStep("collect", (context) => {
              if (context.answers.scope && context.answers.notes) {
                return done({
                  notes: context.answers.notes,
                  scope: context.answers.scope,
                });
              }
              return {
                questions: [
                  {
                    id: "scope",
                    options: [
                      { label: "Minimal", value: "minimal" },
                      { label: "Full", value: "full" },
                    ],
                    prompt: "Scope?",
                    title: "Scope",
                    type: "choice" as const,
                  },
                  {
                    id: "notes",
                    prompt: "Notes?",
                    title: "Notes",
                    type: "text" as const,
                  },
                ],
                type: "ask" as const,
              };
            }),
          ],
        }),
      },
    });
    const client = createClient({ runtime });
    const run = await client.runs.create({ input: {}, runId: "run_interaction", workflow: "ask" });
    const actions = await client.sessions.actions(run.session.runId);

    expect(projectActions(actions).find((action) => action.key === "cancel")?.available).toBe(true);
    expect(projectQuestions(run.session).questions.map((question) => question.id)).toEqual(["scope", "notes"]);
    expect(projectMessages(run.session.events).some((message) => message.text.includes("Waiting for 2 answers"))).toBe(true);
    expect(projectTimeline(run.session.events).some((item) => item.status === "waiting")).toBe(true);
    expect(mergeEvents([run.session.events[0]!], run.session.events).map((event) => event.index)).toEqual(
      run.session.events.map((event) => event.index),
    );
  });

  test("validates and submits question flows without UI dependencies", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        flow: loop({
          id: "flow",
          steps: [
            createRuntimeStep("decide", (context) => {
              if (context.answers.scope && context.answers.testing && context.answers.confirm && context.answers.custom) {
                return done({
                  confirm: context.answers.confirm,
                  custom: context.answers.custom,
                  scope: context.answers.scope,
                  testing: context.answers.testing,
                });
              }
              return {
                questions: [
                  {
                    id: "scope",
                    options: [{ label: "Minimal", value: "minimal" }],
                    prompt: "Scope?",
                    type: "choice" as const,
                  },
                  {
                    id: "testing",
                    options: [
                      { label: "Unit", value: "unit" },
                      { label: "Typecheck", value: "typecheck" },
                    ],
                    prompt: "Testing?",
                    type: "multi" as const,
                  },
                  {
                    id: "confirm",
                    prompt: "Proceed?",
                    type: "confirm" as const,
                  },
                  {
                    allowCustom: true,
                    id: "custom",
                    options: [{ label: "Known", value: "known" }],
                    prompt: "Custom?",
                    type: "choice" as const,
                  },
                ],
                type: "ask" as const,
              };
            }),
          ],
        }),
      },
    });
    const client = createClient({ runtime });
    const run = await client.runs.create({ input: {}, runId: "run_flow", workflow: "flow" });
    const flow = createQuestionFlow({ client, session: run.session });

    expect(flow.canSubmit).toBe(false);
    flow.select("scope", "minimal");
    flow.toggle("testing", "unit");
    flow.toggle("testing", "typecheck");
    flow.select("confirm", true);
    flow.setCustomAnswer("custom", "ship a tiny patch");

    expect(flow.summary).toHaveLength(4);
    expect(flow.errors).toEqual([]);
    const completed = await flow.submit();
    expect(completed.status).toBe("completed");
    expect(completed.state.decide).toEqual({
      confirm: true,
      custom: "ship a tiny patch",
      scope: "minimal",
      testing: ["unit", "typecheck"],
    });
  });

  test("question flow can submit a changed question shape with the same id", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        changed: loop({
          id: "changed",
          steps: [
            createRuntimeStep("ask-name", (context) => {
              if (context.answers.name === "__assume__") return done({ name: context.answers.name });
              if (context.answers.name === "") {
                return {
                  questions: [{
                    id: "name",
                    options: [
                      { label: "No preference", value: "__assume__" },
                      { label: "Example User", value: "example-user" },
                    ],
                    prompt: "Choose a fallback name.",
                    type: "choice" as const,
                  }],
                  type: "ask" as const,
                };
              }
              return {
                questions: [{
                  id: "name",
                  prompt: "Name?",
                  type: "text" as const,
                }],
                type: "ask" as const,
              };
            }),
          ],
        }),
      },
    });
    const client = createClient({ runtime });
    const run = await client.runs.create({ input: {}, runId: "run_changed", workflow: "changed" });
    const flow = createQuestionFlow({ client, session: run.session });
    const firstToken = flow.questions[0]?.hookToken;

    flow.setText("name", "");
    const waiting = await flow.submit();
    flow.updateSession(waiting);
    const secondToken = flow.questions[0]?.hookToken;
    expect(secondToken).toBeDefined();
    expect(secondToken).not.toBe(firstToken);

    flow.select("name", "__assume__");
    const completed = await flow.submit();

    expect(completed.status).toBe("completed");
    expect(completed.state["ask-name"]).toEqual({ name: "__assume__" });
  });

  test("question flow does not submit stale answers after an earlier batch answer changes a later question", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        changedBatch: loop({
          id: "changed-batch",
          steps: [
            createRuntimeStep("ask-batch", (context) => {
              if (context.answers.scope === "__assume__" && context.answers.name === "__assume__") {
                return done({
                  name: context.answers.name,
                  scope: context.answers.scope,
                });
              }
              if (context.answers.scope === "__assume__") {
                return {
                  questions: [{
                    id: "name",
                    options: [
                      { label: "No preference", value: "__assume__" },
                      { label: "Example User", value: "example-user" },
                    ],
                    prompt: "Choose a fallback name.",
                    type: "choice" as const,
                  }],
                  type: "ask" as const,
                };
              }
              return {
                questions: [
                  {
                    id: "scope",
                    options: [
                      { label: "No preference", value: "__assume__" },
                      { label: "Minimal", value: "minimal" },
                    ],
                    prompt: "Scope?",
                    type: "choice" as const,
                  },
                  {
                    id: "name",
                    prompt: "Name?",
                    type: "text" as const,
                  },
                ],
                type: "ask" as const,
              };
            }),
          ],
        }),
      },
    });
    const client = createClient({ runtime });
    const run = await client.runs.create({ input: {}, runId: "run_changed_batch", workflow: "changedBatch" });
    const flow = createQuestionFlow({ client, session: run.session });

    flow.select("scope", "__assume__");
    flow.setText("name", "stale text");
    const waiting = await flow.submit();
    flow.updateSession(waiting);

    expect(waiting.status).toBe("waiting");
    expect(flow.errors.map((error) => error.questionId)).toContain("name");

    flow.select("name", "__assume__");
    const completed = await flow.submit();

    expect(completed.status).toBe("completed");
    expect(completed.state["ask-batch"]).toEqual({
      name: "__assume__",
      scope: "__assume__",
    });
  });

  test("question flow can retry after a resolver rejection keeps the same hook pending", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        retryResolver: loop({
          id: "retry-resolver",
          questionResolvers: {
            "scope.resolver": ({ utterance }) => utterance === "minimal"
              ? {
                confidence: 1,
                kind: "answer" as const,
                normalizedValue: "minimal",
                status: "accepted" as const,
              }
              : {
                confidence: 1,
                kind: "unclear" as const,
                message: "Choose explicitly.",
                status: "needs_input" as const,
              },
          },
          steps: [
            createRuntimeStep("ask-scope", (context) => {
              if (context.answers.scope) return done({ scope: context.answers.scope });
              return {
                questions: [{
                  id: "scope",
                  options: [
                    { label: "No preference", value: "__assume__" },
                    { label: "Minimal", value: "minimal" },
                  ],
                  prompt: "Scope?",
                  resolverId: "scope.resolver",
                  type: "choice" as const,
                }],
                type: "ask" as const,
              };
            }),
          ],
        }),
      },
    });
    const client = createClient({ runtime });
    const run = await client.runs.create({
      input: {},
      runId: "run_retry_resolver",
      workflow: "retryResolver",
    });
    const flow = createQuestionFlow({ client, session: run.session });
    const token = flow.questions[0]?.hookToken;

    flow.select("scope", "__assume__");
    const waiting = await flow.submit();
    flow.updateSession(waiting);

    expect(waiting.status).toBe("waiting");
    expect(flow.questions[0]?.hookToken).toBe(token);
    expect(flow.canSubmit).toBe(true);
    expect(flow.stage).toBe("answering");

    flow.select("scope", "minimal");
    const completed = await flow.submit();

    expect(completed.status).toBe("completed");
    expect(completed.state["ask-scope"]).toEqual({ scope: "minimal" });
  });

  test("wraps question flow and actions in one interaction controller", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        one: loop({
          id: "one",
          steps: [
            createRuntimeStep("ask", (context) => {
              if (context.answers.scope) return done({ scope: context.answers.scope });
              return {
                questions: [{
                  id: "scope",
                  options: [{ label: "Minimal", value: "minimal" }],
                  prompt: "Scope?",
                  type: "choice" as const,
                }],
                type: "ask" as const,
              };
            }),
          ],
        }),
      },
    });
    const client = createClient({ runtime });
    const run = await client.runs.create({ input: {}, runId: "run_one", workflow: "one" });
    const interaction = createInteraction({ client, session: run.session });

    await interaction.refresh();
    expect(interaction.questions[0]?.hookToken).toStartWith("question:run_one:ask:1:scope:");
    const completed = await interaction.answer("scope", "minimal");
    expect(completed?.status).toBe("completed");
    expect(interaction.status).toBe("completed");

    const cancelled = await interaction.actions.cancel({ reason: "noop" });
    expect(cancelled.status).toBe("accepted");
  });

  test("reports strict v4 question contract errors", async () => {
    const session = {
      checkpoints: [],
      events: [],
      input: {},
      pendingHooks: [],
      pendingQuestions: [{ id: "missing-shape" }],
      runId: "run_invalid",
      state: {},
      status: "waiting" as const,
      workflowKey: "invalid",
    };

    expect(projectQuestions(session).errors[0]?.code).toBe("INVALID_QUESTION");
  });

  test("parses typed terminal question answers", () => {
    const choice = {
      id: "platform",
      options: [
        { label: "Web app", value: "web" },
        { label: "Mobile app", value: "mobile" },
        { label: "No preference", value: "__assume__" },
      ],
      prompt: "Platform?",
      type: "choice" as const,
    };
    const multi = {
      id: "features",
      options: [
        { label: "Due dates", value: "due-dates" },
        { label: "Tags", value: "tags" },
      ],
      prompt: "Features?",
      type: "multi" as const,
    };
    const customMulti = {
      ...multi,
      allowCustom: true,
    };
    const choiceWithoutDefault = {
      id: "scope",
      options: [
        { label: "Minimal", value: "minimal" },
        { label: "Full", value: "full" },
      ],
      prompt: "Scope?",
      type: "choice" as const,
    };
    const confirm = {
      id: "accounts",
      prompt: "Accounts?",
      type: "confirm" as const,
    };

    expect(parseTerminalQuestionAnswer(choice, "1")).toEqual({ answer: "web", ok: true });
    expect(parseTerminalQuestionAnswer(choice, "Mobile app")).toEqual({ answer: "mobile", ok: true });
    expect(defaultTerminalQuestionAnswer(choice)).toBe("__assume__");
    expect(parseTerminalQuestionAnswer(multi, "1,2")).toEqual({ answer: ["due-dates", "tags"], ok: true });
    expect(parseTerminalQuestionAnswer(customMulti, "1,ship")).toEqual({
      answer: ["due-dates", "ship"],
      ok: true,
    });
    expect(defaultTerminalQuestionAnswer(multi)).toBeUndefined();
    expect(parseTerminalQuestionAnswer(multi, "")).toEqual({
      message: "Choose one or more listed options.",
      ok: false,
    });
    expect(defaultTerminalQuestionAnswer(choiceWithoutDefault)).toBeUndefined();
    expect(parseTerminalQuestionAnswer(choiceWithoutDefault, "")).toEqual({
      message: "Choose one of the listed options.",
      ok: false,
    });
    expect(parseTerminalQuestionAnswer(confirm, "no")).toEqual({ answer: false, ok: true });
    expect(parseTerminalQuestionAnswer(confirm, "")).toEqual({ answer: false, ok: true });
  });

  test("OpenTUI question dock uses terminal defaults and confirm options", () => {
    const choice = {
      id: "platform",
      options: [
        { label: "Web app", value: "web" },
        { label: "Mobile app", value: "mobile" },
        { label: "No preference", value: "__assume__" },
      ],
      prompt: "Platform?",
      type: "choice" as const,
    };
    const confirm = {
      id: "deploy",
      prompt: "Deploy?",
      type: "confirm" as const,
    };

    expect(openTuiDefaultSelectedIndex(choice)).toBe(2);
    expect(openTuiQuestionOptionAnswer(choice, openTuiDefaultSelectedIndex(choice))).toBe("__assume__");
    expect(openTuiSelectedIndexForAnswer(choice, "web")).toBe(0);
    expect(openTuiQuestionOptions(confirm)).toEqual([
      { label: "Yes", value: true },
      { label: "No", value: false },
    ]);
    expect(openTuiDefaultSelectedIndex(confirm)).toBe(1);
    expect(openTuiQuestionOptionAnswer(confirm, 0)).toBe(true);
    expect(openTuiQuestionOptionAnswer(confirm, 1)).toBe(false);
  });

  test("OpenTUI question dock answers choice defaults and confirm yes in test renderer", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      createQuestionDockController,
      WorkflowTuiApp,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "terminal.tui-test-renderer",
      steps: [createRuntimeStep("finish", () => done())],
    });
    const store = createWorkflowRunStore({
      batchMs: 0,
      graph: workflow.graph(),
    });
    const controller = createQuestionDockController();
    const view = await testRender(() => WorkflowTuiApp({
      questionController: controller,
      store,
    }), {
      height: 38,
      width: 140,
    });

    const choiceAnswers: Array<{ questionId: string; value: unknown }> = [];
    const choiceAnswered = controller.ask({
      async answer(answer) {
        choiceAnswers.push(answer);
      },
      pendingQuestions: [{
        id: "scope",
        options: [
          { label: "Small", value: "small" },
          { label: "No preference", value: "__assume__" },
        ],
        prompt: "Scope?",
        title: "Scope",
        type: "choice",
      }],
      resume() {},
      status: "waiting",
    }, {});

    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("Workflow Canvas");
    expect(frame).toContain("merman");
    expect(frame).toContain("Finish");
    view.mockInput.pressEnter();
    await expect(choiceAnswered).resolves.toBe(true);
    expect(choiceAnswers).toEqual([{ questionId: "scope", value: "__assume__" }]);

    const guidedAnswers: Array<{ questionId: string; value: unknown }> = [];
    const guidedAnswered = controller.ask({
      async answer(answer) {
        guidedAnswers.push(answer);
      },
      pendingQuestions: [{
        allowCustom: true,
        id: "audience",
        options: [
          { label: "Single personal user", recommended: true, value: "single" },
          { label: "Small team", value: "team" },
          { label: "Multiple accounts", value: "accounts" },
        ],
        prompt: "Audience?",
        title: "Audience",
        type: "choice",
      }],
      resume() {},
      status: "waiting",
    }, {});

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    await expect(guidedAnswered).resolves.toBe(true);
    expect(guidedAnswers).toEqual([{ questionId: "audience", value: "single" }]);

    const confirmAnswers: Array<{ questionId: string; value: unknown }> = [];
    const confirmAnswered = controller.ask({
      async answer(answer) {
        confirmAnswers.push(answer);
      },
      pendingQuestions: [{
        id: "deploy",
        prompt: "Deploy?",
        title: "Deploy",
        type: "confirm",
      }],
      resume() {},
      status: "waiting",
    }, {});

    await view.renderOnce();
    view.mockInput.pressKey("y");
    await expect(confirmAnswered).resolves.toBe(true);
    expect(confirmAnswers).toEqual([{ questionId: "deploy", value: true }]);

    controller.close();
    store.close();
    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("OpenTUI question dock preserves answered selections when navigating back", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      createQuestionDockController,
      WorkflowTuiApp,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "terminal.tui-back-selection",
      steps: [createRuntimeStep("finish", () => done())],
    });
    const store = createWorkflowRunStore({
      batchMs: 0,
      graph: workflow.graph(),
    });
    const controller = createQuestionDockController();
    const view = await testRender(() => WorkflowTuiApp({
      questionController: controller,
      store,
    }), {
      height: 24,
      width: 80,
    });
    const answers: Array<{ questionId: string; value: unknown }> = [];
    const answered = controller.ask({
      async answer(answer) {
        answers.push(answer);
      },
      pendingQuestions: [
        {
          id: "scope",
          options: [
            { label: "Small", value: "small" },
            { label: "No preference", value: "__assume__" },
          ],
          prompt: "Scope?",
          title: "Scope",
          type: "choice",
        },
        {
          id: "deploy",
          prompt: "Deploy?",
          title: "Deploy",
          type: "confirm",
        },
      ],
      resume() {},
      status: "waiting",
    }, {});

    await view.renderOnce();
    view.mockInput.pressKey("1");
    view.mockInput.pressArrow("left");
    view.mockInput.pressEnter();
    view.mockInput.pressEnter();

    await expect(answered).resolves.toBe(true);
    expect(answers).toEqual([
      { questionId: "scope", value: "small" },
      { questionId: "deploy", value: false },
    ]);

    controller.close();
    store.close();
    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("OpenTUI question dock uses defaults on escape when available", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      createQuestionDockController,
      WorkflowTuiApp,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "terminal.tui-escape-default",
      steps: [createRuntimeStep("finish", () => done())],
    });
    const store = createWorkflowRunStore({
      batchMs: 0,
      graph: workflow.graph(),
    });
    const controller = createQuestionDockController();
    const view = await testRender(() => WorkflowTuiApp({
      questionController: controller,
      store,
    }), {
      height: 24,
      width: 80,
    });
    const answers: Array<{ questionId: string; value: unknown }> = [];
    const answered = controller.ask({
      async answer(answer) {
        answers.push(answer);
      },
      pendingQuestions: [{
        id: "scope",
        options: [
          { label: "Minimal", value: "minimal" },
          { label: "No preference", value: "__assume__" },
        ],
        prompt: "Scope?",
        title: "Scope",
        type: "choice",
      }],
      resume() {},
      status: "waiting",
    }, {});

    await view.renderOnce();
    view.mockInput.pressEscape();

    await expect(answered).resolves.toBe(true);
    expect(answers).toEqual([{ questionId: "scope", value: "__assume__" }]);

    controller.close();
    store.close();
    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("OpenTUI renderer resolves questions to fallback when render fails", async () => {
    await import("@opentui/solid/preload");
    const {
      createOpenTuiWorkflowRenderer,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "terminal.tui-render-fail",
      steps: [createRuntimeStep("finish", () => done())],
    });
    const renderer = await createOpenTuiWorkflowRenderer({
      graph: workflow.graph(),
      stream: createTraceStream(),
    }, {
      createRenderer: async () => ({
        destroy() {},
        setTerminalTitle() {},
      } as never),
      renderApp: async () => {
        throw new Error("render failed");
      },
    });

    await Promise.resolve();
    const answered = await renderer.answerQuestions({
      answer() {},
      pendingQuestions: [{
        id: "scope",
        options: [{ label: "No preference", value: "__assume__" }],
        prompt: "Scope?",
        title: "Scope",
        type: "choice",
      }],
      resume() {},
      status: "waiting",
    }, {});

    expect(answered).toBe(false);
    renderer.close();
  });

  test("OpenTUI renderer treats Ctrl+C as an interrupt and destroys the renderer", async () => {
    await import("@opentui/solid/preload");
    const {
      createOpenTuiWorkflowRenderer,
      isAppExitSequence,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "terminal.tui-interrupt",
      steps: [createRuntimeStep("finish", () => done())],
    });
    let createOptions: {
      prependInputHandlers?: Array<(sequence: string) => boolean>;
      useKittyKeyboard?: unknown;
      useMouse?: boolean;
    } | undefined;
    let destroyCount = 0;
    let interruptCount = 0;
    const renderer = await createOpenTuiWorkflowRenderer({
      graph: workflow.graph(),
      onInterrupt: () => {
        interruptCount += 1;
      },
      stream: createTraceStream(),
    }, {
      createRenderer: async (options) => {
        createOptions = options;
        return {
          destroy() {
            destroyCount += 1;
          },
          setTerminalTitle() {},
        } as never;
      },
      renderApp: async () => {},
    });

    const interruptHandler = createOptions?.prependInputHandlers?.[0];
    expect(createOptions?.useMouse).toBe(true);
    expect(createOptions?.useKittyKeyboard).toEqual({});
    expect(interruptHandler).toBeDefined();
    expect(interruptHandler?.("x")).toBe(false);
    expect(isAppExitSequence("\x03")).toBe(true);
    expect(isAppExitSequence("\x04")).toBe(true);
    expect(isAppExitSequence("\x1b[99;5u")).toBe(true);
    expect(isAppExitSequence("\x1b[100;5u")).toBe(true);
    expect(isAppExitSequence("\x1b[99;5:3u")).toBe(false);
    expect(interruptHandler?.("\x1b[99;5u")).toBe(true);
    expect(interruptCount).toBe(1);
    expect(destroyCount).toBe(1);

    renderer.close();
    expect(destroyCount).toBe(1);
  });

  test("workflow app TUI leaves Ctrl+C for the shell and keeps Ctrl+D as the hard exit", async () => {
    await import("@opentui/solid/preload");
    const {
      isWorkflowTuiEscapeSequence,
      isWorkflowTuiImmediateExitSequence,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");

    expect(isWorkflowTuiImmediateExitSequence("\x03")).toBe(false);
    expect(isWorkflowTuiImmediateExitSequence("\x04")).toBe(true);
    expect(isWorkflowTuiImmediateExitSequence("\x1b[99;5u")).toBe(false);
    expect(isWorkflowTuiImmediateExitSequence("\x1b[100;5u")).toBe(true);
    expect(isWorkflowTuiImmediateExitSequence("\x1b[100;5:3u")).toBe(false);
    expect(isWorkflowTuiEscapeSequence("\x1b")).toBe(true);
    expect(isWorkflowTuiEscapeSequence("\x1b[27u")).toBe(true);
    expect(isWorkflowTuiEscapeSequence("\x1b[A")).toBe(false);
  });

  test("terminal question loop can answer defaults and resume a waiting session", async () => {
    const app = loop({
      id: "terminal.loop",
      steps: [
        createRuntimeStep("ask", (context) => {
          if (context.answers.scope) {
            return done({ scope: context.answers.scope });
          }
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Small", value: "small" },
                { label: "No preference", value: "__assume__" },
              ],
              prompt: "Scope?",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_terminal_loop" });
    await runTerminalQuestionLoop(session, { interactive: false });

    expect(session.status).toBe("completed");
    expect(session.answers.scope).toBe("__assume__");
  });

  test("terminal question loop leaves no-default questions waiting in non-interactive mode", async () => {
    const app = loop({
      id: "terminal.loop.no-default",
      steps: [
        createRuntimeStep("ask", (context) => {
          if (context.answers.scope) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [{ label: "Small", value: "small" }],
              prompt: "Scope?",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });

    const session = await app.start("input", { runId: "run_terminal_loop_no_default" });
    await expect(runTerminalQuestionLoop(session, { interactive: false })).resolves.toBe(session);

    expect(session.status).toBe("waiting");
    expect(session.answers.scope).toBeUndefined();
  });

  test("terminal question loop can answer repeated same-shape questions without hook tokens", async () => {
    const answers: unknown[] = [];
    const session = {
      pendingQuestions: [{
        id: "scope",
        options: [
          { label: "No preference", value: "__assume__" },
          { label: "Minimal", value: "minimal" },
        ],
        prompt: "Scope?",
        type: "choice" as const,
      }],
      status: "waiting",
      async answer(input: { questionId: string; value: unknown }) {
        answers.push(input.value);
      },
      async resume() {
        if (answers.length >= 2) {
          this.pendingQuestions = [];
          this.status = "completed";
        }
      },
    };

    await runTerminalQuestionLoop(session, { interactive: false });

    expect(session.status).toBe("completed");
    expect(answers).toEqual(["__assume__", "__assume__"]);
  });

  test("terminal question loop bounds repeated non-interactive answers without hook tokens", async () => {
    const answers: unknown[] = [];
    const session = {
      pendingQuestions: [{
        id: "notes",
        prompt: "Notes?",
        type: "text" as const,
      }],
      status: "waiting",
      async answer(input: { questionId: string; value: unknown }) {
        answers.push(input.value);
      },
      async resume() {
        this.status = "waiting";
      },
    };

    await runTerminalQuestionLoop(session, {
      interactive: false,
      maxNonInteractiveAutoAnswers: 2,
    });

    expect(session.status).toBe("waiting");
    expect(answers).toEqual(["", ""]);
  });

  test("projects question resolution feedback", () => {
    const events = [
      {
        correlationId: "event-eval",
        detail: {
          confidence: 0.9,
          kind: "revision",
          message: "This is a revision, not a destination.",
          questionId: "destination",
          resolverId: "test.destination",
          status: "revision",
          targetRequirementIds: ["delivery_surface"],
        },
        index: 0,
        message: "This is a revision, not a destination.",
        runId: "run_eval",
        timestamp: "2026-05-04T00:00:00.000Z",
        type: "question.resolution.rejected",
      },
    ];

    expect(projectQuestionResolutions(events).at(-1)).toMatchObject({
      confidence: 0.9,
      kind: "revision",
      message: "This is a revision, not a destination.",
      questionId: "destination",
      resolverId: "test.destination",
      status: "revision",
      targetRequirementIds: ["delivery_surface"],
    });
  });

  test("projects candidate evaluation scorecards", () => {
    const events = [
      {
        correlationId: "event-candidate",
        detail: {
          evaluation: {
            gaps: [],
            gateId: "score.confirm",
            nextAction: "confirm",
            risks: [{ id: "risk", message: "Reference scaffold.", severity: "low" }],
            satisfies: [{ id: "project_name", passed: true, reason: "Resolved." }],
            score: 0.91,
            scorePolicyId: "score.intent-fit",
            status: "pass",
          },
        },
        index: 0,
        message: "Candidate evaluation score 91%.",
        runId: "run_eval",
        timestamp: "2026-05-04T00:00:00.000Z",
        type: "candidate.evaluation.completed",
      },
    ];

    expect(projectCandidateEvaluations(events).at(-1)).toMatchObject({
      nextAction: "confirm",
      gateId: "score.confirm",
      score: 0.91,
      scorePolicyId: "score.intent-fit",
      status: "pass",
    });
  });

  test("projects OTel-ish trace context into a joinable tree", async () => {
    const runtime = createIntentRuntime({
      workflows: {
        traceable: loop({
          id: "traceable",
          steps: [
            createRuntimeStep("prepare", () => done({ ok: true })),
            createRuntimeStep("finish", () => done({ ok: true })),
          ],
        }),
      },
    });
    const client = createClient({ runtime });
    const run = await client.runs.create({ input: {}, runId: "run_traceable", workflow: "traceable" });
    const tree = projectTraceTree(run.session.events);
    const root = tree.nodes.find((node) => node.spanId === "run:run_traceable");

    expect(root?.traceId).toBe("run_traceable");
    expect(root?.children.map((node) => node.spanId)).toEqual(
      expect.arrayContaining(["step:prepare:attempt:1", "step:finish:attempt:1"]),
    );
    expect(root?.children.find((node) => node.spanId === "step:prepare:attempt:1")?.events.some((event) =>
      event.type === "step.completed"
    )).toBe(true);
  });

  test("streams trace updates to the terminal renderer", () => {
    let output = "";
    const stream = createTraceStream();
    const renderer = createTerminalTraceRenderer({
      color: false,
      formatEvent(event) {
        if (event.type !== "step.started") return undefined;
        return {
          children: [
            {
              children: ["field one", "field two"],
              text: "contract fields (2)",
            },
          ],
          id: event.stepId ?? event.type,
          phaseId: "run",
          phaseTitle: "Run",
          status: "running",
          text: event.stepId ?? event.type,
        };
      },
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      stream,
    });

    stream.push({
      correlationId: "event-1",
      index: 0,
      message: "Starting prepare.",
      runId: "run_terminal",
      stepId: "prepare",
      timestamp: "2026-05-04T00:00:00.000Z",
      trace: {
        name: "prepare",
        parentSpanId: "run:run_terminal",
        spanId: "step:prepare",
        traceId: "run_terminal",
      },
      type: "step.started",
    });
    renderer.close();

    expect(output).toContain("Run");
    expect(output).toContain("+-- run prepare");
    expect(output).toContain("|   +-- contract fields (2)");
    expect(output).toContain("|   |   +-- field one");
  });

  test("terminal trace renderer uses in-place spinner output for TTY streams", () => {
    let output = "";
    const stream = createTraceStream();
    const renderer = createTerminalTraceRenderer({
      color: false,
      formatEvent(event) {
        if (event.type === "step.started") {
          return {
            id: "prepare",
            phaseId: "run",
            phaseTitle: "Run",
            status: "running",
            text: "prepare",
          };
        }
        if (event.type === "step.completed") {
          return {
            id: "prepare",
            phaseId: "run",
            phaseTitle: "Run",
            status: "ok",
            text: "prepare",
          };
        }
        return undefined;
      },
      output: {
        isTTY: true,
        write(chunk) {
          output += chunk;
        },
      },
      stream,
    });

    stream.push(eventRecord("step.started"));
    stream.push(eventRecord("step.completed"));
    renderer.close();

    expect(output).toContain("\r\u001b[2K");
    expect(output).toContain("+-- ok prepare");
  });

  test("terminal trace renderer stops active spinner before waiting events", () => {
    let output = "";
    const stream = createTraceStream();
    const renderer = createTerminalTraceRenderer({
      color: false,
      output: {
        isTTY: true,
        write(chunk) {
          output += chunk;
        },
      },
      stream,
    });

    stream.push({
      correlationId: "run:run_wait:step:refine-prompt:attempt:1",
      index: 0,
      message: "Starting refine-prompt.",
      runId: "run_wait",
      stepId: "refine-prompt",
      timestamp: "2026-05-04T00:00:00.000Z",
      trace: {
        name: "refine-prompt",
        parentSpanId: "run:run_wait",
        spanId: "step:refine-prompt:attempt:1",
        traceId: "run_wait",
      },
      type: "step.started",
    });
    stream.push({
      correlationId: "run:run_wait:step:refine-prompt:attempt:1",
      detail: {
        questions: [{
          id: "refine-prompt-0",
          prompt: "Edit the prompt.",
          title: "Refine prompt",
          type: "text",
        }],
      },
      index: 1,
      message: "Waiting for 1 answer.",
      runId: "run_wait",
      stepId: "refine-prompt",
      timestamp: "2026-05-04T00:00:00.000Z",
      trace: {
        name: "refine-prompt",
        parentSpanId: "run:run_wait",
        spanId: "step:refine-prompt:attempt:1",
        traceId: "run_wait",
      },
      type: "step.waiting",
    });
    const waitingIndex = output.indexOf("+-- warn refine-prompt waiting");
    const spinnerAfterWaiting = output.slice(waitingIndex).includes("+-- - refine-prompt");
    renderer.close();

    expect(waitingIndex).toBeGreaterThan(-1);
    expect(spinnerAfterWaiting).toBe(false);
  });

  test("terminal trace renderer formats generic command events by default", () => {
    let output = "";
    const stream = createTraceStream();
    const renderer = createTerminalTraceRenderer({
      color: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      stream,
    });

    stream.push({
      command: "bun run check",
      commandId: "check:bun-run-check",
      correlationId: "event-command-started",
      index: 0,
      message: "Running bun run check.",
      runId: "run_terminal",
      timestamp: "2026-05-04T00:00:00.000Z",
      title: "Run bun run check",
      trace: {
        attributes: { phase: "verification" },
        name: "bun run check",
        spanId: "command.bun-run-check",
        traceId: "run_terminal",
      },
      type: "command.started",
    });
    stream.push({
      command: "bun run check",
      commandId: "check:bun-run-check",
      correlationId: "event-command-completed",
      durationMs: 5190,
      index: 1,
      message: "Ran bun run check.",
      output: "product:completed\nRan 32 tests across 2 files. [5.24s]",
      runId: "run_terminal",
      timestamp: "2026-05-04T00:00:01.000Z",
      title: "Run bun run check",
      trace: {
        attributes: { phase: "verification" },
        name: "bun run check",
        spanId: "command.bun-run-check",
        status: "ok",
        traceId: "run_terminal",
      },
      type: "command.completed",
    });
    renderer.close();

    expect(output).toContain("Verification");
    expect(output).toContain("+-- run Run bun run check");
    expect(output).toContain("+-- ok Ran bun run check [5.19s]");
    expect(output).toContain("|   +-- product:completed");
  });

  test("terminal trace renderer formats generic SDK lifecycle events by default", () => {
    let output = "";
    const stream = createTraceStream();
    const renderer = createTerminalTraceRenderer({
      color: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      stream,
    });

    stream.push(traceRecord("run.started", {
      trace: {
        attributes: { workflowId: "planner.concrete-plan" },
        name: "planner.concrete-plan",
        spanId: "run:run_terminal",
        traceId: "run_terminal",
      },
    }));
    stream.push(traceRecord("step.started", {
      stepId: "draft-plan",
      trace: {
        name: "Draft plan",
        parentSpanId: "run:run_terminal",
        spanId: "step:draft-plan:attempt:1",
        traceId: "run_terminal",
      },
    }));
    stream.push(traceRecord("model.request.started", {
      detail: {
        model: "google/gemma-4-26b-a4b",
        operation: "Draft concrete plan",
        provider: "local-chat",
      },
      trace: {
        attributes: {
          model: "google/gemma-4-26b-a4b",
          operation: "Draft concrete plan",
          phase: "provider",
          provider: "local-chat",
        },
        name: "Draft concrete plan",
        parentSpanId: "step:draft-plan:attempt:1",
        spanId: "model:draft-plan",
        traceId: "run_terminal",
      },
    }));
    stream.push(traceRecord("model.response.delta"));
    stream.push(traceRecord("model.response.completed", {
      detail: { contentLength: 1234 },
      trace: {
        attributes: {
          model: "google/gemma-4-26b-a4b",
          operation: "Draft concrete plan",
          phase: "provider",
          provider: "local-chat",
        },
        name: "Draft concrete plan",
        parentSpanId: "step:draft-plan:attempt:1",
        spanId: "model:draft-plan",
        traceId: "run_terminal",
      },
    }));
    stream.push(traceRecord("score.gated", {
      detail: {
        evaluation: {
          score: 0.82,
          scorePolicyId: "score.plan-quality",
          status: "revise",
        },
        operationId: "draft-plan",
      },
      trace: {
        attributes: { phase: "operations" },
        name: "Draft concrete plan",
        parentSpanId: "step:draft-plan:attempt:1",
        spanId: "operation:draft-plan",
        traceId: "run_terminal",
      },
    }));
    stream.push(traceRecord("step.completed", {
      durationMs: 42,
      stepId: "draft-plan",
      trace: {
        name: "Draft plan",
        parentSpanId: "run:run_terminal",
        spanId: "step:draft-plan:attempt:1",
        traceId: "run_terminal",
      },
    }));
    renderer.close();

    expect(output).toContain("Run");
    expect(output).toContain("+-- run planner.concrete-plan");
    expect(output).toContain("Steps");
    expect(output).toContain("+-- run Draft plan");
    expect(output).toContain("Provider");
    expect(output).toContain("+-- run Draft concrete plan (local-chat/google/gemma-4-26b-a4b)");
    expect(output).toContain("+-- ok Draft concrete plan (local-chat/google/gemma-4-26b-a4b)");
    expect(output).not.toContain("model.response.delta");
    expect(output).toContain("Operations");
    expect(output).toContain("+-- warn score 82% [revise]");
    expect(output).toContain("+-- ok Draft plan [42ms]");
  });

  test("projects workflow run state for dashboard rendering and loopbacks", () => {
    const workflow = loop({
      id: "planner.concrete-plan",
      steps: [
        createRuntimeStep("clarify-intent", () => done()),
        createRuntimeStep("normalize-request", () => done()),
        createRuntimeStep("draft-plan", () => done()),
        createRuntimeStep("evaluate-plan", () => done()),
      ],
    });
    const projection = projectWorkflowRun({
      events: [
        traceRecord("run.started", { runId: "run_loop" }),
        traceRecord("step.started", { attempt: 1, runId: "run_loop", stepId: "clarify-intent" }),
        traceRecord("step.completed", { attempt: 1, runId: "run_loop", stepId: "clarify-intent" }),
        traceRecord("step.started", { attempt: 1, runId: "run_loop", stepId: "normalize-request" }),
        traceRecord("step.completed", { attempt: 1, runId: "run_loop", stepId: "normalize-request" }),
        traceRecord("step.started", { attempt: 1, runId: "run_loop", stepId: "draft-plan" }),
        traceRecord("score.gated", {
          detail: { evaluation: { score: 0.91, status: "pass", threshold: 0.8 } },
          runId: "run_loop",
          stepId: "draft-plan",
        }),
        traceRecord("step.completed", { attempt: 1, runId: "run_loop", stepId: "draft-plan" }),
        traceRecord("step.started", { attempt: 1, runId: "run_loop", stepId: "evaluate-plan" }),
        traceRecord("score.gated", {
          detail: { evaluation: { score: 0.64, status: "revise", threshold: 0.8 } },
          runId: "run_loop",
          stepId: "evaluate-plan",
        }),
        traceRecord("step.goto", {
          detail: {
            fromStepId: "evaluate-plan",
            reason: "missing target platform and persistence scope",
            targetStepId: "normalize-request",
          },
          runId: "run_loop",
          stepId: "evaluate-plan",
        }),
      ],
      graph: workflow.graph(),
      input: "create a todo app",
    });

    expect(projection.currentStepId).toBe("normalize-request");
    expect(projection.steps.map((item) => item.id)).toEqual([
      "$trigger",
      "clarify-intent",
      "normalize-request",
      "draft-plan",
      "evaluate-plan",
      "$end",
    ]);
    expect(projection.steps.find((item) => item.id === "$trigger")?.status).toBe("done");
    expect(projection.steps.find((item) => item.id === "$end")?.status).toBe("pending");
    expect(projection.steps.find((item) => item.id === "normalize-request")?.status).toBe("revisiting");
    expect(projection.steps.find((item) => item.id === "draft-plan")?.status).toBe("stale");
    expect(projection.steps.find((item) => item.id === "evaluate-plan")?.status).toBe("looped");
    expect(projection.loops[0]?.reason).toBe("missing target platform and persistence scope");

    const frame = renderTerminalWorkflowFrame(projection, { columns: 100 });
    expect(frame).toContain("planner.concrete-plan");
    expect(frame).toContain("02 Normalize Request");
    expect(frame).toContain("Loop: evaluate-plan -> normalize-request");
    expect(frame).toContain("Reason: missing target platform and persistence scope");
  });

  test("workflow run projection clears stale questions after answers and terminal step states", () => {
    const workflow = loop({
      id: "terminal.projection-clear",
      steps: [
        createRuntimeStep("ask-scope", () => done()),
      ],
    });
    const answeredProjection = projectWorkflowRun({
      events: [
        traceRecord("run.started", { runId: "run_projection_clear" }),
        traceRecord("step.started", { runId: "run_projection_clear", stepId: "ask-scope" }),
        traceRecord("question.requested", {
          detail: {
            questions: [{
              id: "scope",
              options: [{ label: "Minimal", value: "minimal" }],
              prompt: "Scope?",
              type: "choice",
            }],
          },
          runId: "run_projection_clear",
          stepId: "ask-scope",
        }),
        traceRecord("question.answered", {
          detail: { questionId: "scope", value: "minimal" },
          runId: "run_projection_clear",
          stepId: "ask-scope",
        }),
      ],
      graph: workflow.graph(),
    });

    expect(answeredProjection.status).toBe("running");
    expect(answeredProjection.pendingQuestions).toEqual([]);
    expect(answeredProjection.steps.find((item) => item.id === "$trigger")?.status).toBe("done");
    expect(answeredProjection.steps.find((item) => item.id === "ask-scope")?.status).toBe("running");

    const completedProjection = projectWorkflowRun({
      events: [
        traceRecord("run.started", { runId: "run_projection_clear" }),
        traceRecord("step.started", { runId: "run_projection_clear", stepId: "ask-scope" }),
        traceRecord("question.requested", {
          detail: {
            questions: [{
              id: "scope",
              options: [{ label: "Minimal", value: "minimal" }],
              prompt: "Scope?",
              type: "choice",
            }],
          },
          runId: "run_projection_clear",
          stepId: "ask-scope",
        }),
        traceRecord("question.answered", {
          detail: { questionId: "scope", value: "minimal" },
          runId: "run_projection_clear",
          stepId: "ask-scope",
        }),
        traceRecord("step.completed", { runId: "run_projection_clear", stepId: "ask-scope" }),
      ],
      graph: workflow.graph(),
    });

    expect(completedProjection.status).toBe("running");
    expect(completedProjection.currentStepId).toBeUndefined();
    expect(completedProjection.pendingQuestions).toEqual([]);
    expect(completedProjection.steps.find((item) => item.id === "ask-scope")?.status).toBe("done");

    const endedProjection = projectWorkflowRun({
      events: [
        traceRecord("run.started", { runId: "run_projection_clear" }),
        traceRecord("step.started", { runId: "run_projection_clear", stepId: "ask-scope" }),
        traceRecord("step.completed", { runId: "run_projection_clear", stepId: "ask-scope" }),
        traceRecord("run.completed", { runId: "run_projection_clear" }),
      ],
      graph: workflow.graph(),
    });
    expect(endedProjection.status).toBe("completed");
    expect(endedProjection.steps.find((item) => item.id === "$end")?.status).toBe("done");

    const failedProjection = projectWorkflowRun({
      events: [
        traceRecord("run.started", { runId: "run_projection_clear" }),
        traceRecord("step.started", { runId: "run_projection_clear", stepId: "ask-scope" }),
        traceRecord("question.requested", {
          detail: {
            questions: [{
              id: "scope",
              prompt: "Scope?",
              type: "text",
            }],
          },
          runId: "run_projection_clear",
          stepId: "ask-scope",
        }),
        traceRecord("run.failed", { runId: "run_projection_clear" }),
      ],
      graph: workflow.graph(),
    });

    expect(failedProjection.status).toBe("failed");
    expect(failedProjection.currentStepId).toBeUndefined();
    expect(failedProjection.pendingQuestions).toEqual([]);
    expect(failedProjection.steps.find((item) => item.id === "$end")?.status).toBe("failed");
  });

  test("workflow run store batches events and keeps a semantic transcript", async () => {
    const workflow = loop({
      id: "terminal.store",
      steps: [
        createRuntimeStep("draft-plan", () => done()),
      ],
    });
    const store = createWorkflowRunStore({
      batchMs: 10,
      graph: workflow.graph(),
      input: "ship it",
    });
    const snapshots: unknown[] = [];
    const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot));

    store.push(traceRecord("run.started", { runId: "run_store" }));
    store.push(traceRecord("step.started", { runId: "run_store", stepId: "draft-plan" }));

    expect(store.snapshot().status).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.snapshot().status).toBe("running");
    expect(snapshots.length).toBe(2);

    store.push(traceRecord("operation.started", {
      detail: { operationId: "draft-plan" },
      runId: "run_store",
      stepId: "draft-plan",
      trace: {
        attributes: { phase: "operations" },
        name: "Draft concrete plan",
        spanId: "operation:draft-plan",
        traceId: "run_store",
      },
    }));
    store.push(traceRecord("operation.completed", {
      detail: { durationMs: 42, operationId: "draft-plan" },
      runId: "run_store",
      stepId: "draft-plan",
      trace: {
        attributes: { phase: "operations" },
        name: "Draft concrete plan",
        spanId: "operation:draft-plan",
        traceId: "run_store",
      },
    }));
    store.flush();

    const operationRows = store.snapshot().transcript.filter((item) => item.id === "operation:draft-plan");
    expect(operationRows).toHaveLength(1);
    expect(operationRows[0]?.status).toBe("ok");
    expect(operationRows[0]?.text).toContain("draft-plan");
    expect(operationRows[0]?.durationLabel).toBe("42ms");
    expect(operationRows[0]?.clockLabel).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(operationRows[0]?.elapsedLabel).toBe("+0ms");

    store.push(traceRecord("run.completed", {
      runId: "run_store",
      timestamp: "2026-05-04T00:00:05.100Z",
    }));
    store.flush();
    expect(store.snapshot().runDurationLabel).toBe("5.10s");

    unsubscribe();
    store.close();
  });

  test("workflow run store only leaves the latest new activity row spinning", () => {
    const workflow = loop({
      id: "terminal.store.leaf-active",
      steps: [
        createRuntimeStep("process-image-batch", () => done()),
      ],
    });
    const store = createWorkflowRunStore({
      batchMs: 0,
      graph: workflow.graph(),
    });

    store.push(traceRecord("run.started", { runId: "run_leaf_active" }));
    expect(store.snapshot().transcript.find((item) => item.id === "run.run_leaf_active")?.status).toBe("running");

    store.push(traceRecord("step.started", {
      runId: "run_leaf_active",
      stepId: "process-image-batch",
      trace: {
        attributes: { phase: "steps" },
        name: "Process batch",
        spanId: "step:process-image-batch",
        traceId: "run_leaf_active",
      },
    }));
    expect(store.snapshot().transcript.find((item) => item.id === "run.run_leaf_active")?.status).toBe("info");
    expect(store.snapshot().transcript.find((item) => item.id === "step.process-image-batch")?.status).toBe("running");

    store.push(traceRecord("operation.started", {
      detail: { operationId: "images.process-image-batch" },
      runId: "run_leaf_active",
      stepId: "process-image-batch",
      trace: {
        attributes: { phase: "images" },
        name: "Process image batch",
        spanId: "operation:images.process-image-batch",
        traceId: "run_leaf_active",
      },
    }));
    expect(store.snapshot().transcript.find((item) => item.id === "step.process-image-batch")?.status).toBe("info");
    expect(store.snapshot().transcript.find((item) => item.id === "operation:images.process-image-batch")?.status).toBe("running");

    store.push(traceRecord("worker.item.completed", {
      itemId: "raw/image-x.png:fingerprint-image",
      itemKind: "image",
      output: { fileId: "image-x" },
      provider: "process-image-item",
      runId: "run_leaf_active",
      stepId: "process-image-batch",
      title: "raw/image-x.png: fingerprint-image",
      trace: {
        attributes: { phase: "image-item" },
        name: "fingerprint image",
        spanId: "worker:raw-image-x:fingerprint-image",
        traceId: "run_leaf_active",
      },
    }));
    expect(store.snapshot().transcript.find((item) => item.id === "operation:images.process-image-batch")?.status).toBe("info");
    expect(store.snapshot().transcript.find((item) => item.id === "worker.raw/image-x.png:fingerprint-image")?.status).toBe("ok");

    store.push(traceRecord("operation.completed", {
      detail: { durationMs: 40_100, operationId: "images.process-image-batch" },
      durationMs: 40_100,
      runId: "run_leaf_active",
      stepId: "process-image-batch",
      trace: {
        attributes: { phase: "images" },
        name: "Process image batch",
        spanId: "operation:images.process-image-batch",
        traceId: "run_leaf_active",
      },
    }));
    expect(store.snapshot().transcript.find((item) => item.id === "operation:images.process-image-batch")?.status).toBe("ok");

    store.close();
  });

  test("workflow run store projects model conversations from worker and model events", () => {
    const workflow = loop({
      id: "terminal.store.conversation",
      steps: [
        createRuntimeStep("clarify-intent", () => done()),
      ],
    });
    const store = createWorkflowRunStore({
      batchMs: 0,
      graph: workflow.graph(),
    });
    const trace = {
      attributes: { operation: "Clarify intent", provider: "opencode", stepId: "clarify-intent" },
      name: "Clarify intent",
      parentSpanId: "step:clarify-intent:attempt:1",
      spanId: "model:opencode:clarify-intent",
      traceId: "run_conversation",
    };

    store.push(traceRecord("run.started", { index: 0, runId: "run_conversation" }));
    store.push(traceRecord("worker.item.started", {
      index: 1,
      input: { message: "create a todo app" },
      itemId: "model-step",
      itemKind: "model_step",
      operation: "Clarify intent",
      provider: "opencode",
      providerRefs: { messageId: "msg_1", partId: "part_1", sessionId: "ses_1" },
      raw: { type: "step_start" },
      rawType: "step_start",
      runId: "run_conversation",
      stepId: "clarify-intent",
      title: "Clarify intent started a model step",
      trace,
    }));
    store.push(traceRecord("worker.item.delta", {
      index: 2,
      itemId: "assistant-message",
      itemKind: "assistant_message",
      operation: "Clarify intent",
      provider: "opencode",
      providerRefs: { messageId: "msg_1", partId: "part_2", sessionId: "ses_1" },
      runId: "run_conversation",
      stepId: "clarify-intent",
      text: "I will ask one focused question.",
      title: "Clarify intent wrote output",
      trace,
    }));
    store.push(traceRecord("worker.item.started", {
      index: 3,
      input: { path: "./catalog/planning/clarify-intent/clarify.md" },
      itemId: "tool-read",
      itemKind: "tool_call",
      operation: "Clarify intent",
      provider: "opencode",
      providerRefs: { callId: "call_1", sessionId: "ses_1" },
      runId: "run_conversation",
      stepId: "clarify-intent",
      title: "Clarify intent is using read_file",
      trace,
    }));
    store.push(traceRecord("worker.item.completed", {
      index: 4,
      itemId: "tool-read",
      itemKind: "tool_call",
      operation: "Clarify intent",
      output: { lines: 107 },
      provider: "opencode",
      providerRefs: { callId: "call_1", sessionId: "ses_1" },
      runId: "run_conversation",
      stepId: "clarify-intent",
      title: "Clarify intent completed read_file",
      trace,
    }));
    store.push(traceRecord("model.response.delta", {
      detail: { delta: "Which feature set should the first version include?", operation: "Clarify intent", provider: "opencode" },
      index: 5,
      runId: "run_conversation",
      trace,
    }));
    store.push(traceRecord("model.response.completed", {
      detail: { contentLength: 49, operation: "Clarify intent", provider: "opencode" },
      index: 6,
      runId: "run_conversation",
      trace,
    }));

    const conversation = store.snapshot().conversations.find((item) => item.provider === "opencode");
    expect(conversation?.stepId).toBe("clarify-intent");
    expect(conversation?.operation).toBe("Clarify intent");
    expect(conversation?.providerRefs?.sessionId).toBe("ses_1");
    expect(conversation?.eventTypes).toContain("worker.item.delta");
    expect(conversation?.eventTypes).toContain("model.response.completed");
    expect(conversation?.sections.map((section) => section.kind)).toEqual([
      "prompt",
      "assistant",
      "toolCall",
      "final",
      "raw",
    ]);
    expect(conversation?.sections.find((section) => section.kind === "prompt")).toMatchObject({
      text: "create a todo app",
    });
    expect(conversation?.sections.find((section) => section.kind === "final")).toMatchObject({
      text: "Which feature set should the first version include?",
    });
    expect(store.snapshot().transcript.find((row) => row.id === "worker.model-step")?.conversationId).toBe(conversation?.id);

    store.close();
  });

  test("workflow run store keeps repeated model rounds as separate chronological conversations", () => {
    const workflow = loop({
      id: "terminal.store.conversation-rounds",
      steps: [
        createRuntimeStep("clarify-intent", () => done()),
      ],
    });
    const store = createWorkflowRunStore({
      batchMs: 0,
      graph: workflow.graph(),
    });
    const trace = {
      attributes: { operation: "Clarify intent", provider: "opencode", stepId: "clarify-intent" },
      name: "Clarify intent",
      parentSpanId: "step:clarify-intent:attempt:1",
      spanId: "model:opencode:clarify-intent",
      traceId: "run_conversation_rounds",
    };

    store.push(traceRecord("run.started", { index: 0, runId: "run_conversation_rounds" }));
    store.push(traceRecord("model.request.started", {
      detail: { operation: "Clarify intent", provider: "opencode", resolvedModel: "openai/gpt-5.5" },
      index: 1,
      runId: "run_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("model.response.delta", {
      detail: { delta: "First question.", operation: "Clarify intent", provider: "opencode" },
      index: 2,
      runId: "run_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("model.response.completed", {
      detail: { operation: "Clarify intent", provider: "opencode" },
      index: 3,
      runId: "run_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("question.answered", {
      detail: { questionId: "intent", value: "single user todo" },
      index: 4,
      runId: "run_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("model.request.started", {
      detail: { operation: "Clarify intent", provider: "opencode", resolvedModel: "openai/gpt-5.5" },
      index: 5,
      runId: "run_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("model.response.delta", {
      detail: { delta: "Second question.", operation: "Clarify intent", provider: "opencode" },
      index: 6,
      runId: "run_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("model.response.completed", {
      detail: { operation: "Clarify intent", provider: "opencode" },
      index: 7,
      runId: "run_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));

    const conversations = store.snapshot().conversations.filter((item) => item.stepId === "clarify-intent");
    expect(conversations).toHaveLength(2);
    expect(conversations[0]?.eventIndexes).toEqual([1, 2, 3]);
    expect(conversations[1]?.eventIndexes).toEqual([5, 6, 7]);
    expect(conversations[0]?.finalOutput).toBe("First question.");
    expect(conversations[1]?.finalOutput).toBe("Second question.");
    expect(conversations[0]?.id).not.toBe(conversations[1]?.id);

    store.close();
  });

  test("workflow run store separates repeated worker model-step conversations", () => {
    const workflow = loop({
      id: "terminal.store.worker-conversation-rounds",
      steps: [
        createRuntimeStep("clarify-intent", () => done()),
      ],
    });
    const store = createWorkflowRunStore({
      batchMs: 0,
      graph: workflow.graph(),
    });
    const trace = {
      attributes: { operation: "Clarify intent", provider: "opencode", stepId: "clarify-intent" },
      name: "Clarify intent",
      parentSpanId: "step:clarify-intent:attempt:1",
      spanId: "worker:opencode:clarify-intent",
      traceId: "run_worker_conversation_rounds",
    };

    store.push(traceRecord("worker.item.started", {
      index: 1,
      input: { message: "first prompt" },
      itemId: "model-step-1",
      itemKind: "model_step",
      operation: "Clarify intent",
      provider: "opencode",
      runId: "run_worker_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("worker.item.delta", {
      index: 2,
      itemId: "model-step-1",
      itemKind: "model_step",
      operation: "Clarify intent",
      provider: "opencode",
      runId: "run_worker_conversation_rounds",
      stepId: "clarify-intent",
      text: "First worker round.",
      trace,
    }));
    store.push(traceRecord("worker.item.completed", {
      index: 3,
      itemId: "model-step-1",
      itemKind: "model_step",
      operation: "Clarify intent",
      provider: "opencode",
      runId: "run_worker_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("worker.item.started", {
      index: 4,
      input: { message: "second prompt" },
      itemId: "model-step-2",
      itemKind: "model_step",
      operation: "Clarify intent",
      provider: "opencode",
      runId: "run_worker_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));
    store.push(traceRecord("worker.item.delta", {
      index: 5,
      itemId: "model-step-2",
      itemKind: "model_step",
      operation: "Clarify intent",
      provider: "opencode",
      runId: "run_worker_conversation_rounds",
      stepId: "clarify-intent",
      text: "Second worker round.",
      trace,
    }));
    store.push(traceRecord("worker.item.completed", {
      index: 6,
      itemId: "model-step-2",
      itemKind: "model_step",
      operation: "Clarify intent",
      provider: "opencode",
      runId: "run_worker_conversation_rounds",
      stepId: "clarify-intent",
      trace,
    }));

    const conversations = store.snapshot().conversations.filter((item) => item.stepId === "clarify-intent");
    expect(conversations).toHaveLength(2);
    expect(conversations[0]?.eventIndexes).toEqual([1, 2, 3]);
    expect(conversations[1]?.eventIndexes).toEqual([4, 5, 6]);
    expect(conversations[0]?.sections.find((section) => section.kind === "assistant")).toMatchObject({
      text: "First worker round.",
    });
    expect(conversations[1]?.sections.find((section) => section.kind === "assistant")).toMatchObject({
      text: "Second worker round.",
    });

    store.close();
  });

  test("workflow run store flushes on the remaining batch budget", async () => {
    const workflow = loop({
      id: "terminal.store.remaining-budget",
      steps: [
        createRuntimeStep("draft-plan", () => done()),
      ],
    });
    const store = createWorkflowRunStore({
      batchMs: 80,
      graph: workflow.graph(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    store.push(traceRecord("run.started", { runId: "run_store_budget" }));
    await new Promise((resolve) => setTimeout(resolve, 45));

    expect(store.events()).toHaveLength(1);
    expect(store.snapshot().status).toBe("running");

    store.close();
  });

  test("workflow app registry exposes workflows and drives headless runs", async () => {
    const planner = loop({
      id: "app.planner",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Ship it" })),
      ],
    });
    const reviewer = loop({
      id: "app.reviewer",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Review it" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      id: "demo-app",
      title: "Demo App",
      workflows: {
        planner: {
          input: {
            kind: "prompt",
            placeholder: "What should we plan?",
          },
          result: {
            format: (session) => `Plan: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Planner",
          workflow: planner,
        },
        reviewer: {
          commands: [{
            description: "Route review requests to the reviewer workflow.",
            name: "review",
            usage: "/review <scope>",
          }],
          title: "Reviewer",
          workflow: reviewer,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);

    expect(app.defaultWorkflowId).toBe("planner");
    expect(app.listWorkflows().map((workflow) => workflow.id)).toEqual(["planner", "reviewer"]);
    expect(app.listCommands()).toEqual([{
      description: "Route review requests to the reviewer workflow.",
      name: "review",
      usage: "/review <scope>",
      workflowId: "reviewer",
    }]);
    expect(app.listWorkflows()[1]?.commands).toEqual([{
      description: "Route review requests to the reviewer workflow.",
      name: "review",
      usage: "/review <scope>",
      workflowId: "reviewer",
    }]);
    expect(parseWorkflowCliArgs(app, ["reviewer", "look", "here"])).toEqual({
      interactive: undefined,
      prompt: "look here",
      workflowId: "reviewer",
    });
    expect(parseWorkflowCliArgs(app, ["--workflow", "reviewer"])).toEqual({
      interactive: undefined,
      prompt: "",
      workflowId: "reviewer",
    });
    expect(parseWorkflowCliArgs(app, ["--workflow"])).toEqual({
      error: "Missing workflow id after --workflow.",
      interactive: undefined,
      prompt: "",
      workflowId: undefined,
    });
    expect(parseWorkflowCliArgs(app, ["--interactive", "reviewer", "look", "here"])).toEqual({
      interactive: true,
      prompt: "look here",
      workflowId: "reviewer",
    });
    expect(parseWorkflowCliArgs(app, ["-s", "run_123"])).toEqual({
      interactive: undefined,
      prompt: "",
      sessionId: "run_123",
      workflowId: undefined,
    });
    expect(parseWorkflowCliArgs(app, ["--session"])).toEqual({
      error: "Missing session id after --session.",
      interactive: undefined,
      prompt: "",
      workflowId: undefined,
    });
    const run = await runtime.startRun({
      input: "ship it",
      workflowId: "planner",
    });

    expect(run.status).toBe("completed");
    expect(runtime.formatResult(run.runId)).toBe("Plan: Ship it");

    const routedRun = await runtime.startRun({
      input: "/review payment flow",
      workflowId: "planner",
    });
    expect(routedRun.workflowId).toBe("reviewer");
  });

  test("workflow app runtime supports custom artifact end adapters", async () => {
    const workflow = loop({
      id: "app.artifact-end",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Custom artifact" })),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          result: {
            artifactName: "brief.md",
            format: (session) => `Brief: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          workflow,
        },
      },
    });
    const writes: string[] = [];
    const runtime = createWorkflowAppRuntime(app, {
      endHooks: [
        artifactEnd({
          write({ artifactName, run }) {
            writes.push(`${run.workflowId}:${artifactName}:${run.result}`);
            return [{
              kind: "memory",
              mediaType: "text/markdown",
              name: artifactName,
            }];
          },
        }),
      ],
    });

    const run = await runtime.startRun({
      input: "ship it",
      runId: "run_artifact_end",
      workflowId: "planner",
    });

    expect(run.status).toBe("completed");
    expect(writes).toEqual(["planner:brief.md:Brief: Custom artifact"]);
    expect(run.artifacts).toEqual([{
      kind: "memory",
      mediaType: "text/markdown",
      name: "brief.md",
    }]);
    expect(run.events.map((event) => event.type)).toContain("workflow.end.completed");
  });

  test("workflow app runtime answers questions through the headless API", async () => {
    const workflow = loop({
      id: "app.runtime-question",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Minimal", value: "minimal" },
                { label: "Full", value: "full" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const run = await runtime.startRun({
      input: "ship it",
      workflowId: "planner",
    });

    expect(run.status).toBe("waiting");
    await runtime.answerQuestion(run.runId, {
      questionId: "scope",
      value: "minimal",
    });
    const completed = await runtime.resumeRun(run.runId);

    expect(completed.status).toBe("completed");
    expect(completed.session.answers?.scope).toBe("minimal");
  });

  test("workflow app runtime reopens selected checkpoint answers when revising from a step", async () => {
    const workflow = loop({
      id: "app.runtime-revise-question",
      steps: [
        createRuntimeStep("ask-audience", (context) => {
          if ("audience" in context.answers) return done({ audience: context.answers.audience });
          return {
            questions: [{
              id: "audience",
              options: [
                { label: "Personal", value: "personal" },
                { label: "Team", value: "team" },
              ],
              prompt: "Audience?",
              title: "Audience",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) {
            return done({
              audience: context.answers.audience,
              scope: context.answers.scope,
            });
          }
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Minimal", value: "minimal" },
                { label: "Full", value: "full" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const run = await runtime.startRun({
      input: "ship it",
      workflowId: "planner",
    });

    expect(run.status).toBe("waiting");
    await runtime.answerQuestion(run.runId, {
      questionId: "audience",
      value: "personal",
    });
    const scopeRun = await runtime.resumeRun(run.runId);
    expect(scopeRun.status).toBe("waiting");
    expect(scopeRun.session.pendingQuestions.map((question) => question.id)).toEqual(["scope"]);

    await runtime.answerQuestion(run.runId, {
      questionId: "scope",
      value: "minimal",
    });
    const completed = await runtime.resumeRun(run.runId);
    expect(completed.status).toBe("completed");
    expect(completed.session.answers?.audience).toBe("personal");
    expect(completed.session.answers?.scope).toBe("minimal");

    const child = await runtime.rerunFromStep(completed.runId, {
      stepId: "ask-scope",
    });

    expect(child.events[0]?.type).toBe("run.rerun.created");
    expect(child.status).toBe("waiting");
    expect(child.session.answers?.audience).toBe("personal");
    expect(child.session.answers?.scope).toBeUndefined();
    expect(child.session.pendingQuestions.map((question) => question.id)).toEqual(["scope"]);
  });

  test("workflow app runtime resumes arbitrary hooks through the headless API", async () => {
    const approval = createHook<{ label: string }, string>({ id: "approval" });
    const workflow = loop({
      id: "app.runtime-hook",
      steps: [
        createRuntimeStep("gate", async (context) => {
          const answer = await context.waitFor(approval, { label: "Approve" });
          return done({ answer });
        }),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        gated: {
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const run = await runtime.startRun({
      input: "ship it",
      runId: "run_app_hook",
      workflowId: "gated",
    });
    const token = run.session.pendingHooks?.[0]?.token;

    expect(run.status).toBe("waiting");
    expect(token).toBeDefined();
    const completed = await runtime.resumeHook({
      token: token!,
      value: "approved",
    });

    expect(completed.status).toBe("completed");
    expect(completed.session.state).toMatchObject({
      gate: { answer: "approved" },
    });
  });

  test("workflow app HTTP adapter and client expose runs, questions, hooks, and events", async () => {
    const approval = createHook<{ label: string }, string>({ id: "approval" });
    const askWorkflow = loop({
      id: "app.http-question",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Minimal", value: "minimal" },
                { label: "Full", value: "full" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const hookWorkflow = loop({
      id: "app.http-hook",
      steps: [
        createRuntimeStep("gate", async (context) => {
          const answer = await context.waitFor(approval, { label: "Approve" });
          return done({ answer });
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      workflows: {
        gated: {
          workflow: hookWorkflow,
        },
        planner: {
          result: {
            format: (session) => `Scope: ${session.answers?.scope}`,
          },
          workflow: askWorkflow,
        },
      },
    });
    const baseRuntime = createWorkflowAppRuntime(app);
    let subscriptions = 0;
    let unsubscribes = 0;
    let resolveSubscriptions!: () => void;
    const subscriptionsReady = new Promise<void>((resolve) => {
      resolveSubscriptions = resolve;
    });
    const runtime: typeof baseRuntime = {
      ...baseRuntime,
      subscribe(runId, listener) {
        subscriptions += 1;
        if (subscriptions >= 2) resolveSubscriptions();
        const unsubscribe = baseRuntime.subscribe(runId, listener);
        return () => {
          unsubscribes += 1;
          unsubscribe();
        };
      },
    };
    const http = createWorkflowAppHttpAdapter({ runtime });
    const remote = createWorkflowAppClient({
      baseUrl: "http://local/api/workflow-app",
      fetch: (request) => http.fetch(request as Request),
    });

    expect((await remote.workflows.list()).map((workflow) => workflow.id)).toEqual(["gated", "planner"]);
    const waiting = await remote.runs.create({
      input: "ship it",
      runId: "run_app_http_question",
      workflowId: "planner",
    });

    expect(waiting.status).toBe("waiting");
    expect(waiting.pendingQuestions[0]).toMatchObject({ id: "scope" });
    const streamed = collectUntilEvent(
      remote.runs.streamEvents(waiting.runId, { fromIndex: waiting.events.length }),
      "run.completed",
    );
    const earlyStreamed = collectUntilEvent(
      remote.runs.streamEvents(waiting.runId, { fromIndex: waiting.events.length }),
      "question.answered",
    );
    await subscriptionsReady;
    await remote.runs.answerQuestion(waiting.runId, {
      questionId: "scope",
      value: "minimal",
    });
    const earlyEvents = await earlyStreamed;
    await waitFor(() => unsubscribes >= 1);
    const completed = await remote.runs.resume(waiting.runId);
    const streamedEvents = await streamed;

    expect(completed.status).toBe("completed");
    expect(completed.result).toBe("Scope: minimal");
    expect(earlyEvents.at(-1)?.type).toBe("question.answered");
    expect(streamedEvents.map((event) => event.type)).toContain("question.answered");
    expect(streamedEvents.at(-1)?.type).toBe("run.completed");
    expect((await remote.runs.get(completed.runId)).status).toBe("completed");
    expect((await remote.runs.list()).map((run) => run.runId)).toContain("run_app_http_question");
    expect((await remote.runs.events(completed.runId)).some((event) => event.type === "question.answered")).toBe(true);

    const gated = await remote.runs.create({
      input: "ship hook",
      runId: "run_app_http_hook",
      workflowId: "gated",
    });
    const token = gated.pendingHooks?.[0]?.token;

    expect(token).toBeDefined();
    const hookCompleted = await remote.hooks.resume({
      token: token!,
      value: "approved",
    });

    expect(hookCompleted.status).toBe("completed");
    expect(hookCompleted.state).toMatchObject({
      gate: { answer: "approved" },
    });

    const stream = await http.fetch(new Request("http://local/api/workflow-app/runs/run_app_http_hook/events/stream"));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(await stream.text()).toContain("event: run.completed");
  });

  test("workflow CLI app runs a registered workflow non-interactively", async () => {
    const workflow = loop({
      id: "app.cli",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "No preference", value: "__assume__" },
                { label: "Minimal", value: "minimal" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      workflows: {
        planner: {
          result: {
            format: (session) => `Scope: ${session.answers?.scope}`,
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    let output = "";
    const session = await runWorkflowCliApp(app, {
      argv: ["planner", "create", "a", "todo", "app"],
      input,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session?.status).toBe("completed");
    expect(output).toContain("Result");
    expect(output).toContain("Scope: __assume__");
  });

  test("workflow CLI app reports unknown workflows without throwing", async () => {
    const workflow = loop({
      id: "app.cli-unknown",
      steps: [
        createRuntimeStep("finish", () => done({ ok: true })),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          workflow,
        },
      },
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    let output = "";
    const session = await runWorkflowCliApp(app, {
      argv: ["--workflow", "missing", "ship"],
      input,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session).toBeUndefined();
    expect(output).toContain("Unknown workflow: missing");
    expect(output).toContain("Available workflows: planner");
  });

  test("workflow app reports unknown workflows before prompting for input", async () => {
    const workflow = loop({
      id: "app.unknown-before-input",
      steps: [
        createRuntimeStep("finish", () => done({ ok: true })),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          workflow,
        },
      },
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    let output = "";
    const session = await runWorkflowApp(app, {
      mode: "cli",
      cli: {
        argv: ["--workflow", "missing"],
        input,
        output: {
          isTTY: true,
          write(chunk) {
            output += chunk;
            return true;
          },
        },
        renderer: "none",
      },
    });

    expect(session).toBeUndefined();
    expect(output).toContain("Unknown workflow: missing");
    expect(output).not.toContain("Input is required");
  });

  test("workflow app reports missing workflow operands before prompting for input", async () => {
    const workflow = loop({
      id: "app.missing-workflow-operand",
      steps: [
        createRuntimeStep("finish", () => done({ ok: true })),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          workflow,
        },
      },
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    let output = "";
    const session = await runWorkflowCliApp(app, {
      argv: ["--workflow"],
      defaultPrompt: "ship",
      input,
      output: {
        isTTY: true,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session).toBeUndefined();
    expect(output).toContain("Missing workflow id after --workflow.");
    expect(output).not.toContain("Result");
  });

  test("workflow CLI app is batch by default for required questions", async () => {
    const workflow = loop({
      id: "app.cli-required-batch",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Minimal", value: "minimal" },
                { label: "Full", value: "full" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          workflow,
        },
      },
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    let output = "";
    const session = await runWorkflowCliApp(app, {
      argv: ["planner", "ship"],
      input,
      output: {
        isTTY: true,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session?.status).toBe("waiting");
    expect(session?.answers?.scope).toBeUndefined();
    expect(output).toContain("Waiting");
    expect(output).toContain("Cannot auto-answer Scope");
  });

  test("workflow CLI app can opt into interactive terminal questions", async () => {
    const workflow = loop({
      id: "app.cli-required-interactive",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Minimal", value: "minimal" },
                { label: "Full", value: "full" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          result: {
            format: (session) => `Scope: ${session.answers?.scope}`,
          },
          workflow,
        },
      },
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    output.isTTY = true;
    let written = "";
    output.on("data", (chunk) => {
      written += chunk.toString();
    });
    queueMicrotask(() => {
      input.write("1\n");
    });
    const session = await runWorkflowCliApp(app, {
      argv: ["--interactive", "planner", "ship"],
      input,
      output,
      renderer: "none",
    });

    expect(session?.status).toBe("completed");
    expect(session?.answers?.scope).toBe("minimal");
    expect(written).toContain("Scope?");
    expect(written).toContain("Result");
    expect(written).toContain("Scope: minimal");
  });

  test("workflow app auto mode chooses CLI for --cli and piped stdin", async () => {
    const workflow = loop({
      id: "app.auto-cli",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Auto CLI" })),
      ],
    });
    const app = createWorkflowApp({
      workflows: {
        planner: {
          result: {
            format: (session) => `Plan: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          workflow,
        },
      },
    });
    const ttyInput = new PassThrough() as PassThrough & { isTTY?: boolean };
    ttyInput.isTTY = true;
    let explicitOutput = "";
    await runWorkflowApp(app, {
      cli: {
        argv: ["planner", "ship", "this"],
        input: ttyInput,
        output: {
          isTTY: true,
          write(chunk) {
            explicitOutput += chunk;
            return true;
          },
        },
        renderer: "none",
      },
    });
    expect(explicitOutput).toContain("Plan: Auto CLI");

    const flagInput = new PassThrough() as PassThrough & { isTTY?: boolean };
    flagInput.isTTY = true;
    let flagOutput = "";
    await runWorkflowApp(app, {
      cli: {
        argv: ["--cli", "--prompt", "ship", "with", "flag"],
        input: flagInput,
        output: {
          isTTY: true,
          write(chunk) {
            flagOutput += chunk;
            return true;
          },
        },
        renderer: "none",
      },
    });
    expect(flagOutput).toContain("Plan: Auto CLI");

    const pipedInput = new PassThrough() as PassThrough & { isTTY?: boolean };
    pipedInput.isTTY = false;
    pipedInput.end("ship from stdin\n");
    let pipedOutput = "";
    await runWorkflowApp(app, {
      cli: {
        argv: [],
        input: pipedInput,
        output: {
          isTTY: true,
          write(chunk) {
            pipedOutput += chunk;
            return true;
          },
        },
        renderer: "none",
      },
    });
    expect(pipedOutput).toContain("Plan: Auto CLI");
  });

  test("workflow TUI shell starts a run from the composer and leaves it available", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-shell",
      steps: [
        createRuntimeStep("finish", () => done({ title: "TUI Shell" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          result: {
            format: (session) => `Plan: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const artifactDirectory = await mkdtemp(path.join(tmpdir(), "dromio-artifacts-"));
    const runtime = createWorkflowAppRuntime(app, {
      endHooks: [artifactEnd.file({ directory: artifactDirectory })],
    });
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 80,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    const run = runtime.listRuns()[0];
    expect(run?.status).toBe("completed");
    expect(runtime.formatResult(run!.runId)).toBe("Plan: TUI Shell");
    const resultPath = path.join(artifactDirectory, run!.runId, "result.md");
    const tracePath = path.join(artifactDirectory, run!.runId, "trace.json");
    await waitFor(() => existsSync(resultPath) && existsSync(tracePath));
    expect(await readFile(resultPath, "utf8")).toBe("Plan: TUI Shell");
    const trace = JSON.parse(await readFile(tracePath, "utf8")) as { events: unknown[]; result?: string; runId?: string };
    expect(trace.runId).toBe(run!.runId);
    expect(trace.result).toBe("Plan: TUI Shell");
    expect(trace.events.length).toBeGreaterThan(0);
    expect(run?.artifacts.map((artifact) => artifact.name)).toEqual(["result.md", "trace.json"]);
    expect(run?.events.map((event) => event.type)).toContain("workflow.end.completed");

    view.renderer.destroy();
    await rm(artifactDirectory, { force: true, recursive: true });
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell shows a toast when terminal selection is copied", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-copy-toast",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Copy" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 90,
    });
    const copied: string[] = [];
    (view.renderer as unknown as { copyToClipboardOSC52(text: string): boolean }).copyToClipboardOSC52 = (text) => {
      copied.push(text);
      return true;
    };

    await view.renderOnce();
    view.renderer.console.onCopySelection?.("copied text");
    let frame = "";
    for (let index = 0; index < 30; index += 1) {
      await view.renderOnce();
      frame = view.captureCharFrame();
      if (frame.includes("Copied to clipboard")) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(copied).toEqual(["copied text"]);
    expect(frame).toContain("Copied to clipboard");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell shows a spinner for the currently running step", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    let finishSlowStep!: () => void;
    const slowStep = new Promise<void>((resolve) => {
      finishSlowStep = resolve;
    });
    const workflow = loop({
      id: "app.tui-step-spinner",
      steps: [
        createRuntimeStep("slow-step", async () => {
          await slowStep;
          return done({ title: "Spinner" });
        }, {
          label: "Slow step",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 90,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    let frame = "";
    for (let index = 0; index < 60; index += 1) {
      await view.renderOnce();
      frame = view.captureCharFrame();
      if (["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"].some((glyph) => frame.includes(`${glyph} 01 Slow step`))) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    finishSlowStep();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    expect(frame).toContain("running");
    expect(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"].some((glyph) => frame.includes(`${glyph} 01 Slow step`))).toBe(true);
    expect(frame).toContain("STEP");
    expect(frame).toContain("TYPE");
    expect(frame).toContain("DETAILS");
    expect(frame).toContain("Steps");
    expect(frame).toContain("slow-step");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell shows live activity in the right sidebar while running", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    let finishSlowStep!: () => void;
    const slowStep = new Promise<void>((resolve) => {
      finishSlowStep = resolve;
    });
    const workflow = loop({
      id: "app.tui-right-activity-sidebar",
      steps: [
        createRuntimeStep("slow-step", async () => {
          await slowStep;
          return done({ title: "Sidebar activity" });
        }, {
          label: "Slow step",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 32,
      width: 180,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    let frame = "";
    for (let index = 0; index < 80; index += 1) {
      await view.renderOnce();
      frame = view.captureCharFrame().replaceAll("\u00a0", " ");
      if (frame.includes("LIVE ACTIVITY") && frame.includes("Slow step")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(frame).toContain("Workflow Run");
    expect(frame).toContain("Workflow Canvas");
    expect(frame).toContain("CONFIG");
    expect(frame).toContain("ACTIVITY");
    expect(frame).toContain("LIVE ACTIVITY");
    expect(frame).toContain("Slow step");

    view.mockInput.pressArrow("left");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("Workflow");
    expect(frame).toContain("Run");
    expect(frame).not.toContain("LIVE ACTIVITY");

    view.mockInput.pressArrow("right");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("LIVE ACTIVITY");

    finishSlowStep();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell shows the active routed model in the running step panel", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    let finishSlowStep!: () => void;
    const slowStep = new Promise<void>((resolve) => {
      finishSlowStep = resolve;
    });
    const workflow = loop({
      id: "app.tui-running-step-model",
      steps: [
        createRuntimeStep("clarify-intent", async (context) => {
          context.emit({
            detail: {
              requested: {
                tools: ["filesystem"],
                id: "planner.agent",
                label: "Planner agent",
                worker: "opencode",
              },
              selected: {
                tools: ["filesystem"],
                id: "planner.agent",
                label: "Planner agent",
                worker: "opencode",
              },
              target: {
                operation: "Clarify intent",
                stepId: "clarify-intent",
                workflowId: "planner",
              },
            },
            message: "Selected Planner agent for clarify-intent/Clarify intent.",
            stepId: "clarify-intent",
            trace: {
              attributes: {
                modelId: "planner.agent",
                operation: "Clarify intent",
                phase: "model",
                provider: "opencode",
                stepId: "clarify-intent",
              },
              kind: "internal",
              name: "Select model for Clarify intent",
              parentSpanId: "step:clarify-intent:attempt:1",
              spanId: "model-router:clarify-intent:Clarify intent",
              status: "ok",
              traceId: context.step.runId,
            },
            type: "model.worker.selected",
          });
          context.emit({
            detail: {
              model: "gpt-5.5",
              opencodeModel: "default",
              operation: "Clarify intent",
              provider: "openai",
              resolvedModel: "openai/gpt-5.5",
              worker: "opencode",
            },
            message: "Resolved Clarify intent to openai/gpt-5.5.",
            stepId: "clarify-intent",
            trace: {
              attributes: {
                model: "gpt-5.5",
                operation: "Clarify intent",
                phase: "model",
                provider: "openai",
                resolvedModel: "openai/gpt-5.5",
                stepId: "clarify-intent",
                worker: "opencode",
              },
              kind: "client",
              name: "Clarify intent",
              parentSpanId: "step:clarify-intent:attempt:1",
              spanId: "model:opencode:clarify-intent",
              status: "unset",
              traceId: context.step.runId,
            },
            type: "model.request.started",
          });
          await slowStep;
          return done({ title: "Model visible" });
        }, {
          label: "Clarify intent",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 32,
      width: 180,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    let frame = "";
    for (let index = 0; index < 80; index += 1) {
      await view.renderOnce();
      frame = view.captureCharFrame().replaceAll("\u00a0", " ");
      if (
        frame.includes("Clarify intent: Planner agent") &&
        frame.includes("model opencode default") &&
        frame.includes("model openai/gpt-5.5")
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(frame).toContain("Workflow Canvas");
    expect(frame).toContain("LIVE ACTIVITY");
    expect(frame).toContain("01 Clarify intent");
    expect(frame).toContain("Clarify intent: Planner agent");
    expect(frame).toContain("model opencode default");
    expect(frame).toContain("model openai/gpt-5.5");

    finishSlowStep();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell does not open the library while a workflow is running", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    let finishSlowStep!: () => void;
    const slowStep = new Promise<void>((resolve) => {
      finishSlowStep = resolve;
    });
    const workflow = loop({
      id: "app.tui-running-library-lock",
      steps: [
        createRuntimeStep("slow-step", async () => {
          await slowStep;
          return done({ title: "Locked" });
        }, {
          label: "Slow step",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    let frame = "";
    for (let index = 0; index < 60; index += 1) {
      await view.renderOnce();
      frame = view.captureCharFrame();
      if (frame.includes("running") && frame.includes("Slow step")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(frame).toContain("running");
    expect(frame).toContain("Slow step");

    view.mockInput.pressEscape();
    for (let index = 0; index < 30; index += 1) {
      await view.renderOnce();
      frame = view.captureCharFrame();
      if (frame.includes("Workflow running")) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(frame).toContain("Slow step");
    expect(frame).toContain("Workflow running");
    expect(frame).toContain("Finish or terminate");
    expect(frame).toContain("Run in progress");
    expect(frame).not.toContain("Filter workflows");

    finishSlowStep();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();
    view.mockInput.pressEscape();
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("Workflow Library");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell expands activity row details on double-click", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-activity-expand",
      steps: [
        createRuntimeStep("process-batch", (context) => {
          context.emit(workerItemEvent({
            input: {
              args: ["--full"],
              command: "describe-image",
              path: "raw/image-x.png",
              query: "fingerprint",
            },
            itemId: "image-x",
            itemKind: "tool_call",
            output: {
              file: "raw/image-x.png",
              result: `expanded-output-line-${"x".repeat(160)}`,
              stdout: "expanded stdout",
            },
            preview: "Processed raw/image-x.png",
            provider: "process-image-item",
            title: "Processed raw/image-x.png",
            type: "worker.item.completed",
          }));
          return done({ title: "Activity" });
        }, {
          label: "Process batch",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 42,
      width: 180,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();

    let lines = view.captureCharFrame().split("\n");
    const stepY = lines.findIndex((line) => line.includes("01 Process batch"));
    expect(stepY).toBeGreaterThan(0);
    await view.mockMouse.click(Math.max(0, lines[stepY]!.indexOf("01 Process batch") + 1), stepY);
    await view.renderOnce();

    let frame = view.captureCharFrame();
    expect(frame).toContain("Processed raw/image-x.png");
    expect(frame).toContain("provider: process-image-item");
    expect(frame).not.toContain("output.result: expanded-output-line");

    lines = frame.split("\n");
    const rowY = lines.findIndex((line) => line.includes("Processed raw/image-x.png"));
    expect(rowY).toBeGreaterThan(0);
    await view.mockMouse.doubleClick(Math.max(0, lines[rowY]!.indexOf("Processed raw/image-x.png") + 1), rowY);
    await view.renderOnce();

    frame = view.captureCharFrame();
    expect(frame).toContain("Activity inspector");
    expect(frame).toContain("expanded-output-line");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell opens a model conversation inspector from an activity row", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-model-conversation",
      steps: [
        createRuntimeStep("clarify-intent", (context) => {
          const trace = {
            attributes: { operation: "Clarify intent", provider: "opencode", stepId: "clarify-intent" },
            name: "Clarify intent",
            parentSpanId: `step:clarify-intent:attempt:${context.step.attempt}`,
            spanId: "model:opencode:clarify-intent",
            traceId: context.step.runId,
          };
          context.emit(workerItemEvent({
            input: { message: "create a todo app" },
            itemId: "model-step",
            itemKind: "model_step",
            operation: "Clarify intent",
            provider: "opencode",
            providerRefs: { messageId: "msg_1", sessionId: "ses_1" },
            raw: { type: "step_start" },
            rawType: "step_start",
            title: "Clarify intent started a model step",
            trace,
            type: "worker.item.started",
          }));
          context.emit(workerItemEvent({
            itemId: "assistant-message",
            itemKind: "assistant_message",
            operation: "Clarify intent",
            provider: "opencode",
            providerRefs: { messageId: "msg_1", partId: "part_2", sessionId: "ses_1" },
            text: "I will clarify the requested app shape.",
            title: "Clarify intent wrote output",
            trace,
            type: "worker.item.delta",
          }));
          context.emit({
            detail: { delta: "Which feature set should the first version include?", operation: "Clarify intent", provider: "opencode" },
            message: "Received Clarify intent delta.",
            trace,
            type: "model.response.delta",
          });
          context.emit({
            detail: { contentLength: 49, operation: "Clarify intent", provider: "opencode" },
            message: "Completed Clarify intent.",
            trace,
            type: "model.response.completed",
          });
          return done({ title: "Conversation" });
        }, {
          label: "Clarify intent",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 58,
      width: 190,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();

    let lines = view.captureCharFrame().split("\n");
    const stepY = lines.findIndex((line) => line.includes("01 Clarify intent"));
    expect(stepY).toBeGreaterThan(0);
    await view.mockMouse.click(Math.max(0, lines[stepY]!.indexOf("01 Clarify intent") + 1), stepY);
    await view.renderOnce();

    let frame = view.captureCharFrame();
    expect(frame).toContain("ACTIVITY");
    expect(frame).toContain("DETAILS");
    expect(frame).toContain("Clarify intent output");
    expect(frame).not.toContain("Runtime data");

    lines = frame.split("\n");
    const rowY = lines.findIndex((line) => line.includes("Clarify intent output"));
    expect(rowY).toBeGreaterThan(0);
    await view.mockMouse.doubleClick(Math.max(0, lines[rowY]!.indexOf("Clarify intent output") + 1), rowY);
    await view.renderOnce();

    frame = view.captureCharFrame();
    expect(frame).toContain("Activity inspector");
    expect(frame).toContain("Model conversation");
    expect(frame).toContain("provider opencode");
    expect(frame).toContain("sessionId: ses_1");
    expect(frame).toContain("spanId: model:opencode:clarify-intent");
    expect(frame).toContain("PROMPT");
    expect(frame).toContain("create a todo app");
    expect(frame).toContain("ASSISTANT STREAM");
    expect(frame).toContain("I will clarify the requested app shape.");
    expect(frame).toContain("FINAL OUTPUT");
    expect(frame).toContain("Which feature set should the first version include?");
    expect(frame).toContain("RAW EVENT");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell attaches pasted image paths to the submitted prompt", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const imageDirectory = await mkdtemp(path.join(tmpdir(), "dromio-paste-image-"));
    const imagePath = path.join(imageDirectory, "sample.png");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const workflow = loop({
      id: "app.tui-paste-image",
      steps: [
        createRuntimeStep("capture", (context) => done({ input: context.input })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          result: {
            format: (session) => String((session.state as Record<string, { input: string }>).capture.input),
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "describe this",
      onExit() {},
      runtime,
    }), {
      height: 34,
      width: 100,
    });

    await view.renderOnce();
    await view.mockInput.pasteBracketedText(imagePath);
    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("attached Image 1");

    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    const run = runtime.listRuns()[0];
    expect(run?.input).toContain("describe this");
    expect(run?.input).toContain("Attachments:");
    expect(run?.input).toContain("Image 1");
    expect(run?.input).toContain("Markdown: ![Image 1]");
    expect(run?.attachments?.[0]?.mediaType).toBe("image/png");
    expect(run?.attachments?.[0]?.name).toBe("sample.png");
    const savedPath = run?.attachments?.[0]?.path;
    expect(savedPath && existsSync(savedPath)).toBe(true);

    view.renderer.destroy();
    if (savedPath) await rm(savedPath, { force: true });
    await rm(imageDirectory, { force: true, recursive: true });
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell starts from the requested initial workflow", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-planner",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const reviewer = loop({
      id: "app.tui-reviewer",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Reviewer" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow: planner,
        },
        reviewer: {
          result: {
            format: (session) => `Review: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Reviewer",
          workflow: reviewer,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      initialWorkflowId: "reviewer",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 80,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    const run = runtime.listRuns()[0];
    expect(run?.workflowId).toBe("reviewer");
    expect(runtime.formatResult(run!.runId)).toBe("Review: Reviewer");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell renders workflow workspace state", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-workspace",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Workspace" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          configuration: {
            fields: [
              {
                env: "WIKIME_MODEL_BASE_URL",
                id: "modelBaseUrl",
                label: "Model base URL",
                source: "config",
                value: "http://127.0.0.1:1234/v1",
              },
              {
                env: "WIKIME_THUMBNAIL_MAX_SIZE",
                id: "thumbnailMaxSize",
                label: "Thumbnail max size",
                source: "env",
                value: 512,
              },
              {
                env: "WIKIME_OPTIONAL_MODEL",
                id: "optionalModel",
                label: "Optional model",
                source: "missing",
              },
            ],
          },
          title: "Planner",
          workflow,
          workspace: {
            frame: () => ({
              compiledGraph: workflow.graph(),
              cursor: 1,
              document: {},
              patches: [{
                createdAt: "2026-05-09T00:00:00.000Z",
                id: "patch-1",
                patch: {
                  op: "replace" as const,
                  path: "/trigger/label",
                  value: "Start here",
                },
                source: "human" as const,
                target: "document" as const,
              }],
              status: "valid" as const,
              validation: {
                issues: [],
                ok: true,
              },
              workspaceId: "workspace.planner",
            }),
          },
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 52,
      width: 140,
    });

    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).not.toContain("RUN SURFACE");
    expect(frame).not.toContain("answered in TUI");
    expect(frame).toContain("CONFIGURATION");
    expect(frame).toContain("Model base URL");
    expect(frame).toContain("WIKIME_MODEL_BASE");
    expect(frame).toContain("Optional model");
    expect(frame).toContain("not set");
    expect(frame).toContain("optional");
    expect(frame).not.toContain("<missing>");
    expect(frame).toContain("WORKSPACE");
    expect(frame).toContain("valid");
    expect(frame).toContain("patches");
    expect(frame).toContain("3 nodes");
    expect(frame).toContain("replace");

    const lines = frame.split("\n");
    const configurationY = lines.findIndex((line) => line.includes("CONFIGURATION"));
    expect(configurationY).toBeGreaterThan(0);
    const configurationX = Math.max(0, lines[configurationY]!.indexOf("CONFIGURATION") + 1);
    await view.mockMouse.click(configurationX, configurationY);
    await view.renderOnce();

    let popupFrame = view.captureCharFrame();
    expect(popupFrame).toContain("Workflow metadata");
    expect(popupFrame).toContain("enter open");
    expect(popupFrame).toContain("esc close");
    expect(popupFrame).toContain("Model base URL");
    expect(popupFrame).toContain("WORKSPACE");

    view.mockInput.pressEscape();
    await settleEscapeKey();
    await view.renderOnce();
    popupFrame = view.captureCharFrame();
    expect(popupFrame).not.toContain("Workflow metadata");
    expect(popupFrame).toContain("CONFIGURATION");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell dedupes identical input and HTTP body examples", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const inputSchema = {
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      type: "object",
    };
    const graph = {
      edges: [],
      end: {
        boundary: "end" as const,
        description: "Planner terminal state.",
        id: "review-plan",
        label: "Review plan",
      },
      id: "app.tui-dedupe-trigger-example",
      label: "Planner",
      nodes: [
        {
          id: "clarify-intent",
          kind: "step",
          label: "Clarify intent",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits the rough prompt.",
        id: "request",
        input: [{
          contractId: "planner.request.input",
          jsonSchema: { type: "string" },
          key: "prompt",
        }],
        label: "Start prompt",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-dedupe-trigger-example",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_dedupe_trigger_example",
        status: "completed",
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const controlPlane = {
      listTriggers: async () => [{
        auth: { mode: "bearer" },
        config: {
          method: "POST",
          path: "/api/triggers/planner.request",
        },
        enabled: true,
        id: "planner.request",
        input: {
          contentType: "application/json",
          jsonSchema: inputSchema,
          mode: "body",
        },
        label: "Planner request",
        type: "http",
        workflowId: "planner",
      }],
      listTriggerJobs: async () => [],
    } as any;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      controlPlane,
      onExit() {},
      runtime,
    }), {
      height: 40,
      width: 140,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    await waitFor(() => view.captureCharFrame().includes("planner.request"));
    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("INPUT EXAMPLE");
    expect(frame).toContain("\"prompt\": \"\"");
    expect(frame).toContain("PUBLISHED TRIGGER");
    expect(frame).toContain("planner.request");
    expect(frame).not.toContain("HTTP BODY EXAMPLE");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell opens slash commands for input mode changes", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const inputSchema = {
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
      type: "object",
    };
    const graph = {
      edges: [],
      end: {
        boundary: "end" as const,
        description: "Planner terminal state.",
        id: "review-plan",
        label: "Review plan",
      },
      id: "app.tui-slash-commands",
      label: "Planner",
      nodes: [
        {
          id: "clarify-intent",
          kind: "step",
          label: "Clarify intent",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits the rough prompt.",
        id: "request",
        input: [{
          contractId: "planner.request.input",
          jsonSchema: { type: "string" },
          key: "prompt",
        }],
        label: "Start prompt",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-slash-commands",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_slash_commands",
        status: "completed",
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          input: {
            kind: "prompt",
            placeholder: "What should we plan?",
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const controlPlane = {
      listTriggers: async () => [{
        auth: { mode: "bearer" },
        config: {
          method: "POST",
          path: "/api/triggers/planner.request",
        },
        enabled: true,
        id: "planner.request",
        input: {
          contentType: "application/json",
          jsonSchema: inputSchema,
          mode: "body",
        },
        label: "Planner request",
        type: "http",
        workflowId: "planner",
      }],
      listTriggerJobs: async () => [],
    } as any;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      controlPlane,
      onExit() {},
      runtime,
    }), {
      height: 40,
      width: 120,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => view.captureCharFrame().includes("planner.request"));
    view.mockInput.pressKey("/");
    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("Commands");
    expect(frame).toContain("/render");
    expect(frame).toContain("/raw");
    expect(frame).toContain("Search");

    view.mockInput.pressArrow("down");
    view.mockInput.pressEnter();
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("Planner input · raw");
    expect(frame).toContain("tab pane");
    expect(frame).toContain("ctrl+p commands");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell opens current workflow sessions from slash command", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const graph = {
      edges: [],
      id: "app.tui-sessions",
      label: "Planner",
      nodes: [
        {
          id: "clarify-intent",
          kind: "step" as const,
          label: "Clarify intent",
          maxRetries: 0,
        },
      ],
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-sessions",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_live_session",
        status: "completed",
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const previousRuns = Array.from({ length: 32 }, (_, index) => ({
      artifacts: [],
      events: [{
        message: `Previous run ${index} completed.`,
        runId: `run_previous_session_${String(index).padStart(2, "0")}`,
        timestamp: `2026-05-10T12:${String(34 - Math.min(index, 30)).padStart(2, "0")}:00.000Z`,
        type: "run.completed",
      } as EventRecord],
      input: `create a todo app ${String(index).padStart(2, "0")}`,
      pendingQuestions: [],
      result: `previous result ${String(index).padStart(2, "0")}`,
      runId: `run_previous_session_${String(index).padStart(2, "0")}`,
      state: { title: "Previous" },
      status: "completed",
      workflowId: "planner",
    }));
    let seenFilter: unknown;
    const controlPlane = {
      listRuns: async (filter: unknown) => {
        seenFilter = filter;
        return previousRuns;
      },
      listTriggerJobs: async () => [],
      listTriggers: async () => [],
    } as any;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      controlPlane,
      onExit() {},
      runtime,
    }), {
      height: 32,
      width: 120,
    });

    await view.renderOnce();
    view.mockInput.pressKey("/");
    for (const char of "session") view.mockInput.pressKey(char);
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("/session");
    view.mockInput.pressEnter();
    await waitFor(() => view.captureCharFrame().includes("run_previous_session"));
    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(seenFilter).toEqual({ workflowId: "planner" });
    expect(frame).toContain("Sessions · Planner");
    expect(frame).toContain("create a todo app 00");
    expect(frame).toContain("1-16 of 32");

    for (let index = 0; index < 5; index += 1) {
      await view.mockMouse.scroll(60, 20, "down");
      await view.renderOnce();
    }
    frame = view.captureCharFrame();
    expect(frame).toContain("create a todo app 15");
    expect(frame).toContain("16-31 of 32");

    view.mockInput.pressEnter();
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("Workflow Run");
    expect(frame).toContain("run_previo");
    expect(frame).toContain("previous result 15");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell keeps a default prompt focused when only one workflow exists", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-start-single-workflow",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 30,
      width: 180,
    });

    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("enter run");
    expect(frame).toContain("tab pane");
    expect(frame).toMatch(/> +\[start\] Trigger/);

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toMatch(/> +\[start\] Trigger/);
    expect(frame).not.toMatch(/> +01 Finish/);

    view.mockInput.pressTab();
    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("Start Workflow");
    expect(frame).toContain("Planner");
    expect(frame).toMatch(/> +01 Finish/);
    expect(frame).not.toContain("Workflow selection");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell switches the start center between canvas and activity tabs", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-start-center-tabs",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 30,
      width: 180,
    });

    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("Canvas");
    expect(frame).toContain("Activity");
    expect(frame).toContain("Workflow Canvas");
    expect(frame).not.toContain("No workflow activity yet.");

    const lines = frame.split("\n");
    const activityY = lines.findIndex((line) => line.includes("Activity"));
    expect(activityY).toBeGreaterThan(0);
    const activityX = Math.max(0, lines[activityY]!.indexOf("Activity") + 1);
    await view.mockMouse.click(activityX, activityY);
    await view.renderOnce();

    frame = view.captureCharFrame();
    expect(frame).toContain("Activity");
    expect(frame).toContain("No workflow activity yet.");
    expect(frame).not.toContain("Workflow Canvas");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell selects start-page steps without cycling workflows", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-start-arrows-planner",
      steps: [
        createRuntimeStep("planner-finish", () => done({ title: "Planner" }), {
          label: "Planner Step",
        }),
      ],
    });
    const reviewer = loop({
      id: "app.tui-start-arrows-reviewer",
      steps: [
        createRuntimeStep("reviewer-finish", () => done({ title: "Reviewer" }), {
          label: "Reviewer Step",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          result: { artifactName: "plan" },
          title: "Planner",
          workflow: planner,
        },
        reviewer: {
          result: { artifactName: "review" },
          title: "Reviewer",
          workflow: reviewer,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 28,
      width: 100,
    });

    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("Planner");
    expect(frame).toContain("Planner Step");
    expect(frame).toMatch(/> +\[start\] Trigger/);
    expect(frame).not.toContain("Reviewer Step");

    view.mockInput.pressTab();
    await view.renderOnce();

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("Planner");
    expect(frame).toMatch(/> +01 Planner Step/);

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("Planner");
    expect(frame).toContain("Planner Step");
    expect(frame).toMatch(/> +\[end\] End/);
    expect(frame).not.toContain("Reviewer Step");

    view.mockInput.pressTab();
    view.mockInput.pressTab();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    expect(runtime.listRuns()[0]?.workflowId).toBe("planner");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell recalls prompt history with start-page arrow keys", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-start-prompt-history",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "first prompt",
      onExit() {},
      runtime,
    }), {
      height: 30,
      width: 140,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();
    view.mockInput.pressEscape();
    await settleEscapeKey();
    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();

    let frame = view.captureCharFrame();
    expect(frame).toContain("Start Workflow");
    expect(frame).not.toContain("> first prompt");

    view.mockInput.pressArrow("up");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("> first prompt");
    expect(frame).toMatch(/> +\[start\] Trigger/);

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).not.toContain("> first prompt");
    expect(frame).toMatch(/> +\[start\] Trigger/);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell opens design step detail from the start page", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-click-start-step",
      steps: [
        createRuntimeStep("draft-plan", () => done({ draft: true }), {
          description: "Create the first version.",
          label: "Draft Plan",
        }),
        createRuntimeStep("score-plan", () => done({ score: 1 }), {
          description: "Evaluate the draft before running.",
          label: "Score Plan",
          models: [{
            label: "Evaluate draft",
            operation: "evaluate",
            prompt: {
              kind: "file",
              path: path.join(process.cwd(), "catalog/planning/draft-plan/evaluate.md"),
            },
          }],
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 34,
      width: 100,
    });

    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).not.toContain("TRIGGER BOUNDARY");
    const lines = frame.split("\n");
    const stepY = lines.findIndex((line) => line.includes("02 Score Plan"));
    expect(stepY).toBeGreaterThan(0);
    const stepX = Math.max(0, lines[stepY]!.indexOf("02 Score Plan") + 1);
    await view.mockMouse.click(stepX, stepY);
    await view.renderOnce();

    let detail = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(detail).toContain("Step Detail");
    expect(detail).toContain("02 Score Plan");
    expect(detail).toContain("score-plan");
    await clickStepDetailTab(view, "DETAILS");
    detail = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(detail).toContain("Step Detail");
    expect(detail).toContain("score-plan");
    expect(detail).toContain("Evaluate");
    expect(detail).toContain("draft");
    expect(detail).toContain("Prompts");
    expect(detail).toContain("evaluate.md");
    expect(detail).not.toContain("02eScore");
    expect(detail).not.toContain("ScoreiPlan");
    expect(runtime.listRuns()).toHaveLength(0);

    view.mockInput.pressEscape();
    await settleEscapeKey();
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Start Workflow");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell opens prompt files in a compact scroll viewer", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    const tmp = await mkdtemp(path.join(tmpdir(), "dromio-prompt-viewer-"));
    const promptPath = path.join(tmp, "viewer-prompt.md");
    await writeFile(promptPath, Array.from({ length: 40 }, (_, index) =>
      `viewer line ${String(index + 1).padStart(2, "0")}`
    ).join("\n"));
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-prompt-file-viewer",
      steps: [
        createRuntimeStep("inspect-prompt", () => done({ ok: true }), {
          label: "Inspect Prompt",
          models: [{
            label: "Inspect prompt",
            operation: "inspect",
            prompt: {
              kind: "file",
              path: promptPath,
            },
          }],
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 34,
      width: 110,
    });

    try {
      await view.renderOnce();
      view.mockInput.pressEnter();
      await view.renderOnce();
      view.mockInput.pressArrow("down");
      await view.renderOnce();
      let frame = view.captureCharFrame();
      let lines = frame.split("\n");
      const promptY = lines.findIndex((line) => line.includes("viewer-prompt.md"));
      expect(promptY).toBeGreaterThan(0);
      const promptX = Math.max(0, lines[promptY]!.indexOf("viewer-prompt.md") + 1);
      await view.mockMouse.click(promptX, promptY);
      await view.mockMouse.click(promptX, promptY);
      await view.renderOnce();

      frame = view.captureCharFrame();
      lines = frame.split("\n");
      expect(frame).toContain("File viewer");
      expect(frame).toContain("viewer line 01");
      expect(frame).toContain("viewer line 18");
      expect(frame).toContain("1-18 of 40");
      const lastVisibleLineY = lines.findIndex((line) => line.includes("viewer line 18"));
      const footerY = lines.findIndex((line) => line.includes("1-18 of 40"));
      expect(lastVisibleLineY).toBeGreaterThan(0);
      expect(footerY).toBeGreaterThan(lastVisibleLineY);
      expect(footerY - lastVisibleLineY).toBeLessThanOrEqual(3);
      expect(frame).toContain("█");

      await view.mockMouse.scroll(promptX, lastVisibleLineY, "down");
      await view.renderOnce();

      frame = view.captureCharFrame();
      expect(frame).toContain("viewer line 07");
      expect(frame).toContain("viewer line 24");
      expect(frame).toContain("7-24 of 40");
      expect(frame).not.toContain("viewer line 01");

      for (let index = 0; index < 4; index += 1) view.mockInput.pressArrow("down");
      await view.renderOnce();

      frame = view.captureCharFrame();
      expect(frame).toContain("viewer line 11");
      expect(frame).toContain("11-28 of 40");

      view.renderer.destroy();
    } finally {
      await rm(tmp, { force: true, recursive: true });
      if (previousDebug === undefined) {
        delete process.env.DEBUG;
      } else {
        process.env.DEBUG = previousDebug;
      }
    }
  });

  test("workflow TUI shell clears typed input on Ctrl+C before exiting", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-ctrl-c-clear",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    let exitCount = 0;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {
        exitCount += 1;
      },
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("> ship");

    view.mockInput.pressCtrlC();
    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("Start Workflow");
    expect(frame).not.toContain("> ship");
    expect(exitCount).toBe(0);

    for (const char of "draft") view.mockInput.pressKey(char);
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("> draft");

    view.mockInput.pressCtrlC();
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("Start Workflow");
    expect(frame).not.toContain("> draft");
    expect(exitCount).toBe(0);

    view.mockInput.pressCtrlC();
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Workflow Library");
    expect(exitCount).toBe(0);

    view.mockInput.pressCtrlC();
    expect(exitCount).toBe(1);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell tabs between start-page steps and input fields", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const graph = {
      edges: [],
      end: {
        boundary: "end" as const,
        description: "Planner terminal state.",
        id: "review-plan",
        label: "Review plan",
      },
      id: "app.tui-start-pane-switching",
      label: "Planner",
      nodes: [
        {
          id: "draft-plan",
          kind: "step",
          label: "Draft plan",
          maxRetries: 0,
        },
        {
          id: "score-plan",
          kind: "step",
          label: "Score plan",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits a planning request.",
        id: "request",
        input: [
          {
            contractId: "planner.request.goal",
            jsonSchema: { type: "string" },
            key: "goal",
          },
          {
            contractId: "planner.request.tone",
            jsonSchema: { type: "string" },
            key: "tone",
          },
        ],
        label: "Planner request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-start-pane-switching",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_start_pane_switching",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          input: {
            kind: "prompt",
            placeholder: "Describe the plan.",
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const controlPlane = {
      listTriggers: async () => [{
        auth: { mode: "bearer" },
        config: {
          method: "POST",
          path: "/api/triggers/planner.request",
        },
        enabled: true,
        id: "planner.request",
        input: {
          contentType: "application/json",
          jsonRender: {
            fields: [
              { label: "Goal", name: "goal", type: "text" },
              { label: "Tone", name: "tone", type: "text" },
            ],
          },
          jsonSchema: {
            properties: {
              goal: { type: "string" },
              tone: { type: "string" },
            },
            type: "object",
          },
          mode: "body",
        },
        label: "Planner request",
        type: "http",
        workflowId: "planner",
      }],
      listTriggerJobs: async () => [],
    } as any;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      controlPlane,
      onExit() {},
      runtime,
    }), {
      height: 32,
      width: 130,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(spanForegroundForExactText(view.captureSpans(), "Steps")).toEqual([192, 132, 252, 255]);

    view.mockInput.pressTab({ shift: true });
    for (const char of "build") view.mockInput.pressKey(char);
    view.mockInput.pressArrow("down");
    for (const char of "crisp") view.mockInput.pressKey(char);
    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("build");
    expect(frame).toContain("crisp");
    expect(frame).toMatch(/> +\[start\] Planner request/);
    expect(spanForegroundForExactText(view.captureSpans(), "Steps")).toEqual([154, 164, 186, 255]);

    view.mockInput.pressTab();
    await view.renderOnce();
    expect(spanForegroundForExactText(view.captureSpans(), "Steps")).toEqual([192, 132, 252, 255]);

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toMatch(/> +01 Draft plan/);

    view.mockInput.pressKey("x");
    await view.renderOnce();
    expect(view.captureCharFrame()).not.toContain("crispx");

    view.mockInput.pressTab({ shift: true });
    view.mockInput.pressArrow("up");
    view.mockInput.pressKey("!");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(spanForegroundForExactText(view.captureSpans(), "Steps")).toEqual([154, 164, 186, 255]);
    expect(frame).toContain("build!");
    expect(frame).toContain("crisp");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell focuses the start-page canvas and opens selected node detail", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const graph = {
      edges: [
        { from: "request", id: "request-to-draft-plan", kind: "sequence" as const, to: "draft-plan" },
        { from: "draft-plan", id: "draft-plan-to-score-plan", kind: "sequence" as const, to: "score-plan" },
        { from: "score-plan", id: "score-plan-to-review-plan", kind: "sequence" as const, to: "review-plan" },
      ],
      end: {
        boundary: "end" as const,
        description: "Planner terminal state.",
        id: "review-plan",
        label: "Review plan",
      },
      id: "app.tui-start-canvas-focus",
      label: "Planner",
      nodes: [
        {
          description: "Create the first version.",
          id: "draft-plan",
          kind: "step",
          label: "Draft plan",
          maxRetries: 0,
        },
        {
          description: "Evaluate the draft.",
          id: "score-plan",
          kind: "step",
          label: "Score plan",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits a planning request.",
        id: "request",
        label: "Planner request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-start-canvas-focus",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_start_canvas_focus",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 42,
      width: 220,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    view.mockInput.pressTab();
    await view.renderOnce();
    let frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("canvas focus");
    expect(frame).toMatch(/> +\[start\] Planner request/);

    view.mockInput.pressTab({ shift: true });
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).not.toContain("canvas focus");
    expect(spanForegroundForExactText(view.captureSpans(), "Steps")).toEqual([192, 132, 252, 255]);

    view.mockInput.pressTab({ shift: true });
    await view.renderOnce();
    expect(spanForegroundForExactText(view.captureSpans(), "Steps")).toEqual([154, 164, 186, 255]);

    view.mockInput.pressTab();
    view.mockInput.pressTab();
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("canvas focus");

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toMatch(/> +01 Draft plan/);

    view.mockInput.pressArrow("right");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("No workflow activity yet.");
    expect(frame).not.toContain("canvas focus");

    view.mockInput.pressArrow("left");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("canvas focus");
    expect(frame).toMatch(/> +01 Draft plan/);

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toMatch(/> +02 Score plan/);

    view.mockInput.pressKey("x");
    await view.renderOnce();
    expect(view.captureCharFrame()).not.toContain("> x");

    view.mockInput.pressEnter();
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("Step Detail");
    expect(frame).toContain("02 Score plan");
    expect(frame).toContain("score-plan");
    expect(runtime.listRuns()).toHaveLength(0);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell selects start canvas nodes with the mouse", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const graph = {
      edges: [
        { from: "request", id: "request-to-draft-plan", kind: "sequence" as const, to: "draft-plan" },
        { from: "draft-plan", id: "draft-plan-to-score-plan", kind: "sequence" as const, to: "score-plan" },
        { from: "score-plan", id: "score-plan-to-review-plan", kind: "sequence" as const, to: "review-plan" },
      ],
      end: {
        boundary: "end" as const,
        description: "Planner terminal state.",
        id: "review-plan",
        label: "Review plan",
      },
      id: "app.tui-start-canvas-mouse",
      label: "Planner",
      nodes: [
        {
          description: "Create the first version.",
          id: "draft-plan",
          kind: "step",
          label: "Draft plan",
          maxRetries: 0,
        },
        {
          description: "Evaluate the draft.",
          id: "score-plan",
          kind: "step",
          label: "Score plan",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits a planning request.",
        id: "request",
        label: "Planner request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-start-canvas-mouse",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_start_canvas_mouse",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 42,
      width: 220,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();

    const beforeClickFrame = view.captureCharFrame().replaceAll("\u00a0", " ");
    const beforeClickLines = beforeClickFrame.split("\n");
    const targetY = beforeClickLines.findIndex((line) => {
      const column = line.indexOf("Draft plan");
      return column > 45 && column < 180;
    });
    expect(targetY).toBeGreaterThan(-1);
    const targetX = beforeClickLines[targetY]!.indexOf("Draft plan") + 2;

    await view.mockMouse.click(targetX, targetY);
    await view.renderOnce();

    const afterClickFrame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(afterClickFrame).toContain("canvas focus");
    expect(afterClickFrame).toMatch(/> +01 Draft plan/);
    expect(afterClickFrame).not.toContain("Step Detail");
    expect(runtime.listRuns()).toHaveLength(0);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell expands nested start steps and selects the inner canvas node", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const graph = {
      edges: [
        { from: "request", id: "request-to-resolve-config", kind: "sequence" as const, to: "resolve-config" },
        { from: "resolve-config", id: "resolve-config-to-process-batch", kind: "sequence" as const, to: "process-batch" },
        { from: "process-batch", id: "process-batch-to-audio-processed", kind: "sequence" as const, to: "audio-processed" },
      ],
      end: {
        boundary: "end" as const,
        description: "Audio terminal state.",
        id: "audio-processed",
        label: "Audio processed",
      },
      id: "app.tui-start-nested-steps",
      label: "Audio",
      nodes: [
        {
          id: "resolve-config",
          kind: "step",
          label: "Resolve config",
          maxRetries: 0,
        },
        {
          catalog: {
            execution: {
              childWorkflowDocumentId: "process-audio-item",
              itemLabelPath: "path",
              itemSource: "audioFiles",
              kind: "forEach",
              label: "for each audio file",
            },
            id: "audio.process-batch",
            label: "Process audio batch",
          },
          childNodes: [
            { catalogItemId: "audio.fingerprint", id: "fingerprint-audio", kind: "adapter", label: "Fingerprint audio" },
            { catalogItemId: "audio.check-catalog", id: "check-catalog", kind: "adapter", label: "Check catalog" },
          ],
          id: "process-batch",
          kind: "step",
          label: "Process batch",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits the audio processing request.",
        id: "request",
        label: "Process audio request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-start-nested-steps",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_start_nested_steps",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "audio",
      title: "App",
      workflows: {
        audio: {
          title: "Process Audio",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 54,
      width: 220,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("right");
    view.mockInput.pressArrow("down");
    await view.renderOnce();

    const frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toMatch(/> +└ 02\.01 Fingerprint audio/);
    const projection = projectWorkflowGraphDiagram({
      graph,
      selectedStepId: "process-batch::fingerprint-audio",
    });
    const childNodeId = projection.nodeIdByStepId["process-batch::fingerprint-audio"];
    expect(childNodeId).toBeTruthy();
    expect(projection.nodeBgColors[childNodeId!]).toBe("#24243a");

    view.mockInput.pressArrow("left");
    await view.renderOnce();
    expect(view.captureCharFrame().replaceAll("\u00a0", " ")).toMatch(/> +▾ 02 Process batch/);

    view.mockInput.pressArrow("left");
    await view.renderOnce();
    expect(view.captureCharFrame().replaceAll("\u00a0", " ")).toMatch(/> +▸ 02 Process batch/);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell keeps workflow tree navigation active on step detail", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const graph = {
      edges: [
        { from: "request", id: "request-to-resolve-config", kind: "sequence" as const, to: "resolve-config" },
        { from: "resolve-config", id: "resolve-config-to-process-batch", kind: "sequence" as const, to: "process-batch" },
        { from: "process-batch", id: "process-batch-to-images-processed", kind: "sequence" as const, to: "images-processed" },
      ],
      end: {
        boundary: "end" as const,
        description: "Images terminal state.",
        id: "images-processed",
        label: "Images processed",
      },
      id: "app.tui-step-detail-tree-nav",
      label: "Images",
      nodes: [
        {
          id: "resolve-config",
          kind: "step",
          label: "Resolve config",
          maxRetries: 0,
        },
        {
          catalog: {
            execution: {
              childWorkflowDocumentId: "process-image-item",
              itemLabelPath: "path",
              itemSource: "images",
              kind: "forEach",
              label: "for each image",
            },
            id: "images.process-batch",
            label: "Process image batch",
          },
          childNodes: [
            { catalogItemId: "images.fingerprint", id: "fingerprint-image", kind: "adapter", label: "Fingerprint image" },
            { catalogItemId: "images.check-catalog", id: "check-catalog", kind: "adapter", label: "Check catalog" },
          ],
          id: "process-batch",
          kind: "step",
          label: "Process batch",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits the image processing request.",
        id: "request",
        label: "Process images request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-step-detail-tree-nav",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_step_detail_tree_nav",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "images",
      title: "App",
      workflows: {
        images: {
          title: "Process Images",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 48,
      width: 150,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("right");
    view.mockInput.pressArrow("down");
    view.mockInput.pressEnter();
    await view.renderOnce();

    let frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("Step Detail");
    expect(frame).toContain("01 fingerprint");
    expect(frame).toContain("fingerprint-image");

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("02 check-catalog");
    expect(frame).toContain("check-catalog");

    view.mockInput.pressArrow("left");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("02 Process batch");
    expect(frame).toContain("process-batch");

    view.mockInput.pressArrow("left");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toMatch(/▸ 02 Process batch/);

    view.mockInput.pressArrow("right");
    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(frame).toContain("01 fingerprint");
    expect(frame).toContain("fingerprint-image");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell scrolls the canvas to the selected nested start step", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const childNodes = [
      "Fingerprint audio",
      "Check catalog",
      "Read metadata",
      "Extract speech",
      "Normalize transcript",
      "Detect chapters",
      "Build chunks",
      "Score quality",
      "Write embedding",
      "Write search row",
      "Prepare item summary",
      "Archive item",
    ].map((label, index) => ({
      catalogItemId: `audio.child-${index + 1}`,
      id: `child-${index + 1}`,
      kind: "adapter" as const,
      label,
    }));
    const graph = {
      edges: [
        { from: "request", id: "request-to-resolve-config", kind: "sequence" as const, to: "resolve-config" },
        { from: "resolve-config", id: "resolve-config-to-process-batch", kind: "sequence" as const, to: "process-batch" },
        { from: "process-batch", id: "process-batch-to-audio-processed", kind: "sequence" as const, to: "audio-processed" },
      ],
      end: {
        boundary: "end" as const,
        description: "Audio terminal state.",
        id: "audio-processed",
        label: "Audio processed",
      },
      id: "app.tui-start-canvas-scroll",
      label: "Audio",
      nodes: [
        {
          id: "resolve-config",
          kind: "step",
          label: "Resolve config",
          maxRetries: 0,
        },
        {
          catalog: {
            execution: {
              childWorkflowDocumentId: "process-audio-item",
              itemSource: "audioFiles",
              kind: "forEach",
              label: "for each audio file",
            },
            id: "audio.process-batch",
            label: "Process audio batch",
          },
          childNodes,
          id: "process-batch",
          kind: "step",
          label: "Process batch",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits the audio processing request.",
        id: "request",
        label: "Process audio request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-start-canvas-scroll",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_start_canvas_scroll",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "audio",
      title: "App",
      workflows: {
        audio: {
          title: "Process Audio",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 34,
      width: 220,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("right");
    for (let index = 0; index < childNodes.length; index += 1) view.mockInput.pressArrow("down");
    await view.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await view.renderOnce();

    const frame = view.captureCharFrame().replaceAll("\u00a0", " ");
    const frameLines = frame.split("\n");
    const archiveLineIndex = frameLines.findIndex((line) => line.includes("12 Archive item"));
    const canvasTitleLineIndex = frameLines.findIndex((line) => line.includes("Workflow Canvas"));
    const inputPanelLineIndex = frameLines.findIndex((line, index) =>
      index > canvasTitleLineIndex && (line.includes("input fields") || line.includes("What do you want"))
    );
    const canvasBottomLineIndex = inputPanelLineIndex > canvasTitleLineIndex ? inputPanelLineIndex : frameLines.length - 3;
    const canvasMiddleLineIndex = Math.floor((canvasTitleLineIndex + canvasBottomLineIndex) / 2);
    expect(frame).toMatch(/12 Archive item/);
    expect(frameLines.some((line) => line.indexOf("12 Archive item") > 45)).toBe(true);
    expect(Math.abs(archiveLineIndex - canvasMiddleLineIndex)).toBeLessThanOrEqual(5);
    expect(frameLines.some((line) => line.indexOf("start Process audio request") > 45)).toBe(false);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell backs out of step detail on Ctrl+C instead of exiting", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-ctrl-c-step-detail",
      steps: [
        createRuntimeStep("draft-plan", () => done({ draft: true }), {
          description: "Create the first version.",
          label: "Draft Plan",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    let exitCount = 0;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {
        exitCount += 1;
      },
      runtime,
    }), {
      height: 48,
      width: 140,
    });

    await view.renderOnce();
    view.mockInput.pressTab();
    await view.renderOnce();
    view.mockInput.pressArrow("down");
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Step Detail");
    expect(view.captureCharFrame()).toContain("draft-plan");

    view.mockInput.pressCtrlC();
    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("Start Workflow");
    expect(frame).not.toContain("Step Detail");
    expect(exitCount).toBe(0);
    expect(runtime.listRuns()).toHaveLength(0);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell opens step detail from a clicked step", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-click-step",
      steps: [
        createRuntimeStep("draft-plan", () => done({ draft: true }), {
          description: "Create the first version.",
          label: "Draft Plan",
        }),
        createRuntimeStep("score-plan", () => done({ score: 1 }), {
          description: "Evaluate the draft against the rubric.",
          label: "Score Plan",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 48,
      width: 140,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();

    const frame = view.captureCharFrame();
    const lines = frame.split("\n");
    const endY = lines.findIndex((line) => line.includes("[end] End"));
    expect(endY).toBeGreaterThan(0);
    const endX = Math.max(0, lines[endY]!.indexOf("[end] End") + 1);
    await view.mockMouse.click(endX, endY);
    await view.renderOnce();

    const endDetail = view.captureCharFrame();
    expect(endDetail).toContain("Step Detail");
    expect(endDetail).toContain("[end] End");
    expect(endDetail).toContain("Activity");
    expect(endDetail).toContain("draft-plan");
    expect(endDetail).toContain("score-plan");
    expect(endDetail).not.toContain("No events for this step yet.");

    const endDetailLines = endDetail.split("\n");
    const stepY = endDetailLines.findIndex((line) => line.includes("02 Score Plan"));
    expect(stepY).toBeGreaterThan(0);
    const stepX = Math.max(0, endDetailLines[stepY]!.indexOf("02 Score Plan") + 1);
    await view.mockMouse.click(stepX, stepY);
    await view.renderOnce();

    const detail = view.captureCharFrame();
    expect(detail).toContain("Step Detail");
    expect(detail).toContain("score-plan");
    await clickStepDetailTab(view, "DETAILS");
    const detailWithMetadata = view.captureCharFrame();
    expect(detailWithMetadata).toContain("Step Detail");
    expect(detailWithMetadata).toContain("score-plan");
    expect(detailWithMetadata).toContain("Evaluate");
    expect(detailWithMetadata).toContain("draft");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell gives nested step rail labels the available width", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const graph = {
      edges: [],
      end: {
        boundary: "end" as const,
        description: "Workflow terminal state.",
        id: "end",
        label: "Images processed",
      },
      id: "app.tui-nested-step-rail",
      label: "Nested Step Rail",
      nodes: [
        {
          id: "resolve-config",
          kind: "step",
          label: "Resolve config",
          maxRetries: 0,
        },
        {
          id: "discover-images",
          kind: "step",
          label: "Discover images",
          maxRetries: 0,
        },
        {
          catalog: {
            execution: {
              childWorkflowDocumentId: "process-image-item",
              itemLabelPath: "relativePath",
              itemSource: "images",
              kind: "forEach",
              label: "for each image",
            },
            id: "images.process-image-batch",
            label: "Process image batch",
          },
          childNodes: [
            { catalogItemId: "images.fingerprint", id: "fingerprint-image", kind: "adapter", label: "Fingerprint" },
            { catalogItemId: "images.check-catalog", id: "check-catalog", kind: "adapter", label: "Check catalog" },
            { catalogItemId: "images.read-metadata", id: "read-metadata", kind: "adapter", label: "Read metadata", loop: { backToNodeId: "read-metadata", endNodeId: "describe-image", id: "image-content-loop", role: "start" as const, startNodeId: "read-metadata" } },
            { catalogItemId: "images.extract-exif", id: "extract-exif", kind: "adapter", label: "Extract EXIF", loop: { backToNodeId: "read-metadata", endNodeId: "describe-image", id: "image-content-loop", role: "body" as const, startNodeId: "read-metadata" } },
            { catalogItemId: "images.generate-thumbnail", id: "generate-thumbnail", kind: "adapter", label: "Generate thumbnail", loop: { backToNodeId: "read-metadata", endNodeId: "describe-image", id: "image-content-loop", role: "body" as const, startNodeId: "read-metadata" } },
            { catalogItemId: "images.extract-ocr", id: "extract-ocr", kind: "adapter", label: "Extract OCR", loop: { backToNodeId: "read-metadata", endNodeId: "describe-image", id: "image-content-loop", role: "body" as const, startNodeId: "read-metadata" } },
            { catalogItemId: "images.describe-image", id: "describe-image", kind: "adapter", label: "Describe image", loop: { backToNodeId: "read-metadata", endNodeId: "describe-image", id: "image-content-loop", role: "end" as const, startNodeId: "read-metadata" } },
            { catalogItemId: "images.build-search-document", id: "build-search-document", kind: "adapter", label: "Build search document" },
            { catalogItemId: "images.write-embedding", id: "write-embedding", kind: "adapter", label: "Write embedding" },
          ],
          id: "process-image-batch",
          kind: "step",
          label: "Process batch",
          maxRetries: 0,
        },
        {
          id: "prepare-summary",
          kind: "step",
          label: "Prepare summary",
          maxRetries: 0,
        },
        {
          id: "summarize-run",
          kind: "step",
          label: "Summarize run",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits the image processing request.",
        id: "request",
        label: "Process images request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-nested-step-rail",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_nested_step_rail",
        status: "completed",
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "images",
      title: "App",
      workflows: {
        images: {
          title: "Process Images",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: " ",
      onExit() {},
      runtime,
    }), {
      height: 36,
      width: 140,
    });

    await view.renderOnce();
    const startFrame = view.captureCharFrame();
    const lines = startFrame.split("\n");
    const stepY = lines.findIndex((line) => line.includes("03 Process"));
    expect(stepY).toBeGreaterThan(0);
    const stepX = Math.max(0, lines[stepY]!.indexOf("03 Process") + 1);
    await view.mockMouse.click(stepX, stepY);
    await view.renderOnce();

    const detail = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(detail).toContain("03 Process");
    expect(detail).not.toContain("03 [loop] Process");
    expect(detail).toContain("for each image");
    expect(detail).toContain("Step Detail");
    await clickStepDetailTab(view, "DETAILS");
    const detailWithMetadata = view.captureCharFrame().replaceAll("\u00a0", " ");
    expect(detailWithMetadata).toContain("execution: for");
    expect(detailWithMetadata).toContain("Child workflow");
    expect(detailWithMetadata).toContain("process-image-item · 9 nested steps");
    expect(detailWithMetadata).toContain("loop 03-07 · per image · 07 returns to 03");
    expect(detailWithMetadata).not.toContain("Nested steps");
    expect(detail).toContain("LOOP 03-07 · per image");
    expect(detail).toContain("│ · 03 read-metadata");
    expect(detail).toContain("│ · 05 generate-thumbnail");
    expect(detail).toContain("│ · 07 describe-image");
    expect(detail).toContain("└─ 07 returns to 03");
    expect(detail).toContain("08 build-search-document");
    expect(detail).toContain("09 write-embedding");
    expect(detail).not.toContain("03↻ read-metadata");
    expect(detail).not.toContain("07↺03 describe-image");
    expect(detail).not.toContain("01↻ fingerprint");
    expect(detail).not.toContain("08↻ build-search-document");
    expect(detail).not.toContain("03.05 generate-thumbnail");
    expect(detail).not.toContain("generate-thumbna...");
    expect(detail).not.toContain("build-search-doc...");
    expect(detail).not.toContain("write-embeddi...");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell supports word-delete editing shortcuts", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-editing-planner",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const jockey = loop({
      id: "app.tui-editing-jockey",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Jockey" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow: planner,
        },
        jockey: {
          title: "Jockey",
          workflow: jockey,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    for (const char of "jockey draft") view.mockInput.pressKey(char);
    view.mockInput.pressBackspace({ meta: true });
    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("Filter workflows");
    expect(frame).toContain("> jockey");
    view.mockInput.pressEnter();
    for (const char of "ship rough plan") view.mockInput.pressKey(char);
    view.mockInput.pressBackspace({ meta: true });
    view.mockInput.pressKey("w", { ctrl: true });
    for (const char of "final") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    const run = runtime.listRuns()[0];
    expect(run?.workflowId).toBe("jockey");
    expect(run?.input).toBe("ship final");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell edits prompt text at a visible cursor", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-cursor-editing",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    view.mockInput.pressTab({ shift: true });
    await view.renderOnce();
    for (const char of "test") view.mockInput.pressKey(char);
    view.mockInput.pressArrow("left");
    view.mockInput.pressArrow("left");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("> test");

    for (const char of "XX") view.mockInput.pressKey(char);
    view.mockInput.pressBackspace();
    view.mockInput.pressKey("Y");
    view.mockInput.pressArrow("right");
    view.mockInput.pressKey("!");
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    expect(runtime.listRuns()[0]?.input).toBe("teXYs!t");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell edits rendered input fields at a visible cursor", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const graph = {
      edges: [],
      end: {
        boundary: "end" as const,
        description: "Planner terminal state.",
        id: "review-plan",
        label: "Review plan",
      },
      id: "app.tui-rendered-cursor-editing",
      label: "Planner",
      nodes: [
        {
          id: "clarify-intent",
          kind: "step",
          label: "Clarify intent",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits the rough prompt.",
        id: "request",
        input: [{
          contractId: "planner.request.input",
          jsonSchema: { type: "string" },
          key: "prompt",
        }],
        label: "Start prompt",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-rendered-cursor-editing",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_rendered_cursor_editing",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          input: {
            kind: "prompt",
            placeholder: "What do you want to plan?",
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 28,
      width: 110,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    view.mockInput.pressTab({ shift: true });
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Planner input");
    expect(view.captureCharFrame()).toContain("> prompt");

    for (const char of "test") view.mockInput.pressKey(char);
    view.mockInput.pressArrow("left");
    view.mockInput.pressArrow("left");
    await view.renderOnce();
    expect(spanBackgroundsForExactText(view.captureSpans(), "s")).toContainEqual([217, 226, 242, 255]);

    for (const char of "XX") view.mockInput.pressKey(char);
    view.mockInput.pressBackspace();
    view.mockInput.pressKey("Y");
    view.mockInput.pressArrow("right");
    view.mockInput.pressKey("!");
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    expect(runtime.listRuns()[0]?.input).toBe("teXYs!t");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell starts rendered JSON input without requiring field edits", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const inputSchema = {
      properties: {
        dryRun: { title: "Dry run", type: "boolean" },
        rootDir: { title: "Root directory", type: "string" },
      },
      type: "object",
    };
    const graph = {
      edges: [],
      end: {
        boundary: "end" as const,
        description: "Image processing terminal state.",
        id: "images-processed",
        label: "Images processed",
      },
      id: "app.tui-rendered-json-submit",
      label: "Images",
      nodes: [
        {
          id: "process",
          kind: "step",
          label: "Process",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        description: "User submits an image request.",
        id: "request",
        input: [
          {
            contractId: "images.request.root-dir",
            jsonSchema: { type: "string" },
            key: "rootDir",
          },
          {
            contractId: "images.request.dry-run",
            jsonSchema: { type: "boolean" },
            key: "dryRun",
          },
        ],
        label: "Image request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-rendered-json-submit",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_rendered_json_submit",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "images",
      title: "App",
      workflows: {
        images: {
          input: {
            kind: "prompt",
            placeholder: `JSON request, for example {"rootDir":".","dryRun":true}`,
          },
          title: "Images",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const controlPlane = {
      listTriggers: async () => [{
        auth: { mode: "bearer" },
        config: {
          method: "POST",
          path: "/api/triggers/images.request",
        },
        enabled: true,
        id: "images.request",
        input: {
          contentType: "application/json",
          jsonSchema: inputSchema,
          mode: "body",
        },
        label: "Images request",
        type: "http",
        workflowId: "images",
      }],
      listTriggerJobs: async () => [],
    } as any;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      controlPlane,
      onExit() {},
      runtime,
    }), {
      height: 28,
      width: 120,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await view.renderOnce();
    await waitFor(() => view.captureCharFrame().includes("Images input fields"));
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Root directory");
    expect(view.captureCharFrame()).toContain("[ ] example true");

    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    expect(runtime.listRuns()[0]?.input).toBe("{}");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell blocks rendered JSON submission when required schema fields are empty", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const inputSchema = {
      properties: {
        rootDir: { title: "Root directory", type: "string" },
      },
      required: ["rootDir"],
      type: "object",
    };
    const graph = {
      edges: [],
      end: {
        boundary: "end" as const,
        id: "images-processed",
        label: "Images processed",
      },
      id: "app.tui-rendered-json-required",
      label: "Images",
      nodes: [
        {
          id: "process",
          kind: "step",
          label: "Process",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        id: "request",
        input: [
          {
            contractId: "images.request.root-dir",
            jsonSchema: { type: "string" },
            key: "rootDir",
          },
        ],
        label: "Image request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-rendered-json-required",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_rendered_json_required",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "images",
      title: "App",
      workflows: {
        images: {
          input: {
            kind: "prompt",
            placeholder: "JSON request",
          },
          title: "Images",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const controlPlane = {
      listTriggers: async () => [{
        enabled: true,
        id: "images.request",
        input: {
          contentType: "application/json",
          jsonSchema: inputSchema,
          mode: "body",
        },
        label: "Images request",
        type: "http",
        workflowId: "images",
      }],
      listTriggerJobs: async () => [],
    } as any;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      controlPlane,
      onExit() {},
      runtime,
    }), {
      height: 28,
      width: 120,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => view.captureCharFrame().includes("Images input fields"));
    view.mockInput.pressEnter();
    await view.renderOnce();

    expect(runtime.listRuns()).toHaveLength(0);
    expect(view.captureCharFrame()).toContain("Root directory is required.");

    view.mockInput.pressKey(".");
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    expect(runtime.listRuns()[0]?.input).toBe("{\"rootDir\":\".\"}");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell submits schema-derived object fields as JSON values", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const inputSchema = {
      properties: {
        metadata: { title: "Metadata", type: "object" },
      },
      type: "object",
    };
    const graph = {
      edges: [],
      end: {
        boundary: "end" as const,
        id: "images-processed",
        label: "Images processed",
      },
      id: "app.tui-rendered-json-object",
      label: "Images",
      nodes: [
        {
          id: "process",
          kind: "step",
          label: "Process",
          maxRetries: 0,
        },
      ],
      trigger: {
        boundary: "trigger" as const,
        id: "request",
        input: [
          {
            contractId: "images.request.metadata",
            jsonSchema: { type: "object" },
            key: "metadata",
          },
        ],
        label: "Image request",
        type: "manual",
      },
    };
    const workflow = {
      graph: () => graph,
      id: "app.tui-rendered-json-object",
      start: () => ({
        answer: () => undefined,
        pendingQuestions: [],
        resume: () => undefined,
        runId: "run_rendered_json_object",
        status: "completed" as const,
      }),
    };
    const app = createWorkflowApp({
      defaultWorkflow: "images",
      title: "App",
      workflows: {
        images: {
          input: {
            kind: "prompt",
            placeholder: "JSON request",
          },
          title: "Images",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const controlPlane = {
      listTriggers: async () => [{
        enabled: true,
        id: "images.request",
        input: {
          contentType: "application/json",
          jsonSchema: inputSchema,
          mode: "body",
        },
        label: "Images request",
        type: "http",
        workflowId: "images",
      }],
      listTriggerJobs: async () => [],
    } as any;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      controlPlane,
      onExit() {},
      runtime,
    }), {
      height: 28,
      width: 120,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => view.captureCharFrame().includes("Images input fields"));
    await view.mockInput.pasteBracketedText("{\"a\":1}");
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    expect(runtime.listRuns()[0]?.input).toBe("{\"metadata\":{\"a\":1}}");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell resumes an existing run by session id and brands as dromio", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      formatWorkflowTuiExitSummary,
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-resume-session",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Resumed" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "Intent Planner",
      workflows: {
        planner: {
          result: {
            artifactName: "brief.md",
            format: (session) => `Plan: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const run = await runtime.startRun({
      input: "resume this plan",
      workflowId: "planner",
    });
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      initialRunId: run.runId,
      onExit() {},
      runtime,
    }), {
      height: 30,
      width: 140,
    });

    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("dromio");
    expect(frame).toContain("Workflow Run");
    expect(frame).toContain("Activity");
    expect(frame).toContain("Result");
    expect(frame).toContain("Plan: Resumed");
    expect(frame).toContain("duration:");
    expect(frame).not.toContain("Result Artifact");

    const summary = formatWorkflowTuiExitSummary(app, run);
    expect(summary).toContain("███▄  █▀▀▄ ▄▀▀▄");
    expect(summary).toContain("█▄ ▄█ ▀█▀ ▄▀▀▄");
    expect(summary).toContain("Last run  resume this plan");
    expect(summary).toContain(`Run ID    ${run.runId}`);
    expect(summary).not.toContain("Continue");
    const idleSummary = formatWorkflowTuiExitSummary(app, undefined);
    expect(idleSummary).toContain("███▄  █▀▀▄ ▄▀▀▄");
    expect(idleSummary).not.toContain("Session");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell selects a workflow from the library before starting", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-library-planner",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const reviewer = loop({
      id: "app.tui-library-reviewer",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Reviewer" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow: planner,
        },
        reviewer: {
          result: {
            format: (session) => `Review: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Reviewer",
          workflow: reviewer,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 90,
	    });

	    await view.renderOnce();
	    for (const char of "rev") view.mockInput.pressKey(char);
	    await view.renderOnce();
	    const filteredFrame = view.captureCharFrame();
	    expect(filteredFrame).toContain("Filter workflows");
	    expect(filteredFrame).toContain("> rev");
	    view.mockInput.pressEnter();
	    for (const char of "ship") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    const run = runtime.listRuns()[0];
    expect(run?.workflowId).toBe("reviewer");
    expect(runtime.formatResult(run!.runId)).toBe("Review: Reviewer");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell exports selected workflows with platform fields", async () => {
    const previousDebug = process.env.DEBUG;
    const previousPlatformUrl = process.env.INTENT_PLATFORM_URL;
    delete process.env.DEBUG;
    delete process.env.INTENT_PLATFORM_URL;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-export-planner",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const reviewer = loop({
      id: "app.tui-export-reviewer",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Reviewer" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow: planner,
        },
        reviewer: {
          title: "Reviewer",
          workflow: reviewer,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    let captured:
      | {
        fields: Record<string, string>;
        workflowIds: string[];
      }
      | undefined;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      exportWorkflows: {
        async run(input) {
          captured = input;
          return {
            bundleDir: "/tmp/exported-app",
            message: "Export complete",
          };
        },
      },
      onExit() {},
      runtime,
    }), {
      height: 30,
      width: 120,
    });

    await view.renderOnce();
    view.mockInput.pressKey("/");
    for (const char of "export") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await view.renderOnce();
    const exportFrame = view.captureCharFrame();
    expect(exportFrame).toContain("Export mode");
    expect(exportFrame).toContain("[ ] Planner");
    expect(exportFrame).not.toContain("[x] Planner");

    view.mockInput.pressKey(" ");
    view.mockInput.pressArrow("down");
    view.mockInput.pressKey(" ");
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Export Workflow App");

    view.mockInput.pressTab();
    for (const char of "acme") view.mockInput.pressKey(char);
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("down");
    await view.mockInput.pasteBracketedText("https://dromio-platform.example");
    view.mockInput.pressArrow("down");
    await view.mockInput.pasteBracketedText("test-token");
    view.mockInput.pressTab();
    view.mockInput.pressArrow("down");
    view.mockInput.pressArrow("down");
    view.mockInput.pressKey(" ");
    view.mockInput.pressEnter();
    await waitFor(() => Boolean(captured));

    expect(captured?.workflowIds).toEqual(["planner", "reviewer"]);
    expect(captured?.fields.orgSlug).toBe("acme");
    expect(captured?.fields.platformUrl).toBe("https://dromio-platform.example");
    expect(captured?.fields.platformToken).toBe("test-token");
    expect(captured?.fields.registryDir).toBe("");
    expect(captured?.fields.publish).toBe("true");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
    if (previousPlatformUrl === undefined) {
      delete process.env.INTENT_PLATFORM_URL;
    } else {
      process.env.INTENT_PLATFORM_URL = previousPlatformUrl;
    }
  });

  test("workflow TUI shell focuses invalid export registry fields", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-export-invalid",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow: planner,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      exportWorkflows: {
        run() {
          throw new Error("should not run");
        },
      },
      onExit() {},
      runtime,
    }), {
      height: 30,
      width: 120,
    });

    await view.renderOnce();
    view.mockInput.pressKey("/");
    for (const char of "export") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    view.mockInput.pressKey(" ");
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Export Workflow App");

    view.mockInput.pressTab();
    for (const char of "acme") view.mockInput.pressKey(char);
    view.mockInput.pressArrow("down");
    for (const char of ".dromio/releases") view.mockInput.pressKey(char);
    view.mockInput.pressArrow("down");
    await view.mockInput.pasteBracketedText("https://dromio-platform.example");
    view.mockInput.pressTab();
    view.mockInput.pressEnter();
    await view.renderOnce();

    const frame = view.captureCharFrame();
    expect(frame).toContain("Choose a local registry or a platform URL");
    expect(frame).toContain("› Platform URL");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell toggles a selected library workflow diagram with tab", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-library-diagram-planner",
      steps: [
        createRuntimeStep("draft", () => done({ title: "Planner" })),
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const reviewer = loop({
      id: "app.tui-library-diagram-reviewer",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Reviewer" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          description: "Make a plan.",
          title: "Planner",
          workflow: planner,
        },
        reviewer: {
          description: "Review a plan.",
          title: "Reviewer",
          workflow: reviewer,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 28,
      width: 110,
    });

    await view.renderOnce();
    view.mockInput.pressTab();
    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("Workflow Diagram");
    expect(frame).toContain("tab close");
    expect(frame).toContain("Planner");
    expect(frame).not.toContain("Filter workflows");

    view.mockInput.pressArrow("down");
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).toContain("Workflow Diagram");
    expect(frame).toContain("Reviewer");

    view.mockInput.pressTab();
    await view.renderOnce();
    frame = view.captureCharFrame();
    expect(frame).not.toContain("Workflow Diagram");
    expect(frame).toContain("Reviewer");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell keeps the library readable in compact windows", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-compact-library",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Compact" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "Intent Planner",
      workflows: {
        planner: {
          description: "Turn a rough prompt into a concrete, self-evaluated plan.",
          title: "Planner",
          workflow,
        },
        resume: {
          description: "Continue workflow toward the active thread goal.",
          title: "Continue workflow toward the active thread goal",
          workflow,
        },
        catalog: {
          description: "Discover and process images into searchable catalog output.",
          title: "Catalog image processor",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 68,
    });

    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("Workflow Library");
    expect(frame).toContain("Continue workflow");
    expect(frame).toContain("Turn a rough prompt");
    expect(frame).not.toContain("Run state");
    expect(frame).not.toContain("Workspace");
    expect(frame).not.toContain("Continuewwork");
    expect(frame).not.toContain("Turnaanrough");
    const lines = frame.split("\n");
    const resumeLines = lines.filter((line) => line.includes("Continue workflow toward"));
    expect(resumeLines).toHaveLength(1);
    expect(resumeLines[0]).toContain("3 nodes");
    expect(resumeLines[0]).not.toContain("toward3");
    const catalogLine = lines.find((line) => line.includes("Catalog image processor"));
    expect(catalogLine).toBeDefined();
    expect(catalogLine).toContain("Discover and proc");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell keeps workflow rows visible in short terminals", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-short-library",
      steps: [createRuntimeStep("finish", () => done({ title: "Short" }))],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "response-review",
      title: "LLM Review Note",
      workflows: {
        "response-review": {
          title: "Response review",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 12,
      width: 146,
    });

    await view.renderOnce();
    const frame = view.captureCharFrame();
    const lines = frame.split("\n");
    const workflowRow = lines.findIndex((line) => line.includes("Response review"));
    const statusRow = lines.findIndex((line) => line.includes("· idle ·"));
    expect(frame).toContain("Workflow Library");
    expect(frame).toContain("Workflows");
    expect(frame).toContain("filter > type to search");
    expect(frame).not.toContain("Filter workflows");
    expect(workflowRow).toBeGreaterThan(0);
    expect(statusRow).toBeGreaterThan(workflowRow);
    expect(statusRow).toBeGreaterThanOrEqual(9);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell reflows start panes when the terminal is resized", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-resize",
      steps: [
        createRuntimeStep("generate", () => done({ title: "Generated" }), {
          label: "Generate response",
        }),
        createRuntimeStep("review", () => done({ title: "Reviewed" }), {
          label: "Review response",
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "response-review",
      title: "LLM Review Note",
      workflows: {
        "response-review": {
          title: "Response review",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "Review this response",
      onExit() {},
      runtime,
    }), {
      height: 30,
      width: 180,
    });

    await view.renderOnce();
    expect(view.captureCharFrame().match(/Workflow Canvas/g)).toHaveLength(1);

    view.resize(112, 18);
    await view.renderOnce();
    const compactFrame = view.captureCharFrame();
    expect(compactFrame.split("\n")).toHaveLength(19);
    expect(compactFrame).toContain("Start Workflow");
    expect(compactFrame).not.toContain("Workflow Canvas");

    view.resize(180, 30);
    await view.renderOnce();
    const expandedFrame = view.captureCharFrame();
    expect(expandedFrame.match(/Workflow Canvas/g)).toHaveLength(1);
    expect(expandedFrame.split("\n").filter((line) => line.trim() === "Start Workflow")).toHaveLength(1);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell toggles the Workflow Room rail to free canvas space", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-room-toggle",
      steps: [createRuntimeStep("finish", () => done({ title: "Complete" }))],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "review",
      title: "Review App",
      workflows: {
        review: {
          result: { format: () => JSON.stringify({ ok: true }) },
          title: "Review",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "Review this",
      onExit() {},
      runtime,
    }), {
      height: 30,
      width: 150,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("WORKFLOW ROOM");

    view.mockInput.pressKey("x", { ctrl: true });
    view.mockInput.pressKey("b");
    await view.renderOnce();
    expect(view.captureCharFrame()).not.toContain("WORKFLOW ROOM");

    view.mockInput.pressKey("x", { ctrl: true });
    view.mockInput.pressKey("b");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("WORKFLOW ROOM");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell sidebar renders separated labels and values", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-sidebar-render",
      steps: [
        createRuntimeStep("first", () => done({ ok: true })),
        createRuntimeStep("second", () => done({ ok: true })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "Intent Planner",
      workflows: {
        planner: {
          description: "Turn a rough prompt into a concrete, self-evaluated plan.",
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("Turn a rough prompt");
    expect(frame).toContain("Workflow");
    expect(frame).toContain("2 steps");
    expect(frame).toContain("questions");
    expect(frame).toContain("0 pending");
    expect(frame).toContain("Run");
    expect(frame).toContain("idle");
    expect(frame).not.toContain("2osteps");
    expect(frame).not.toContain("idlestate");
    expect(frame).not.toContain("result.md");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell scrolls overflowing sidebar sections", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-sidebar-scroll",
      steps: [
        createRuntimeStep("one", () => done({ ok: true })),
        createRuntimeStep("two", () => done({ ok: true })),
        createRuntimeStep("three", () => done({ ok: true })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "Intent Planner",
      workflows: {
        planner: {
          description: "A long enough workflow description to keep the sidebar full.",
          result: {
            artifactName: "result.md",
            format: () => "ok",
          },
          title: "Scrollable Planner",
          workflow,
          workspace: {
            frame: () => ({
              compiledGraph: workflow.graph(),
              cursor: 1,
              document: {},
              patches: [
                {
                  createdAt: "2026-05-09T00:00:00.000Z",
                  id: "patch-1",
                  patch: { op: "replace" as const, path: "/nodes/1/label", value: "Two" },
                  source: "human" as const,
                  target: "document" as const,
                },
              ],
              status: "valid" as const,
              validation: { issues: [], ok: true },
              workspaceId: "workspace.planner",
            }),
          },
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app, {
      endHooks: [
        artifactEnd({
          write({ artifactName }) {
            return [
              { kind: "result", mediaType: "text/markdown", name: artifactName },
              { kind: "trace", mediaType: "application/json", name: "trace.json" },
              { kind: "audit", mediaType: "application/json", name: "audit.json" },
            ];
          },
        }),
      ],
    });
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 18,
      width: 110,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("Workflow");
    expect(frame).not.toContain("audit.json");

    const sidebarScrollTargets = [
      [86, 8],
      [98, 8],
      [104, 12],
    ] as const;
    for (const [sidebarX, sidebarY] of sidebarScrollTargets) {
      for (let index = 0; index < 40; index += 1) {
        await view.mockMouse.scroll(sidebarX, sidebarY, "down");
      }
    }
    await view.renderOnce();
    frame = view.captureCharFrame();

    expect(frame).toContain("audit.json");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell opens artifacts for the selected workflow run from the palette", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-palette-planner",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const reviewer = loop({
      id: "app.tui-palette-reviewer",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Reviewer" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          result: {
            artifactName: "brief.md",
            format: (session) => `Plan: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Planner",
          workflow: planner,
        },
        reviewer: {
          result: {
            artifactName: "review.md",
            format: (session) => `Review: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Reviewer",
          workflow: reviewer,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    for (const char of "plan") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns().some((run) => run.workflowId === "planner" && run.status === "completed"));
    view.mockInput.pressEscape();
    await settleEscapeKey();
    await view.renderOnce();

    view.mockInput.pressArrow("down");
    view.mockInput.pressEnter();
    for (const char of "review") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns().some((run) => run.workflowId === "reviewer" && run.status === "completed"));
    view.mockInput.pressEscape();
    await settleEscapeKey();
    await view.renderOnce();
    view.mockInput.pressArrow("up");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Planner");

    view.mockInput.pressKey("p", { ctrl: true });
    for (const char of "artifact") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await view.renderOnce();

    const frame = view.captureCharFrame();
    expect(frame).toContain("brief.md");
    expect(frame).toContain("Plan: Planner");
    expect(frame).not.toContain("review.md");
    expect(frame).not.toContain("plan.md");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell opens result artifacts in a full-screen popup", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const longResult = Array.from({ length: 36 }, (_, index) => `artifact line ${String(index + 1).padStart(2, "0")}`).join("\n");
    const workflow = loop({
      id: "app.tui-long-artifact",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Artifact" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          result: {
            artifactName: "artifact.md",
            format: () => longResult,
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app, {
      endHooks: [
        artifactEnd({
          write({ artifactName }) {
            return [
              { kind: "result", mediaType: "text/markdown", name: artifactName },
              { kind: "trace", mediaType: "application/json", name: "trace.json" },
            ];
          },
        }),
      ],
    });
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 110,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();

    const runFrame = view.captureCharFrame();
    expect(runFrame).toContain("Workflow Run");
    expect(runFrame).toMatch(/Activity/i);
    expect(runFrame).toMatch(/Result/i);

    view.mockInput.pressEnter();
    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("Result Artifact");
    expect(frame).toContain("artifact.md");
    expect(frame).toContain("artifact line 01");
    expect(frame).toContain("artifact line 10");
    expect(frame).not.toContain("Activity");
    expect(spanForegroundForText(view.captureSpans(), "artifact.md")).toEqual([134, 239, 172, 255]);

    for (let index = 0; index < 15; index += 1) view.mockInput.pressArrow("down");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("artifact line 25");

    view.mockInput.pressEscape();
    await settleEscapeKey();
    await view.renderOnce();
    const backFrame = view.captureCharFrame();
    expect(backFrame).toContain("Workflow Run");
    expect(backFrame).toMatch(/Activity/i);
    expect(backFrame).not.toContain("Result Artifact");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell does not open another workflow artifact when selected workflow has no run", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-palette-scope-planner",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const reviewer = loop({
      id: "app.tui-palette-scope-reviewer",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Reviewer" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          result: {
            artifactName: "brief.md",
            format: (session) => `Plan: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Planner",
          workflow: planner,
        },
        reviewer: {
          result: {
            artifactName: "review.md",
            format: (session) => `Review: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Reviewer",
          workflow: reviewer,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    for (const char of "plan") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns().some((run) => run.workflowId === "planner" && run.status === "completed"));
    view.mockInput.pressEscape();
    await settleEscapeKey();
    await view.renderOnce();
    view.mockInput.pressArrow("down");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Reviewer");

    view.mockInput.pressKey("p", { ctrl: true });
    for (const char of "artifact") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await view.renderOnce();

    const frame = view.captureCharFrame();
    expect(frame).toContain("Workflow Library");
    expect(frame).toContain("Reviewer");
    expect(frame).not.toContain("brief.md");
    expect(frame).not.toContain("Plan: Planner");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell has searchable command help and generic result artifacts", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-help-artifact",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Artifact" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          result: {
            artifactName: "summary.txt",
            format: (session) => `Summary: ${(session.state as Record<string, { title: string }>).finish.title}`,
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

	    await view.renderOnce();
	    view.mockInput.pressKey("p", { ctrl: true });
	    for (const char of "help") view.mockInput.pressKey(char);
	    await view.renderOnce();
	    const paletteFrame = view.captureCharFrame();
	    expect(paletteFrame).toContain("Commands");
	    expect(paletteFrame).toContain("Search  help");
	    expect(paletteFrame).toContain("Results");
	    expect(paletteFrame).toContain("› Show Workflow Help");
	    expect(paletteFrame).not.toContain("Opend");
	    expect(paletteFrame).not.toContain("OpenrResult");
	    view.mockInput.pressEnter();
	    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Workflow Help");
    view.mockInput.pressEscape();
    await settleEscapeKey();
    await view.renderOnce();

    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");
    await view.renderOnce();

    const runFrame = view.captureCharFrame();
    expect(runFrame).toContain("Workflow Run");
    expect(runFrame).toContain("Activity");

    view.mockInput.pressEnter();
    await view.renderOnce();
    const frame = view.captureCharFrame();
    expect(frame).toContain("summary.txt");
    expect(frame).toContain("Summary: Artifact");
    expect(frame).not.toContain("plan.md");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell keeps long command palettes contained and scrollable", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-long-palette",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Palette" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const now = "2026-05-10T00:00:00.000Z";
    const controlPlane = {
      listTriggers: async () => [{
        enabled: true,
        id: "process-images",
        label: "Process Images",
        type: "http",
        workflowId: "planner",
      }],
      listTriggerJobs: async () => [{
        attempts: 0,
        availableAt: now,
        createdAt: now,
        id: "job_process_images",
        maxAttempts: 3,
        occurrenceId: "occ_process_images",
        payload: { input: {}, source: "test" },
        status: "queued",
        triggerId: "process-images",
        updatedAt: now,
        workflowId: "planner",
      }],
    } as any;
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      controlPlane,
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    view.mockInput.pressKey("p", { ctrl: true });
    await view.renderOnce();
    let frame = view.captureCharFrame();
    expect(frame).toContain("Commands");
    expect(frame).toContain("Suggested");
    expect(frame).toContain("› Open Workflow Library");
    expect(frame).toContain("Open Planner Sessions");
    expect(frame).not.toContain("Copy Job ID");
    expect(frame).not.toContain("Dead-letter");
    expect(frame).not.toContain("PrCopy");
    expect(frame).not.toContain("WorkflowRet");

    for (let index = 0; index < 24; index += 1) {
      view.mockInput.pressArrow("down");
      await view.renderOnce();
      frame = view.captureCharFrame();
      if (frame.includes("Dead-letter Selected Job")) break;
    }
    expect(frame).toContain("Dead-letter Selected Job");
    expect(frame).not.toContain("› Open Workflow Library");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell shows failed runs without formatting completed artifacts", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-failed-result",
      steps: [
        createRuntimeStep("finish", () => fail("No viable plan.")),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          result: {
            format: () => {
              throw new Error("formatter should not run");
            },
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "failed");
    await view.renderOnce();

    const frame = view.captureCharFrame();
    expect(frame).toContain("failed");
    expect(frame).toContain("No viable plan");
    expect(frame).not.toContain("formatter should not run");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell keeps commands available while questions are waiting", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-question-command",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if (context.answers.scope) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Minimal", value: "minimal" },
                { label: "No preference", value: "__assume__" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      title: "App",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 100,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "waiting");
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("ctrl+p commands");

    view.mockInput.pressKey("p", { ctrl: true });
    for (const char of "help") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain("Workflow Help");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow app reports unknown workflows before starting the TUI", async () => {
    const workflow = loop({
      id: "app.tui-unknown",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    let output = "";
    const result = await runWorkflowApp(app, {
      cli: {
        argv: ["--workflow", "missing"],
        input,
        output: {
          isTTY: true,
          write(chunk) {
            output += chunk;
            return true;
          },
        },
      },
    });

    expect(result).toBeUndefined();
    expect(output).toContain("Unknown workflow: missing");
  });

  test("workflow app reports missing workflow operands before starting the TUI", async () => {
    const workflow = loop({
      id: "app.tui-missing-workflow-operand",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    let output = "";
    const result = await runWorkflowApp(app, {
      cli: {
        argv: ["--workflow"],
        input,
        output: {
          isTTY: true,
          write(chunk) {
            output += chunk;
            return true;
          },
        },
      },
    });

    expect(result).toBeUndefined();
    expect(output).toContain("Missing workflow id after --workflow.");
  });

  test("workflow TUI shell falls back to the default workflow for a direct invalid prop", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const planner = loop({
      id: "app.tui-default-fallback",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Planner" })),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      workflows: {
        planner: {
          title: "Planner",
          workflow: planner,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      initialWorkflowId: "missing",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 80,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    expect(runtime.listRuns()[0]?.workflowId).toBe("planner");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell re-presents required questions after escape", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const workflow = loop({
      id: "app.tui-required-question",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Minimal", value: "minimal" },
                { label: "Full", value: "full" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      workflows: {
        planner: {
          title: "Planner",
          workflow,
        },
      },
    });
    const baseRuntime = createWorkflowAppRuntime(app);
    const answeredQuestions: Array<{ questionId: string; value: unknown }> = [];
    const runtime: typeof baseRuntime = {
      ...baseRuntime,
      async answerQuestion(runId, input) {
        answeredQuestions.push(input);
        return baseRuntime.answerQuestion(runId, input);
      },
    };
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 80,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "waiting");
    view.mockInput.pressEscape();
    await view.renderOnce();
    view.mockInput.pressKey("1");
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    const run = runtime.listRuns()[0];
    expect(run?.session.answers?.scope).toBe("minimal");
    expect(answeredQuestions).toEqual([{ questionId: "scope", value: "minimal" }]);

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("workflow TUI shell resumes arbitrary hooks from the hook dock", async () => {
    const previousDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    await import("@opentui/solid/preload");
    const { testRender } = await import("@opentui/solid");
    const {
      WorkflowAppTuiShell,
    } = await import("@dromio/workflow/client/workflow-tui-shell-test-surface");
    const approval = createHook<{ label: string }, { approved: boolean; count: number }>({ id: "approval" });
    const workflow = loop({
      id: "app.tui-hook",
      steps: [
        createRuntimeStep("gate", async (context) => {
          const answer = await context.waitFor(approval, { label: "Approve?" });
          return done({ answer });
        }),
      ],
    });
    const app = createWorkflowApp({
      defaultWorkflow: "planner",
      workflows: {
        planner: {
          result: {
            format: (session) =>
              `Approval: ${JSON.stringify((session.state as Record<string, { answer: unknown }>).gate.answer)}`,
          },
          title: "Planner",
          workflow,
        },
      },
    });
    const runtime = createWorkflowAppRuntime(app);
    const view = await testRender(() => WorkflowAppTuiShell({
      app,
      defaultPrompt: "ship",
      onExit() {},
      runtime,
    }), {
      height: 24,
      width: 80,
    });

    await view.renderOnce();
    view.mockInput.pressEnter();
    await waitFor(() => Boolean(runtime.listRuns()[0]?.session.pendingHooks?.length));
    for (const char of "{\"approved\":true,\"count\":0}") view.mockInput.pressKey(char);
    view.mockInput.pressEnter();
    await waitFor(() => runtime.listRuns()[0]?.status === "completed");

    const run = runtime.listRuns()[0];
    expect(run?.session.state).toMatchObject({
      gate: { answer: { approved: true, count: 0 } },
    });
    expect(runtime.formatResult(run!.runId)).toBe("Approval: {\"approved\":true,\"count\":0}");

    view.renderer.destroy();
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  });

  test("runs workflows through the terminal workflow adapter", async () => {
    const workflow = loop({
      id: "terminal.workflow",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "No preference", value: "__assume__" },
                { label: "Minimal", value: "minimal" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("completed");
    expect(session.state["ask-scope"]).toEqual({ scope: "__assume__" });
    expect(output).toContain("Result");
  });

  test("terminal workflow adapter falls back when the TUI renderer cannot answer", async () => {
    const workflow = loop({
      id: "terminal.tui-fallback",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "No preference", value: "__assume__" },
                { label: "Minimal", value: "minimal" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    output.isTTY = true;
    let written = "";
    output.on("data", (chunk) => {
      written += chunk.toString();
    });
    queueMicrotask(() => {
      input.write("\n");
    });

    const session = await runTerminalWorkflow(workflow, {
      input: {},
      inputStream: input,
      interactive: true,
      output,
      renderer: "tui",
      tuiRendererFactory: async () => ({
        answerQuestions: async () => false,
        close() {},
        pause() {},
        render() {},
        resume() {},
        snapshot() {
          return {};
        },
      } as never),
    });

    expect(session.status).toBe("completed");
    expect(session.answers.scope).toBe("__assume__");
    expect(written).toContain("Scope?");
    expect(written).toContain("Result");
  });

  test("terminal workflow adapter falls back when the TUI renderer cannot start", async () => {
    const workflow = loop({
      id: "terminal.tui-startup-fallback",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "No preference", value: "__assume__" },
                { label: "Minimal", value: "minimal" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    const input = new PassThrough() as PassThrough & { isTTY?: boolean };
    input.isTTY = true;
    const output = new PassThrough() as PassThrough & { isTTY?: boolean };
    output.isTTY = true;
    let written = "";
    output.on("data", (chunk) => {
      written += chunk.toString();
    });
    queueMicrotask(() => {
      input.write("\n");
    });

    const session = await runTerminalWorkflow(workflow, {
      input: {},
      inputStream: input,
      interactive: true,
      output,
      renderer: "tui",
      tuiRendererFactory: async () => {
        throw new Error("TUI unavailable");
      },
    });

    expect(session.status).toBe("completed");
    expect(session.answers.scope).toBe("__assume__");
    expect(written).toContain("Scope?");
    expect(written).toContain("Result");
  });

  test("terminal workflow adapter falls back to logs when TUI cannot start in non-TTY output", async () => {
    const workflow = loop({
      id: "terminal.tui-startup-log-fallback",
      steps: [
        createRuntimeStep("finish", () => done({ ok: true })),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "tui",
      tuiRendererFactory: async () => {
        throw new Error("TUI unavailable");
      },
    });

    expect(session.status).toBe("completed");
    expect(output).toContain("Run");
    expect(output).toContain("terminal.tui-startup-log-fallback");
    expect(output).toContain("Result");
  });

  test("terminal workflow adapter renders dashboard frames when requested", async () => {
    const workflow = loop({
      id: "terminal.dashboard",
      steps: [
        createRuntimeStep("finish", () => done({ ok: true })),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: "ship it",
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "dashboard",
    });

    expect(session.status).toBe("completed");
    expect(output).toContain("terminal.dashboard");
    expect(output).toContain("Workflow");
    expect(output).toContain("01 Finish");
    expect(output).toContain("Result");
  });

  test("terminal workflow adapter can format the final result", async () => {
    const workflow = loop({
      id: "terminal.formatted-result",
      steps: [
        createRuntimeStep("finish", () => done({ title: "Ship it" })),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      formatResult: (currentSession) =>
        `Plan: ${((currentSession.state as { finish: { title: string } }).finish).title}`,
      input: {},
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("completed");
    expect(output).toContain("Result\nPlan: Ship it\n");
    expect(output).not.toContain("\"finish\"");
  });

  test("terminal workflow adapter does not print a result for non-question hook waits", async () => {
    const approvalHook = createHook<{ message: string }, string>({
      id: "approval",
      title: "Approval",
    });
    const workflow = loop({
      id: "terminal.hook-wait",
      steps: [
        createRuntimeStep("wait-for-approval", async (context) => {
          const approval = await context.waitFor(approvalHook, { message: "Approve?" });
          return done({ approval });
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("waiting");
    expect(output).toContain("Waiting");
    expect(output).toContain("Workflow is waiting on a non-question hook that this terminal adapter cannot answer directly.");
    expect(output).toContain("approval");
    expect(output).not.toContain("Result");
  });

  test("terminal workflow adapter leaves no-default choices waiting in non-interactive mode", async () => {
    const workflow = loop({
      id: "terminal.no-default-choice",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if ("scope" in context.answers) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "Minimal", value: "minimal" },
                { label: "Full", value: "full" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("waiting");
    expect(session.answers.scope).toBeUndefined();
    expect(output).toContain("Cannot auto-answer Scope");
    expect(output).not.toContain("Result");
  });

  test("terminal workflow adapter does not partially answer a batch when a later question has no default", async () => {
    const workflow = loop({
      id: "terminal.partial-batch",
      steps: [
        createRuntimeStep("ask-batch", (context) => {
          if ("scope" in context.answers && "platform" in context.answers) {
            return done({
              platform: context.answers.platform,
              scope: context.answers.scope,
            });
          }
          return {
            questions: [
              {
                id: "scope",
                options: [
                  { label: "No preference", value: "__assume__" },
                  { label: "Minimal", value: "minimal" },
                ],
                prompt: "Scope?",
                title: "Scope",
                type: "choice" as const,
              },
              {
                id: "platform",
                options: [
                  { label: "Web", value: "web" },
                  { label: "Mobile", value: "mobile" },
                ],
                prompt: "Platform?",
                title: "Platform",
                type: "choice" as const,
              },
            ],
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("waiting");
    expect(session.answers.scope).toBeUndefined();
    expect(session.answers.platform).toBeUndefined();
    expect(session.pendingQuestions.map((question) => question.id)).toEqual(["scope", "platform"]);
    expect(output).toContain("Cannot auto-answer Platform");
    expect(output).not.toContain("Result");
  });

  test("terminal workflow adapter leaves no-default multi-select questions waiting in non-interactive mode", async () => {
    const workflow = loop({
      id: "terminal.no-default-multi",
      steps: [
        createRuntimeStep("ask-features", (context) => {
          if ("features" in context.answers) return done({ features: context.answers.features });
          return {
            questions: [{
              id: "features",
              options: [
                { label: "Due dates", value: "due-dates" },
                { label: "Tags", value: "tags" },
              ],
              prompt: "Features?",
              title: "Features",
              type: "multi" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("waiting");
    expect(session.answers.features).toBeUndefined();
    expect(output).toContain("Cannot auto-answer Features");
    expect(output).not.toContain("Result");
  });

  test("terminal workflow adapter stops repeated non-interactive text defaults without hanging", async () => {
    const workflow = loop({
      id: "terminal.text-no-progress",
      steps: [
        createRuntimeStep("ask-notes", (context) => {
          if (context.answers.notes) return done({ notes: context.answers.notes });
          return {
            questions: [{
              id: "notes",
              prompt: "Notes?",
              title: "Notes",
              type: "text" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("waiting");
    expect(session.answers.notes).toBe("");
    expect(output).toContain("Cannot advance non-interactive answers");
    expect(output).not.toContain("Result");
  });

  test("terminal workflow adapter stops repeated non-interactive resolver rejections without hanging", async () => {
    const workflow = loop({
      id: "terminal.resolver-no-progress",
      steps: [
        createRuntimeStep("ask-scope", (context) => {
          if (context.answers.scope) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "No preference", value: "__assume__" },
                { label: "Minimal", value: "minimal" },
              ],
              prompt: "Scope?",
              resolverId: "scope.resolver",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      questionResolvers: {
        "scope.resolver": () => ({
          confidence: 1,
          kind: "unclear" as const,
          message: "Choose explicitly.",
          status: "needs_input" as const,
        }),
      },
      renderer: "none",
    });

    expect(session.status).toBe("waiting");
    expect(session.answers.scope).toBeUndefined();
    expect(output).toContain("Cannot advance non-interactive answers");
    expect(output).not.toContain("Result");
  });

  test("terminal workflow adapter bounds changing hook-backed non-interactive questions", async () => {
    const workflow = loop({
      id: "terminal.changing-hook-budget",
      steps: [
        createRuntimeStep("ask-notes", (context) => {
          const asks = typeof context.state.asks === "number" ? context.state.asks : 0;
          return {
            questions: [{
              id: "notes",
              prompt: `Notes? ${asks}`,
              title: "Notes",
              type: "text" as const,
            }],
            state: { asks: asks + 1 },
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      maxNonInteractiveAutoAnswers: 2,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("waiting");
    expect(session.state.asks).toBe(3);
    expect(output).toContain("Cannot advance non-interactive answers");
    expect(output).not.toContain("Result");
  });

  test("terminal workflow adapter can auto-answer a changed question shape with the same id", async () => {
    const workflow = loop({
      id: "terminal.changed-question-shape",
      steps: [
        createRuntimeStep("ask-name", (context) => {
          if (context.answers.name === "__assume__") return done({ name: context.answers.name });
          if (context.answers.name === "") {
            return {
              questions: [{
                id: "name",
                options: [
                  { label: "No preference", value: "__assume__" },
                  { label: "Example User", value: "example-user" },
                ],
                prompt: "Choose a fallback name.",
                title: "Name",
                type: "choice" as const,
              }],
              type: "ask" as const,
            };
          }
          return {
            questions: [{
              id: "name",
              prompt: "Name?",
              title: "Name",
              type: "text" as const,
            }],
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("completed");
    expect(session.answers.name).toBe("__assume__");
    expect(output).toContain("Result");
    expect(output).not.toContain("Cannot advance non-interactive answers");
  });

  test("terminal workflow adapter auto-answers identical defaultable questions in fresh steps", async () => {
    const workflow = loop({
      id: "terminal.repeated-fresh-question",
      steps: [
        createRuntimeStep("first", (context) => {
          if (context.answers.scope) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "No preference", value: "__assume__" },
                { label: "Minimal", value: "minimal" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            type: "ask" as const,
          };
        }),
        createRuntimeStep("second", (context) => {
          if (context.state.secondAsked) return done({ scope: context.answers.scope });
          return {
            questions: [{
              id: "scope",
              options: [
                { label: "No preference", value: "__assume__" },
                { label: "Minimal", value: "minimal" },
              ],
              prompt: "Scope?",
              title: "Scope",
              type: "choice" as const,
            }],
            state: { secondAsked: true },
            type: "ask" as const,
          };
        }),
      ],
    });
    let output = "";
    const session = await runTerminalWorkflow(workflow, {
      input: {},
      interactive: false,
      output: {
        isTTY: false,
        write(chunk) {
          output += chunk;
          return true;
        },
      },
      renderer: "none",
    });

    expect(session.status).toBe("completed");
    expect(session.state.first).toEqual({ scope: "__assume__" });
    expect(session.state.second).toEqual({ scope: "__assume__" });
    expect(output).not.toContain("Cannot advance non-interactive answers");
  });
});

function eventRecord(type: "step.completed" | "step.started") {
  return {
    correlationId: `event-${type}`,
    index: type === "step.started" ? 0 : 1,
    message: type,
    runId: "run_terminal",
    stepId: "prepare",
    timestamp: "2026-05-04T00:00:00.000Z",
    trace: {
      name: "prepare",
      parentSpanId: "run:run_terminal",
      spanId: "step:prepare",
      traceId: "run_terminal",
    },
    type,
  };
}

function traceRecord(type: string, input: Partial<EventRecord> = {}): EventRecord {
  return {
    ...input,
    correlationId: `event-${type}`,
    index: input.index ?? 0,
    message: input.message ?? type,
    runId: input.runId ?? "run_terminal",
    timestamp: input.timestamp ?? "2026-05-04T00:00:00.000Z",
    type,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function clickStepDetailTab(view: {
  captureCharFrame(): string;
  mockMouse: { click(x: number, y: number): Promise<void> | void };
  renderOnce(): Promise<void> | void;
}, label: "ACTIVITY" | "DETAILS") {
  const frame = view.captureCharFrame().replaceAll("\u00a0", " ");
  const lines = frame.split("\n");
  const detailY = lines.findIndex((line) => line.includes("Step Detail"));
  const searchStart = detailY >= 0 ? detailY : 0;
  const visibleLabel = label === "DETAILS" ? "DETAIL" : label;
  const relativeTabY = lines.slice(searchStart).findIndex((line) =>
    line.includes(label) || line.includes(visibleLabel)
  );
  const tabY = relativeTabY >= 0 ? searchStart + relativeTabY : -1;
  if (tabY < 0) {
    throw new Error(`Step detail tabs not found while selecting ${label}.`);
  }
  const tabX = Math.max(lines[tabY]!.indexOf(label), lines[tabY]!.indexOf(visibleLabel));
  if (tabX < 0) {
    throw new Error(`Step detail tab ${label} not found.`);
  }

  await view.mockMouse.click(Math.max(0, tabX + 1), tabY);
  await view.renderOnce();
}

async function settleEscapeKey() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function spanForegroundForText(frame: CapturedFrame, text: string) {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) return span.fg.toInts();
    }
  }
  return undefined;
}

function spanForegroundsForText(frame: CapturedFrame, text: string) {
  const colors: number[][] = [];
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.includes(text)) colors.push(span.fg.toInts());
    }
  }
  return colors;
}

function spanForegroundForExactText(frame: CapturedFrame, text: string) {
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text === text) return span.fg.toInts();
    }
  }
  return undefined;
}

function spanBackgroundsForExactText(frame: CapturedFrame, text: string) {
  const colors: number[][] = [];
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text === text) colors.push(span.bg.toInts());
    }
  }
  return colors;
}

async function collectUntilEvent(
  events: AsyncIterable<EventRecord>,
  type: string,
  timeoutMs = 5000,
) {
  const collected: EventRecord[] = [];
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out waiting for ${type}.`)), timeoutMs);
  });
  const collect = (async () => {
    for await (const event of events) {
      collected.push(event);
      if (event.type === type) return collected;
    }
    return collected;
  })();
  return Promise.race([collect, timeout]);
}
