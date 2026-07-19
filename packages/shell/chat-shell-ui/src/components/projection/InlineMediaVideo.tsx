import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage } from "@chatshell/response-protocol";
import { Icon } from "../ui/Icon";

type InlineMedia = NonNullable<ChatMessage["media"]>[number];

export function InlineMediaVideo({ item }: { readonly item: InlineMedia }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    item.availability === "unavailable" ? "error" : "loading",
  );
  const [url, setUrl] = useState(item.url);
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setUrl(item.url);
    setStatus(item.availability === "unavailable" ? "error" : "loading");
  }, [item.availability, item.url]);

  async function retry() {
    if (!item.retryUrl) return;
    try {
      const response = await fetch(item.retryUrl, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInSeconds: 300 }),
      });
      if (!response.ok) throw new Error(`Media grant failed (${response.status}).`);
      const grant = await response.json() as { readonly url: string };
      setUrl(grant.url);
      setStatus("loading");
    } catch {
      setStatus("error");
    }
  }

  if (status === "error") {
    return (
      <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 text-center text-xs text-foreground-subtle" role="alert">
        <span>{item.name} is unavailable.</span>
        {item.error ? <span className="sr-only">{item.error}</span> : null}
        {item.retryUrl ? <button className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-hover" onClick={() => void retry()} type="button">Retry video</button> : null}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" data-inline-video="true">
      <div className="relative bg-black">
        {status === "loading" ? <span className="absolute inset-0 flex items-center justify-center text-xs text-white/70">Loading video…</span> : null}
        <video
          aria-label={item.name}
          className="aspect-video max-h-[32rem] w-full bg-black object-contain"
          controls
          onError={() => setStatus("error")}
          onLoadedMetadata={() => setStatus("ready")}
          preload="metadata"
          src={url}
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="truncate text-xs text-foreground-subtle">{item.name}</span>
        <button aria-haspopup="dialog" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-hover" onClick={() => setOpen(true)} ref={openerRef} type="button">Open video</button>
      </div>
      {open ? <VideoPreviewDialog name={item.name} onClose={() => setOpen(false)} openerRef={openerRef} url={url} /> : null}
    </div>
  );
}

function VideoPreviewDialog({
  name,
  onClose,
  openerRef,
  url,
}: {
  readonly name: string;
  readonly onClose: () => void;
  readonly openerRef: RefObject<HTMLButtonElement | null>;
  readonly url: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    videoRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        (document.activeElement === videoRef.current ? closeRef.current : videoRef.current)?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      openerRef.current?.focus();
    };
  }, [onClose, openerRef]);
  return createPortal(
    <div aria-label={`Video preview: ${name}`} aria-modal="true" className="hero-visual-theme fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} role="dialog">
      <figure className="m-0 flex max-h-full max-w-full flex-col items-center gap-3">
        <video aria-label={name} className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] rounded-lg bg-black object-contain shadow-2xl sm:max-w-[calc(100vw-4rem)]" controls preload="metadata" ref={videoRef} src={url} tabIndex={0} />
        <figcaption className="max-w-[min(42rem,calc(100vw-4rem))] truncate text-sm text-white/80">{name}</figcaption>
      </figure>
      <button aria-label="Close video preview" className="absolute right-3 top-3 flex size-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white sm:right-5 sm:top-5" onClick={onClose} ref={closeRef} type="button"><Icon className="size-5" name="x" /></button>
    </div>,
    document.body,
  );
}
