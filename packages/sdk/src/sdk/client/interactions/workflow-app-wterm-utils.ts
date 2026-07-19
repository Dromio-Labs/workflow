export function cleanEnv(extra: Record<string, string | undefined> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = env.COLORTERM ?? "truecolor";
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function normalizeBasePath(value: string, fallback: string) {
  const trimmed = value.replace(/\/+$/, "");
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash || fallback;
}

export function stripBasePath(pathname: string, basePath: string) {
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return null;
}

export function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function html(body: string, status = 200) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
    status,
  });
}

export function text(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers,
    },
    status,
  });
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
