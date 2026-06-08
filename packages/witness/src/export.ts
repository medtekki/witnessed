import { isHumanDecision } from "@witnessed/core";
import type { Anchor, Jwk, PaymentSettlement, Receipt } from "@witnessed/core";
import { verifyReceipt, verifyChain } from "@witnessed/verifier";

const DISCLAIMER =
  "This export is STRUCTURED TO SUPPORT EU AI Act Article 12 logging and traceability " +
  "obligations (ordered event log, timestamps, actor, outcome, integrity verification, " +
  "retention statement). The field mapping and its sufficiency for Article 12 / Annex IV / " +
  "FRIA have NOT been validated by legal counsel and MUST be before any reliance. Format v0.";

export interface Article12ExportOptions {
  /** Identifies the AI system / provider for the log header. */
  system: { name: string; provider: string; version?: string };
  /** When the export was generated (ISO 8601). Injected so exports are deterministic. */
  generated_at: string;
  /** Human description of what this export covers. */
  scope?: string;
  /** Retention policy in effect, for the record-keeping statement. */
  retention?: { minimum_days: number };
}

export interface Article12Event {
  sequence: number;
  id: string; // receipt id (content hash) — the integrity anchor
  event_type: string; // action.type
  description: string; // action.description
  issued_at: string; // actor's claimed time
  witnessed_at: string; // authoritative time
  actor: { key_id: string; label?: string; on_behalf_of?: string };
  payload_digest: string | null;
  effect: { anchor: Anchor | null; verified: boolean | null; detail: string | null };
  chain: { prev: string[] };
  human_oversight: boolean;
  service_payment: PaymentSettlement | null;
  integrity: { witness_key_id: string; signature_valid: boolean; reason?: string };
}

export interface Article12Export {
  format: "receipts.article12.v0";
  disclaimer: string;
  system: Article12ExportOptions["system"];
  generated_at: string;
  scope: string;
  retention: { minimum_days: number } | null;
  integrity_summary: {
    total: number;
    all_valid: boolean;
    invalid_ids: string[];
    chain_complete: boolean;
    chain_issues: string[];
  };
  events: Article12Event[];
}

/**
 * Build an Article-12-oriented event log from a set of receipts. Every receipt is
 * re-verified (its signature attested in the export), the chain links are resolved, and
 * events are ordered deterministically by (witnessed_at, id).
 */
export function buildArticle12Export(
  receipts: Receipt[],
  trustedWitnessKeys: Record<string, Jwk>,
  options: Article12ExportOptions,
): Article12Export {
  const ordered = [...receipts].sort((a, b) =>
    a.witness.witnessed_at === b.witness.witnessed_at
      ? a.id.localeCompare(b.id)
      : a.witness.witnessed_at.localeCompare(b.witness.witnessed_at),
  );

  const invalid_ids: string[] = [];
  const events: Article12Event[] = ordered.map((r, i) => {
    const v = verifyReceipt(r, trustedWitnessKeys);
    if (!v.valid) invalid_ids.push(r.id);
    const check = r.witness.anchor_check;
    return {
      sequence: i + 1,
      id: r.id,
      event_type: r.action.type,
      description: r.action.description,
      issued_at: r.issued_at,
      witnessed_at: r.witness.witnessed_at,
      actor: {
        key_id: r.agent.key_id,
        ...(r.agent.label ? { label: r.agent.label } : {}),
        ...(r.agent.on_behalf_of ? { on_behalf_of: r.agent.on_behalf_of } : {}),
      },
      payload_digest: r.payload_digest,
      effect: {
        anchor: r.anchor,
        verified: check ? check.verified : null,
        detail: check ? check.detail : null,
      },
      chain: { prev: r.prev },
      human_oversight: isHumanDecision(r.action.type),
      service_payment: r.witness.payment,
      integrity: {
        witness_key_id: r.witness.witness_key_id,
        signature_valid: v.valid,
        ...(v.valid ? {} : { reason: v.reason }),
      },
    };
  });

  const chain = verifyChain(ordered, trustedWitnessKeys);

  return {
    format: "receipts.article12.v0",
    disclaimer: DISCLAIMER,
    system: options.system,
    generated_at: options.generated_at,
    scope: options.scope ?? "unspecified",
    retention: options.retention ?? null,
    integrity_summary: {
      total: ordered.length,
      all_valid: invalid_ids.length === 0,
      invalid_ids,
      chain_complete: chain.valid,
      chain_issues: chain.issues,
    },
    events,
  };
}
