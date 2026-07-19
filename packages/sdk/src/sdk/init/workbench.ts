import {
  mkdir,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  workbenchStarterFiles,
} from "./workbench-template.js";

export type CreateWorkbenchStarterInput = {
  force?: boolean;
  packageName?: string;
  registry?: string;
  targetDir: string;
};

export type CreatedWorkbenchStarter = {
  files: string[];
  packageName: string;
  targetDir: string;
};

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

export async function createWorkbenchStarter(
  input: CreateWorkbenchStarterInput,
): Promise<CreatedWorkbenchStarter> {
  const targetDir = path.resolve(input.targetDir);
  const packageName = normalizePackageName(input.packageName ?? path.basename(targetDir));
  await ensureWritableTarget(targetDir, input.force === true);
  const context = {
    packageName,
    registry: normalizeRegistry(input.registry ?? DEFAULT_REGISTRY),
  };
  const files = workbenchStarterFiles(context);
  for (const file of files) {
    const filePath = path.join(targetDir, file.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content);
  }
  return {
    files: files.map((file) => file.path),
    packageName,
    targetDir,
  };
}

async function ensureWritableTarget(targetDir: string, force: boolean): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(targetDir);
  } catch (error) {
    if (isMissingPathError(error)) {
      await mkdir(targetDir, { recursive: true });
      return;
    }
    throw error;
  }
  if (entries.length > 0 && !force) {
    throw new Error(`Target directory is not empty: ${targetDir}`);
  }
}

function normalizePackageName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(normalized)) {
    throw new Error(`Invalid package name: ${value}`);
  }
  return normalized;
}

function normalizeRegistry(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Registry URL is required.");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
