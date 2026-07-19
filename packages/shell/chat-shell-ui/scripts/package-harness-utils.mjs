import {existsSync} from "node:fs";
import path from "node:path";

export function resolveWorkspaceBinary(startDirectory, binaryName) {
  const binaryFile = process.platform === "win32" ? `${binaryName}.cmd` : binaryName;
  const binaryPath = findUp(startDirectory, ["node_modules", ".bin", binaryFile]);

  if (!binaryPath) {
    throw new Error(`Could not resolve ${binaryFile} from any node_modules/.bin directory above ${startDirectory}.`);
  }

  return binaryPath;
}

export function resolveWorkspaceDependency(startDirectory, packageName) {
  const dependencyPath = findUp(startDirectory, ["node_modules", ...packageName.split("/")]);

  if (!dependencyPath) {
    throw new Error(`Missing workspace dependency for package harness: ${packageName}`);
  }

  return dependencyPath;
}

export function resolveWorkspaceNodeModules(startDirectory) {
  const nodeModulesPath = findUp(startDirectory, ["node_modules"]);

  if (!nodeModulesPath) {
    throw new Error(`Could not resolve a node_modules directory above ${startDirectory}.`);
  }

  return nodeModulesPath;
}

export function resolveWorkspaceNodeModulesForDependency(startDirectory, packageName) {
  let dependencyPath = resolveWorkspaceDependency(startDirectory, packageName);

  for (const _part of packageName.split("/")) {
    dependencyPath = path.dirname(dependencyPath);
  }

  return dependencyPath;
}

export function localDependencySpec(startDirectory, packageName) {
  return `file:${resolveWorkspaceDependency(startDirectory, packageName)}`;
}

export function assertSpawnSucceeded(result, label) {
  if (result.status === 0) {
    return;
  }

  const details = result.error
    ? `${result.error.name}: ${result.error.message}`
    : `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  throw new Error(`${label} failed:\n${details}`);
}

function findUp(startDirectory, relativeParts) {
  for (let directory = path.resolve(startDirectory); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, ...relativeParts);
    if (existsSync(candidate)) {
      return candidate;
    }

    if (directory === path.dirname(directory)) {
      return undefined;
    }
  }
}
