/**
 * Anchor validators let the witness independently confirm that an agent's claimed
 * external effect actually happened, turning a "witnessed claim" into "proven effect".
 */
/** What a validator gets to inspect: the anchor value plus the claim's content digest. */
export interface AnchorContext {
  /** The Anchor.value (e.g. a Message-ID, txn id, or EHR record id). */
  value: string;
  /** The claim's payload_digest, enabling provenance binding (null if the agent set none). */
  payload_digest: string | null;
}

export interface AnchorValidator {
  /** The Anchor.type this validator handles, e.g. "email.message_id". */
  readonly type: string;
  validate(ctx: AnchorContext): Promise<{ verified: boolean; detail: string }>;
}

export type ValidatorRegistry = Record<string, AnchorValidator>;

/** Looks up a message by its Message-ID against an email provider (ESP). */
export interface EmailLookup {
  (messageId: string): Promise<{ found: boolean; detail?: string }>;
}

/**
 * Validates an `email.message_id` anchor by asking an injected lookup whether a message
 * with that Message-ID exists at the provider. In production `lookup` calls an ESP API
 * (e.g. Postmark/SendGrid/Resend); in tests it is stubbed.
 */
export class EmailMessageIdValidator implements AnchorValidator {
  readonly type = "email.message_id";

  constructor(private readonly lookup: EmailLookup) {}

  async validate(ctx: AnchorContext): Promise<{ verified: boolean; detail: string }> {
    const r = await this.lookup(ctx.value);
    return {
      verified: r.found,
      detail: r.detail ?? (r.found ? "message found at provider" : "message not found at provider"),
    };
  }
}

/** Looks up a transaction by id at a payment processor; reports its settlement status. */
export interface PaymentLookup {
  (txnId: string): Promise<{ found: boolean; status?: string; detail?: string }>;
}

/**
 * Validates a `payment.txn_id` anchor. Unlike email, a payment is only "proven" when the
 * transaction both exists AND has reached a settled status — a found-but-failed/pending
 * transaction is recorded as verified:false. In production `lookup` calls a processor API
 * (e.g. Stripe/Adyen); in tests it is stubbed.
 */
export class PaymentTxnIdValidator implements AnchorValidator {
  readonly type = "payment.txn_id";

  constructor(
    private readonly lookup: PaymentLookup,
    /** Statuses that count as a settled, effect-proven payment. */
    private readonly settledStatuses: readonly string[] = ["succeeded", "settled", "paid", "captured"],
  ) {}

  async validate(ctx: AnchorContext): Promise<{ verified: boolean; detail: string }> {
    const r = await this.lookup(ctx.value);
    if (!r.found) {
      return { verified: false, detail: r.detail ?? "transaction not found at provider" };
    }
    const settled = r.status !== undefined && this.settledStatuses.includes(r.status);
    return {
      verified: settled,
      detail: r.detail ?? `transaction status "${r.status ?? "unknown"}" at provider`,
    };
  }
}

/** Looks up a clinical record by id at an EHR; reports status and a content hash. */
export interface EhrLookup {
  (
    recordId: string,
  ): Promise<{ found: boolean; status?: string; contentHash?: string; detail?: string }>;
}

/**
 * Validates an `ehr.record_id` anchor with MDR-style provenance semantics. An EHR record is
 * only "proven" when it (1) exists, (2) is in an accepted status (not draft/entered-in-error),
 * and (3) — when the claim carries a payload_digest — the EHR record's content hash MATCHES
 * that digest, proving the agent wrote exactly the clinical data it claimed. Without a
 * payload_digest, provenance can't be bound and only existence+status are checked.
 * In production `lookup` fetches the resource from the EHR (e.g. a FHIR API); in tests it is stubbed.
 */
export class EhrRecordIdValidator implements AnchorValidator {
  readonly type = "ehr.record_id";

  constructor(
    private readonly lookup: EhrLookup,
    /** Record statuses that count as a real, non-erroneous clinical record. */
    private readonly acceptedStatuses: readonly string[] = [
      "active",
      "final",
      "amended",
      "completed",
    ],
  ) {}

  async validate(ctx: AnchorContext): Promise<{ verified: boolean; detail: string }> {
    const r = await this.lookup(ctx.value);
    if (!r.found) {
      return { verified: false, detail: r.detail ?? "record not found in EHR" };
    }
    if (r.status === undefined || !this.acceptedStatuses.includes(r.status)) {
      return {
        verified: false,
        detail: r.detail ?? `record status "${r.status ?? "unknown"}" not accepted`,
      };
    }
    if (ctx.payload_digest !== null) {
      if (r.contentHash === undefined) {
        return { verified: false, detail: "EHR returned no content hash for provenance check" };
      }
      if (r.contentHash !== ctx.payload_digest) {
        return {
          verified: false,
          detail: "EHR record content hash does not match the receipt payload_digest (provenance mismatch)",
        };
      }
      return { verified: true, detail: `record "${r.status}" with matching provenance` };
    }
    return { verified: true, detail: `record "${r.status}" (no payload_digest to bind provenance)` };
  }
}
