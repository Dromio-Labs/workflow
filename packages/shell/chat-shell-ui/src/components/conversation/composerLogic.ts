import type { CSSProperties } from "react";

import type {
  ChatShellComposerConfig,
  ChatShellMenuItem,
} from "../../contracts/chatShellManifest";

export type NestedMenuId = "model" | "speed";

const nestedMenuWidth = 240;
const nestedMenuFallbackHeight = 168;
const nestedMenuGap = 6;
const nestedMenuInset = 8;
export const allowedImageAttachmentTypes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
export const maxAttachmentBytes = 10 * 1024 * 1024;
export const maxAttachmentCount = 8;
export const maxTotalAttachmentBytes = 20 * 1024 * 1024;

type PromptTrigger = "slash" | "mention" | "skill";

type TriggerQuery = {
  end: number;
  query: string;
  start: number;
  trigger: PromptTrigger;
};

export function getNestedMenuId(item: ChatShellMenuItem): NestedMenuId | null {
  return item.submenuId === "model" || item.submenuId === "speed" ? item.submenuId : null;
}

export function getNestedMenuStyle(anchor: HTMLElement, panel: HTMLElement | null): CSSProperties {
  const anchorRect = anchor.getBoundingClientRect();
  const parentMenu = anchor.closest('[role="menu"]') as HTMLElement | null;
  const parentRect = parentMenu?.getBoundingClientRect() ?? anchorRect;
  const bounds = getComposerOverlayBounds(anchor);
  const availableWidth = Math.max(0, bounds.right - bounds.left);
  const leftSpace = Math.max(0, parentRect.left - bounds.left - nestedMenuGap);
  const rightSpace = Math.max(0, bounds.right - parentRect.right - nestedMenuGap);
  const side: "left" | "right" = rightSpace > leftSpace ? "right" : "left";
  const sideSpace = side === "right" ? rightSpace : leftSpace;
  const width = Math.min(nestedMenuWidth, Math.max(0, sideSpace || availableWidth));
  const left = clamp(
    side === "right" ? parentRect.right + nestedMenuGap : parentRect.left - width - nestedMenuGap,
    bounds.left,
    Math.max(bounds.left, bounds.right - width),
  );
  const availableHeight = Math.max(0, bounds.bottom - bounds.top);
  const measuredHeight = panel?.scrollHeight ?? panel?.getBoundingClientRect().height ?? nestedMenuFallbackHeight;
  const visibleHeight = Math.min(measuredHeight, availableHeight);
  const top = clamp(anchorRect.top - 4, bounds.top, Math.max(bounds.top, bounds.bottom - visibleHeight));
  const maxHeight = Math.max(0, Math.min(measuredHeight, bounds.bottom - top));
  const overflows = measuredHeight > maxHeight + 1;
  const fixedOffset = getFixedPositionOffset(anchor);

  return {
    left: left - fixedOffset.left,
    maxHeight: overflows ? maxHeight : maxHeight + 2,
    overflowX: "hidden",
    overflowY: overflows ? "auto" : "hidden",
    scrollbarGutter: "auto",
    position: "fixed",
    top: top - fixedOffset.top,
    width,
    zIndex: 60,
  };
}

function getFixedPositionOffset(anchor: HTMLElement) {
  let node = anchor.parentElement;

  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const createsFixedContainingBlock =
      style.transform !== "none" ||
      style.perspective !== "none" ||
      style.filter !== "none" ||
      style.backdropFilter !== "none" ||
      style.contain.includes("paint") ||
      style.contain.includes("layout") ||
      style.contain.includes("strict") ||
      style.contain.includes("content") ||
      style.willChange.includes("transform") ||
      style.willChange.includes("perspective") ||
      style.willChange.includes("filter");

    if (createsFixedContainingBlock) {
      const rect = node.getBoundingClientRect();
      return {left: rect.left, top: rect.top};
    }

    node = node.parentElement;
  }

  return {left: 0, top: 0};
}

function getComposerOverlayBounds(anchor: HTMLElement) {
  const viewport = {
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth,
    top: 0,
  };
  const frame = anchor.closest(".chat-shell-frame") as HTMLElement | null;
  const frameRect = frame?.getBoundingClientRect();
  const rawBounds = frameRect
    ? {
        bottom: Math.min(viewport.bottom, frameRect.bottom),
        left: Math.max(viewport.left, frameRect.left),
        right: Math.min(viewport.right, frameRect.right),
        top: Math.max(viewport.top, frameRect.top),
      }
    : viewport;
  const insetBounds = {
    bottom: rawBounds.bottom - nestedMenuInset,
    left: rawBounds.left + nestedMenuInset,
    right: rawBounds.right - nestedMenuInset,
    top: rawBounds.top + nestedMenuInset,
  };

  if (insetBounds.right <= insetBounds.left || insetBounds.bottom <= insetBounds.top) {
    return rawBounds;
  }

  return insetBounds;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getPromptTriggerSymbol(trigger: PromptTrigger) {
  if (trigger === "slash") {
    return "/";
  }

  if (trigger === "mention") {
    return "@";
  }

  return "$";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTriggerQuery(value: string, cursor: number, trigger: PromptTrigger): TriggerQuery | null {
  const beforeCursor = value.slice(0, cursor);
  const symbol = getPromptTriggerSymbol(trigger);
  const escaped = escapeRegExp(symbol);
  const invalidChars = `\\s${escaped}`;
  const match = new RegExp(`(?:^|\\s)${escaped}([^${invalidChars}]*)$`).exec(beforeCursor);

  if (!match || match.index === undefined) {
    return null;
  }

  const tokenStartsAfterWhitespace = beforeCursor[match.index] !== symbol;
  const start = match.index + (tokenStartsAfterWhitespace ? 1 : 0);

  return {
    end: cursor,
    query: match[1] ?? "",
    start,
    trigger,
  };
}

function itemMatchesQuery(item: ChatShellMenuItem, query: string) {
  if (!query) {
    return true;
  }

  const needle = query.toLowerCase();
  return [item.label, item.id, item.value, item.description, item.shortcut]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(needle));
}

export function getPromptTriggerQuery(value: string, cursor: number): TriggerQuery | null {
  return getTriggerQuery(value, cursor, "slash") ?? getTriggerQuery(value, cursor, "mention") ?? getTriggerQuery(value, cursor, "skill");
}

export function getPromptTriggerSections(triggerQuery: TriggerQuery | null, commands: ChatShellComposerConfig["promptCommands"]) {
  if (!triggerQuery) {
    return [];
  }

  if (triggerQuery.trigger === "slash") {
    return [
      {
        id: "slash-command-section",
        items: commands.slash.filter((item) => itemMatchesQuery(item, triggerQuery.query)),
      },
      {
        id: "slash-skill-section",
        items: commands.skills.filter((item) => itemMatchesQuery(item, triggerQuery.query)),
        title: "Skills",
      },
    ].filter((section) => section.items.length > 0);
  }

  if (triggerQuery.trigger === "skill") {
    return [
      {
        id: "skill-section",
        items: commands.skills.filter((item) => itemMatchesQuery(item, triggerQuery.query)),
      },
    ];
  }

  return [
    {
      id: "mention-add-section",
      items: commands.mentionAdd.filter((item) => itemMatchesQuery(item, triggerQuery.query)),
      title: "Add",
    },
    {
      id: "mention-files-chats-section",
      items: commands.mentionFiles.filter((item) => itemMatchesQuery(item, triggerQuery.query)),
      title: "Files and chats",
    },
  ].filter((section) => section.items.length > 0);
}

export function menuHasItems(menu: {sections: Array<{items: unknown[]}>}) {
  return menu.sections.some((section) => section.items.length > 0);
}
