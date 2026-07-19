export class DatasetVersionMismatchError extends Error {
  constructor(
    readonly datasetName: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(`Dataset ${datasetName} registry version mismatch: expected ${expectedVersion}, found ${actualVersion}.`);
    this.name = "DatasetVersionMismatchError";
  }
}

export class DatasetSchemaMismatchError extends Error {
  constructor(readonly datasetName: string) {
    super(`Dataset ${datasetName} registry schema fingerprint mismatch.`);
    this.name = "DatasetSchemaMismatchError";
  }
}
