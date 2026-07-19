import type { ChatMessage } from "@chatshell/response-protocol";
import { useLayoutEffect } from "react";

import type { ProjectedConversationConfig } from "./ProjectedConversation";

const SCROLL_SETTLE_FRAME_COUNT = 4;
const ERROR_SCROLL_SETTLE_FRAME_COUNT = 24;
const COMPLETED_OUTPUT_TOP_INSET = 20;

export function useProjectedConversationScroll({
	assistantMessageCount,
	conversation,
	latestAssistantMessage,
}: {
	assistantMessageCount: number;
	conversation: ProjectedConversationConfig;
	latestAssistantMessage?: ChatMessage;
}) {
	const { isStreaming } = conversation;

	useLayoutEffect(() => {
		const shouldFollowLatestOutput =
			isStreaming || conversation.runtimeState === "error";
		const shouldShowLatestCompletedOutput =
			!isStreaming && conversation.runtimeState === "complete";
		const scroller = document.querySelector<HTMLElement>(
			".zc-conversation-scroll",
		);
		const scrollerContent = scroller?.querySelector<HTMLElement>(
			".zc-conversation-inner",
		);
		const composer = document.querySelector<HTMLElement>(".zc-composer-wrap");

		if (!scroller) return undefined;

		scroller.dataset.visualScrollState = "pending";

		if (!shouldFollowLatestOutput && !shouldShowLatestCompletedOutput) {
			if (scrollerContent) scrollerContent.style.paddingBottom = "";

			scroller.scrollTop = 0;
			scroller.dataset.visualScrollState = "settled";
			return undefined;
		}

		const scrollToLatestCompletedOutput = () => {
			if (scrollerContent) scrollerContent.style.paddingBottom = "";

			const outputs = Array.from(
				scroller.querySelectorAll<HTMLElement>(
					"[data-assistant-output='true']",
				),
			);
			const latestOutput = outputs.at(-3) ?? outputs.at(-1);

			if (!latestOutput) {
				scroller.scrollTop = 0;
				return;
			}

			const scrollerRect = scroller.getBoundingClientRect();
			const outputRect = latestOutput.getBoundingClientRect();
			scroller.scrollTop = Math.max(
				0,
				scroller.scrollTop +
					outputRect.top -
					scrollerRect.top -
					COMPLETED_OUTPUT_TOP_INSET,
			);
		};

		const scrollToBottom = () => {
			const scrollerRect = scroller.getBoundingClientRect();
			const composerRect = composer?.getBoundingClientRect();
			const composerOverlap = composerRect
				? Math.max(0, scrollerRect.bottom - composerRect.top)
				: 0;
			const streamingInset = Math.ceil(composerOverlap);

			if (scrollerContent) {
				scrollerContent.style.paddingBottom =
					isStreaming && streamingInset > 0 ? `${streamingInset}px` : "";
			}

			scroller.scrollTop = Math.max(
				0,
				scroller.scrollHeight - scroller.clientHeight,
			);
		};

		let cancelled = false;
		const frameIds: number[] = [];
		const settle = (framesRemaining: number) => {
			if (cancelled) return;

			if (shouldShowLatestCompletedOutput) {
				scrollToLatestCompletedOutput();
			} else {
				scrollToBottom();
			}

			if (framesRemaining > 0) {
				frameIds.push(
					window.requestAnimationFrame(() => settle(framesRemaining - 1)),
				);
			} else {
				scroller.dataset.visualScrollState = "settled";
			}
		};

		const settleFrames =
			conversation.runtimeState === "error"
				? ERROR_SCROLL_SETTLE_FRAME_COUNT
				: SCROLL_SETTLE_FRAME_COUNT;
		if ("fonts" in document) {
			void document.fonts.ready.then(() => {
				if (!cancelled) settle(settleFrames);
			});
		} else {
			settle(settleFrames);
		}

		return () => {
			cancelled = true;
			frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
		};
	}, [
		assistantMessageCount,
		conversation.runtimeState,
		conversation.state,
		conversation.threadId,
		isStreaming,
		latestAssistantMessage?.content,
		latestAssistantMessage?.toolCalls.length,
	]);
}
