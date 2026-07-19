import type { DromioContentPart } from "@dromio/protocols";

const maximumThreadTitleLength = 60;

export function titleFromFirstMessage(
	content: readonly DromioContentPart[],
): string | undefined {
	const text = content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	if (text) return truncateThreadTitle(text);

	const file = content.find((part) => part.type === "file");
	if (file?.type === "file") return truncateThreadTitle(`Shared ${file.name}`);

	const media = content.find(
		(part) =>
			part.type === "image" || part.type === "audio" || part.type === "video",
	);
	if (media?.type === "image") return "Shared an image";
	if (media?.type === "audio") return "Shared audio";
	if (media?.type === "video") return "Shared a video";

	return undefined;
}

export function truncateThreadTitle(title: string): string {
	if (title.length <= maximumThreadTitleLength) return title;
	const prefix = title.slice(0, maximumThreadTitleLength - 1);
	const boundary = prefix.lastIndexOf(" ");
	const summary = boundary >= 36 ? prefix.slice(0, boundary) : prefix;
	return `${summary.trimEnd()}…`;
}
