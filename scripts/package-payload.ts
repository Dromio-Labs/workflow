export interface PackedPackageManifest {
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly exports?: unknown;
  readonly name: string;
  readonly version: string;
}

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
