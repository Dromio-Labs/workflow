import type { CliRenderer } from "@opentui/core";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { platform, release, tmpdir } from "node:os";
import * as path from "node:path";

export const TERMINAL_INPUT_RESET = [
  "\x1b[?1000l",
  "\x1b[?1002l",
  "\x1b[?1003l",
  "\x1b[?1004l",
  "\x1b[?1006l",
  "\x1b[?1015l",
].join("");

export async function readClipboardImage(): Promise<{ buffer: Buffer; mediaType: string } | undefined> {
  const os = platform();
  if (os === "darwin") {
    const tmpfile = path.join(tmpdir(), `dromio-clipboard-${randomUUID()}.png`);
    try {
      const result = await runBufferedCommand("osascript", [
        "-e",
        'set imageData to the clipboard as "PNGf"',
        "-e",
        `set fileRef to open for access POSIX file "${tmpfile}" with write permission`,
        "-e",
        "set eof fileRef to 0",
        "-e",
        "write imageData to fileRef",
        "-e",
        "close access fileRef",
      ]);
      if (result.code !== 0 || !existsSync(tmpfile)) return undefined;
      const buffer = readFileSync(tmpfile);
      return buffer.byteLength ? { buffer, mediaType: "image/png" } : undefined;
    } catch {
      return undefined;
    } finally {
      rmSync(tmpfile, { force: true });
    }
  }

  if (os === "win32" || release().includes("WSL")) {
    const script = "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }";
    const result = await runBufferedCommand("powershell.exe", ["-NonInteractive", "-NoProfile", "-Command", script]);
    const base64 = result.stdout.toString("utf8").trim();
    if (result.code === 0 && base64) {
      const buffer = Buffer.from(base64, "base64");
      if (buffer.byteLength) return { buffer, mediaType: "image/png" };
    }
  }

  if (os === "linux") {
    const wayland = await runBufferedCommand("wl-paste", ["-t", "image/png"]);
    if (wayland.code === 0 && wayland.stdout.byteLength) {
      return { buffer: wayland.stdout, mediaType: "image/png" };
    }
    const x11 = await runBufferedCommand("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
    if (x11.code === 0 && x11.stdout.byteLength) {
      return { buffer: x11.stdout, mediaType: "image/png" };
    }
  }

  return undefined;
}

export function runBufferedCommand(command: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: Buffer }>((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout?.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once("error", () => resolve({ code: -1, stdout: Buffer.alloc(0) }));
    child.once("close", (code) => resolve({ code, stdout: Buffer.concat(chunks) }));
  });
}

export async function openPathInExternalEditor(input: {
  create?: boolean;
  defaultContent?: string;
  filePath: string;
  renderer: CliRenderer;
}): Promise<{ filePath: string; ok: true } | { message: string; ok: false }> {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor?.trim()) {
    return {
      message: "Set EDITOR or VISUAL to open files from the TUI.",
      ok: false,
    };
  }
  let filePath: string;
  try {
    filePath = prepareExternalEditorPath(input.filePath, {
      create: input.create,
      defaultContent: input.defaultContent,
    });
  } catch (caught) {
    return {
      message: caught instanceof Error ? caught.message : String(caught),
      ok: false,
    };
  }
  const [command, ...args] = externalEditorCommandParts(editor);
  if (!command) {
    return {
      message: "EDITOR or VISUAL did not contain a command.",
      ok: false,
    };
  }
  input.renderer.suspend();
  input.renderer.currentRenderBuffer.clear();
  try {
    const code = await runExternalEditorCommand(command, [...args, filePath]);
    if (code !== 0) {
      return {
        message: `Editor exited with code ${code ?? "unknown"}.`,
        ok: false,
      };
    }
    return { filePath, ok: true };
  } finally {
    input.renderer.currentRenderBuffer.clear();
    input.renderer.resume();
    input.renderer.requestRender();
  }
}

export function prepareExternalEditorPath(
  filePath: string,
  input: { create?: boolean; defaultContent?: string },
) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (existsSync(absolutePath)) {
    if (!statSync(absolutePath).isFile()) throw new Error(`Editor target is not a file: ${filePath}`);
    return absolutePath;
  }
  if (!input.create) throw new Error(`File does not exist: ${filePath}`);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, input.defaultContent ?? "");
  return absolutePath;
}

export function externalEditorCommandParts(editor: string) {
  return editor.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

export function runExternalEditorCommand(command: string, args: string[]) {
  return new Promise<number | null>((resolve) => {
    const child = spawn(command, args, {
      shell: platform() === "win32",
      stdio: "inherit",
    });
    child.once("error", () => resolve(-1));
    child.once("close", (code) => resolve(code));
  });
}

export async function copyTextToClipboard(
  text: string,
  renderer: Pick<CliRenderer, "copyToClipboardOSC52">,
) {
  renderer.copyToClipboardOSC52(text);
  await copyTextToNativeClipboard(text);
}

export function openExternalUrl(url: string) {
  const command = platform() === "darwin"
    ? "open"
    : platform() === "win32"
    ? "cmd.exe"
    : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

export async function copyTextToNativeClipboard(text: string) {
  for (const command of clipboardCommands()) {
    if (await writeClipboardCommand(command.command, command.args, text)) return;
  }
}

export function clipboardCommands(): Array<{ args: string[]; command: string }> {
  const os = platform();
  if (os === "darwin") return [{ args: [], command: "pbcopy" }];
  if (os === "win32") {
    return [{
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())",
      ],
      command: "powershell.exe",
    }];
  }
  if (release().includes("WSL")) return [{ args: [], command: "clip.exe" }];
  if (os === "linux" && process.env.WAYLAND_DISPLAY) return [{ args: [], command: "wl-copy" }];
  if (os === "linux") {
    return [
      { args: ["-selection", "clipboard"], command: "xclip" },
      { args: ["--clipboard", "--input"], command: "xsel" },
    ];
  }
  return [];
}

export function writeClipboardCommand(command: string, args: string[], text: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    child.stdin?.end(text);
  });
}

export function resetTerminalInputModes() {
  if (!process.stdout.isTTY) return;
  process.stdout.write(TERMINAL_INPUT_RESET);
}
