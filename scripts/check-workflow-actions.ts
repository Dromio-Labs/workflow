import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const workflowRoot = path.resolve(import.meta.dir, "../.github/workflows");
const workflowFiles = (await readdir(workflowRoot))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
const mutableReferences: string[] = [];
const permissionFindings: string[] = [];

for (const workflowFile of workflowFiles) {
  const contents = await readFile(path.join(workflowRoot, workflowFile), "utf8");
  for (const [index, line] of contents.split("\n").entries()) {
    const reference = line.match(/^\s*-\s+uses:\s+([^\s#]+)/)?.[1];
    if (!reference || reference.startsWith("./")) {
      continue;
    }
    if (!/^[^@\s]+@[0-9a-f]{40}$/.test(reference)) {
      mutableReferences.push(`${workflowFile}:${index + 1}: ${reference}`);
    }
  }

  if (workflowFile === "release.yml") {
    const publishStart = contents.indexOf("  publish-next:\n");
    const verifyStart = contents.indexOf("  verify-next:\n");
    const repairStart = contents.indexOf("  repair-next-tags:\n");
    const promoteStart = contents.indexOf("  promote-latest:\n");
    const publishJob = contents.slice(publishStart, verifyStart);
    const repairJob = contents.slice(repairStart, promoteStart);
    const oidcGrantCount = contents.match(/^      id-token: write$/gm)?.length ?? 0;
    if (
      publishStart < 0 ||
      verifyStart < 0 ||
      repairStart < 0 ||
      promoteStart < 0 ||
      !/^    permissions:\n      contents: read\n      id-token: write$/m.test(publishJob) ||
      oidcGrantCount !== 1
    ) {
      permissionFindings.push(
        "release.yml: only publish-next may grant contents: read and id-token: write for npm provenance",
      );
    }
    if (
      !/^    environment: npm-prerelease$/m.test(repairJob) ||
      !/^          DROMIO_RELEASE_CONFIRM: repair-next-tags$/m.test(repairJob) ||
      !/^          NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}$/m.test(repairJob) ||
      /^    permissions:/m.test(repairJob)
    ) {
      permissionFindings.push(
        "release.yml: repair-next-tags must use the protected prerelease token without an OIDC grant",
      );
    }
  }
}

if (mutableReferences.length > 0) {
  throw new Error(
    `External GitHub Actions must use immutable 40-character commit SHAs:\n${mutableReferences.join("\n")}`,
  );
}

if (permissionFindings.length > 0) {
  throw new Error(`Release permissions violate least privilege:\n${permissionFindings.join("\n")}`);
}

console.log(
  `Verified immutable GitHub Action references and least-privilege release permissions in ${workflowFiles.length} workflows.`,
);
