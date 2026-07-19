import { describe, expect, it } from "vitest";

import { resolveActiveShellThreadId } from "../../src/components/shell/chatShellRegistry";

describe("resolveActiveShellThreadId", () => {
	const controlPlane = {
		activeThreadId: "thread-persisted",
		threads: [
			{
				active: true,
				archived: false,
				ephemeral: false,
				id: "thread-persisted",
				pinnedAt: undefined,
				pinRank: undefined,
				timeLabel: "Now",
				title: "Persisted thread",
				titleGenerating: false,
				unread: false,
				workspaceId: "workspace-1",
			},
		],
		workspaces: [
			{
				id: "workspace-1",
				name: "Workspace",
				threadIds: ["thread-persisted"],
			},
		],
	};

	it("keeps a requested thread while it remains registered", () => {
		expect(resolveActiveShellThreadId(controlPlane, "thread-persisted")).toBe(
			"thread-persisted",
		);
	});

	it("falls back to backend selection when a replaced ephemeral thread is stale", () => {
		expect(resolveActiveShellThreadId(controlPlane, "thread-ephemeral")).toBe(
			"thread-persisted",
		);
	});
});
