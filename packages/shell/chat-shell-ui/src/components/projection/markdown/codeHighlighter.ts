import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import css from "@shikijs/langs/css";
import diff from "@shikijs/langs/diff";
import html from "@shikijs/langs/html";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import shellscript from "@shikijs/langs/shellscript";
import sql from "@shikijs/langs/sql";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import type { BundledLanguage, CodeHighlighterPlugin } from "streamdown";

const SUPPORTED_LANGUAGES = [
	"css",
	"diff",
	"html",
	"javascript",
	"json",
	"jsx",
	"markdown",
	"python",
	"shellscript",
	"sql",
	"tsx",
	"typescript",
] satisfies BundledLanguage[];

type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
type HighlightCallback = NonNullable<
	Parameters<CodeHighlighterPlugin["highlight"]>[1]
>;
type Highlighter = Awaited<ReturnType<typeof createHighlighterCore>>;
type HighlightResult = ReturnType<Highlighter["codeToTokens"]>;

const LANGUAGE_ALIASES: Readonly<Partial<Record<string, SupportedLanguage>>> = {
	bash: "shellscript",
	css: "css",
	diff: "diff",
	html: "html",
	javascript: "javascript",
	js: "javascript",
	json: "json",
	jsx: "jsx",
	markdown: "markdown",
	md: "markdown",
	py: "python",
	python: "python",
	sh: "shellscript",
	shell: "shellscript",
	shellscript: "shellscript",
	sql: "sql",
	tsx: "tsx",
	ts: "typescript",
	typescript: "typescript",
};
const THEMES: ["github-light", "github-dark"] = ["github-light", "github-dark"];
const resultCache = new Map<string, HighlightResult>();
const pendingCallbacks = new Map<string, Set<HighlightCallback>>();
const pendingHighlights = new Set<string>();
let highlighterPromise: Promise<Highlighter> | null = null;

export const dromioCodeHighlighter: CodeHighlighterPlugin = {
	name: "shiki",
	type: "code-highlighter",
	getSupportedLanguages: () => [...SUPPORTED_LANGUAGES],
	getThemes: () => THEMES,
	supportsLanguage: (language) => resolveLanguage(language) !== null,
	highlight: ({ code, language }, callback) => {
		const resolvedLanguage = resolveLanguage(language);
		if (!resolvedLanguage) return null;
		const key = `${resolvedLanguage}:${code}`;
		const cached = resultCache.get(key);
		if (cached) return cached;

		if (callback) {
			const callbacks = pendingCallbacks.get(key) ?? new Set<HighlightCallback>();
			callbacks.add(callback);
			pendingCallbacks.set(key, callbacks);
		}
		if (pendingHighlights.has(key)) return null;
		pendingHighlights.add(key);

		void getHighlighter()
			.then((highlighter) => {
				const result = highlighter.codeToTokens(code, {
					lang: resolvedLanguage,
					themes: { dark: THEMES[1], light: THEMES[0] },
				});
				resultCache.set(key, result);
				for (const notify of pendingCallbacks.get(key) ?? []) notify(result);
				pendingCallbacks.delete(key);
				pendingHighlights.delete(key);
			})
			.catch((error: Error) => {
				pendingCallbacks.delete(key);
				pendingHighlights.delete(key);
				console.error("[Dromio Code] Syntax highlighting failed", error);
			});
		return null;
	},
};

function resolveLanguage(language: BundledLanguage): SupportedLanguage | null {
	return LANGUAGE_ALIASES[language.trim().toLowerCase()] ?? null;
}

function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= createHighlighterCore({
		engine: createJavaScriptRegexEngine({ forgiving: true }),
		langs: [
			css,
			diff,
			html,
			javascript,
			json,
			jsx,
			markdown,
			python,
			shellscript,
			sql,
			tsx,
			typescript,
		],
		themes: [githubLight, githubDark],
	});
	return highlighterPromise;
}
