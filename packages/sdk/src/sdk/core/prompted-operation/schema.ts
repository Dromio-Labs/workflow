import { z } from "zod";
import {
  candidateEvaluationStatusSchema,
  candidateNextActionSchema,
} from "../evaluation/schema.js";

export const promptedOperationDecisionStatusSchema = z.enum([
  "completed",
  "needs_input",
  "revise",
  "rejected",
  "failed",
]);

export const promptedOperationEvaluationSchema = z.object({
  gateId: z.string().trim().optional(),
  message: z.string().optional(),
  nextAction: candidateNextActionSchema,
  score: z.number().min(0).max(1),
  scorePolicyId: z.string().trim().optional(),
  status: candidateEvaluationStatusSchema,
});

export const promptedOperationDecisionSchema = z.object({
  gateId: z.string().trim().optional(),
  message: z.string().optional(),
  nextAction: candidateNextActionSchema,
  score: z.number().min(0).max(1),
  scorePolicyId: z.string().trim().min(1),
  status: promptedOperationDecisionStatusSchema,
});
