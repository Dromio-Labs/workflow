import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  WorkflowCatalogItem,
} from "../catalog/index.js";

export type WorkflowValidateCatalog = {
  get(id: string): WorkflowCatalogItem | undefined;
  ids: Set<string>;
};

type CatalogModule = {
  workflowCatalog?: { items?(): WorkflowCatalogItem[] };
  workflowCatalogItems?: WorkflowCatalogItem[];
} & Record<string, unknown>;

// Bun's package build strips Vite control comments. Keep the trusted local
// module specifier as a function argument so downstream bundlers never try to
// statically expand a filesystem import.
const importCatalogModule = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<CatalogModule>;

export async function loadWorkbenchCatalog(cwd: string): Promise<WorkflowValidateCatalog> {
  const importedItems = await importCatalogItems(cwd);
  const scannedIds = await scanCatalogIds(path.join(cwd, "catalog"));
  const byId = new Map<string, WorkflowCatalogItem>();
  for (const item of importedItems) {
    byId.set(item.id, item);
    scannedIds.add(item.id);
  }
  return {
    get(id) {
      return byId.get(id);
    },
    ids: scannedIds,
  };
}

export function resolveCatalogSource(cwd: string, source: string): string | undefined {
  const normalized = source.replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
  const candidates = [
    path.join(cwd, source),
    path.join(cwd, `${normalized}.ts`),
    path.join(cwd, `${normalized}.tsx`),
    path.join(cwd, `${normalized}.js`),
    path.join(cwd, normalized, "index.ts"),
    path.join(cwd, normalized, "index.tsx"),
    path.join(cwd, normalized, "index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function importCatalogItems(cwd: string): Promise<WorkflowCatalogItem[]> {
  const indexPath = path.join(cwd, "catalog", "index.ts");
  if (!existsSync(indexPath)) return [];
  try {
    const specifier = `${pathToFileURL(indexPath).href}?dromioValidate=${Date.now()}`;
    const mod = await importCatalogModule(specifier);
    return uniqueCatalogItems([
      ...catalogItemsFromExport(mod.workflowCatalogItems),
      ...catalogItemsFromExport(mod.workflowCatalog),
      ...Object.values(mod).flatMap(catalogItemsFromExport),
    ]);
  } catch {
    return [];
  }
}

async function scanCatalogIds(catalogDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!existsSync(catalogDir)) return ids;
  const files = await collectCatalogFiles(catalogDir);
  for (const filePath of files) {
    if (filePath.endsWith(".json")) {
      await scanJsonCatalogIds(filePath, ids);
    } else {
      await scanTypeScriptCatalogIds(filePath, ids);
    }
  }
  return ids;
}

async function collectCatalogFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        files.push(...await collectCatalogFiles(entryPath));
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.(ts|tsx|json)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

async function scanJsonCatalogIds(filePath: string, ids: Set<string>): Promise<void> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (isRecord(parsed) && typeof parsed.id === "string") ids.add(parsed.id);
}

async function scanTypeScriptCatalogIds(filePath: string, ids: Set<string>): Promise<void> {
  const text = await readFile(filePath, "utf8");
  const matches = text.matchAll(/\bid\s*:\s*["']([a-zA-Z0-9_.:-]+)["']/g);
  for (const match of matches) {
    const id = match[1];
    if (id && id.includes(".")) ids.add(id);
  }
}

function isWorkflowCatalogItem(value: unknown): value is WorkflowCatalogItem {
  return isRecord(value) && typeof value.id === "string" && typeof value.label === "string";
}

function catalogItemsFromExport(value: unknown): WorkflowCatalogItem[] {
  if (Array.isArray(value)) return value.filter(isWorkflowCatalogItem);
  if (isRecord(value) && typeof value.items === "function") {
    const items = value.items() as unknown;
    return Array.isArray(items) ? items.filter(isWorkflowCatalogItem) : [];
  }
  return [];
}

function uniqueCatalogItems(items: WorkflowCatalogItem[]): WorkflowCatalogItem[] {
  const byId = new Map<string, WorkflowCatalogItem>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
