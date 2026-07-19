import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type PromptSource =
  | {
      kind: "file";
      path: string | URL;
    }
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "loader";
      load(): Promise<string> | string;
    };

export function promptFile(path: string | URL): PromptSource {
  return { kind: "file", path };
}

export function promptText(text: string): PromptSource {
  return { kind: "text", text };
}

export function promptLoader(load: () => Promise<string> | string): PromptSource {
  return { kind: "loader", load };
}

export function describePromptSource(source: PromptSource) {
  if (source.kind === "file") {
    return {
      kind: "file" as const,
      path: promptSourcePath(source.path),
    };
  }
  if (source.kind === "text") {
    return {
      kind: "text" as const,
      preview: source.text.slice(0, 160),
    };
  }
  return {
    kind: "loader" as const,
  };
}

export async function readPromptSource(source: PromptSource): Promise<string> {
  if (source.kind === "text") return source.text;
  if (source.kind === "loader") return source.load();
  return readFile(source.path, "utf8");
}

function promptSourcePath(input: string | URL) {
  if (typeof input === "string") return input;
  return input.protocol === "file:" ? fileURLToPath(input) : input.toString();
}
