export type FileLanguageTone =
  | "css"
  | "default"
  | "go"
  | "html"
  | "javascript"
  | "json"
  | "markdown"
  | "python"
  | "rust"
  | "shell"
  | "typescript"
  | "yaml";

export type FileLanguagePresentation = {
  readonly label: string;
  readonly tone: FileLanguageTone;
};

const languagePresentations: Record<string, FileLanguagePresentation> = {
  bash: {label: "SH", tone: "shell"},
  cjs: {label: "JS", tone: "javascript"},
  css: {label: "CSS", tone: "css"},
  cts: {label: "TS", tone: "typescript"},
  fish: {label: "SH", tone: "shell"},
  go: {label: "GO", tone: "go"},
  htm: {label: "HTML", tone: "html"},
  html: {label: "HTML", tone: "html"},
  javascript: {label: "JS", tone: "javascript"},
  js: {label: "JS", tone: "javascript"},
  json: {label: "JSON", tone: "json"},
  jsonc: {label: "JSON", tone: "json"},
  jsx: {label: "JS", tone: "javascript"},
  less: {label: "LESS", tone: "css"},
  markdown: {label: "MD", tone: "markdown"},
  md: {label: "MD", tone: "markdown"},
  mdx: {label: "MDX", tone: "markdown"},
  mjs: {label: "JS", tone: "javascript"},
  mts: {label: "TS", tone: "typescript"},
  py: {label: "PY", tone: "python"},
  python: {label: "PY", tone: "python"},
  rs: {label: "RS", tone: "rust"},
  rust: {label: "RS", tone: "rust"},
  sass: {label: "SASS", tone: "css"},
  scss: {label: "SCSS", tone: "css"},
  sh: {label: "SH", tone: "shell"},
  shell: {label: "SH", tone: "shell"},
  ts: {label: "TS", tone: "typescript"},
  tsx: {label: "TS", tone: "typescript"},
  typescript: {label: "TS", tone: "typescript"},
  yaml: {label: "YAML", tone: "yaml"},
  yml: {label: "YAML", tone: "yaml"},
  zsh: {label: "SH", tone: "shell"},
};

export function getFileLanguagePresentation(
  language: string | undefined,
  name: string,
): FileLanguagePresentation {
  const token = getLanguageToken(language, name);
  const registered = languagePresentations[token];

  if (registered) {
    return registered;
  }

  return {
    label: token.toUpperCase().slice(0, 4),
    tone: "default",
  };
}

function getLanguageToken(language: string | undefined, name: string) {
  if (language?.trim()) {
    return language.trim().toLowerCase().replace(/^\./, "");
  }

  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex > 0 ? name.slice(extensionIndex + 1).trim().toLowerCase() : "";
}
