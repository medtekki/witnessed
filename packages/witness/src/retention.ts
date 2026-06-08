import type { Receipt } from "@witnessed/core";
import type { ReceiptStore } from "./store";

/** Operator retention policy. EU AI Act high-risk logs: keep at least ~6 months (180 days). */
export interface RetentionPolicy {
  minimumDays: number;
}

/** Store-side lifecycle metadata about a stored receipt (not part of the signed receipt). */
export interface RecordMeta {
  id: string;
  witnessed_at: string;
  retain_until: string | null; // ISO 8601; null = retain indefinitely
  legal_hold: boolean;
  legal_hold_reason: string | null;
}

export interface ListFilter {
  from?: string; // witnessed_at >= this ISO 8601 time
  to?: string; // witnessed_at <= this ISO 8601 time
  agentKeyId?: string; // only receipts signed by this agent key
}

export interface PurgeResult {
  purged: string[]; // ids deleted because they passed retain_until and were not held
  retainedUnderHold: string[]; // ids that WOULD have expired but were kept due to a legal hold
}

/** A store that supports record-keeping: retention windows, legal hold, listing, and purge. */
export interface RetentionStore extends ReceiptStore {
  getMeta(id: string): Promise<RecordMeta | null>;
  placeLegalHold(id: string, reason: string): Promise<boolean>;
  releaseLegalHold(id: string): Promise<boolean>;
  list(filter?: ListFilter): Promise<Receipt[]>;
  /** Delete records past their retain_until that are not under legal hold. Audited, never silent. */
  purgeExpired(nowIso: string): Promise<PurgeResult>;
}

/** retain_until = witnessed_at + minimumDays (or null when no policy is configured). */
export function computeRetainUntil(
  witnessedAtIso: string,
  policy: RetentionPolicy | undefined,
): string | null {
  if (!policy) return null;
  const base = new Date(witnessedAtIso).getTime();
  return new Date(base + policy.minimumDays * 24 * 60 * 60 * 1000).toISOString();
}
