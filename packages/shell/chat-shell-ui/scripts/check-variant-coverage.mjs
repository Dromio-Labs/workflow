import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredMockManifestKeys = new Set(["default"]);

const mockBackendSource = await readFile(path.join(root, "src/data/mockBackendChatShell.ts"), "utf8");
const variantsDoc = await readFile(path.join(root, "docs/chat-shell/variants.md"), "utf8");
const visualSpec = await readFile(path.join(root, "tests/e2e/chat-shell.visual.spec.ts"), "utf8");

const mockVariantKeys = extractMockVariantKeys(mockBackendSource).filter((variant) => !ignoredMockManifestKeys.has(variant));
const documentedVariants = extractVariantQueryValues(variantsDoc);
const visuallyCoveredVariants = extractVariantQueryValues(visualSpec);

assertSameSet("docs/chat-shell/variants.md", documentedVariants, "mock backend variants", mockVariantKeys);
assertSameSet("tests/e2e/chat-shell.visual.spec.ts", visuallyCoveredVariants, "documented variants", documentedVariants);

for (const variant of documentedVariants) {
  if (!variantsDoc.includes(`\`${variant}\``)) {
    throw new Error(`docs/chat-shell/variants.md must include a variant mapping bullet for \`${variant}\`.`);
  }
}

console.log(`Variant coverage check passed: ${documentedVariants.join(", ")} are documented and covered by visual smoke routes.`);

function extractMockVariantKeys(source) {
  const match = /export const mockChatShellManifests = \{([\s\S]*?)\n\} satisfies/.exec(source);
  if (!match) {
    throw new Error("Unable to find mockChatShellManifests export in src/data/mockBackendChatShell.ts.");
  }

  return [...match[1].matchAll(/^\s{2}([a-z][a-z0-9-]*):/gm)].map(([, key]) => key).sort();
}

function extractVariantQueryValues(source) {
  return [...new Set([...source.matchAll(/\?variant=([a-z][a-z0-9-]*)/g)].map(([, variant]) => variant))].sort();
}

function assertSameSet(actualLabel, actual, expectedLabel, expected) {
  const missing = expected.filter((entry) => !actual.includes(entry));
  const unexpected = actual.filter((entry) => !expected.includes(entry));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${actualLabel} does not match ${expectedLabel}. Missing: ${missing.join(", ") || "none"}. Unexpected: ${
        unexpected.join(", ") || "none"
      }.`,
    );
  }
}
