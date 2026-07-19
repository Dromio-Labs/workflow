import {
  createWorkflowCatalog,
  type WorkflowCatalog,
} from "../product/catalog/catalog.js";
import type { StepContractSourceMap } from "../core/index.js";
import type { AuthoredStepDefinition } from "./step.js";

type CatalogableStepDefinition = AuthoredStepDefinition<
  StepContractSourceMap | undefined,
  StepContractSourceMap | undefined
>;

export function catalog(
  definitions: readonly CatalogableStepDefinition[],
): WorkflowCatalog {
  return createWorkflowCatalog([...definitions]);
}
