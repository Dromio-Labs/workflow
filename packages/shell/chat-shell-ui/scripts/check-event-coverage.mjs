import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const expectedPayloadFields = {
  "action.trigger": ["actionId", "surface"],
  "composer.submit": ["payload"],
  "menu.select": ["item", "menuId"],
  "panel.resize": ["panelId", "width"],
  "settings.change": ["settingId", "value"],
  "settings.close": ["open"],
  "settings.open": ["open"],
  "sidebar.toggle": ["collapsed"],
  "sidePanel.close": ["surfaceId"],
  "sidePanel.open": ["surfaceId"],
  "sidePanel.resize": ["surfaceId", "width"],
  "sidePanel.select": ["surfaceId"],
  "status.select": ["statusId"],
  "status.toggle": ["open"],
  "task.select": ["taskId"],
  "window.fullscreen.toggle": ["fullscreen"],
};

const sourceContracts = parseEventContracts(
  await readFile(path.join(root, "src/components/shell/ChatShell.types.ts"), "utf8"),
  "src/components/shell/ChatShell.types.ts",
);
const docsEvents = parseDocumentedEvents(await readFile(path.join(root, "docs/chat-shell/events.md"), "utf8"));
const coveredTestEvents = parseCoveredTestEvents(await Promise.all([
  readFile(path.join(root, "tests/unit/chat-shell.events-contract.test.tsx"), "utf8"),
  readFile(path.join(root, "tests/unit/chat-shell.interactions.test.tsx"), "utf8"),
]));

const distRootPath = path.join(root, "dist/chat-shell.d.ts");
const distTypesPath = path.join(root, "dist/components/shell/ChatShell.types.d.ts");

if (existsSync(distRootPath) && existsSync(distTypesPath)) {
  const distRoot = await readFile(distRootPath, "utf8");
  if (!/ChatShellEvent/.test(distRoot) || !/\.\/components\/shell\/ChatShell\.types/.test(distRoot)) {
    throw new Error("dist/chat-shell.d.ts must re-export ChatShellEvent from components/shell/ChatShell.types.");
  }

  const distContracts = parseEventContracts(await readFile(distTypesPath, "utf8"), "dist/components/shell/ChatShell.types.d.ts");
  assertContractMap("dist/components/shell/ChatShell.types.d.ts", distContracts, "source ChatShellEvent", sourceContracts);
}

assertContractMap("source ChatShellEvent", sourceContracts, "expected event payload fields", expectedPayloadFields);
assertSameSet("docs/chat-shell/events.md", Object.keys(docsEvents), "source ChatShellEvent", Object.keys(sourceContracts));
assertSameSet(
  "tests/unit/chat-shell.events-contract.test.tsx plus chat-shell.interactions.test.tsx",
  Object.keys(coveredTestEvents),
  "source ChatShellEvent",
  Object.keys(sourceContracts),
);

console.log(`Event coverage check passed: ${Object.keys(sourceContracts).sort().join(", ")} are exported, documented, and covered by unit event assertions.`);

function parseEventContracts(source, label) {
  const eventBodyMatch = /export type ChatShellEvent =([\s\S]*?)export type ChatShellEventHandler/.exec(source);
  if (!eventBodyMatch) {
    throw new Error(`Unable to find ChatShellEvent union in ${label}.`);
  }

  const contracts = {};
  const eventBody = eventBodyMatch[1];

  for (const blockMatch of eventBody.matchAll(/\{([\s\S]*?)\}(?:\s*\||;)/g)) {
    const block = blockMatch[1];
    const typeLine = /readonly type:\s*([^;]+);/.exec(block)?.[1];
    if (!typeLine) {
      continue;
    }

    const eventTypes = [...typeLine.matchAll(/"([^"]+)"/g)].map(([, eventType]) => eventType);
    const fields = [...block.matchAll(/readonly ([a-zA-Z][a-zA-Z0-9]*)(?:\??)?:/g)]
      .map(([, field]) => field)
      .filter((field) => field !== "type")
      .sort();

    for (const eventType of eventTypes) {
      contracts[eventType] = fields;
    }
  }

  if (Object.keys(contracts).length === 0) {
    throw new Error(`No ChatShellEvent type literals were found in ${label}.`);
  }

  return sortContractMap(contracts);
}

function parseDocumentedEvents(source) {
  const listMatch = /Current event types:\n\n([\s\S]*?)\n\nEvents describe/.exec(source);
  if (!listMatch) {
    throw new Error("docs/chat-shell/events.md must include a Current event types list.");
  }

  return Object.fromEntries(
    [...listMatch[1].matchAll(/^- `([^`]+)`/gm)].map(([, eventType]) => [eventType, true]).sort(),
  );
}

function parseCoveredTestEvents(sources) {
  return Object.fromEntries(
    [...new Set([...sources.join("\n").matchAll(/type: "([^"]+)"/g)].map((match) => match[1]))]
      .sort()
      .map((eventType) => [eventType, true]),
  );
}

function assertContractMap(actualLabel, actual, expectedLabel, expected) {
  assertSameSet(actualLabel, Object.keys(actual), expectedLabel, Object.keys(expected));

  for (const eventType of Object.keys(expected)) {
    assertSameSet(`${actualLabel} fields for ${eventType}`, actual[eventType], `${expectedLabel} fields for ${eventType}`, expected[eventType]);
  }
}

function assertSameSet(actualLabel, actualValues, expectedLabel, expectedValues) {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
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

function sortContractMap(contracts) {
  return Object.fromEntries(Object.entries(contracts).sort(([left], [right]) => left.localeCompare(right)));
}
