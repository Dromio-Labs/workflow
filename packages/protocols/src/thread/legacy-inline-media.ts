const supportedImageTypes = new Set([
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
]);
const maximumEncodedImageLength = 14 * 1024 * 1024;
const markdownDataImage =
	/!\[([^\]]*)\]\((data:([^;,)]+);base64,([A-Za-z0-9+/=\r\n]+))\)/g;

export interface LegacyInlineDataImage {
	readonly base64: string;
	readonly mediaType: string;
	readonly name: string;
	readonly url: string;
}

export interface RetainedLegacyInlineDataImage {
	readonly mediaType: string;
	readonly name: string;
	readonly reason: "encoded_size_exceeded" | "unsupported_media_type";
}

export function extractLegacyInlineDataImages(text: string): {
	readonly images: readonly LegacyInlineDataImage[];
	readonly retained: readonly RetainedLegacyInlineDataImage[];
	readonly text: string;
} {
	const images: LegacyInlineDataImage[] = [];
	const retained: RetainedLegacyInlineDataImage[] = [];
	const remaining = text.replace(
		markdownDataImage,
		(
			fullMatch,
			alt: string,
			url: string,
			mediaType: string,
			base64: string,
		) => {
			const name = alt.trim() || `Screenshot ${images.length + 1}`;
			const reason = !supportedImageTypes.has(mediaType)
				? "unsupported_media_type"
				: url.length > maximumEncodedImageLength
					? "encoded_size_exceeded"
					: undefined;
			if (reason) {
				retained.push({ mediaType, name, reason });
				return fullMatch;
			}
			const normalizedBase64 = base64.replace(/[\r\n]/g, "");
			images.push({
				base64: normalizedBase64,
				mediaType,
				name,
				url: `data:${mediaType};base64,${normalizedBase64}`,
			});
			return "";
		},
	);
	const normalized = remaining.replace(/\n{3,}/g, "\n\n").trim();
	return {
		images,
		retained,
		text: normalized || (images.length ? "Screenshot attached." : text),
	};
}
