import {useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type ChangeEvent, type FormEvent, type KeyboardEvent} from "react";

import type {ChatShellComposerConfig, ChatShellMenuItem} from "../../contracts/chatShellManifest";
import type {ChatShellComposerSubmitPayload} from "../shell/ChatShell.types";
import {
  getPresentedShellControlAttributes,
  isShellControlVisible,
} from "../presentation/presentedShellControl";
import type {ResolvedShellControls} from "../presentation/resolveShellPresentationControls";
import {Icon} from "../ui/Icon";
import {DropdownMenu, getMenuPanelId, MenuPanel} from "../ui/DropdownMenu";
import type {ShellContentLayout} from "./MainContent";
import {
  BrainIcon,
  ChevronDownIcon,
  ContextUsageIcon,
  HandIcon,
} from "./ComposerIcons";
import {ComposerSubmitControl} from "./ComposerSubmitControl";

type Attachment = {
  file: File;
  id: string;
  name: string;
  src: string;
};

import {
  allowedImageAttachmentTypes,
  getNestedMenuId,
  getNestedMenuStyle,
  getPromptTriggerQuery,
  getPromptTriggerSections,
  getPromptTriggerSymbol,
  maxAttachmentBytes,
  maxAttachmentCount,
  maxTotalAttachmentBytes,
  menuHasItems,
  type NestedMenuId,
} from "./composerLogic";

export function Composer({
  composer,
  controls,
  isStreaming = false,
  layout,
  onActionTrigger,
  onMenuSelect,
  onSubmit,
  variant = "main",
}: {
  composer: ChatShellComposerConfig;
  controls: ResolvedShellControls;
  isStreaming?: boolean;
  layout: ShellContentLayout;
  onActionTrigger?: (actionId: string, surface?: string) => void | Promise<void>;
  onMenuSelect?: (menuId: string, item: ChatShellMenuItem) => void;
  onSubmit?: (payload: ChatShellComposerSubmitPayload) => void | Promise<void>;
  variant?: "main" | "side-panel";
}) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [approvalMode, setApprovalMode] = useState(composer.approvalMode);
  const [model, setModel] = useState(composer.model);
  const [reasoning, setReasoning] = useState(composer.reasoning);
  const [speed, setSpeed] = useState(() => {
    const speedItems = composer.speedMenu.sections.flatMap((section) => section.items);
    const selected = speedItems.find((item) => item.checked) ?? speedItems[0];
    return selected?.value ?? selected?.label ?? "Standard";
  });
  const [addOpen, setAddOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [nestedMenu, setNestedMenu] = useState<NestedMenuId | null>(null);
  const [nestedMenuStyle, setNestedMenuStyle] = useState<CSSProperties>({});
  const [promptMenuDismissed, setPromptMenuDismissed] = useState(false);
  const [promptMenuIndex, setPromptMenuIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nestedMenuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const nestedMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasPayload = prompt.trim().length > 0 || attachments.length > 0;
  const canSubmit = hasPayload && !isSubmitting;
  const promptTriggerQuery = getPromptTriggerQuery(prompt, textareaRef.current?.selectionStart ?? prompt.length);
  const promptMenuSections = getPromptTriggerSections(promptTriggerQuery, composer.promptCommands);
  const promptMenuItems = promptMenuSections.flatMap((section) => section.items);
  const selectablePromptMenuItems = promptMenuItems.filter((item) => !item.disabled);
  const promptMenuOpen = !promptMenuDismissed && Boolean(promptTriggerQuery) && promptMenuItems.length > 0 && !isSubmitting;
  const activePromptMenuItem = selectablePromptMenuItems[Math.min(promptMenuIndex, Math.max(selectablePromptMenuItems.length - 1, 0))];
  const promptMenu = {
    id: promptTriggerQuery?.trigger === "mention" ? "mention-menu" : promptTriggerQuery?.trigger === "skill" ? "skill-menu" : "slash-command-menu",
    sections: promptMenuSections,
  };
  const addMenuPanelId = getMenuPanelId(composer.addMenu.id, "composer-add");
  const approvalMenuPanelId = getMenuPanelId(composer.approvalMenu.id, "composer-approval");
  const modelMenuPanelId = getMenuPanelId(composer.modelMenu.id, "composer-model");
  const reasoningMenuPanelId = getMenuPanelId(composer.reasoningMenu.id, "composer-reasoning");

  useLayoutEffect(() => {
    setModel(composer.model);
  }, [composer.model]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    };

    resize();
    const frame = window.requestAnimationFrame(resize);
    const observer = new ResizeObserver(resize);
    observer.observe(textarea);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [prompt]);

  useLayoutEffect(() => {
    setPromptMenuIndex(0);
  }, [promptTriggerQuery?.query, promptTriggerQuery?.trigger]);

  useLayoutEffect(() => {
    if (!reasoningOpen || !nestedMenu) {
      return undefined;
    }

    const updatePosition = () => {
      const anchor = nestedMenuAnchorRef.current;
      if (!anchor?.isConnected) {
        setNestedMenu(null);
        return;
      }

      setNestedMenuStyle(getNestedMenuStyle(anchor, nestedMenuPanelRef.current));
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [nestedMenu, reasoningOpen]);

  const addFiles = (files: FileList | File[]) => {
    const next = [...attachments];
    let totalBytes = next.reduce((total, attachment) => total + attachment.file.size, 0);
    let error: string | null = null;
    for (const file of Array.from(files)) {
      if (!allowedImageAttachmentTypes.has(file.type)) {
        error = `Unsupported image type: ${file.type || "unknown"}.`;
      } else if (file.size > maxAttachmentBytes) {
        error = `${file.name} exceeds the 10 MB image limit.`;
      } else if (next.length >= maxAttachmentCount) {
        error = `A message can include at most ${maxAttachmentCount} images.`;
      } else if (totalBytes + file.size > maxTotalAttachmentBytes) {
        error = "Attachments exceed the 20 MB message limit.";
      } else {
        next.push({
        file,
        id: `${file.name}-${Date.now()}-${next.length}`,
        name: file.name,
        src: URL.createObjectURL(file),
        });
        totalBytes += file.size;
      }
    }
    setAttachments(next);
    setAttachmentError(error);
  };

  const handlePaste = (event: ClipboardEvent<HTMLFormElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const insertPromptMenuItem = (item: ChatShellMenuItem) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? prompt.length;
    const query = getPromptTriggerQuery(prompt, cursor);

    if (!query || item.disabled) {
      return;
    }

    onMenuSelect?.(promptMenu.id, item);

    const symbol = getPromptTriggerSymbol(query.trigger);
    const replacement = item.value ?? `${symbol}${item.id} `;
    const nextPrompt = `${prompt.slice(0, query.start)}${replacement}${prompt.slice(query.end)}`;
    const nextCursor = query.start + replacement.length;

    setPrompt(nextPrompt);
    setPromptMenuDismissed(true);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (promptMenuOpen && selectablePromptMenuItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPromptMenuIndex((index) => (index + 1) % selectablePromptMenuItems.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPromptMenuIndex((index) => (index - 1 + selectablePromptMenuItems.length) % selectablePromptMenuItems.length);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (activePromptMenuItem) {
          insertPromptMenuItem(activePromptMenuItem);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setPromptMenuDismissed(true);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) {
        submitPrompt();
      }
    }
  };

  const submitPrompt = async () => {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit?.({
        attachments,
        prompt,
      });
      setPrompt("");
      for (const attachment of attachments) URL.revokeObjectURL(attachment.src);
      setAttachments([]);
      setAttachmentError(null);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Failed to send message.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitPrompt();
  };

  const handleAddMenuSelect = (item: ChatShellMenuItem) => {
    onMenuSelect?.(composer.addMenu.id, item);

    if (item.id === "files") {
      fileInputRef.current?.click();
    }
    setAddOpen(false);
  };

  const handleApprovalMenuSelect = (item: ChatShellMenuItem) => {
    onMenuSelect?.(composer.approvalMenu.id, item);
    setApprovalMode(item.value ?? item.label);
    setApprovalOpen(false);
  };

  const handleModelMenuSelect = (item: ChatShellMenuItem) => {
    onMenuSelect?.(composer.modelMenu.id, item);
    setModel(item.label);
    setModelOpen(false);
  };

  const handleReasoningMenuSelect = (item: ChatShellMenuItem) => {
    onMenuSelect?.(composer.reasoningMenu.id, item);
    setReasoning(item.value ?? item.label);
    setReasoningOpen(false);
    closeNestedMenu();
  };

  const handleNestedMenuSelect = (item: ChatShellMenuItem) => {
    const menu = nestedMenu === "model" ? composer.modelMenu : composer.speedMenu;
    onMenuSelect?.(menu.id, item);

    if (nestedMenu === "model") {
      setModel(item.value ?? item.label);
    } else {
      setSpeed(item.value ?? item.label);
    }
    setReasoningOpen(false);
    closeNestedMenu();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(event.target.files);
      event.target.value = "";
    }
  };

  const closeNestedMenu = () => {
    nestedMenuAnchorRef.current = null;
    nestedMenuPanelRef.current = null;
    setNestedMenu(null);
  };

  const handlePromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(event.target.value);
    setPromptMenuDismissed(false);
  };

  const handleReasoningSubmenu = (item: ChatShellMenuItem, anchor?: HTMLButtonElement) => {
    const submenuId = getNestedMenuId(item);
    if (!submenuId || !anchor) {
      closeNestedMenu();
      return;
    }

    nestedMenuAnchorRef.current = anchor;
    setNestedMenu(submenuId);
    setNestedMenuStyle(getNestedMenuStyle(anchor, nestedMenuPanelRef.current));
  };

  const removeAttachment = (attachmentId: string) => {
    const removed = attachments.find((item) => item.id === attachmentId);
    if (removed) URL.revokeObjectURL(removed.src);
    setAttachments((current) => current.filter((item) => item.id !== attachmentId));
    setAttachmentError(null);
    textareaRef.current?.focus();
  };

  const isSidePanel = variant === "side-panel";

  return (
    <div
      className={[
        "zc-composer-wrap",
        isSidePanel ? "" : "lg:pr-76",
        layout.disablePaddingTransition ? "transition-none" : "transition-[padding] duration-300 ease-out",
      ].join(" ")}
      style={{paddingLeft: layout.composerPaddingLeft, paddingRight: layout.composerPaddingRight}}
    >
      <div className={isSidePanel ? "flex w-full justify-center" : "flex w-full justify-center px-2 sm:px-4"}>
        <div
          className={isSidePanel ? "zc-composer-positioner zc-composer-positioner-side relative z-30 w-full shrink-0 transition-transform duration-150 ease-out" : "zc-composer-positioner relative z-30 w-full shrink-0 transition-transform duration-150 ease-out mb-4"}
          style={{maxWidth: isSidePanel ? "100%" : 740}}
        >
          <div className="w-full shrink-0">
            <input accept="image/gif,image/jpeg,image/png,image/webp" className="hidden" disabled={isSubmitting} multiple onChange={handleFileChange} ref={fileInputRef} type="file" />
            <div className="relative">
              <div className="absolute inset-x-0 bottom-full z-20" />
              {promptMenuOpen ? (
                <MenuPanel
                  autoFocus={false}
                  className="bottom-full left-0 mb-2 w-full"
                  menu={promptMenu}
                  onSelect={(item) => insertPromptMenuItem(item)}
                  selectedValue={activePromptMenuItem?.value ?? activePromptMenuItem?.label}
                  style={{
                    maxHeight: 380,
                    overflowX: "hidden",
                    overflowY: promptMenuItems.length > 9 ? "auto" : "hidden",
                    scrollbarGutter: "auto",
                  }}
                />
              ) : null}
              <form aria-busy={isSubmitting} className="relative p-0" onPaste={handlePaste} onSubmit={handleSubmit}>
                <div className="zc-composer-card relative flex flex-col gap-3 overflow-visible rounded-2xl border border-input-border bg-input p-3 transition-colors hover:border-input-border-hover">
                  {attachmentError ? <p className="m-0 text-xs text-destructive" role="alert">{attachmentError}</p> : null}
                  {attachments.length ? (
                    <div className="flex min-h-18 flex-wrap gap-2">
                      {attachments.map((attachment) => (
                        <div className="relative size-20 overflow-hidden rounded-lg border border-border bg-background" key={attachment.id}>
                          <img alt={attachment.name} className="size-full object-cover" src={attachment.src} />
                          <button
                            aria-label={`Remove ${attachment.name}`}
                            className="absolute right-1 top-1 z-10 flex size-4 items-center justify-center rounded-full bg-foreground text-background text-[11px] leading-none transition-colors hover:bg-foreground-subtle"
                            disabled={isSubmitting}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              removeAttachment(attachment.id);
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            title={`Remove ${attachment.name}`}
                            type="button"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="relative flex-1">
                    <div className="relative">
                      <textarea
                        aria-label="Prompt"
                        className="block min-h-10 max-h-40 w-full resize-none overflow-y-auto bg-transparent p-0 text-[13px] leading-5 text-foreground caret-foreground outline-none placeholder:text-foreground-subtlest"
                        data-chat-shell-primary-focus
                        data-testid="chat-input"
                        onChange={handlePromptChange}
                        onKeyDown={handleKeyDown}
                        placeholder={composer.placeholder}
                        readOnly={isSubmitting}
                        ref={textareaRef}
                        rows={1}
                        value={prompt}
                      />
                    </div>
                  </div>
                  <div className="zc-composer-actions flex items-end gap-2 sm:gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      {menuHasItems(composer.addMenu) && isShellControlVisible(controls["composer.add"]) ? <DropdownMenu className="bottom-full left-0 mb-2 w-[470px] max-w-[calc(100vw-2rem)]" menu={composer.addMenu} onClose={() => setAddOpen(false)} onSelect={handleAddMenuSelect} open={addOpen}>
                        <button {...getPresentedShellControlAttributes(controls["composer.add"])} aria-controls={addMenuPanelId} aria-expanded={addOpen} aria-haspopup="menu" aria-label="Add context" className="group/button inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-[13px] whitespace-nowrap text-foreground outline-none transition-all select-none hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4" disabled={isSubmitting} onClick={() => setAddOpen((open) => !open)} type="button">
                          <Icon className="size-4" name="plus" />
                          <span className="sr-only">Add context</span>
                        </button>
                      </DropdownMenu> : null}
                      <div className="flex shrink-0 items-center">
                        {menuHasItems(composer.approvalMenu) && isShellControlVisible(controls["composer.approval"]) ? <DropdownMenu className="bottom-full left-0 mb-2 w-80" menu={composer.approvalMenu} onClose={() => setApprovalOpen(false)} onSelect={handleApprovalMenuSelect} open={approvalOpen} selectedValue={approvalMode}>
                          <button {...getPresentedShellControlAttributes(controls["composer.approval"])} aria-controls={approvalMenuPanelId} aria-expanded={approvalOpen} aria-haspopup="menu" aria-label={approvalMode} className="zc-composer-approval flex h-7 shrink-0 items-center gap-1 rounded-lg border border-transparent bg-transparent pl-2 pr-1.5 text-[13px] text-foreground outline-none transition-all select-none hover:bg-hover hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3.5" onClick={() => setApprovalOpen((open) => !open)} role="combobox" type="button">
                            <HandIcon className="size-4 text-current" />
                            <span className="zc-composer-approval-label hidden sm:inline-flex"><span>{approvalMode}</span></span>
                            <ChevronDownIcon className="size-3.5 text-foreground-subtle" />
                          </button>
                        </DropdownMenu> : null}
                      </div>
                    </div>
                    <div className="zc-composer-secondary flex items-center gap-1 sm:gap-1.5">
                      {composer.contextUsage && isShellControlVisible(controls["composer.context"]) ? <button {...getPresentedShellControlAttributes(controls["composer.context"])} type="button" aria-label={composer.contextUsage.ariaLabel} className="group/button inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent bg-transparent text-[13px]/relaxed whitespace-nowrap text-foreground-subtle outline-none transition-all select-none hover:bg-hover hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0">
                        <ContextUsageIcon />
                      </button> : null}
                      {menuHasItems(composer.modelMenu) && isShellControlVisible(controls["composer.model"]) ? <DropdownMenu className="bottom-full right-0 mb-2 w-52" menu={composer.modelMenu} onClose={() => setModelOpen(false)} onSelect={handleModelMenuSelect} open={modelOpen} selectedValue={model}>
                        <button {...getPresentedShellControlAttributes(controls["composer.model"])} aria-controls={modelMenuPanelId} aria-expanded={modelOpen} aria-haspopup="menu" aria-label={model} className="group/button inline-flex h-7 shrink-0 w-fit items-center justify-between gap-1 rounded-lg border border-transparent bg-transparent pl-2 pr-1.5 text-[13px] text-foreground outline-none transition-all select-none hover:bg-hover hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3.5" onClick={() => setModelOpen((open) => !open)} type="button">
                          <span className="zc-composer-model-label hidden min-w-0 text-left sm:inline">{model}</span>
                          <ChevronDownIcon className="size-3.5 text-foreground-subtle" />
                        </button>
                      </DropdownMenu> : composer.modelMenu.id === "model-menu-readonly" && isShellControlVisible(controls["composer.model"]) ? <span {...getPresentedShellControlAttributes(controls["composer.model"])} aria-label={`Model: ${model}`} className="zc-composer-model-label hidden h-7 items-center px-2 text-[13px] text-foreground-subtle sm:inline-flex">{model}</span> : null}
                      {menuHasItems(composer.reasoningMenu) && isShellControlVisible(controls["composer.reasoning"]) ? <div {...getPresentedShellControlAttributes(controls["composer.reasoning"])} className="relative">
                        <DropdownMenu
                          className="bottom-full right-0 mb-2 w-52"
                          menu={composer.reasoningMenu}
                          onClose={() => {
                            setReasoningOpen(false);
                            closeNestedMenu();
                          }}
                          onSelect={handleReasoningMenuSelect}
                          onSubmenu={handleReasoningSubmenu}
                          open={reasoningOpen}
                          selectedValue={reasoning}
                        >
                          <>
                            <button aria-controls={reasoningMenuPanelId} aria-expanded={reasoningOpen} aria-haspopup="menu" aria-label={reasoning} className="group/button inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1.5 text-[13px] text-foreground outline-none transition-all select-none hover:bg-hover hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4" onClick={() => {
                              if (reasoningOpen) {
                                setReasoningOpen(false);
                                closeNestedMenu();
                                return;
                              }

                              setReasoningOpen(true);
                            }} type="button">
                              <BrainIcon className="size-4 text-current" />
                              <span className="zc-composer-reasoning-label hidden min-w-0 whitespace-nowrap sm:inline-flex"><span className="relative inline-flex">{reasoning}</span></span>
                              <ChevronDownIcon className="size-3.5 text-foreground-subtle" />
                            </button>
                            {reasoningOpen && nestedMenu ? (
                              <MenuPanel
                                autoFocus={false}
                                className="w-60"
                                menu={nestedMenu === "model" ? composer.modelMenu : composer.speedMenu}
                                onSelect={handleNestedMenuSelect}
                                panelRef={(node) => {
                                  nestedMenuPanelRef.current = node;
                                }}
                                selectedValue={nestedMenu === "model" ? model : speed}
                                style={nestedMenuStyle}
                              />
                            ) : null}
                          </>
                        </DropdownMenu>
                      </div> : null}
                      <ComposerSubmitControl
                        canSubmit={canSubmit}
                        interruptAction={composer.interruptAction}
                        isStreaming={isStreaming}
                        isSubmitting={isSubmitting}
                        onActionTrigger={onActionTrigger}
                      />
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
