import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { workflowDocumentSchema } from "../workflow-document/index.js";

export type IntentCheckIssue = {
  column: number;
  filePath: string;
  message: string;
  rule: string;
  line: number;
};

export type IntentCheckOptions = {
  cwd?: string;
  files?: string[];
  fix?: boolean;
};

export type IntentCheckResult = {
  fixedFiles: number;
  issues: IntentCheckIssue[];
};

const CHECKED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const CHECKED_JSON_SUFFIXES = [".workflow.json"];
const WORKFLOW_CONFIG_FILE = "config.json";
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const STEP_CONFIG_ORDER = [
  "id",
  "label",
  "description",
  "kind",
  "input",
  "output",
  "config",
  "model",
  "operation",
  "prompt",
  "buildPrompt",
  "evaluator",
  "policy",
  "workflow",
  "prepare",
  "items",
  "childInput",
  "collect",
  "continueOnError",
  "itemId",
  "itemKind",
  "itemLabel",
  "itemLabelPath",
  "itemSource",
  "iterationLabel",
  "onItemCompleted",
  "onItemFailed",
  "onItemStarted",
  "workflowConfig",
  "branches",
  "maxRetries",
  "run",
];

export async function checkIntentProject(options: IntentCheckOptions = {}): Promise<IntentCheckResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const files = options.files?.length
    ? options.files.map((file) => path.resolve(cwd, file))
    : await collectIntentCheckFiles(cwd);
  const issues: IntentCheckIssue[] = [];
  let fixedFiles = 0;

  for (const filePath of files) {
    if (isWorkflowJsonFile(filePath)) {
      issues.push(...await checkWorkflowJsonFile(filePath, cwd));
      continue;
    }
    if (!CHECKED_EXTENSIONS.has(path.extname(filePath))) continue;
    const sourceText = await readFile(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const stepIssues = checkStepConfigOrder(sourceFile, cwd);
    const workflowEnvIssues = await checkWorkflowEnvConfigFile(sourceFile, cwd);
    if (options.fix && stepIssues.length > 0) {
      const fixedSource = fixStepConfigOrder(sourceFile, sourceText);
      if (fixedSource !== sourceText) {
        await writeFile(filePath, fixedSource);
        fixedFiles += 1;
        const fixedSourceFile = ts.createSourceFile(
          filePath,
          fixedSource,
          ts.ScriptTarget.Latest,
          true,
          filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        issues.push(
          ...checkStepConfigOrder(fixedSourceFile, cwd),
          ...await checkWorkflowEnvConfigFile(fixedSourceFile, cwd),
        );
        continue;
      }
    }
    issues.push(...stepIssues, ...workflowEnvIssues);
  }

  return { fixedFiles, issues };
}

export function formatIntentCheckIssues(result: IntentCheckResult): string {
  return result.issues
    .map((issue) => `${issue.filePath}:${issue.line}:${issue.column} ${issue.rule} ${issue.message}`)
    .join("\n");
}

async function collectIntentCheckFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...await collectIntentCheckFiles(entryPath));
      }
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!CHECKED_EXTENSIONS.has(path.extname(entry.name)) && !isWorkflowJsonFile(entry.name)) continue;
    if (entry.isSymbolicLink() && !(await isFile(entryPath))) continue;
    files.push(entryPath);
  }

  return files;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function checkWorkflowJsonFile(filePath: string, cwd: string): Promise<IntentCheckIssue[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    return [issueForFile({
      cwd,
      filePath,
      message: error instanceof Error ? error.message : "Workflow JSON could not be parsed.",
      rule: "workflow-sdk/workflow-json",
    })];
  }
  const result = workflowDocumentSchema.safeParse(parsed);
  if (result.success) return [];
  return result.error.issues.map((issue) => issueForFile({
    cwd,
    filePath,
    message: `${issue.path.join(".") || "$"}: ${issue.message}`,
    rule: "workflow-sdk/workflow-document-schema",
  }));
}

function isWorkflowJsonFile(filePath: string): boolean {
  return CHECKED_JSON_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}

function checkStepConfigOrder(sourceFile: ts.SourceFile, cwd: string): IntentCheckIssue[] {
  const issues: IntentCheckIssue[] = [];

  function visit(node: ts.Node) {
    if (!ts.isCallExpression(node) || !isStepFactoryCall(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const config = node.arguments[0];
    if (!config || !ts.isObjectLiteralExpression(config)) {
      ts.forEachChild(node, visit);
      return;
    }

    const properties = namedConfigProperties(config);
    const first = properties[0];
    if (first?.name !== "id") {
      issues.push(issueForNode({
        cwd,
        message: `step config should put "id" first.`,
        node: first?.node ?? config,
        rule: "workflow-sdk/step-config-order",
        sourceFile,
      }));
    }

    const orderedNames = properties
      .map((property) => property.name)
      .filter((name) => STEP_CONFIG_ORDER.includes(name));
    const expectedNames = [...orderedNames].sort(
      (left, right) => STEP_CONFIG_ORDER.indexOf(left) - STEP_CONFIG_ORDER.indexOf(right),
    );
    const misplaced = orderedNames.find((name, index) => name !== expectedNames[index]);
    if (misplaced && misplaced !== "id") {
      const expected = expectedNames.join(", ");
      issues.push(issueForNode({
        cwd,
        message: `step config keys should follow SDK order: ${expected}.`,
        node: properties.find((property) => property.name === misplaced)?.node ?? config,
        rule: "workflow-sdk/step-config-order",
        sourceFile,
      }));
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

async function checkWorkflowEnvConfigFile(sourceFile: ts.SourceFile, cwd: string): Promise<IntentCheckIssue[]> {
  const workflowDirectory = workflowDirectoryForFile(sourceFile.fileName, cwd);
  if (!workflowDirectory) return [];
  const envNode = firstProcessEnvAccess(sourceFile);
  if (!envNode) return [];
  if (await isFile(path.join(workflowDirectory.absolutePath, WORKFLOW_CONFIG_FILE))) return [];
  const configPath = path.join(workflowDirectory.relativePath, WORKFLOW_CONFIG_FILE);
  return [issueForNode({
    cwd,
    message: `Workflow code reads process.env but ${configPath} is missing. Add a workflow config file for non-secret defaults; keep secrets in env.`,
    node: envNode,
    rule: "workflow-sdk/workflow-env-config-file",
    sourceFile,
  })];
}

function workflowDirectoryForFile(filePath: string, cwd: string) {
  const relativePath = path.relative(cwd, filePath);
  const parts = relativePath.split(path.sep);
  if (parts[0] !== "workflows" || parts.length < 3) return undefined;
  return {
    absolutePath: path.join(cwd, "workflows", parts[1]!),
    relativePath: path.join("workflows", parts[1]!),
  };
}

function firstProcessEnvAccess(sourceFile: ts.SourceFile): ts.Node | undefined {
  let match: ts.Node | undefined;

  function visit(node: ts.Node) {
    if (match) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process"
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return match;
}

function fixStepConfigOrder(sourceFile: ts.SourceFile, sourceText: string): string {
  const edits: Array<{ end: number; start: number; text: string }> = [];

  function visit(node: ts.Node) {
    if (!ts.isCallExpression(node) || !isStepFactoryCall(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const config = node.arguments[0];
    if (!config || !ts.isObjectLiteralExpression(config)) {
      ts.forEachChild(node, visit);
      return;
    }

    const properties = config.properties;
    if (properties.length < 2) {
      ts.forEachChild(node, visit);
      return;
    }

    const sortedProperties = [...properties].sort((left, right) => {
      const leftOrder = stepConfigPropertyOrder(left);
      const rightOrder = stepConfigPropertyOrder(right);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.pos - right.pos;
    });
    if (sortedProperties.every((property, index) => property === properties[index])) {
      ts.forEachChild(node, visit);
      return;
    }

    const segments = new Map<ts.ObjectLiteralElementLike, string>();
    for (const property of properties) {
      segments.set(property, propertySegment(sourceText, property));
    }
    edits.push({
      end: propertySegmentEnd(sourceText, properties[properties.length - 1]!),
      start: properties[0]!.getFullStart(),
      text: sortedProperties.map((property) => segments.get(property)).join(""),
    });

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return applyEdits(sourceText, edits);
}

function isStepFactoryCall(node: ts.CallExpression): boolean {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text === "step";
  if (!ts.isPropertyAccessExpression(expression)) return false;
  return ts.isIdentifier(expression.expression) && expression.expression.text === "step";
}

function namedConfigProperties(node: ts.ObjectLiteralExpression) {
  return node.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property) && !ts.isShorthandPropertyAssignment(property)) {
      return [];
    }
    const name = property.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return [{ name: name.text, node: property }];
    }
    return [];
  });
}

function stepConfigPropertyOrder(property: ts.ObjectLiteralElementLike): number {
  const name = propertyName(property);
  if (!name) return STEP_CONFIG_ORDER.length;
  const order = STEP_CONFIG_ORDER.indexOf(name);
  return order === -1 ? STEP_CONFIG_ORDER.length : order;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property) && !ts.isShorthandPropertyAssignment(property)) {
    return undefined;
  }
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function propertySegment(sourceText: string, property: ts.ObjectLiteralElementLike): string {
  const segment = sourceText.slice(property.getFullStart(), propertySegmentEnd(sourceText, property));
  const trailingWhitespace = segment.match(/\s*$/)?.[0] ?? "";
  const content = segment.slice(0, segment.length - trailingWhitespace.length);
  return content.endsWith(",")
    ? segment
    : `${content},${trailingWhitespace}`;
}

function propertySegmentEnd(sourceText: string, property: ts.ObjectLiteralElementLike): number {
  let end = property.end;
  while (end < sourceText.length && /\s/.test(sourceText[end]!)) end += 1;
  if (sourceText[end] === ",") end += 1;
  return end;
}

function applyEdits(sourceText: string, edits: Array<{ end: number; start: number; text: string }>): string {
  return [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce((text, edit) => `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`, sourceText);
}

function issueForNode(input: {
  cwd: string;
  message: string;
  node: ts.Node;
  rule: string;
  sourceFile: ts.SourceFile;
}): IntentCheckIssue {
  const position = input.sourceFile.getLineAndCharacterOfPosition(input.node.getStart(input.sourceFile));
  return {
    column: position.character + 1,
    filePath: path.relative(input.cwd, input.sourceFile.fileName),
    line: position.line + 1,
    message: input.message,
    rule: input.rule,
  };
}

function issueForFile(input: {
  cwd: string;
  filePath: string;
  message: string;
  rule: string;
}): IntentCheckIssue {
  return {
    column: 1,
    filePath: path.relative(input.cwd, input.filePath),
    line: 1,
    message: input.message,
    rule: input.rule,
  };
}
