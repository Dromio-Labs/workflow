import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectedConversation } from "../../src/components/projection/ProjectedConversation";
import { mockChatShellManifest } from "../../src/chat-shell-mock-backend";
import { projectControlPlaneConversationState } from "../../src/runtime/controlPlaneConversation";

describe("multi-turn media projection", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("preserves user and assistant message order with later user media", () => {
		const controlPlane = structuredClone(mockChatShellManifest.controlPlane);
		const conversationId = controlPlane.threads.find(
			(thread) => thread.id === controlPlane.activeThreadId,
		)?.conversationId;

		if (!conversationId)
			throw new Error("Active conversation fixture is missing.");

		controlPlane.messages.push(
			{
				conversationId,
				id: "message-user-follow-up",
				partIds: ["part-user-follow-up", "part-user-follow-up-image"],
				role: "user",
			},
			{
				conversationId,
				durationMs: 125,
				id: "message-assistant-follow-up",
				partIds: ["part-assistant-follow-up"],
				role: "assistant",
			},
		);
		controlPlane.messageParts.push(
			{
				content: "What is shown in this image?",
				id: "part-user-follow-up",
				messageId: "message-user-follow-up",
				type: "content",
			},
			{
				fileId: "file-user-screenshot",
				id: "part-user-follow-up-image",
				mediaType: "image/png",
				messageId: "message-user-follow-up",
				name: "browser-agent.png",
				type: "media",
				url: "blob:user-screenshot",
			},
			{
				content: "The image shows the browser agent shell.",
				id: "part-assistant-follow-up",
				messageId: "message-assistant-follow-up",
				type: "content",
			},
		);

		const state = projectControlPlaneConversationState(controlPlane);

		expect(state.messages.map((message) => message.id)).toEqual([
			"message-user-prompt",
			"message-assistant-result",
			"message-user-follow-up",
			"message-assistant-follow-up",
		]);
		expect(state.messages[2]).toMatchObject({
			content: "What is shown in this image?",
			media: [{ fileId: "file-user-screenshot", url: "blob:user-screenshot" }],
			role: "user",
		});
	});

	it("projects and previews assistant media", () => {
		const controlPlane = structuredClone(mockChatShellManifest.controlPlane);
		const assistant = controlPlane.messages.find(
			(message) => message.role === "assistant",
		);
		if (!assistant) throw new Error("Assistant fixture is missing.");
		assistant.partIds.push("part-assistant-screenshot");
		controlPlane.messageParts.push({
			fileId: "file-assistant-screenshot",
			id: "part-assistant-screenshot",
			mediaType: "image/png",
			messageId: assistant.id,
			name: "BBC Homepage Screenshot",
			type: "media",
			url: "data:image/png;base64,iVBORw0KGgo=",
		});

		const state = projectControlPlaneConversationState(controlPlane);
		const projected = state.messages.find(
			(message) => message.id === assistant.id,
		);
		expect(projected?.media).toEqual([
			expect.objectContaining({
				fileId: "file-assistant-screenshot",
				name: "BBC Homepage Screenshot",
			}),
		]);

		render(
			<ProjectedConversation
				conversation={{
					isStreaming: false,
					metadata: {
						fileLinks: [],
						inlineCode: [],
						userTimestampLabel: "Now",
					},
					runtimeState: "complete",
					state,
					threadId: controlPlane.activeThreadId,
				}}
			/>,
		);
		const image = screen.getByRole("img", { name: "BBC Homepage Screenshot" });
		fireEvent.load(image);
		fireEvent.click(
			screen.getByRole("button", { name: "Preview BBC Homepage Screenshot" }),
		);
		expect(
			screen.getByRole("dialog", {
				name: "Image preview: BBC Homepage Screenshot",
			}),
		).toBeInTheDocument();
	});

	it("renders every turn in sequence and lazily loads transcript images", () => {
		const view = render(
			<ProjectedConversation
				conversation={{
					isStreaming: false,
					metadata: {
						fileLinks: [],
						inlineCode: [],
						userTimestampLabel: "Now",
					},
					runtimeState: "complete",
					state: {
						messages: [
							completeMessage("user-1", "user", "First prompt"),
							completeMessage("assistant-1", "assistant", "First answer"),
							{
								...completeMessage("user-2", "user", "Visual follow-up"),
								media: [
									{
										fileId: "file-user-screenshot",
										mediaType: "image/png",
										name: "browser-agent.png",
										url: "blob:user-screenshot",
									},
								],
							},
							completeMessage("assistant-2", "assistant", "Grounded answer"),
						],
					},
					threadId: "thread-multiturn",
				}}
			/>,
		);

		expect(screen.getByText("First prompt")).toBeInTheDocument();
		expect(screen.getByText("First answer")).toBeInTheDocument();
		expect(screen.getByText("Visual follow-up")).toBeInTheDocument();
		expect(screen.getByText("Grounded answer")).toBeInTheDocument();
		const firstImage = screen.getByRole("img", { name: "browser-agent.png" });
		expect(firstImage).toHaveAttribute("loading", "eager");
		const previewTrigger = screen.getByRole("button", {
			name: "Preview browser-agent.png",
		});
		expect(previewTrigger).toBeEnabled();
		expect(previewTrigger).toHaveAttribute("aria-busy", "true");
		fireEvent.load(firstImage);
		expect(screen.queryByText("Loading image…")).not.toBeInTheDocument();
		expect(previewTrigger).toHaveAttribute("aria-busy", "false");
		fireEvent.click(previewTrigger);
		const preview = screen.getByRole("dialog", {
			name: "Image preview: browser-agent.png",
		});
		expect(
			within(preview).getByRole("img", { name: "browser-agent.png" }),
		).toHaveAttribute("src", "blob:user-screenshot");
		expect(
			screen.getByRole("button", { name: "Close image preview" }),
		).toHaveFocus();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(previewTrigger).toHaveFocus();

		view.rerender(
			<ProjectedConversation
				conversation={{
					isStreaming: false,
					metadata: {
						fileLinks: [],
						inlineCode: [],
						userTimestampLabel: "Now",
					},
					runtimeState: "complete",
					state: {
						messages: [
							{
								...completeMessage("user-2", "user", "Visual follow-up"),
								media: [
									{
										fileId: "file-user-screenshot",
										mediaType: "image/png",
										name: "browser-agent.png",
										url: "blob:refreshed-user-screenshot",
									},
								],
							},
						],
					},
					threadId: "thread-multiturn",
				}}
			/>,
		);
		expect(screen.getByText("Loading image…")).toBeInTheDocument();
		fireEvent.load(screen.getByRole("img", { name: "browser-agent.png" }));
		expect(screen.queryByText("Loading image…")).not.toBeInTheDocument();
	});

	it("keeps unavailable media in the transcript and reacquires a grant", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ url: "blob:recovered-screenshot" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		render(
			<ProjectedConversation
				conversation={{
					isStreaming: false,
					metadata: {
						fileLinks: [],
						inlineCode: [],
						userTimestampLabel: "Now",
					},
					runtimeState: "complete",
					state: {
						messages: [
							{
								...completeMessage("user-1", "user", "Inspect this"),
								media: [
									{
										availability: "unavailable",
										error: "The download grant expired.",
										fileId: "file-expired",
										mediaType: "image/png",
										name: "expired.png",
										retryUrl: "/v1/files/file-expired/grants",
										url: "about:blank",
									},
								],
							},
						],
					},
					threadId: "thread-recovery",
				}}
			/>,
		);

		expect(screen.getByText("expired.png is unavailable.")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Retry image" }));

		await waitFor(() => {
			expect(screen.getByRole("img", { name: "expired.png" })).toHaveAttribute(
				"src",
				"blob:recovered-screenshot",
			);
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/v1/files/file-expired/grants",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("plays authorized video inline, opens a modal, and restores focus", () => {
		render(
			<ProjectedConversation
				conversation={{
					isStreaming: false,
					metadata: { fileLinks: [], inlineCode: [], userTimestampLabel: "Now" },
					runtimeState: "complete",
					state: {
						messages: [{
							...completeMessage("assistant-video", "assistant", "Recording complete"),
							media: [{
								fileId: "file-recording",
								mediaType: "video/webm",
								name: "browser-recording.webm",
								url: "blob:browser-recording",
							}],
						}],
					},
					threadId: "thread-video",
				}}
			/>,
		);

		const inline = screen.getByLabelText("browser-recording.webm");
		expect(inline).toHaveAttribute("controls");
		expect(inline).toHaveAttribute("preload", "metadata");
		fireEvent.loadedMetadata(inline);
		const opener = screen.getByRole("button", { name: "Open video" });
		fireEvent.click(opener);
		expect(screen.getByRole("dialog", {
			name: "Video preview: browser-recording.webm",
		})).toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(opener).toHaveFocus();
	});
});

function completeMessage(
	id: string,
	role: "assistant" | "user",
	content: string,
) {
	return {
		content,
		id,
		media: [],
		parts: [{ content, type: "content" as const }],
		role,
		status: "complete" as const,
		toolCalls: [],
	};
}
