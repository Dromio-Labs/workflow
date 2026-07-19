import { escapeHtml } from "../workflow-app-wterm-utils.js";

export type RenderWtermPageInput = {
  basePath: string;
  cols: number;
  ghosttyImportUrl?: string;
  ghosttyWasmUrl: string;
  rows: number;
  title: string;
  wtermImportUrl: string;
};

export function renderWtermPage(input: RenderWtermPageInput) {
  const ptyPath = `${input.basePath}/pty`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body, #terminal { height: 100%; margin: 0; }
    body {
      background:
        radial-gradient(circle at 20% 12%, rgba(192, 132, 252, 0.18), transparent 30%),
        radial-gradient(circle at 86% 76%, rgba(14, 165, 233, 0.14), transparent 34%),
        linear-gradient(135deg, #090512 0%, #120821 52%, #070914 100%);
      color: #f6edff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #terminal { padding: 14px; }
    .wterm {
      --term-fg: #f6edff; --term-bg: #120821; --term-cursor: #f0abfc;
      --term-color-0: #120821; --term-color-1: #fb7185; --term-color-2: #86efac; --term-color-3: #fde68a;
      --term-color-4: #7dd3fc; --term-color-5: #d8b4fe; --term-color-6: #67e8f9; --term-color-7: #f6edff;
      --term-color-8: #817099; --term-color-9: #fda4af; --term-color-10: #bbf7d0; --term-color-11: #fef3c7;
      --term-color-12: #bae6fd; --term-color-13: #f0abfc; --term-color-14: #a5f3fc; --term-color-15: #ffffff;
      --term-font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --term-font-size: 14px; --term-line-height: 1.2; --term-row-height: 17px;
      position: relative; width: 100%; height: 100%; overflow: hidden; outline: none;
      border: 1px solid rgba(216, 180, 254, 0.24);
      border-radius: 16px;
      background:
        linear-gradient(180deg, rgba(24, 12, 44, 0.96), rgba(12, 7, 24, 0.98));
      box-shadow:
        0 28px 80px rgba(0, 0, 0, 0.38),
        inset 0 1px 0 rgba(255, 255, 255, 0.08);
      color: var(--term-fg);
      font-family: var(--term-font-family); font-size: var(--term-font-size); line-height: var(--term-line-height);
    }
    .term-grid { display: block; white-space: pre; contain: layout paint style; will-change: contents; }
    .term-row { display: block; height: var(--term-row-height); line-height: var(--term-row-height); contain: layout style; }
    .term-row > span { display: inline-block; height: var(--term-row-height); vertical-align: top; }
    .term-block { width: 1ch; overflow: hidden; }
    .term-cursor { outline: 1px solid var(--term-cursor); outline-offset: -1px; }
    .wterm.focused .term-cursor { background: var(--term-cursor); color: var(--term-bg); outline: none; }
    .wterm.has-scrollback { overflow-y: auto; }
    .wterm ::selection { background: rgba(192, 132, 252, 0.34); }
    #terminal-fallback {
      display: none; height: 100%; margin: 0; overflow: auto; padding: 14px; white-space: pre;
      border: 1px solid rgba(216, 180, 254, 0.24);
      border-radius: 16px;
      background:
        linear-gradient(180deg, rgba(24, 12, 44, 0.96), rgba(12, 7, 24, 0.98));
      color: #f6edff; font: 14px/17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      outline: none;
    }
    .fallback-row { display: block; height: 17px; line-height: 17px; white-space: pre; }
    .fallback-row > span { white-space: pre; }
    body.fallback-visible { position: relative; }
    body.fallback-visible #terminal { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
    body.fallback-visible #terminal-fallback { display: block; position: relative; z-index: 1; }
  </style>
</head>
<body>
  <div id="terminal" aria-label="Intent terminal"></div>
  <pre id="terminal-fallback" aria-label="Intent terminal text fallback" tabindex="0">Connecting...</pre>
  <script type="module">
    const element = document.getElementById("terminal");
    const fallback = document.getElementById("terminal-fallback");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socketUrl = new URL(${JSON.stringify(ptyPath)}, location.href);
    socketUrl.protocol = proto;
    const pageParams = new URLSearchParams(location.search);
    for (const key of ["token", "workflow", "session", "fallback"]) {
      const value = pageParams.get(key);
      if (value) socketUrl.searchParams.set(key, value);
    }
    const forceFallback = pageParams.get("fallback") === "1";
    element.tabIndex = 0;
    let term;
    let socket;
    let fallbackRawText = "";
    let fallbackScreenHtml = "";
    let fallbackScreenText = "";
    let fallbackText = "";
    let fallbackMonitor;
    let fallbackTimer;
    const cleanTerminalText = (value) => value
      .replace(/\\x1b\\][\\s\\S]*?(?:\\x07|\\x1b\\\\)/g, "")
      .replace(/\\x1b\\[[0-?;]*[ -/]*[@-~]/g, "")
      .replace(/\\x1b[()#%*+\\-.\\/].|\\x1b[=>]/g, "")
      .replace(/\\x1b(?:\\[[0-?;]*[ -/]*|\\][\\s\\S]*|[()#%*+\\-.\\/]?)/g, "")
      .replace(/\\r/g, "\\n")
      .replace(/\\x00/g, "");
    const normalizeScreenText = (value) => value
      .replace(/\\u00a0/g, " ")
      .replace(/[ \\t]+$/gm, "")
      .trimEnd();
    const escapeText = (value) => value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const escapeStyleValue = (value) => value.replace(/[;"'<>]/g, "");
    const fallbackDisplayText = () => fallbackScreenText || fallbackText.trimStart();
    const renderFallbackText = () => {
      if (fallbackScreenHtml) {
        fallback.innerHTML = fallbackScreenHtml;
        fallback.scrollTop = 0;
      } else {
        fallback.textContent = fallbackDisplayText() || "Waiting for terminal output...";
        fallback.scrollTop = fallback.scrollHeight;
      }
    };
    const mirrorSpanStyle = (span) => {
      const style = getComputedStyle(span);
      const declarations = [
        ["color", style.color],
        ["background-color", style.backgroundColor],
        ["font-weight", style.fontWeight],
        ["font-style", style.fontStyle],
        ["text-decoration-line", style.textDecorationLine],
      ].filter(([, value]) => value && value !== "normal" && value !== "none" && value !== "rgba(0, 0, 0, 0)");
      return declarations.length
        ? " style=\\"" + declarations.map(([name, value]) => name + ": " + escapeStyleValue(value) + ";").join(" ") + "\\""
        : "";
    };
    const mirrorWtermScreenHtml = () => {
      const rows = Array.from(element.querySelectorAll(".term-row"));
      if (rows.length === 0) return "";
      return rows.map((row) => {
        const spans = Array.from(row.querySelectorAll("span"));
        const content = spans.length
          ? spans.map((span) => "<span" + mirrorSpanStyle(span) + ">" + escapeText(span.textContent || " ") + "</span>").join("")
          : escapeText(row.textContent || "");
        return "<div class=\\"fallback-row\\">" + content + "</div>";
      }).join("");
    };
    const syncFallbackScreenFromWterm = () => {
      const screenText = normalizeScreenText(element.innerText || element.textContent || "");
      if (screenText.replace(/\\s+/g, "").length < 40 || !screenText.includes("\\n")) return;
      fallbackScreenHtml = mirrorWtermScreenHtml();
      fallbackScreenText = screenText;
      renderFallbackText();
    };
    const appendFallbackText = (value) => {
      fallbackRawText = (fallbackRawText + value).slice(-240000);
      fallbackText = cleanTerminalText(fallbackRawText).slice(-120000);
      renderFallbackText();
      if (forceFallback && fallbackText.trim()) showFallback();
    };
    const showFallback = () => {
      document.body.classList.add("fallback-visible");
      fallback.focus({ preventScroll: true });
    };
    const fallbackVisibleText = () => fallbackDisplayText().replace(/\\s+/g, "");
    const wtermVisibleText = () => normalizeScreenText(element.innerText || element.textContent || "").replace(/\\s+/g, "");
    const showFallbackIfUnreadable = () => {
      if (document.body.classList.contains("fallback-visible")) return;
      if (!fallbackVisibleText()) return;
      if (fallbackScreenText) {
        showFallback();
        return;
      }
      if (!wtermVisibleText()) showFallback();
    };
    const scheduleFallbackIfUnreadable = () => {
      clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(showFallbackIfUnreadable, 1200);
    };
    const sendTerminalData = (data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(data);
    };
    const encodedKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return encodedTerminalShortcut(event);
      if (event.key.length === 1) return event.key;
      if (event.key === "Enter") return "\\r";
      if (event.key === "Backspace") return "\\x7f";
      if (event.key === "Tab") return "\\t";
      if (event.key === "ArrowUp") return "\\x1b[A";
      if (event.key === "ArrowDown") return "\\x1b[B";
      if (event.key === "ArrowRight") return "\\x1b[C";
      if (event.key === "ArrowLeft") return "\\x1b[D";
      if (event.key === "Escape") return "\\x1b";
      return "";
    };
    const encodedTerminalShortcut = (event) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return "";
      if (event.key === "Enter") return "\\x1b[13;5u";
      const key = event.key.length === 1 ? event.key.toLowerCase() : "";
      if (key >= "a" && key <= "z") return String.fromCharCode(key.charCodeAt(0) - 96);
      return "";
    };
    const sendKey = (event) => {
      const data = encodedKey(event);
      if (!data) return;
      event.preventDefault();
      event.stopPropagation();
      sendTerminalData(data);
    };
    window.addEventListener("keydown", sendKey, { capture: true });
    element.focus({ preventScroll: true });
    const measuredCellSize = () => {
      const row = element.querySelector(".term-row") || fallback.querySelector(".fallback-row");
      const rect = row?.getBoundingClientRect();
      const textLength = row?.textContent?.length || term?.cols || ${input.cols};
      return {
        width: rect?.width && textLength > 0 ? Math.max(6, Math.min(14, rect.width / textLength)) : 8,
        height: rect?.height ? Math.max(12, Math.min(24, rect.height)) : 17,
      };
    };
    const measuredTerminalSize = () => {
      const target = document.body.classList.contains("fallback-visible") ? fallback : element;
      const cell = measuredCellSize();
      const width = target.clientWidth || element.clientWidth || fallback.clientWidth;
      const height = target.clientHeight || element.clientHeight || fallback.clientHeight;
      return {
        cols: Math.max(40, Math.floor(width / cell.width)),
        rows: Math.max(12, Math.floor(height / cell.height)),
      };
    };
    const sendMeasuredResize = () => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      const size = measuredTerminalSize();
      socket.send("\\x1b[RESIZE:" + size.cols + ";" + size.rows + "]");
    };
    const sendResize = (term) => {
      if (socket?.readyState === WebSocket.OPEN) {
        const measured = measuredTerminalSize();
        const cols = Math.max(term.cols || 0, measured.cols);
        const rows = Math.max(term.rows || 0, measured.rows);
        socket.send("\\x1b[RESIZE:" + cols + ";" + rows + "]");
      }
    };
    const sendFallbackResize = () => {
      const cols = Math.max(40, Math.floor(fallback.clientWidth / 8));
      const rows = Math.max(12, Math.floor(fallback.clientHeight / 19));
      if (socket?.readyState === WebSocket.OPEN) socket.send("\\x1b[RESIZE:" + cols + ";" + rows + "]");
    };
    let resizeTimer;
    const scheduleMeasuredResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendMeasuredResize, 80);
    };
    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(scheduleMeasuredResize) : undefined;
    resizeObserver?.observe(element);
    resizeObserver?.observe(fallback);
    window.addEventListener("resize", scheduleMeasuredResize);
    async function initWterm() {
      const { WTerm } = await import(${JSON.stringify(input.wtermImportUrl)});
      const ghosttyImportUrl = ${JSON.stringify(input.ghosttyImportUrl)};
      let core;
      if (ghosttyImportUrl) {
        try {
          const { GhosttyCore } = await import(ghosttyImportUrl);
          core = await GhosttyCore.load({ wasmPath: ${JSON.stringify(input.ghosttyWasmUrl)} });
        } catch (error) {
          console.warn("wterm ghostty core failed to load; falling back to the lightweight core.", error);
        }
      }
      term = new WTerm(element, {
        autoResize: true,
        cols: ${input.cols},
        core,
        cursorBlink: true,
        onData: (data) => {
          sendTerminalData(data);
        },
        onResize: () => sendResize(term),
        rows: ${input.rows},
      });
      await term.init();
    }
    try {
      await initWterm();
    } catch (error) {
      appendFallbackText("[terminal renderer fallback] " + (error?.message || error) + "\\n");
      showFallback();
    }
    socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      term ? sendResize(term) : sendFallbackResize();
      setTimeout(sendMeasuredResize, 120);
    });
    socket.addEventListener("message", async (event) => {
      let data = event.data;
      if (event.data instanceof Blob) data = new Uint8Array(await event.data.arrayBuffer());
      if (event.data instanceof ArrayBuffer) data = new Uint8Array(event.data);
      appendFallbackText(typeof data === "string" ? data : new TextDecoder().decode(data));
      if (typeof event.data === "string") {
        term?.write(event.data);
      } else if (data instanceof Uint8Array) {
        term?.write(data);
      }
      if (term) {
        requestAnimationFrame(() => {
          syncFallbackScreenFromWterm();
          setTimeout(syncFallbackScreenFromWterm, 80);
        });
        scheduleFallbackIfUnreadable();
      }
    });
    fallbackMonitor = setInterval(showFallbackIfUnreadable, 1200);
    socket.addEventListener("close", () => {
      appendFallbackText("\\n[terminal session ended]\\n");
      term?.write("\\r\\n\\x1b[90m[terminal session ended]\\x1b[0m\\r\\n");
    });
    socket.addEventListener("error", () => {
      appendFallbackText("\\n[terminal websocket error]\\n");
      term?.write("\\r\\n\\x1b[31m[terminal websocket error]\\x1b[0m\\r\\n");
      if (!term) showFallback();
    });
    window.addEventListener("beforeunload", () => {
      clearInterval(fallbackMonitor);
      clearTimeout(fallbackTimer);
      clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasuredResize);
      socket?.close();
    });
  </script>
</body>
</html>`;
}
