import type {
  InferStepContractInput,
  InferStepContractOutput,
  SleepFiredValue,
  SleepOptions,
  StepContractSourceMap,
} from "../core/index.js";
import {
  baseStep,
  type AuthoredStepDefinition,
  type AuthoredStepInput,
} from "./step.js";

type SleepInputContext<TInputContracts extends StepContractSourceMap> = {
  input: InferStepContractInput<TInputContracts>;
};

export type AuthoredSleepSchedule =
  | { ms: number; until?: never }
  | { ms?: never; until: Date | string };

export type AuthoredSleepStepInput<
  TInputContracts extends StepContractSourceMap,
  TOutputContracts extends StepContractSourceMap,
> = Omit<AuthoredStepInput<TInputContracts, TOutputContracts>, "kind" | "run"> & {
  mapFired(
    context: SleepInputContext<TInputContracts> & { fired: SleepFiredValue },
  ):
    | InferStepContractOutput<TOutputContracts>
    | Promise<InferStepContractOutput<TOutputContracts>>;
  schedule(context: SleepInputContext<TInputContracts>): AuthoredSleepSchedule;
  timerId(context: SleepInputContext<TInputContracts>): string;
};

/** Defines a durable duration or absolute-time wait over the canonical timer hook. */
export function sleepStep<
  const TInputContracts extends StepContractSourceMap,
  const TOutputContracts extends StepContractSourceMap,
>(
  input: AuthoredSleepStepInput<TInputContracts, TOutputContracts>,
): AuthoredStepDefinition<TInputContracts, TOutputContracts> {
  return baseStep({
    ...input,
    implementation: input.implementation ?? { kind: "primitive" },
    kind: "wait",
    sideEffects: input.sideEffects ?? ["timer.wait"],
    async run(context) {
      const inputContext = { input: context.input };
      const schedule = input.schedule(inputContext);
      const id = input.timerId(inputContext);
      const options: SleepOptions = schedule.ms === undefined
        ? { id, until: schedule.until }
        : { id, ms: schedule.ms };
      const fired = await context.sleep(options);
      return input.mapFired({ fired, input: context.input });
    },
  });
}
