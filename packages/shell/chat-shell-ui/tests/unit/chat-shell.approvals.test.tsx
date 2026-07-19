import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ProjectedConversation } from "../../src/components/projection/ProjectedConversation";

describe("ProjectedConversation approvals", () => {
	test("renders safe approval controls and dispatches the selected decision", () => {
		const onApprovalResponse = vi.fn();

		render(
			<ProjectedConversation
				conversation={{
					isStreaming: true,
					metadata: {
						fileLinks: [],
						inlineCode: [],
						userTimestampLabel: "Now",
					},
					pendingApprovals: [
						{
							requestId: "approval-1",
							summary: "Navigate the managed browser",
						},
					],
					runtimeState: "streaming",
					state: { messages: [] },
					threadId: "thread-1",
				}}
				onApprovalResponse={onApprovalResponse}
			/>,
		);

		expect(screen.getByText("Navigate the managed browser")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		expect(onApprovalResponse).toHaveBeenCalledWith("approval-1", "approve");
	});
});
