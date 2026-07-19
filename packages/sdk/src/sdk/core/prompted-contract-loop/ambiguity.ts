import type { EvaluationBarQuestion } from "../evaluation/index.js";

export type RequirementAmbiguityKind =
  | "missing"
  | "subjective_quality_bar"
  | "underspecified_acceptance"
  | "underspecified_output";

export type RequirementAmbiguity<TRequirementId extends string = string> = {
  id: TRequirementId;
  kind: RequirementAmbiguityKind;
  phrase?: string;
  reason: string;
  score: number;
};

export const defaultSubjectiveQualityPhrases = [
  "solid enough",
  "mvp quality",
  "mvp-ready",
  "mvp ready",
  "production ready",
  "secure",
  "fast",
  "beautiful",
  "good ux",
  "high quality",
] as const;

export function detectRequirementAmbiguity<const TRequirementId extends string>(input: {
  id: TRequirementId;
  label?: string;
  phrases?: readonly string[];
  prompt?: string;
  requireOutputShape?: boolean;
  required?: boolean;
  value?: unknown;
}): RequirementAmbiguity<TRequirementId>[] {
  const findings: RequirementAmbiguity<TRequirementId>[] = [];
  const text = String(input.value ?? input.prompt ?? "").toLowerCase();
  const phrases = input.phrases ?? defaultSubjectiveQualityPhrases;
  if (input.required && isEmpty(input.value)) {
    findings.push({
      id: input.id,
      kind: "missing",
      reason: `${input.label ?? input.id} is required but not resolved.`,
      score: 0,
    });
  }
  for (const phrase of phrases) {
    if (text.includes(phrase.toLowerCase())) {
      findings.push({
        id: input.id,
        kind: "subjective_quality_bar",
        phrase,
        reason: `"${phrase}" is a subjective quality bar without explicit pass/fail criteria.`,
        score: 0.45,
      });
    }
  }
  if (input.requireOutputShape && !mentionsOutputShape(text)) {
    findings.push({
      id: input.id,
      kind: "underspecified_output",
      reason: `${input.label ?? input.id} does not define the expected output shape.`,
      score: 0.55,
    });
  }
  return findings;
}

export function questionForAmbiguity<const TQuestionId extends string>(input: {
  appName?: string;
  ambiguity: RequirementAmbiguity;
  id: TQuestionId;
  recommendedOptionId?: string;
}): EvaluationBarQuestion<TQuestionId> {
  if (input.ambiguity.kind === "subjective_quality_bar") {
    return {
      id: input.id,
      options: [
        {
          description: "Product, engineering, risk, and verification readiness.",
          label: "Comprehensive MVP Gate",
          value: "comprehensive_mvp_gate",
        },
        {
          description: "User problem, target user, workflow, and success metric.",
          label: "Product MVP Readiness",
          value: "product_mvp_readiness",
        },
        {
          description: "Architecture, data model, API, tests, and rollout.",
          label: "Engineering Readiness",
          value: "engineering_readiness",
        },
        {
          description: "Scope, milestones, owners, dependencies, and risks.",
          label: "Execution Readiness",
          value: "execution_readiness",
        },
      ],
      prompt: `What quality bar should ${input.appName ?? "this app"} use for MVP readiness?`,
      recommendedOptionId: input.recommendedOptionId ?? "comprehensive_mvp_gate",
      title: "MVP readiness quality bar",
      type: "choice",
    };
  }
  return {
    id: input.id,
    prompt: input.ambiguity.reason,
    title: input.ambiguity.kind.replace(/_/g, " "),
    type: "text",
  };
}

function isEmpty(value: unknown) {
  return value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
}

function mentionsOutputShape(value: string) {
  return /\b(output|return|show|print|render|score|verdict|risk|decision|step|field|json|report)\b/.test(value);
}
