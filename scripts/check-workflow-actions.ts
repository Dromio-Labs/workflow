import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const workflowRoot = path.resolve(import.meta.dir, "../.github/workflows");
const workflowFiles = (await readdir(workflowRoot))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();
const mutableReferences: string[] = [];

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
}

if (mutableReferences.length > 0) {
  throw new Error(
    `External GitHub Actions must use immutable 40-character commit SHAs:\n${mutableReferences.join("\n")}`,
  );
}

console.log(`Verified immutable GitHub Action references in ${workflowFiles.length} workflows.`);
