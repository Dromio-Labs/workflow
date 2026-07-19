import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {collectClassRules, sameBodySet} from "./css-parity/css-rules.mjs";
import {extractUsedClassTokens, listSourceFiles} from "./css-parity/source-tokens.mjs";
import {assertSpawnSucceeded, resolveWorkspaceBinary} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const tailwindEntry = path.join(sourceRoot, "tailwind.entry.css");
const generatedCssPath = path.join(root, ".generated", "tailwind.css");
const oracleCssPath = path.join(sourceRoot, "utilities.css");
const themeCssPath = path.join(sourceRoot, "theme.css");
const structuralCssPath = path.join(sourceRoot, "styles.css");
const allowlistPath = path.join(root, "scripts", "css-non-utility-allowlist.json");

const generated = spawnSync(
  resolveWorkspaceBinary(root, "tailwindcss"),
  ["--input", tailwindEntry, "--output", generatedCssPath],
  {
    cwd: root,
    encoding: "utf8",
  },
);
assertSpawnSucceeded(generated, "Tailwind CSS parity build");

const sourceFiles = await listSourceFiles(sourceRoot);
const usedTokens = await extractUsedClassTokens(sourceFiles);
const generatedRules = collectClassRules(await readFile(generatedCssPath, "utf8"));
const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
const knownNonUtilityTokens = new Set([
  ...collectClassRules(await readFile(themeCssPath, "utf8"), {allSelectorClasses: true}).keys(),
  ...collectClassRules(await readFile(structuralCssPath, "utf8"), {allSelectorClasses: true}).keys(),
]);
for (const token of usedTokens) {
  if (isAllowlisted(token, allowlist)) {
    knownNonUtilityTokens.add(token);
  }
}

if (existsSync(oracleCssPath)) {
  const oracleRules = collectClassRules(await readFile(oracleCssPath, "utf8"));
  const mismatches = [];
  const warnings = [];
  let compared = 0;
  let knownNonUtility = 0;

  for (const token of usedTokens) {
    const oracleBodies = oracleRules.get(token);
    const generatedBodies = generatedRules.get(token);

    if (!oracleBodies && !generatedBodies && !knownNonUtilityTokens.has(token)) {
      warnings.push(token);
      continue;
    }

    if (!oracleBodies || knownNonUtilityTokens.has(token)) {
      if (knownNonUtilityTokens.has(token)) {
        knownNonUtility += 1;
      }
      continue;
    }

    compared += 1;
    if (!generatedBodies || !sameBodySet(oracleBodies, generatedBodies)) {
      mismatches.push({
        token,
        oracle: oracleBodies.map((body) => body.raw).sort(),
        generated: generatedBodies?.map((body) => body.raw).sort() ?? [],
        oracleNormalized: oracleBodies.map((body) => body.normalized).sort(),
        generatedNormalized: generatedBodies?.map((body) => body.normalized).sort() ?? [],
      });
    }
  }

  printWarnings(warnings);

  if (mismatches.length > 0) {
    console.error(`CSS parity failed with ${mismatches.length} mismatched class token(s).`);
    for (const mismatch of mismatches) {
      console.error(`\n${mismatch.token}`);
      console.error("  oracle:");
      for (const body of mismatch.oracle) {
        console.error(`    ${body}`);
      }
      console.error("  generated:");
      for (const body of mismatch.generated) {
        console.error(`    ${body}`);
      }
      if (process.env.CSS_PARITY_DEBUG === "1") {
        console.error("  oracle normalized:");
        for (const body of mismatch.oracleNormalized) {
          console.error(`    ${body}`);
        }
        console.error("  generated normalized:");
        for (const body of mismatch.generatedNormalized) {
          console.error(`    ${body}`);
        }
      }
    }
    process.exit(1);
  }

  console.log(
    `CSS parity passed (oracle mode): ${compared} utility token(s) matched, ` +
      `${knownNonUtility} known non-utility token(s), ${warnings.length} warning(s).`,
  );
} else {
  const missing = [];
  const warnings = [];
  let generatedCount = 0;
  let knownNonUtility = 0;

  for (const token of usedTokens) {
    if (generatedRules.has(token)) {
      generatedCount += 1;
    } else if (knownNonUtilityTokens.has(token)) {
      knownNonUtility += 1;
    } else {
      missing.push(token);
      warnings.push(token);
    }
  }

  printWarnings(warnings);

  if (missing.length > 0) {
    console.error(`CSS parity failed (post-oracle mode): ${missing.length} used token(s) are uncovered.`);
    for (const token of missing) {
      console.error(`  ${token}`);
    }
    process.exit(1);
  }

  console.log(
    `CSS parity passed (post-oracle mode): ${generatedCount} generated utility token(s), ` +
      `${knownNonUtility} known non-utility token(s), ${warnings.length} warning(s).`,
  );
}

function printWarnings(warnings) {
  if (warnings.length === 0) {
    return;
  }

  console.warn(`CSS parity warnings: ${warnings.length} used token(s) were not found in generated/theme/structural CSS.`);
  for (const token of warnings.sort()) {
    console.warn(`  ${token}`);
  }
}

function isAllowlisted(token, allowlist) {
  return allowlist.exact.includes(token) || allowlist.prefixes.some((prefix) => token.startsWith(prefix));
}
