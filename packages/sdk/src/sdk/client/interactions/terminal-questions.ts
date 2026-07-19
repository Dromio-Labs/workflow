import { createInterface } from "node:readline/promises";
import type {
  Readable,
  Writable,
} from "node:stream";
import type { Question } from "../../core/index.js";

export type TerminalQuestion = Question & {
  allowCustom?: boolean;
};

export type TerminalQuestionSession = {
  pendingQuestions: TerminalQuestion[];
  status: string;
  answer(input: { questionId: string; value: unknown }): Promise<unknown> | unknown;
  resume(): Promise<unknown> | unknown;
};

export type TerminalQuestionInput = Readable & {
  isTTY?: boolean;
};

export type TerminalQuestionOutput = {
  isTTY?: boolean;
  write(chunk: string): unknown;
};

export type TerminalQuestionOptions = {
  defaultOptionValue?: string;
  emptyAnswerHint?: false | string;
  input?: TerminalQuestionInput;
  interactive?: boolean;
  maxNonInteractiveAutoAnswers?: number;
  output?: TerminalQuestionOutput;
};

export type ParsedTerminalQuestionAnswer =
  | {
      answer: unknown;
      ok: true;
    }
  | {
      message: string;
      ok: false;
    };

const defaultOptionValue = "__assume__";

export class TerminalQuestionDefaultUnavailableError extends Error {
  constructor(
    readonly question: TerminalQuestion,
    message: string,
  ) {
    super(message);
    this.name = "TerminalQuestionDefaultUnavailableError";
  }
}

export async function runTerminalQuestionLoop<TSession extends TerminalQuestionSession>(
  session: TSession,
  options: TerminalQuestionOptions = {},
) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const interactive = options.interactive ?? Boolean(input.isTTY && output.isTTY);
  const seenNonInteractiveWaits = new Set<string>();
  let nonInteractiveAutoAnswers = 0;
  while (session.status === "waiting" && session.pendingQuestions.length > 0) {
    if (!interactive) {
      if (hasQuestionHookTokens(session)) {
        const signature = terminalQuestionSignature(session, options);
        if (seenNonInteractiveWaits.has(signature)) break;
        seenNonInteractiveWaits.add(signature);
      } else {
        nonInteractiveAutoAnswers += session.pendingQuestions.length;
        if (nonInteractiveAutoAnswers > (options.maxNonInteractiveAutoAnswers ?? 25)) break;
      }
    }
    try {
      await answerTerminalQuestions(session, {
        ...options,
        interactive,
      });
    } catch (error) {
      if (!interactive && error instanceof TerminalQuestionDefaultUnavailableError) break;
      throw error;
    }
    await session.resume();
  }

  return session;
}

export async function answerTerminalQuestions(
  session: TerminalQuestionSession,
  options: TerminalQuestionOptions = {},
) {
  const answers = [];
  for (const question of session.pendingQuestions) {
    answers.push({
      questionId: question.id,
      value: await readTerminalQuestionAnswer(question, options),
    });
  }
  for (const answer of answers) {
    await session.answer({
      questionId: answer.questionId,
      value: answer.value,
    });
  }
}

export async function readTerminalQuestionAnswer(
  question: TerminalQuestion,
  options: TerminalQuestionOptions = {},
) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const interactive = options.interactive ?? Boolean(input.isTTY && output.isTTY);
  if (!interactive) {
    const value = parseTerminalQuestionAnswer(question, "", options);
    if (value.ok) return value.answer;
    throw new TerminalQuestionDefaultUnavailableError(question, value.message);
  }

  const rl = createInterface({
    input,
    output: output as Writable,
  });

  try {
    writeTerminalQuestion(output, question, options);

    while (true) {
      const value = parseTerminalQuestionAnswer(question, await rl.question("> "), options);
      if (value.ok) return value.answer;
      output.write(`${value.message}\n`);
    }
  } finally {
    rl.close();
  }
}

export function writeTerminalQuestion(
  output: Pick<TerminalQuestionOutput, "write">,
  question: TerminalQuestion,
  options: TerminalQuestionOptions = {},
) {
  output.write("\n");
  output.write(`${question.title ?? "Question"}\n`);
  output.write(`${question.prompt}\n`);

  const hint = defaultTerminalQuestionAnswer(question, options) !== undefined
    ? options.emptyAnswerHint ?? "Press Enter to use the default."
    : false;
  if (hint) {
    output.write("\n");
    output.write(`${hint}\n`);
  }

  if (question.type !== "choice" && question.type !== "multi") return;

  for (const [index, option] of visibleOptions(question, options).entries()) {
    output.write(`${index + 1}. ${option.label}\n`);
    if (option.description) output.write(`   ${option.description}\n`);
  }

  if (question.type === "multi") {
    output.write("Choose multiple with commas, for example: 1,3\n");
  }
}

export function parseTerminalQuestionAnswer(
  question: TerminalQuestion,
  rawAnswer: string,
  options: TerminalQuestionOptions = {},
): ParsedTerminalQuestionAnswer {
  const answer = rawAnswer.trim();
  if (!answer) {
    const defaultAnswer = defaultTerminalQuestionAnswer(question, options);
    if (defaultAnswer === undefined) {
      return {
        message: defaultUnavailableMessage(question),
        ok: false,
      };
    }
    return {
      answer: defaultAnswer,
      ok: true,
    };
  }

  if (question.type === "text") {
    return {
      answer,
      ok: true,
    };
  }

  if (question.type === "confirm") {
    const normalized = answer.toLowerCase();
    if (["y", "yes", "true"].includes(normalized)) {
      return { answer: true, ok: true };
    }
    if (["n", "no", "false"].includes(normalized)) {
      return { answer: false, ok: true };
    }
    return {
      message: "Answer yes or no.",
      ok: false,
    };
  }

  if (question.type === "choice") {
    const option = resolveTerminalQuestionOption(question, answer, options);
    if (option) {
      return {
        answer: option.value,
        ok: true,
      };
    }
    if (question.allowCustom) {
      return {
        answer,
        ok: true,
      };
    }
    return {
      message: "Choose one of the listed options.",
      ok: false,
    };
  }

  const values = answer.split(",").map((item) => item.trim()).filter(Boolean);
  const resolved = values.map((value) => resolveTerminalQuestionOption(question, value, options));
  if (resolved.every(Boolean)) {
    return {
      answer: resolved.map((option) => option!.value),
      ok: true,
    };
  }
  if (question.allowCustom) {
    return {
      answer: values.map((value, index) => resolved[index]?.value ?? value),
      ok: true,
    };
  }
  return {
    message: "Choose one or more listed options.",
    ok: false,
  };
}

export function defaultTerminalQuestionAnswer(
  question: TerminalQuestion,
  options: TerminalQuestionOptions = {},
) {
  if (question.type === "choice") {
    return findDefaultOption(question, options)?.value;
  }
  if (question.type === "multi") {
    const option = findDefaultOption(question, options);
    return option ? [option.value] : undefined;
  }
  if (question.type === "confirm") {
    return false;
  }
  return "";
}

export function resolveTerminalQuestionOption(
  question: TerminalQuestion,
  answer: string,
  options: TerminalQuestionOptions = {},
) {
  const visible = visibleOptions(question, options);
  const optionIndex = Number(answer);
  if (Number.isInteger(optionIndex) && optionIndex >= 1 && optionIndex <= visible.length) {
    return visible[optionIndex - 1];
  }

  const normalizedAnswer = normalizeOptionText(answer);
  return visible.find((option) =>
    normalizeOptionText(option.value) === normalizedAnswer ||
    normalizeOptionText(option.label) === normalizedAnswer
  );
}

function visibleOptions(question: TerminalQuestion, options: TerminalQuestionOptions) {
  const value = options.defaultOptionValue ?? defaultOptionValue;
  return (question.options ?? []).filter((option) => option.value !== value);
}

function findDefaultOption(question: TerminalQuestion, options: TerminalQuestionOptions) {
  const value = options.defaultOptionValue ?? defaultOptionValue;
  return (question.options ?? []).find((option) => option.value === value);
}

function defaultUnavailableMessage(question: TerminalQuestion) {
  if (question.type === "choice") return "Choose one of the listed options.";
  if (question.type === "multi") return "Choose one or more listed options.";
  return "Enter an answer.";
}

function normalizeOptionText(value: string) {
  return value.trim().toLowerCase();
}

export function terminalQuestionSignature(
  session: Pick<TerminalQuestionSession, "pendingQuestions"> & {
    pendingHooks?: Array<{ id: string; token: string }>;
  },
  options: TerminalQuestionOptions = {},
) {
  return session.pendingQuestions.map((question) =>
    JSON.stringify({
      allowCustom: question.allowCustom,
      defaultOptionValue: options.defaultOptionValue ?? defaultOptionValue,
      id: question.id,
      options: (question.options ?? []).map((option) => ({
        description: option.description,
        label: option.label,
        recommended: option.recommended,
        value: option.value,
      })),
      prompt: question.prompt,
      requirementId: question.requirementId,
      resolverId: question.resolverId,
      title: question.title,
      token: session.pendingHooks?.find((hook) => hook.id === question.id)?.token,
      type: question.type,
    })
  ).join("|");
}

function hasQuestionHookTokens(
  session: Pick<TerminalQuestionSession, "pendingQuestions"> & {
    pendingHooks?: Array<{ id: string; token: string }>;
  },
) {
  if (!session.pendingHooks || session.pendingHooks.length === 0) return false;
  return session.pendingQuestions.every((question) =>
    session.pendingHooks?.some((hook) => hook.id === question.id && hook.token)
  );
}
