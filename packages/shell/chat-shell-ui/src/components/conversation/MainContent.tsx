import type {ReactNode} from "react";

import type {ChatShellComposerConfig, ChatShellMenuItem} from "../../contracts/chatShellManifest";
import {ProjectedConversation, type ProjectedConversationConfig} from "../projection/ProjectedConversation";
import type {ChatShellComposerSubmitPayload} from "../shell/ChatShell.types";
import type {ResolvedShellControls} from "../presentation/resolveShellPresentationControls";
import {Composer} from "./Composer";

export type ShellContentLayout = {
  composerPaddingLeft: number;
  composerPaddingRight: number;
  conversationPaddingLeft: number;
  conversationPaddingRight: number;
  disablePaddingTransition?: boolean;
};

export function MainContent({
  composer,
  composerContent,
  conversation,
  layout,
  onMenuSelect,
  onActionTrigger,
  onApprovalResponse,
  onComposerSubmit,
  presentationControls,
}: {
  composer: ChatShellComposerConfig;
  composerContent?: ReactNode;
  conversation: ProjectedConversationConfig;
  layout: ShellContentLayout;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onActionTrigger?: (actionId: string, surface?: string) => void | Promise<void>;
  onApprovalResponse?: (requestId: string, decision: "approve" | "reject") => void | Promise<void>;
  onComposerSubmit?: (payload: ChatShellComposerSubmitPayload) => void | Promise<void>;
  presentationControls: ResolvedShellControls;
}) {
  return (
    <main aria-label="Conversation" className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div
        aria-atomic="false"
        aria-label="Conversation transcript"
        aria-live={conversation.isStreaming ? "polite" : "off"}
        className="zc-conversation-scroll hero-conversation-scroll-mask hero-scrollbar min-h-0 w-full flex-1 overflow-y-auto transition-opacity duration-150 opacity-100"
        data-bottom="true"
        data-top="true"
        role="log"
        style={{overflowAnchor: "none"}}
      >
        <div
          className={[
            "zc-conversation-inner w-full px-2 sm:px-4",
            layout.disablePaddingTransition ? "transition-none" : "transition-[padding] duration-300 ease-out",
          ].join(" ")}
          style={{paddingLeft: layout.conversationPaddingLeft, paddingRight: layout.conversationPaddingRight}}
        >
          <div className="mx-auto flex w-full flex-col gap-4 px-2 pt-3 pb-5 text-foreground sm:gap-5 sm:px-4 sm:pt-4 sm:pb-6" style={{maxWidth: 772}}>
            <ProjectedConversation
              conversation={conversation}
              emptyState={{
                onSelectSuggestion: (prompt) => {
                  void onComposerSubmit?.({attachments: [], prompt});
                },
                subtitle: composer.emptyState?.subtitle,
                suggestions: composer.suggestions,
                title: composer.emptyState?.title,
              }}
              onApprovalResponse={onApprovalResponse}
            />
          </div>
        </div>
      </div>
      {composerContent ?? <Composer composer={composer} controls={presentationControls} isStreaming={conversation.isStreaming} layout={layout} onActionTrigger={onActionTrigger} onMenuSelect={onMenuSelect} onSubmit={onComposerSubmit} />}
    </main>
  );
}
