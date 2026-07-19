import type { DromioMessageItem } from "@dromio/protocols";

export function appendText(content: DromioMessageItem["content"], delta: string): DromioMessageItem["content"] { const last = content.at(-1); return last?.type === "text" ? [...content.slice(0, -1), { ...last, text: `${last.text}${delta}` }] : [...content, { type: "text", text: delta }]; }
