import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";

import {
  ChatShell,
  defineChatShellExtension,
  type ChatShellComposerSubmitPayload,
  type ChatShellEvent,
} from "../../src/chat-shell";
import {ChatShellManifestSchema, chatShellSchemaVersion} from "../../src/chat-shell-contracts";
import {mockChatShellManifest} from "../../src/chat-shell-mock-backend";

describe("ChatShell event contract", () => {
  it("exports event types and schema imports from package source entries", () => {
    const payload = {
      attachments: [
        {
          id: "screenshot-1",
          name: "failure-state.png",
          src: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
      prompt: "Explain the failing release gate with this screenshot.",
    } satisfies ChatShellComposerSubmitPayload;
    const event = {
      payload,
      type: "composer.submit",
    } satisfies Extract<ChatShellEvent, {type: "composer.submit"}>;

    expect(event.payload.attachments[0]).toMatchObject({
      id: "screenshot-1",
      name: "failure-state.png",
    });
    expect(ChatShellManifestSchema.parse(mockChatShellManifest).schemaVersion).toBe(chatShellSchemaVersion);
  });

  it("emits composer.submit as a backend-owned intent with a typed prompt and attachment payload", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn<(event: ChatShellEvent) => void>();
    const manifest = ChatShellManifestSchema.parse(mockChatShellManifest);
    const payload = {
      attachments: [
        {
          id: "screenshot-1",
          name: "failure-state.png",
          src: "data:image/png;base64,iVBORw0KGgo=",
        },
      ],
      prompt: "Explain the failing release gate with this screenshot.",
    } satisfies ChatShellComposerSubmitPayload;
    const extension = defineChatShellExtension({
      shell: {
        slots: [
          {
            order: -10,
            region: "windowChrome",
            renderer: ({actions, helpers}) => (
              <div data-testid="contract-submit-slot">
                {helpers.renderDefault()}
                <button type="button" onClick={() => void actions.submitComposer(payload)}>
                  Submit typed composer intent
                </button>
              </div>
            ),
            rendererId: "shell.contract-submit",
          },
        ],
      },
    });

    render(<ChatShell extensions={extension} manifest={manifest} onEvent={onEvent} />);

    expect(screen.queryByText(payload.prompt)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", {name: "Submit typed composer intent"}));

    expect(onEvent).toHaveBeenCalledWith({
      payload,
      type: "composer.submit",
    });
    expect(screen.queryByText(payload.prompt)).not.toBeInTheDocument();
    expect(screen.getByRole("log", {name: "Conversation transcript"})).toHaveTextContent(/Built a standalone browser Gomoku game/);
  });
});
