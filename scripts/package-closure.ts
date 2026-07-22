export const packageDirectories = [
  "packages/protocols",
  "packages/execution",
  "packages/thread/service",
  "packages/trigger",
  "packages/workflow/canvas-protocol",
  "packages/workflow/kernel",
  "packages/room/protocol",
  "packages/shell/chat-shell-ui",
  "packages/sdk",
] as const;

export const canonicalPackageName = "@dromio/workflow";

export function selectCanonicalPublishTarget<T extends { readonly name: string }>(
  items: readonly T[],
): readonly T[] {
  const targets = items.filter((item) => item.name === canonicalPackageName);
  if (targets.length !== 1) {
    throw new Error(
      `The release manifest must contain exactly one ${canonicalPackageName} publish target; found ${targets.length}.`,
    );
  }
  return targets;
}
