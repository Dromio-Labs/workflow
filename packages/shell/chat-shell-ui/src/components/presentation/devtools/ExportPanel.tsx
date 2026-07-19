import type {ShellPresentationPatch} from "../../../contracts/chatShellPresentation";
import {DevButton} from "./DevButton";

export function ExportPanel({
  importError,
  importValue,
  onApplyImport,
  onCopy,
  onImportValueChange,
  onReset,
  patch,
}: {
  readonly importError: string | null;
  readonly importValue: string;
  readonly onApplyImport: () => void;
  readonly onCopy: (value: string) => Promise<void>;
  readonly onImportValueChange: (value: string) => void;
  readonly onReset: () => void;
  readonly patch: ShellPresentationPatch;
}) {
  const json = JSON.stringify(patch, null, 2);
  const snippet = `<ChatShell manifest={manifest} presentation={${json}} />`;
  const prompt = `Apply this validated ChatShell presentation patch through the public presentation prop. Do not hide controls with CSS:\n${json}`;

  return (
    <section aria-label="Presentation export" className="hero-overlay-scrollbar hero-visual-theme fixed right-4 top-16 z-[1200] grid max-h-[calc(100svh-5rem)] w-[min(28rem,calc(100vw-2rem))] gap-2 overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl">
      <textarea aria-label="Presentation JSON" className="hero-overlay-scrollbar h-40 resize-y rounded-lg border border-border bg-input p-2 font-mono text-xs text-foreground" readOnly value={json} />
      <div className="flex flex-wrap gap-2">
        <DevButton onClick={() => void onCopy(json)}>Copy JSON</DevButton>
        <DevButton onClick={() => void onCopy(snippet)}>Copy component snippet</DevButton>
        <DevButton onClick={() => void onCopy(prompt)}>Copy AI prompt</DevButton>
        <DevButton onClick={onReset}>Discard draft changes</DevButton>
      </div>
      <textarea aria-label="Import presentation JSON" className="hero-overlay-scrollbar h-24 resize-y rounded-lg border border-border bg-input p-2 font-mono text-xs text-foreground" onChange={(event) => onImportValueChange(event.target.value)} placeholder="Paste presentation JSON to validate and apply" value={importValue} />
      {importError ? <p className="text-xs text-red-400" role="alert">{importError}</p> : null}
      <DevButton onClick={onApplyImport}>Apply imported JSON</DevButton>
    </section>
  );
}
