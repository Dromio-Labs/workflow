const DROMIO_CLIPBOARD_FALLBACK = Symbol("dromioClipboardFallback");

interface DromioClipboard extends Clipboard {
	[DROMIO_CLIPBOARD_FALLBACK]?: true;
}

export function ensureClipboardWriteText(): void {
	if (typeof navigator === "undefined") return;
	const currentClipboard = navigator.clipboard as DromioClipboard | undefined;
	if (currentClipboard?.[DROMIO_CLIPBOARD_FALLBACK]) return;
	const nativeWriteText = currentClipboard?.writeText.bind(currentClipboard);
	const clipboard = Object.create(currentClipboard ?? null) as DromioClipboard;

	Object.defineProperties(clipboard, {
		[DROMIO_CLIPBOARD_FALLBACK]: { value: true },
		writeText: {
			value: async (value: string) => {
				if (nativeWriteText) {
					try {
						await nativeWriteText(value);
						return;
					} catch {
						// A restricted browser may expose the API but reject every write.
					}
				}
				await writeTextWithSelectionFallback(value);
			},
		},
	});
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: clipboard,
	});
}

async function writeTextWithSelectionFallback(value: string): Promise<void> {
	if (typeof document === "undefined") {
		throw new Error("Clipboard API is unavailable");
	}

	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.setAttribute("readonly", "");
	textarea.style.left = "-9999px";
	textarea.style.position = "fixed";
	textarea.style.top = "0";
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();
	textarea.setSelectionRange(0, textarea.value.length);

	try {
		if (!document.execCommand("copy")) {
			throw new Error("The browser rejected the clipboard write");
		}
	} finally {
		textarea.remove();
	}
}
