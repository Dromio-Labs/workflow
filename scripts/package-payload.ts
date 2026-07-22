import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";

export interface PackedPackageManifest {
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly exports?: unknown;
  readonly name: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly version: string;
}

export interface PackedPackageSource {
  readonly path: string;
  readonly source: string;
}

const nodeBuiltins = new Set(
  builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")]),
);

export function assertPackedPackageRuntimePayload(
  manifest: PackedPackageManifest,
  packedPaths: readonly string[],
): void {
  const files = new Set(
    packedPaths.map((path) => path.replace(/^package\//, "")),
  );
  const targets = [
    ...concreteExportTargets(manifest.exports),
    ...binTargets(manifest.bin),
  ];
  if (targets.length === 0) {
    throw new Error(
      `${manifest.name}@${manifest.version} declares no concrete runtime, type, or binary payload targets.`,
    );
  }
  for (const target of targets) {
    const path = target.replace(/^\.\//, "");
    if (!files.has(path)) {
      throw new Error(
        `${manifest.name}@${manifest.version} packed payload is missing declared target ${target}.`,
      );
    }
  }
}

export function assertPackedPackageDependencyClosure(
  manifest: PackedPackageManifest,
  sources: readonly PackedPackageSource[],
): void {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const missing = new Map<string, Set<string>>();

  for (const file of sources) {
    for (const specifier of moduleSpecifiers(file)) {
      const dependency = externalPackageName(specifier, manifest.name);
      if (!dependency || declared.has(dependency)) continue;
      const paths = missing.get(dependency) ?? new Set<string>();
      paths.add(file.path);
      missing.set(dependency, paths);
    }
  }

  if (missing.size === 0) return;
  const details = [...missing]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dependency, paths]) => (
      `${dependency} (${[...paths].sort().join(", ")})`
    ))
    .join("; ");
  throw new Error(
    `${manifest.name}@${manifest.version} packed output imports undeclared runtime dependencies: ${details}.`,
  );
}

function concreteExportTargets(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return value.includes("*") ? [] : [value];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value).flatMap(concreteExportTargets);
}

function binTargets(value: PackedPackageManifest["bin"]): readonly string[] {
  if (typeof value === "string") return [value];
  if (!value) return [];
  return Object.values(value);
}

function moduleSpecifiers(file: PackedPackageSource): readonly string[] {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file.path),
  );
  const specifiers = new Set<string>();

  function collect(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.add(node.moduleReference.expression.text);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
        specifiers.add(argument.literal.text);
      }
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument) && isModuleLoaderCall(node.expression)) {
        specifiers.add(argument.text);
      }
    }
    ts.forEachChild(node, collect);
  }

  collect(sourceFile);
  return [...specifiers];
}

function isModuleLoaderCall(expression: ts.Expression): boolean {
  if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(expression)) return expression.text === "require";
  return ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "require" &&
    expression.name.text === "resolve";
}

function externalPackageName(specifier: string, selfName: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("bun:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:") ||
    specifier.startsWith("node:")
  ) {
    return undefined;
  }
  const dependency = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/", 1)[0];
  if (!dependency || dependency === selfName || nodeBuiltins.has(dependency)) {
    return undefined;
  }
  return dependency;
}

function scriptKind(file: string): ts.ScriptKind {
  const extension = path.extname(file);
  if (extension === ".cjs" || extension === ".mjs" || extension === ".js") {
    return ts.ScriptKind.JS;
  }
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}
