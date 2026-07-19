import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts?: Record<string, string>;
};

const publicScripts = ["demo", "demo1", "demo2", "demo3:cli", "demo3:web"];
const bannedScriptNames = [
  "demo2:fixture",
  "demo3:fixture",
  "demo3:smoke",
  "smoke",
  "smoke:demo2:fixture",
  "smoke:demo2:live",
  "smoke:file-state",
];
const failures: string[] = [];

for (const name of publicScripts) {
  const script = packageJson.scripts?.[name] ?? "";
  if (!script) continue;
  if (/\bEVAL_EXEC_V4_BACKEND=demo\b/.test(script)) {
    failures.push(`Public demo script ${name} forces the deterministic demo backend.`);
  }
  if (/(^|\s)--fixture(\s|$)/.test(script)) {
    failures.push(`Public demo script ${name} runs fixture mode.`);
  }
}

for (const name of bannedScriptNames) {
  if (packageJson.scripts?.[name]) {
    failures.push(`Remove deterministic public/test script: ${name}`);
  }
}

for (const [name, script] of Object.entries(packageJson.scripts ?? {})) {
  if (/\bEVAL_EXEC_V4_BACKEND=demo\b/.test(script)) {
    failures.push(`Script ${name} selects the removed demo backend.`);
  }
  if (/(^|\s)--fixture(\s|$)/.test(script)) {
    failures.push(`Script ${name} selects removed fixture mode.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Public demo determinism check passed");
