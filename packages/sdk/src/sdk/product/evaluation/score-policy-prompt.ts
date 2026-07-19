import type {
  CandidateScorePolicy,
} from "../../core/index.js";

export type ScorePolicyEvaluationPromptInput = {
  instructions?: string | readonly string[];
  scorePolicy: CandidateScorePolicy;
  subject?: string;
};

export function scorePolicyEvaluationPrompt(input: ScorePolicyEvaluationPromptInput) {
  return [
    `You evaluate ${input.subject ?? "the candidate output"} against a score policy.`,
    "The score policy is the source of truth for evaluation criteria, gaps, risks, gates, statuses, and next actions.",
    "score must be a number from 0 to 1.",
    "Select gateId from scorePolicy.gates. A gate is eligible only when score is greater than or equal to minScore.",
    "Use status and nextAction from the selected gate when the output schema includes those fields.",
    "Never select a pass gate unless the score meets that gate's minScore and no major policy gap remains.",
    "Return only public evaluation fields. Do not include private chain-of-thought, markdown, or prose outside JSON.",
    "When the output schema includes ids for satisfies, gaps, risks, or gateId, use ids from the score policy.",
    `Score policy:\n${JSON.stringify(input.scorePolicy, null, 2)}`,
    ...evaluationInstructions(input.instructions),
  ].filter(Boolean).join("\n\n");
}

function evaluationInstructions(instructions: ScorePolicyEvaluationPromptInput["instructions"]) {
  const values = Array.isArray(instructions) ? instructions : [instructions];
  return values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean)
    .map((value) => `Step-specific evaluation guidance:\n${value}`);
}
