import {spawnSync} from "node:child_process";
import {mkdir, readFile, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertSpawnSucceeded, resolveWorkspaceBinary} from "./package-harness-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const structural = path.join(root, "src", "styles.css");
const theme = path.join(root, "src", "theme.css");
const tailwindEntry = path.join(root, "src", "tailwind.entry.css");
const generated = path.join(root, ".generated", "tailwind.css");
const target = path.join(root, "dist", "styles.css");

for (const source of [tailwindEntry, theme, structural]) {
  const sourceStat = await stat(source);
  if (!sourceStat.isFile() || sourceStat.size === 0) {
    throw new Error(`${path.basename(source)} must exist and contain the package CSS.`);
  }
}

await mkdir(path.dirname(target), {recursive: true});
await mkdir(path.dirname(generated), {recursive: true});

const tailwind = spawnSync(
  resolveWorkspaceBinary(root, "tailwindcss"),
  ["--input", tailwindEntry, "--output", generated],
  {
    cwd: root,
    encoding: "utf8",
  },
);
assertSpawnSucceeded(tailwind, "Tailwind CSS build");

// Utility CSS comes first, then the hand-owned theme/component layer, then
// structural rules that intentionally win same-specificity cascade conflicts.
const css = [
  await readFile(generated, "utf8"),
  await readFile(theme, "utf8"),
  await readFile(structural, "utf8"),
].join("\n");
await writeFile(target, css);

console.log("Wrote dist/styles.css (Tailwind + theme + structural).");
