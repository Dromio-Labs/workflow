import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DromioMarkdown } from "../../src/components/projection/markdown";
import type { ProjectedConversationMetadata } from "../../src/components/projection/ProjectedConversation";

const projection: ProjectedConversationMetadata = {
  fileLinks: [{ name: "report.ts", path: "/workspace/report.ts" }],
  inlineCode: ["thread.turn.start"],
  userTimestampLabel: "Now",
  workspacePath: "/workspace",
};

function renderMarkdown(content: string, isStreaming = false) {
  return render(
    <DromioMarkdown
      content={content}
      isStreaming={isStreaming}
      projection={projection}
    />,
  );
}

describe("DromioMarkdown", () => {
  it("renders GFM tables as semantic, locally scrollable tables", async () => {
    renderMarkdown("| Name | State |\n| --- | --- |\n| renderer | ready |");

    expect(await screen.findByRole("table")).toHaveAttribute("data-markdown", "table");
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByText("renderer")).toBeInTheDocument();
    expect(screen.getByRole("table").parentElement).toHaveAttribute(
      "data-markdown",
      "table-scroll",
    );
  });

  it("renders GFM, code, and incomplete streaming Markdown", async () => {
    const { rerender } = renderMarkdown("## Summary\n\n- [x] parsed\n- [ ] streamed\n\n```ts\nconst ready = true", true);

    expect(await screen.findByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(document.querySelector("pre")?.textContent).toContain("const ready = true");

    rerender(
      <DromioMarkdown
        content={"## Summary\n\n- [x] parsed\n- [ ] streamed\n\n```ts\nconst ready = true;\n```"}
        isStreaming={false}
        projection={projection}
      />,
    );
    expect(document.querySelector("pre")?.textContent).toContain("const ready = true;");
  });

  it("syntax-highlights supported fenced code", async () => {
    renderMarkdown("```typescript\nconst ready = true;\n```");

    expect(await screen.findByText("typescript")).toBeInTheDocument();
    await waitFor(() => {
      const tokenColors = new Set(
        Array.from(document.querySelectorAll<HTMLElement>("pre code span span"))
          .map((token) => token.style.getPropertyValue("--shiki-dark"))
          .filter(Boolean),
      );
      expect(tokenColors.size).toBeGreaterThan(1);
    });
  });

  it("copies fenced code with the built-in code action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderMarkdown("```typescript\nconst ready = true;\n```");

    await user.click(await screen.findByTitle("Copy Code"));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0].trimEnd()).toBe("const ready = true;");
  });

  it("falls back when the native clipboard write is rejected", async () => {
    const user = userEvent.setup();
    const rejectedWriteText = vi.fn(async () => {
      throw new Error("Clipboard permission denied");
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: rejectedWriteText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    renderMarkdown("```typescript\nconst ready = true;\n```");

    await user.click(await screen.findByTitle("Copy Code"));

    expect(rejectedWriteText).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector('textarea[readonly=""]')).toBeNull();
  });

  it("preserves projected file and inline-code interactions", async () => {
    renderMarkdown("Open report.ts and dispatch thread.turn.start.");

    expect(await screen.findByRole("button", { name: "report.ts" })).toHaveAttribute(
      "title",
      "/workspace/report.ts",
    );
    expect(screen.getByText("thread.turn.start")).toHaveClass("bg-tag", "text-foreground");
  });

  it("opens Markdown links and URL-only inline code in new tabs", async () => {
    renderMarkdown(
      "[BBC](https://www.bbc.com/) and `https://www.bbc.com/news` with `const ready = true`.",
    );

    const links = await screen.findAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "https://www.bbc.com/");
    expect(links[1]).toHaveAttribute("href", "https://www.bbc.com/news");
    for (const link of links) {
      expect(link).toHaveAttribute("data-markdown", "link");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAttribute("target", "_blank");
    }
    expect(screen.getByText("const ready = true").tagName).toBe("CODE");
  });

  it("allows only validated Dromio file tags", async () => {
    renderMarkdown(
      '<file path="/workspace/report.ts" onclick="alert(1)">safe file</file>\n\n<file path="/etc/passwd">unsafe file</file>',
    );

    expect(await screen.findByRole("button", { name: "safe file" })).toHaveAttribute(
      "title",
      "/workspace/report.ts",
    );
    expect(screen.getByText("unsafe file")).toHaveAttribute(
      "data-markdown-file",
      "invalid",
    );
    expect(document.querySelector("[onclick]")).toBeNull();
  });

  it("hardens links and strips executable HTML", async () => {
    renderMarkdown(
      '[unsafe](javascript:alert(1))\n\n<script data-danger="true">alert(1)</script>',
    );

    expect((await screen.findByText(/unsafe/)).closest("a")).toBeNull();
    expect(screen.getByText(/unsafe/)).toHaveTextContent("[blocked]");
    expect(document.querySelector("script")).toBeNull();
  });
});
