import "@testing-library/jest-dom/vitest";

import {afterEach, vi} from "vitest";
import {cleanup} from "@testing-library/react";
import React, {useImperativeHandle, useRef} from "react";

vi.mock("react-resizable-panels", () => {
  const PanelGroup = ({children, className}: {children: React.ReactNode; className?: string}) => (
    React.createElement("div", {className}, children)
  );
  const Panel = ({
    children,
    className,
    elementRef,
    onResize,
    panelRef,
  }: {
    children: React.ReactNode;
    className?: string;
    elementRef?: React.Ref<HTMLDivElement>;
    onResize?: (size: {inPixels: number}) => void;
    panelRef?: React.Ref<{getSize: () => {inPixels: number}; resize: (size: number) => void}>;
  }) => {
    const sizeRef = useRef(0);

    useImperativeHandle(panelRef, () => ({
      getSize: () => ({inPixels: sizeRef.current}),
      resize: (size: number) => {
        sizeRef.current = size;
        onResize?.({inPixels: size});
      },
    }), [onResize]);

    return React.createElement("div", {className, ref: elementRef}, children);
  };
  const Separator = ({
    children,
    className,
    disabled,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {disabled?: boolean}) => (
    React.createElement("div", {
      ...props,
      "aria-disabled": disabled || undefined,
      className,
      role: "separator",
    }, children)
  );

  return {
    Group: PanelGroup,
    Panel,
    Separator,
  };
});

afterEach(() => {
  cleanup();
});

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

if (!window.ResizeObserver) {
  class MockResizeObserver {
    disconnect() {}
    observe() {}
    unobserve() {}
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserver,
  });
}

Element.prototype.setPointerCapture ??= vi.fn();
Element.prototype.releasePointerCapture ??= vi.fn();

Element.prototype.animate ??= vi.fn().mockImplementation(() => ({
  addEventListener: vi.fn(),
  cancel: vi.fn(),
}));
