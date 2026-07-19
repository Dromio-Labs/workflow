import { describe, expect, test } from "bun:test";

import { extractLegacyInlineDataImages } from "../src/index.js";

describe("legacy inline media", () => {
	test("extracts supported data images for read compatibility and migration", () => {
		const result = extractLegacyInlineDataImages(
			"Before\n\n![Capture](data:image/png;base64,aGVsbG8=)\n\nAfter",
		);
		expect(result.text).toBe("Before\n\nAfter");
		expect(result.images).toEqual([
			{
				base64: "aGVsbG8=",
				mediaType: "image/png",
				name: "Capture",
				url: "data:image/png;base64,aGVsbG8=",
			},
		]);
		expect(result.retained).toEqual([]);
	});

	test("retains and reports unsupported media without mutating the text", () => {
		const text = "![Vector](data:image/svg+xml;base64,PHN2Zy8+)";
		const result = extractLegacyInlineDataImages(text);
		expect(result.text).toBe(text);
		expect(result.images).toEqual([]);
		expect(result.retained).toEqual([
			{
				mediaType: "image/svg+xml",
				name: "Vector",
				reason: "unsupported_media_type",
			},
		]);
	});
});
