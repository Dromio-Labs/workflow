import {createContext, useContext, type ReactNode} from "react";

import type {IconName} from "../../contracts/chatShellManifest";
import type {ChatShellIconRendererRegistry} from "../shell/ChatShell.types";

type IconProps = {
  className?: string;
  name: IconName;
};

const IconRendererContext = createContext<ChatShellIconRendererRegistry | undefined>(undefined);

export function IconRendererProvider({
  children,
  renderers,
}: {
  children: ReactNode;
  renderers?: ChatShellIconRendererRegistry;
}) {
  return (
    <IconRendererContext.Provider value={renderers}>
      {children}
    </IconRendererContext.Provider>
  );
}

export function Icon({className = "", name}: IconProps) {
  const iconRenderers = useContext(IconRendererContext);
  const customRenderer = iconRenderers?.[name];

  if (customRenderer) {
    return customRenderer({
      "aria-hidden": true,
      className,
      name,
    });
  }

  const common = {
    "aria-hidden": true,
    className: `lucide ${className}`,
    fill: "none",
    height: 24,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
    width: 24,
    xmlns: "http://www.w3.org/2000/svg",
  };
  const thin = {...common, strokeWidth: 1.5};
  const normal = {...common, strokeWidth: 2};

  switch (name) {
    case "archive":
      return <svg {...thin} className={`lucide lucide-archive ${className}`}><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>;
    case "branch":
      return <svg {...thin} className={`lucide lucide-git-branch ${className}`}><path d="M15 6a9 9 0 0 0-9 9V3" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /></svg>;
    case "check":
      return <svg {...thin} className={`lucide lucide-circle-check-big ${className}`}><path d="M21.801 10A10 10 0 1 1 17 3.335" /><path d="m9 11 3 3L22 4" /></svg>;
    case "chevron-down":
      return <svg {...thin} className={`lucide lucide-chevron-down ${className}`}><path d="m6 9 6 6 6-6" /></svg>;
    case "clock":
      return <svg {...thin} className={`lucide lucide-clock ${className}`}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>;
    case "commit":
      return <svg {...thin} className={`lucide lucide-git-commit-horizontal ${className}`}><circle cx="12" cy="12" r="3" /><line x1="3" x2="9" y1="12" y2="12" /><line x1="15" x2="21" y1="12" y2="12" /></svg>;
    case "copy":
      return <svg {...thin} className={`lucide lucide-copy ${className}`}><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>;
    case "external-window":
      return <svg {...thin} className={`lucide lucide-panel-top-open ${className}`}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="m15 14-3-3-3 3" /></svg>;
    case "file":
      return <svg {...thin} className={`lucide lucide-file ${className}`}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>;
    case "file-diff":
      return <svg {...thin} className={`lucide lucide-file-diff ${className}`}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M9 10h6" /><path d="M12 13V7" /><path d="M9 17h6" /></svg>;
    case "folder":
      return <svg {...normal} className={`lucide lucide-folder ${className}`}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>;
    case "folder-open":
      return <svg {...thin} className={`lucide lucide-folder-open ${className}`}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></svg>;
    case "folder-plus":
      return <svg {...thin} className={`lucide lucide-folder-plus ${className}`}><path d="M12 10v6" /><path d="M9 13h6" /><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>;
    case "fork":
      return <svg {...thin} className={`lucide lucide-git-fork ${className}`}><circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" /><path d="M12 12v3" /></svg>;
    case "globe":
      return <svg {...thin} className={`lucide lucide-globe ${className}`}><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>;
    case "list":
      return <svg {...thin} className={`lucide lucide-list-checks ${className}`}><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></svg>;
    case "layout-panel-left":
      return <svg {...thin} className={`lucide lucide-panel-left-close ${className}`}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m16 15-3-3 3-3" /></svg>;
    case "message-plus":
      return <svg {...thin} className={`lucide lucide-message-circle-plus ${className}`}><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" /><path d="M8 12h8" /><path d="M12 8v8" /></svg>;
    case "mic":
      return <svg {...thin} className={`lucide lucide-mic ${className}`}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></svg>;
    case "more":
      return <svg {...normal} className={`lucide lucide-ellipsis ${className}`}><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>;
    case "package":
      return <svg {...thin} className={`lucide lucide-package ${className}`}><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>;
    case "pencil":
      return <svg {...thin} className={`lucide lucide-pencil ${className}`}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>;
    case "pin":
      return <svg {...thin} className={`lucide lucide-pin ${className}`} overflow="visible"><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V4h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" /></svg>;
    case "plan":
      return <svg {...thin} className={`lucide lucide-list-todo ${className}`}><rect x="3" y="5" width="6" height="6" rx="1" /><path d="m4 16 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></svg>;
    case "plus":
      return <svg {...normal} className={`lucide lucide-plus ${className}`}><path d="M5 12h14" /><path d="M12 5v14" /></svg>;
    case "settings":
      return <svg {...thin} className={`lucide lucide-settings ${className}`}><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" /></svg>;
    case "shield":
      return <svg {...thin} className={`lucide lucide-shield ${className}`}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.68-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg>;
    case "spark":
      return <svg {...thin} className={`lucide lucide-sparkles ${className}`}><path d="M9.94 14.5 8.5 18.06 7.06 14.5 3.5 13.06 7.06 11.62 8.5 8.06l1.44 3.56 3.56 1.44z" /><path d="M16.5 3.5 17.7 6.3l2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2z" /></svg>;
    case "stop":
      return <svg {...common} className={`lucide lucide-square ${className}`}><rect fill="currentColor" height="12" rx="2" stroke="none" width="12" x="6" y="6" /></svg>;
    case "square-chart":
      return <svg {...thin} className={`lucide lucide-square-chart-gantt ${className}`}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 8h7" /><path d="M8 12h6" /><path d="M11 16h5" /></svg>;
    case "target":
      return <svg {...thin} className={`lucide lucide-target ${className}`}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>;
    case "terminal":
      return <svg {...thin} className={`lucide lucide-square-terminal ${className}`}><path d="m7 11 2-2-2-2" /><path d="M11 13h4" /><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /></svg>;
    case "wand":
      return <svg {...thin} className={`lucide lucide-wand-sparkles ${className}`}><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" /><path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" /><path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" /><path d="M11 3H9" /></svg>;
    case "x":
      return <svg {...thin} className={`lucide lucide-x ${className}`}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
  }

  throw new Error(`Icon "${name}" does not have a built-in renderer. Register it with ChatShell renderers.icons or a ChatShell extension.`);
}
