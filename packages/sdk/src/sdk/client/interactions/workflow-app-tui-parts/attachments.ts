import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { TuiPromptAttachment } from "./types.js";

export function promptInputWithAttachments(prompt: string, attachments: TuiPromptAttachment[]) {
  const cleanPrompt = prompt.trim();
  if (attachments.length === 0) return cleanPrompt;
  const lines = [
    cleanPrompt || "Use the attached file(s) as the primary input.",
    "",
    "Attachments:",
  ];
  for (const attachment of attachments) {
    const displayPath = promptAttachmentDisplayPath(attachment.path);
    const size = attachment.size === undefined ? "" : `, ${formatBytes(attachment.size)}`;
    lines.push(`- ${attachment.label}: ${attachment.name} (${attachment.mediaType}${size})${displayPath ? ` at ${displayPath}` : ""}`);
    if (attachment.mediaType.startsWith("image/") && displayPath) {
      lines.push(`  Markdown: ![${attachment.label}](${displayPath})`);
    }
  }
  return lines.join("\n").trim();
}

export function appendPromptText(current: string, next: string) {
  if (!current) return next;
  if (!next) return current;
  if (current.endsWith("\n") || next.startsWith("\n") || current.endsWith(" ")) return `${current}${next}`;
  return `${current} ${next}`;
}

export function nextAttachmentLabel(attachments: TuiPromptAttachment[], mediaType: string) {
  const prefix = mediaType === "application/pdf" ? "PDF" : mediaType.startsWith("image/") ? "Image" : "File";
  const count = attachments.filter((attachment) =>
    prefix === "PDF"
      ? attachment.mediaType === "application/pdf"
      : prefix === "Image"
      ? attachment.mediaType.startsWith("image/")
      : !attachment.mediaType.startsWith("image/") && attachment.mediaType !== "application/pdf"
  ).length;
  return `${prefix} ${count + 1}`;
}

export function savePromptAttachment(input: {
  buffer: Buffer;
  filename: string;
  mediaType: string;
  sourcePath?: string;
}) {
  const directory = path.join(process.cwd(), ".dromio", "uploads");
  mkdirSync(directory, { recursive: true });
  const extension = extensionForMediaType(input.mediaType) || path.extname(input.filename) || ".bin";
  const stem = safeFilenameStem(path.basename(input.filename, path.extname(input.filename)) || "attachment");
  const filePath = path.join(directory, `${stem}-${randomUUID()}${extension}`);
  writeFileSync(filePath, input.buffer);
  return filePath;
}

export function safeFilenameStem(value: string) {
  const safe = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "attachment";
}

export function promptAttachmentDisplayPath(filePath: string | undefined) {
  if (!filePath) return "";
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : filePath;
}

export function pastedFilePath(value: string) {
  if (value.includes("\n")) return undefined;
  const raw = value.trim().replace(/^['"]+|['"]+$/g, "");
  let filePath = raw;
  if (raw.startsWith("file://")) {
    try {
      filePath = fileURLToPath(raw);
    } catch {
      return undefined;
    }
  } else if (process.platform !== "win32") {
    filePath = raw.replace(/\\(.)/g, "$1");
  }
  try {
    return existsSync(filePath) && statSync(filePath).isFile() ? filePath : undefined;
  } catch {
    return undefined;
  }
}

export function mediaTypeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

export function extensionForMediaType(mediaType: string) {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/gif") return ".gif";
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "image/svg+xml") return ".svg";
  if (mediaType === "application/pdf") return ".pdf";
  return "";
}

export function isPromptAttachmentMediaType(mediaType: string) {
  return mediaType.startsWith("image/") || mediaType === "application/pdf";
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  const kib = size / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}
