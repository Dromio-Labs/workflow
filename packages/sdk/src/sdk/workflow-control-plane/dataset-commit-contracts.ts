import type { JsonValue } from "../shared/json.js";
import type {
  DatasetRow,
  DatasetStoreDefinition,
  DatasetUpsertRowsInput,
} from "./types.js";

export type DatasetCommitCondition = {
  /** Stable caller-owned identity returned when this condition fails. */
  id: string;
  definition: DatasetStoreDefinition;
  /** The complete composite dataset key for the row being compared. */
  key: Record<string, JsonValue>;
  match:
    | { kind: "absent" }
    | { equals: JsonValue; field: string; kind: "field" };
};

export type DatasetCommitRowsInput = {
  /**
   * Conditions are evaluated in order. No writes persist unless every
   * condition matches the same datastore snapshot.
   */
  conditions: DatasetCommitCondition[];
  /** All dataset writes commit atomically after the conditions match. */
  writes: DatasetUpsertRowsInput[];
};

export type DatasetCommitRowsResult =
  | {
      committed: true;
      inserted: number;
      updated: number;
    }
  | {
      committed: false;
      conditionId: string;
      /** The authoritative row observed while evaluating the condition. */
      current?: DatasetRow;
    };
