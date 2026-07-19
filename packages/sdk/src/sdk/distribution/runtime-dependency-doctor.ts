import {
  execFile,
} from "node:child_process";
import {
  constants,
} from "node:fs";
import {
  access,
} from "node:fs/promises";
import path from "node:path";
import {
  promisify,
} from "node:util";
import type {
  WorkflowCatalogRuntimeDependency,
} from "../product/catalog/catalog.js";

const execFileAsync = promisify(execFile);

export type RuntimeDependencyDoctorStatus = "missing" | "ok" | "warning";

export type ResolvedRuntimeDependency = WorkflowCatalogRuntimeDependency & {
  source?: string;
  value?: string;
};

export type RuntimeDependencyDoctorCheck = {
  description?: string;
  env?: string | readonly string[];
  id: string;
  install?: {
    linux?: string;
    macos?: string;
    notes?: string;
  };
  kind: "command" | "env" | "http";
  label: string;
  message: string;
  required: boolean;
  status: RuntimeDependencyDoctorStatus;
  value?: string;
};

export type WorkflowRuntimeDependencyDoctorReport = {
  checks: RuntimeDependencyDoctorCheck[];
  ok: boolean;
  title: string;
  workflowId: string;
};

export type RuntimeDependencyDoctorReport = {
  checkedAt: string;
  ok: boolean;
  workflows: WorkflowRuntimeDependencyDoctorReport[];
};

export type RunRuntimeDependencyDoctorInput = {
  checkCommand?: (binary: string) => Promise<boolean> | boolean;
  checkHttp?: boolean;
  fetch?: typeof fetch;
  workflows: Array<{
    dependencies: readonly ResolvedRuntimeDependency[];
    title: string;
    workflowId: string;
  }>;
};

export async function runRuntimeDependencyDoctor(
  input: RunRuntimeDependencyDoctorInput,
): Promise<RuntimeDependencyDoctorReport> {
  const workflows = await Promise.all(input.workflows.map(async (workflow) => {
    const checks = await Promise.all(workflow.dependencies.map((dependency) =>
      checkRuntimeDependency(dependency, input)
    ));
    return {
      checks,
      ok: checks.every((check) => check.status !== "missing"),
      title: workflow.title,
      workflowId: workflow.workflowId,
    };
  }));
  return {
    checkedAt: new Date().toISOString(),
    ok: workflows.every((workflow) => workflow.ok),
    workflows,
  };
}

export function formatRuntimeDependencyDoctorReport(
  report: RuntimeDependencyDoctorReport,
  input: { allPassedMessage?: string; onlyProblems?: boolean } = {},
): string {
  const lines: string[] = [];
  for (const workflow of report.workflows) {
    const checks = input.onlyProblems
      ? workflow.checks.filter((check) => check.status !== "ok")
      : workflow.checks;
    if (checks.length === 0) continue;
    lines.push(`${workflow.title}`);
    for (const check of checks) {
      lines.push(`${doctorStatusLabel(check.status)} ${check.label}: ${check.message}`);
      const install = installHint(check);
      if (install && check.status !== "ok") lines.push(`  install: ${install}`);
    }
  }
  if (lines.length === 0) return input.allPassedMessage ?? "doctor: all checks passed.";
  return lines.join("\n");
}

async function checkRuntimeDependency(
  dependency: ResolvedRuntimeDependency,
  input: RunRuntimeDependencyDoctorInput,
): Promise<RuntimeDependencyDoctorCheck> {
  if (dependency.kind === "command") {
    const value = String(dependency.value ?? dependency.binary ?? "");
    const exists = await (input.checkCommand ?? commandAvailable)(value);
    return dependencyCheck(dependency, {
      message: exists ? `${value} (${dependency.source ?? "config"})` : `${value} not found on PATH`,
      status: exists ? "ok" : "missing",
      value,
    });
  }

  if (dependency.kind === "http") {
    const value = String(dependency.value ?? "");
    const status = input.checkHttp === false
      ? { ok: true, message: `${value} (not probed)` }
      : await checkHttpEndpoint(value, input.fetch ?? fetch);
    return dependencyCheck(dependency, {
      message: status.message,
      status: status.ok ? "ok" : "warning",
      value,
    });
  }

  const envNames = Array.isArray(dependency.env) ? dependency.env : dependency.env ? [dependency.env] : [];
  const value = dependency.value ?? envNames.map((name: string) => process.env[name]).find(Boolean);
  return dependencyCheck(dependency, {
    message: value ? "configured" : `${envNames.join(" or ") || dependency.id} is not configured`,
    status: value ? "ok" : "missing",
    value,
  });
}

function dependencyCheck(
  dependency: ResolvedRuntimeDependency,
  result: {
    message: string;
    status: RuntimeDependencyDoctorStatus;
    value?: string;
  },
): RuntimeDependencyDoctorCheck {
  return {
    description: dependency.description,
    env: dependency.env,
    id: dependency.id,
    install: dependency.install,
    kind: dependency.kind,
    label: dependency.label ?? dependency.id,
    message: result.message,
    required: dependency.required !== false,
    status: dependency.required === false && result.status === "missing" ? "warning" : result.status,
    value: result.value,
  };
}

async function commandAvailable(binary: string): Promise<boolean> {
  if (!binary) return false;
  if (path.isAbsolute(binary)) {
    try {
      await access(binary, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await execFileAsync("which", [binary], { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

async function checkHttpEndpoint(baseUrl: string, fetchImpl: typeof fetch): Promise<{ message: string; ok: boolean }> {
  if (!baseUrl) return { message: "endpoint is not configured", ok: false };
  const url = new URL("models", ensureTrailingSlash(baseUrl));
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(1_500),
    });
    if (response.ok) return { message: `${baseUrl} reachable`, ok: true };
    if (response.status === 401 || response.status === 403) {
      return { message: `${baseUrl} reachable but returned ${response.status}`, ok: true };
    }
    return { message: `${baseUrl} returned ${response.status}`, ok: false };
  } catch (error) {
    return {
      message: `${baseUrl} not reachable (${error instanceof Error ? error.message : String(error)})`,
      ok: false,
    };
  }
}

function installHint(check: RuntimeDependencyDoctorCheck): string | undefined {
  if (process.platform === "darwin" && check.install?.macos) return check.install.macos;
  if (process.platform === "linux" && check.install?.linux) return check.install.linux;
  return check.install?.notes;
}

function doctorStatusLabel(status: RuntimeDependencyDoctorStatus): string {
  if (status === "ok") return "ok";
  if (status === "warning") return "warn";
  return "missing";
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
