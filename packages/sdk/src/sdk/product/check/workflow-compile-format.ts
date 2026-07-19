import type {
  DromioCompileOutput,
} from "./workflow-compile.js";

export function formatCompileOutput(output: DromioCompileOutput): string {
  const written = output.summary.written > 0 ? `, ${output.summary.written} written to ${output.outDir}` : "";
  const mode = output.mode === "render-only" ? " (render-only)" : "";
  const status = output.valid ? "passed" : "completed with validation errors";
  return `dromio compile${mode} ${status}: ${output.summary.compiled}/${output.summary.total} workflow artifacts${written}`;
}
