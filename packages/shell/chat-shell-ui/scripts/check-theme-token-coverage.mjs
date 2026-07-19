import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const contractSource = await readFile(path.join(root, "src/contracts/chatShellManifest.ts"), "utf8");
const appearanceSource = await readFile(path.join(root, "src/components/shell/chatShellAppearance.ts"), "utf8");
const themingDoc = await readFile(path.join(root, "docs/chat-shell/theming.md"), "utf8");

const schemaTokens = extractSchemaTokenKeys(contractSource);
const runtimeTokens = extractRuntimeTokenMap(appearanceSource);
const documentedTokens = extractDocumentedTokens(themingDoc);

assertSameSet("runtime token map", Object.keys(runtimeTokens).sort(), "appearance token schema", schemaTokens);
assertSameSet("docs/chat-shell/theming.md token reference", documentedTokens, "appearance token schema", schemaTokens);

for (const token of schemaTokens) {
  const canonicalVariable = `--chat-shell-color-${toKebabCase(token)}`;

  if (!runtimeTokens[token].includes(canonicalVariable)) {
    throw new Error(`tokenVariableMap.${token} must include canonical CSS variable ${canonicalVariable}.`);
  }
}

if (!themingDoc.includes("`npm run check:theme`")) {
  throw new Error("docs/chat-shell/theming.md must mention `npm run check:theme`.");
}

console.log(`Theme token coverage check passed: ${schemaTokens.join(", ")} are schema-backed, runtime-mapped, and documented.`);

function extractSchemaTokenKeys(source) {
  const match = source.match(
    /export const ChatShellAppearanceTokenOverridesSchema = z\s*\.object\(\{([\s\S]*?)\}\)\s*\.strict\(\);/,
  );
  if (!match) {
    throw new Error("Unable to find ChatShellAppearanceTokenOverridesSchema.");
  }
  const tokens = [...match[1].matchAll(/^\s+([a-z][a-zA-Z0-9]*):\s*ChatShellCssValueSchema\.optional\(\),$/gm)]
    .map(([, token]) => token)
    .sort();

  if (tokens.length === 0) {
    throw new Error("Unable to extract appearance token keys from ChatShellAppearanceTokenOverridesSchema.");
  }

  return tokens;
}

function extractRuntimeTokenMap(source) {
  const body = extractBetween(source, "const tokenVariableMap = {", "\n} satisfies", "tokenVariableMap");
  const entries = [...body.matchAll(/^\s+([a-z][a-zA-Z0-9]*):\s*\[([^\]]+)\],$/gm)].map(([, token, rawVariables]) => {
    const variables = [...rawVariables.matchAll(/"([^"]+)"/g)].map(([, variable]) => variable);

    if (variables.length === 0) {
      throw new Error(`tokenVariableMap.${token} must map to at least one CSS variable.`);
    }

    for (const variable of variables) {
      if (!variable.startsWith("--")) {
        throw new Error(`tokenVariableMap.${token} contains non-CSS-variable entry ${variable}.`);
      }
    }

    return [token, variables];
  });

  if (entries.length === 0) {
    throw new Error("Unable to extract runtime token keys from tokenVariableMap.");
  }

  return Object.fromEntries(entries);
}

function extractDocumentedTokens(source) {
  const body = extractBetween(source, "## Token Overrides", "## Runtime Application", "theming token reference");
  return [...body.matchAll(/`([a-z][a-zA-Z0-9]*)`/g)].map(([, token]) => token).sort();
}

function extractBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Unable to find ${label} start marker.`);
  }

  const bodyStart = start + startMarker.length;
  const end = source.indexOf(endMarker, bodyStart);
  if (end === -1) {
    throw new Error(`Unable to find ${label} end marker.`);
  }

  return source.slice(bodyStart, end);
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

function toKebabCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

