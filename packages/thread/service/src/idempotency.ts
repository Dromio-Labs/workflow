import { ThreadServiceError } from "./errors.js";
import type { ThreadTransaction } from "./ports.js";
import type { ThreadCommandContext, ThreadReceipt, ThreadScope } from "./types.js";

export async function replayCommand<Resource>(tx: ThreadTransaction, scope: ThreadScope, context: ThreadCommandContext, name: string, input: object): Promise<ThreadReceipt<Resource> | undefined> { if (!context.idempotencyKey) return undefined; const stored = await tx.getReceipt(scope, context.idempotencyKey); if (!stored) return undefined; const inputDigest = digest(name, input); if (stored.commandName !== name || stored.inputDigest !== inputDigest) throw new ThreadServiceError({ code: "idempotency_conflict", message: "The idempotency key was already used with a different command." }); return { ...stored.receipt, replayed: true } as ThreadReceipt<Resource>; }
export async function persistCommand(tx: ThreadTransaction, scope: ThreadScope, context: ThreadCommandContext, name: string, input: object, receipt: Parameters<ThreadTransaction["putReceipt"]>[0]["receipt"]): Promise<void> { if (!context.idempotencyKey) return; await tx.putReceipt({ scope, idempotencyKey: context.idempotencyKey, commandName: name, inputDigest: digest(name, input), receipt }); }
function digest(name: string, input: object): string { return JSON.stringify([name, input]); }
