import { defineScorePolicy } from "../../core/index.js";

export const requestIntakeScorePolicy = defineScorePolicy({
  gaps: [
    {
      description: "The request does not contain enough clarified context for the next worker.",
      id: "request-underclarified",
      severity: "high",
    },
    {
      description: "Important user constraints, assumptions, or answers are missing.",
      id: "missing-context",
      severity: "medium",
    },
  ],
  gates: [
    {
      id: "gate.pass",
      minScore: 0.8,
      nextAction: "complete",
      status: "pass",
    },
    {
      id: "gate.revise",
      minScore: 0,
      nextAction: "revise",
      status: "revise",
    },
  ],
  id: "score.request-intake",
  risks: [],
  satisfies: [
    {
      description: "The request captures the user's objective.",
      id: "captures-objective",
    },
    {
      description: "The request records constraints and assumptions.",
      id: "captures-context",
    },
    {
      description: "The request is ready for a downstream worker.",
      id: "worker-ready",
    },
  ],
});
