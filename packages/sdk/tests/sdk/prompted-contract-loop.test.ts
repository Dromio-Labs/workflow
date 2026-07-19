import {
  describe,
  expect,
  test,
} from "bun:test";
import {
  defineEvaluationBar,
  definePromptedContractLoop,
  detectRequirementAmbiguity,
  renderEvaluationBar,
  runPromptedContractLoop,
  type EventRecord,
  type PromptedContract,
} from "@dromio/workflow/core";
import {
  defaultFormatEvent,
  projectEvaluationBars,
} from "@dromio/workflow/client";

describe("prompted contract loop", () => {
  test("detects subjective quality bars as ambiguous requirements", () => {
    const findings = detectRequirementAmbiguity({
      id: "mvp_quality_bar",
      prompt: "Make sure the plan is solid enough for MVP quality.",
    });

    expect(findings.map((finding) => finding.kind)).toContain("subjective_quality_bar");
    expect(findings.map((finding) => finding.phrase)).toEqual(expect.arrayContaining(["solid enough", "mvp quality"]));
  });

  test("asks option questions, evaluates answers with history, and re-resolves", async () => {
    const events: EventRecord[] = [];
    const answers = ["not sure", "sounds good"];
    const loop = definePromptedContractLoop({
      answerEvaluator({ history, utterance }) {
        const text = String(utterance).toLowerCase();
        const suggestion = [...history].reverse().find((item) =>
          item.resolution.status === "needs_input" &&
          item.resolution.kind === "suggestion"
        )?.resolution;
        if (suggestion?.status === "needs_input" && suggestion.suggestedValue && text.includes("sounds good")) {
          return {
            confidence: 0.94,
            kind: "answer",
            normalizedValue: suggestion.suggestedValue,
            status: "accepted",
          };
        }
        return {
          confidence: 0.82,
          kind: "suggestion",
          message: "Use the comprehensive MVP gate.",
          status: "needs_input",
          suggestedValue: "comprehensive_mvp_gate",
        };
      },
      evaluateContract({ contract }) {
        const requirement = contract.requirements.find((item) => item.id === "mvp_quality_bar");
        const passed = requirement?.status === "satisfied";
        return defineEvaluationBar({
          gaps: passed
            ? []
            : [{
                id: "quality-bar-ambiguous",
                message: "Quality bar is still ambiguous.",
                severity: "high",
              }],
          label: "Product behavior clarity",
          nextAction: passed ? "complete" : "ask",
          questions: passed
            ? []
            : [{
                id: "mvp_quality_bar",
                options: [
                  { label: "Comprehensive MVP Gate", value: "comprehensive_mvp_gate" },
                  { label: "Product MVP Readiness", value: "product_mvp_readiness" },
                ],
                prompt: "What quality bar should the app use?",
                recommendedOptionId: "comprehensive_mvp_gate",
                title: "MVP quality bar",
                type: "choice",
              }],
          risks: [],
          satisfies: [{
            id: "mvp_quality_bar",
            passed,
            reason: passed ? "Quality bar is resolved." : "Quality bar needs an answer.",
          }],
          score: passed ? 0.95 : 0.52,
          status: passed ? "pass" : "needs_input",
          subjectId: "product_behavior_contract",
          threshold: 0.85,
        });
      },
      id: "test.product-behavior-loop",
      questionPolicy: {
        id: "test.questions",
        maxAnswerAttempts: 3,
        preferOptions: true,
      },
      resolveContract({ answers }) {
        return contract(Boolean(answers.mvp_quality_bar));
      },
      revisionPolicy: {
        id: "test.revisions",
        maxContractLoops: 3,
      },
    });

    const result = await runPromptedContractLoop(loop, {
      input: { prompt: "solid enough for MVP quality" },
      onEvent(event) {
        events.push(record(event, events.length));
      },
      onQuestion() {
        return answers.shift();
      },
    });

    if (result.status !== "completed") {
      throw new Error(`Expected completed loop, got ${result.status}`);
    }
    expect(result.evaluation.score).toBeGreaterThanOrEqual(0.85);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "contract.questions.requested",
      "contract.answer.evaluated",
      "contract.answer.accepted",
      "evaluation.completed",
      "contract.loop.completed",
    ]));
    expect(projectEvaluationBars(events).map((bar) => bar.label)).toEqual(expect.arrayContaining([
      "Product behavior clarity",
      "Answer quality: MVP quality bar",
    ]));
  });

  test("projects and formats evaluation bars for clients and terminal traces", () => {
    const event = record({
      detail: {
        evaluation: defineEvaluationBar({
          gaps: [{ id: "gap", message: "Missing output category.", severity: "medium" }],
          label: "Generated app usefulness",
          questions: [{ id: "output", prompt: "What should it output?", type: "text" }],
          risks: [],
          satisfies: [{ id: "behavior", passed: false, reason: "Not enough behavior." }],
          score: 0.64,
          status: "needs_input",
          subjectId: "generated_app_usefulness",
          threshold: 0.8,
        }),
      },
      message: "Generated app usefulness 64% needs_input.",
      type: "evaluation.completed",
    }, 0);

    expect(projectEvaluationBars([event])[0]).toMatchObject({
      label: "Generated app usefulness",
      score: 0.64,
      threshold: 0.8,
    });
    expect(renderEvaluationBar(projectEvaluationBars([event])[0])).toBe("[██████░░░░] 64% needs_input");
    expect(defaultFormatEvent(event)?.children?.[0]).toBe("[██████░░░░] 64% threshold 80%");
  });
});

function contract(resolved: boolean): PromptedContract {
  return {
    kind: "product_behavior_contract",
    questions: resolved
      ? []
      : [{
          id: "mvp_quality_bar",
          options: [
            { label: "Comprehensive MVP Gate", value: "comprehensive_mvp_gate" },
          ],
          prompt: "What quality bar should the app use?",
          title: "MVP quality bar",
          type: "choice",
        }],
    requirements: [{
      id: "mvp_quality_bar",
      label: "MVP quality bar",
      question: resolved
        ? undefined
        : {
            id: "mvp_quality_bar",
            options: [
              { label: "Comprehensive MVP Gate", value: "comprehensive_mvp_gate" },
            ],
            prompt: "What quality bar should the app use?",
            title: "MVP quality bar",
            type: "choice",
          },
      required: true,
      status: resolved ? "satisfied" : "ambiguous",
      value: resolved ? "comprehensive_mvp_gate" : null,
    }],
    steps: [{
      id: "define-quality-bar",
      label: "Define quality bar",
      primitive: "define-quality-bar",
      requirementIds: ["mvp_quality_bar"],
    }],
  };
}

function record(event: {
  detail?: unknown;
  message: string;
  trace?: EventRecord["trace"];
  type: string;
}, index: number): EventRecord {
  return {
    ...event,
    correlationId: `test:${index}`,
    index,
    runId: "test-run",
    timestamp: new Date(0).toISOString(),
  };
}
