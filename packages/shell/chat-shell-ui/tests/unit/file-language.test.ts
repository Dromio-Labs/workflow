import {describe, expect, it} from "vitest";

import {getFileLanguagePresentation} from "../../src/components/projection/fileLanguage";

describe("file language presentation", () => {
  it.each([
    ["javascript", "app.js", {label: "JS", tone: "javascript"}],
    [undefined, "styles.css", {label: "CSS", tone: "css"}],
    [undefined, "index.html", {label: "HTML", tone: "html"}],
    ["typescript", "app.tsx", {label: "TS", tone: "typescript"}],
    [undefined, "README.md", {label: "MD", tone: "markdown"}],
  ] as const)("maps %s / %s to a semantic badge", (language, name, expected) => {
    expect(getFileLanguagePresentation(language, name)).toEqual(expected);
  });

  it("keeps unknown extensions legible with the neutral tone", () => {
    expect(getFileLanguagePresentation(undefined, "layout.xyz")).toEqual({
      label: "XYZ",
      tone: "default",
    });
  });

  it("uses the file icon fallback when no extension or language exists", () => {
    expect(getFileLanguagePresentation(undefined, "Dockerfile")).toEqual({
      label: "",
      tone: "default",
    });
  });
});
