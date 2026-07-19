export async function* parseOpenAiCompatibleSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = findEventBoundary(buffer);
      while (boundary) {
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const parsed = parseSseEvent(raw);
        if (parsed === "done") return;
        if (parsed) yield parsed;
        boundary = findEventBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseEvent(buffer);
      if (parsed && parsed !== "done") yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

export function readStreamedError(chunk: Record<string, unknown>) {
  const error = chunk.error;
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object" && !Array.isArray(error)) {
    const record = error as Record<string, unknown>;
    const message = record.message;
    const code = record.code;
    return [
      typeof message === "string" ? message : JSON.stringify(record),
      typeof code === "string" ? `(${code})` : "",
    ].filter(Boolean).join(" ");
  }
  return JSON.stringify(error);
}

export function readDeltaContent(chunk: Record<string, unknown>) {
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object" || Array.isArray(choice)) return "";
      const delta = (choice as Record<string, unknown>).delta;
      if (!delta || typeof delta !== "object" || Array.isArray(delta)) return "";
      const content = (delta as Record<string, unknown>).content;
      return typeof content === "string" ? content : "";
    })
    .join("");
}

function parseSseEvent(raw: string): Record<string, unknown> | "done" | undefined {
  const data = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return undefined;
  if (data === "[DONE]") return "done";
  const parsed = JSON.parse(data) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenAI-compatible stream emitted a non-object chunk.");
  }
  return parsed as Record<string, unknown>;
}

function findEventBoundary(value: string): { index: number; length: number } | undefined {
  const lf = value.indexOf("\n\n");
  const crlf = value.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return undefined;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}
