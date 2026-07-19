import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DromioValidateUsageError,
} from "./workflow-validate-types.js";

export async function workflowFilesForInput(input: {
  cwd: string;
  workflowId?: string;
}): Promise<string[]> {
  const workflowDir = path.join(input.cwd, ".dromio", "workflows");
  if (input.workflowId) {
    const filePath = path.join(workflowDir, `${input.workflowId}.workflow.json`);
    if (!existsSync(filePath)) {
      throw new DromioValidateUsageError(`Workflow not found: ${input.workflowId}`);
    }
    return [filePath];
  }
  if (!existsSync(workflowDir)) return [];
  const entries = await readdir(workflowDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".workflow.json"))
    .map((entry) => path.join(workflowDir, entry.name))
    .sort();
}

export async function workbenchName(cwd: string): Promise<string> {
  const packageJson = path.join(cwd, "package.json");
  if (!existsSync(packageJson)) return path.basename(cwd);
  const parsed = JSON.parse(await readFile(packageJson, "utf8")) as unknown;
  return isRecord(parsed) && typeof parsed.name === "string" ? parsed.name : path.basename(cwd);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
