import { z } from "zod";

export const candidateNextActionSchema = z.enum([
  "ask",
  "suggest",
  "confirm",
  "revise",
  "execute",
  "complete",
  "cancel",
]);

export const candidateEvaluationStatusSchema = z.enum([
  "pass",
  "needs_input",
  "revise",
  "fail",
]);
