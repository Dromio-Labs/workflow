import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { WorkflowDocument } from "../product/index.js";

export type EvaluationEjectOptions = {
  directory: string | URL;
  exportName?: string;
  source: string | URL;
};

export type EvaluationEjectWriteResult = {
  documentPath: string;
  exportName: string;
  sourcePath: string;
};

type EjectSourceInput = {
  document: WorkflowDocument;
  options: EvaluationEjectOptions;
};

type EvaluationDeclaration = {
  argument: string;
  end: number;
  exportName: string;
  exported: boolean;
  start: number;
};

export function ejectEvaluationSource(input: EjectSourceInput): EvaluationEjectWriteResult {
  const sourcePath = filePath(input.options.source);
  const directory = filePath(input.options.directory);
  const originalSource = readFileSync(sourcePath, "utf8");
  const declaration = findDeclaration(originalSource, input.options.exportName);
  const documentPath = path.join(directory, `${input.document.id}.workflow.json`);
  const replacement = explicitEvaluationSource({
    argument: declaration.argument,
    documentPath,
    exportName: declaration.exportName,
    exported: declaration.exported,
    sourcePath,
  });
  const nextSource = `${originalSource.slice(0, declaration.start)}${replacement}${originalSource.slice(declaration.end)}`;
  atomicWrite([
    { content: `${JSON.stringify(input.document, null, 2)}\n`, path: documentPath },
    { content: nextSource, path: sourcePath },
  ]);
  return {
    documentPath,
    exportName: declaration.exportName,
    sourcePath,
  };
}

function explicitEvaluationSource(input: {
  argument: string;
  documentPath: string;
  exportName: string;
  exported: boolean;
  sourcePath: string;
}) {
  const name = input.exportName;
  const prefix = input.exported ? "export " : "";
  const documentUrl = relativeImport(input.sourcePath, input.documentPath);
  return `const ${name}Evaluation = (${input.argument});

${prefix}const ${name}Assessor = step.model({
  buildPrompt: (stepInput) => ${name}Evaluation.evaluator.buildPrompt?.({
    input: stepInput,
    policy: ${name}Evaluation.policy,
  }) ?? { input: stepInput, scorePolicy: ${name}Evaluation.policy },
  id: \`${"${"}${name}Evaluation.id}.assess\`,
  input: ${name}Evaluation.input,
  label: \`Assess ${"${"}${name}Evaluation.label ?? ${name}Evaluation.id}\`,
  model: ${name}Evaluation.evaluator.model,
  operation: ${name}Evaluation.evaluator.operation ?? "assess",
  output: ${name}Evaluation.evaluator.output,
  prompt: ${name}Evaluation.evaluator.prompt,
});

${prefix}const ${name}Gate = step.gate({
  id: \`${"${"}${name}Evaluation.id}.gate\`,
  input: ${name}Evaluation.evaluator.output,
  label: \`Gate ${"${"}${name}Evaluation.label ?? ${name}Evaluation.id}\`,
  policy: ${name}Evaluation.policy,
});

${prefix}const ${name}Workflow = workflow({
  catalog: [${name}Assessor, ${name}Gate],
  document: new URL(${JSON.stringify(documentUrl)}, import.meta.url),
  input: ${name}Evaluation.input,
  output: ${name}Gate.output,
});

${prefix}const ${name} = step.workflow({
  description: ${name}Evaluation.description,
  id: ${name}Evaluation.id,
  label: ${name}Evaluation.label,
  workflow: ${name}Workflow,
});`;
}

function findDeclaration(source: string, requestedName?: string): EvaluationDeclaration {
  const pattern = /(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*step\.evaluate\s*\(/g;
  const matches: EvaluationDeclaration[] = [];
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const open = pattern.lastIndex - 1;
    const close = matchingParenthesis(source, open);
    let end = close + 1;
    while (/\s/.test(source[end] ?? "")) end += 1;
    if (source[end] === ";") end += 1;
    matches.push({
      argument: source.slice(open + 1, close).trim(),
      end,
      exportName: match[2]!,
      exported: Boolean(match[1]),
      start: match.index,
    });
  }
  const selected = requestedName
    ? matches.find((match) => match.exportName === requestedName)
    : matches.length === 1 ? matches[0] : undefined;
  if (selected) return selected;
  if (requestedName) {
    throw new Error(`Cannot eject evaluation: step.evaluate declaration ${requestedName} was not found.`);
  }
  throw new Error(
    `Cannot eject evaluation: expected exactly one step.evaluate declaration, found ${matches.length}. Pass exportName to select one.`,
  );
}

function matchingParenthesis(source: string, open: number) {
  let depth = 0;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")" && --depth === 0) return index;
  }
  throw new Error("Cannot eject evaluation: step.evaluate call is not syntactically balanced.");
}

function relativeImport(sourcePath: string, targetPath: string) {
  const relative = path.relative(path.dirname(sourcePath), targetPath).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function atomicWrite(writes: Array<{ content: string; path: string }>) {
  const originals = new Map(writes.map((write) => [
    write.path,
    existsSync(write.path) ? readFileSync(write.path) : undefined,
  ]));
  const temporary = writes.map((write, index) => ({
    ...write,
    temporaryPath: `${write.path}.dromio-eject-${process.pid}-${index}`,
  }));
  try {
    for (const write of temporary) {
      mkdirSync(path.dirname(write.path), { recursive: true });
      writeFileSync(write.temporaryPath, write.content, { flag: "wx" });
    }
    for (const write of temporary) renameSync(write.temporaryPath, write.path);
  } catch (error) {
    for (const write of temporary) rmSync(write.temporaryPath, { force: true });
    for (const [pathname, content] of originals) {
      if (content) writeFileSync(pathname, content);
      else rmSync(pathname, { force: true });
    }
    throw error;
  }
}

function filePath(value: string | URL) {
  return value instanceof URL ? value.pathname : path.resolve(value);
}
