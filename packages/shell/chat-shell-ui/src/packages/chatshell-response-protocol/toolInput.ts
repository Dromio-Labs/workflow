import type {ToolInput} from "./types";

export type ToolInputBuffer = {
  deltaCount: number;
  rawInput: string;
};

const previewFields = [
  "file_path",
  "filePath",
  "path",
  "target_path",
  "targetPath",
  "filename",
  "file",
  "content",
  "new_string",
  "newString",
  "new_text",
  "newText",
  "old_string",
  "oldString",
  "old_text",
  "oldText",
  "command",
  "description",
  "pattern",
  "replacement",
  "summary",
] as const;

export function appendToolInputDelta(
  current: ToolInputBuffer | undefined,
  delta: string,
): ToolInputBuffer {
  return {
    deltaCount: (current?.deltaCount ?? 0) + 1,
    rawInput: `${current?.rawInput ?? ""}${delta}`,
  };
}

export function buildToolInputPreview(
  rawInput: string,
  finalInput?: ToolInput,
): {
  complete: boolean;
  input: ToolInput;
  rawInput: string;
} {
  if (finalInput) {
    return {complete: true, input: finalInput, rawInput};
  }

  const parsed = parseCompleteJson(rawInput);

  if (parsed.ok) {
    return {complete: true, input: parsed.value, rawInput};
  }

  return {
    complete: false,
    input: readPartialJsonObjectPreview(rawInput),
    rawInput,
  };
}

function parseCompleteJson(rawInput: string): {ok: true; value: ToolInput} | {ok: false} {
  try {
    return {ok: true, value: JSON.parse(rawInput) as ToolInput};
  } catch {
    return {ok: false};
  }
}

function readPartialJsonObjectPreview(rawInput: string): ToolInput {
  const preview: Record<string, string> = {};

  for (const field of previewFields) {
    const value = readPartialJsonStringField(rawInput, field);

    if (value !== undefined) {
      preview[field] = value;
    }
  }

  return preview as ToolInput;
}

function readPartialJsonStringField(rawInput: string, field: string): string | undefined {
  const quotedField = `"${escapeRegExp(field)}"`;
  const match = rawInput.match(new RegExp(`${quotedField}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));

  if (!match) {
    return undefined;
  }

  return match[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
