export function parseJsonObjectFromText(text: string, source = "provider response"): unknown {
  const direct = tryParse(text);
  if (direct.ok) return direct.value;

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fenced = tryParse(match[1] ?? "");
    if (fenced.ok) return fenced.value;
  }

  for (const candidate of jsonObjectCandidates(text)) {
    const parsed = tryParse(candidate);
    if (parsed.ok) return parsed.value;
  }

  throw new Error(`Could not parse JSON object from ${source}.`);
}

function tryParse(value: string) {
  try {
    return { ok: true as const, value: JSON.parse(value.trim()) };
  } catch {
    return { ok: false as const };
  }
}

function* jsonObjectCandidates(text: string) {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let escaped = false;
    let inString = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          yield text.slice(start, index + 1);
          break;
        }
      }
    }
  }
}
