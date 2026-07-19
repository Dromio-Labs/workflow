import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const sdkRoot = fileURLToPath(new URL("../src/sdk", import.meta.url));

type Rule = {
  pattern: RegExp;
  term: string;
};

const disallowed: Rule[] = [
  { pattern: /\beval[-_ ]?exec\b/i, term: "eval-exec policy" },
  { pattern: /\bDromio Platform\b/i, term: "Dromio Platform product name" },
  { pattern: /\bsidecar\b/i, term: "sidecar route/surface" },
  { pattern: /\bETH\b|\bBTC\b|\bUSD\b|\bprice\.check\b|\bcoinbase\b/i, term: "asset/price demo policy" },
  { pattern: /\bwebhook\.send\b|\bhttpbin\b/i, term: "webhook demo policy" },
  { pattern: /\bexecutor\b|\bfixer\b|\bprepare-request\b/i, term: "eval-exec phase label" },
];

const failures: string[] = [];

for (const file of listFiles(sdkRoot)) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts")) {
    continue;
  }
  const source = readFileSync(file, "utf8");
  for (const rule of disallowed) {
    if (rule.pattern.test(source)) {
      failures.push(`${relative(process.cwd(), file)} contains disallowed ${rule.term}`);
    }
  }
}


if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("SDK boundary scan passed: 0 disallowed implementation terms");

function listFiles(root: string): string[] {
  const entries = readdirSync(root);
  return entries.flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    return stat.isDirectory() ? listFiles(path) : [path];
  });
}
