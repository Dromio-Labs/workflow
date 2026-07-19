import type {ReactNode} from "react";

export function DevButton({
  ariaLabel,
  children,
  className = "",
  disabled = false,
  onClick,
}: {
  readonly ariaLabel?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`rounded-lg border border-border bg-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
