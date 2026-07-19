let browserShellBuildQueue: Promise<void> = Promise.resolve();

export function serializeWorkflowBrowserShellBuild<T>(
  build: () => Promise<T>,
): Promise<T> {
  const result = browserShellBuildQueue.then(build, build);
  browserShellBuildQueue = result.then(() => undefined, () => undefined);
  return result;
}
