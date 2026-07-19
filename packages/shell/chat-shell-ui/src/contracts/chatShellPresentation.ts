import {z} from "zod";

export const chatShellPresentationSchemaVersion = "chat-shell-presentation.v1" as const;

export const ShellControlIdSchema = z.enum([
  "chrome.app-picker",
  "chrome.branch",
  "chrome.more",
  "chrome.workspace",
  "chrome.window-controls",
  "chrome.status",
  "chrome.terminal",
  "chrome.side-panel",
  "sidebar",
  "sidebar.archive",
  "sidebar.filter",
  "sidebar.user",
  "composer.add",
  "composer.approval",
  "composer.context",
  "composer.model",
  "composer.reasoning",
  "composer.speed",
  "status-rail",
  "side-panel",
]);

export const ShellControlCapabilitySchema = z.discriminatedUnion("state", [
  z.object({state: z.literal("unsupported")}).strict(),
  z.object({state: z.literal("available")}).strict(),
  z.object({
    reason: z.string().min(1),
    state: z.literal("temporarily-unavailable"),
  }).strict(),
]);

export const ShellControlPolicySchema = z.object({
  defaultVisibility: z.enum(["auto", "visible", "hidden"]),
  required: z.boolean().optional(),
  userConfigurable: z.boolean(),
}).strict();

export const ShellPresentationPreferencesSchema = z.object({
  controls: z.partialRecord(
    ShellControlIdSchema,
    z.enum(["visible", "hidden"]),
  ).default({}),
}).strict();

export const ShellPresentationPolicySchema = z.object({
  controls: z.partialRecord(
    ShellControlIdSchema,
    ShellControlPolicySchema,
  ).default({}),
}).strict();

export const ShellPresentationPatchSchema = z.object({
  controls: z.partialRecord(
    ShellControlIdSchema,
    z.object({visibility: z.enum(["visible", "hidden"])}).strict(),
  ).default({}),
  schemaVersion: z.literal(chatShellPresentationSchemaVersion),
}).strict();

export const ChatShellCapabilitiesSchema = z.object({
  controls: z.partialRecord(
    ShellControlIdSchema,
    ShellControlCapabilitySchema,
  ).default({}),
}).strict();

export type ChatShellCapabilities = z.infer<typeof ChatShellCapabilitiesSchema>;
export type ShellControlCapability = z.infer<typeof ShellControlCapabilitySchema>;
export type ShellControlId = z.infer<typeof ShellControlIdSchema>;
export type ShellControlPolicy = z.infer<typeof ShellControlPolicySchema>;
export type ShellPresentationPatch = z.infer<typeof ShellPresentationPatchSchema>;
export type ShellPresentationPolicy = z.infer<typeof ShellPresentationPolicySchema>;
export type ShellPresentationPreferences = z.infer<typeof ShellPresentationPreferencesSchema>;
