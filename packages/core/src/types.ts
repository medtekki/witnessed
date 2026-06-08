export interface Jwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  d?: string; // present only on private keys; never sent to the witness
}

export interface Agent {
  key_id: string;
  public_key: Jwk; // public only (no `d`)
  label?: string;
  on_behalf_of?: string;
}

export interface Action {
  type: string; // e.g. "email.send"
  description: string; // human-readable
}

/** Agent-provided reference to a real external effect, e.g. an email Message-ID. */
export interface Anchor {
  type: string; // e.g. "email.message_id", "payment.txn_id", "ehr.record_id"
  value: string; // the external reference
}

/** The witness's independent verification of an anchor. Bound by the witness signature. */
export interface AnchorCheck {
  verified: boolean;
  checked_at: string; // ISO 8601, when the witness checked
  validator: string; // which validator ran (anchor type, or "none")
  detail: string; // human-readable explanation
}

/** Proof that issuing this receipt was paid for (e.g. via x402). Bound by the witness signature. */
export interface PaymentSettlement {
  scheme: string; // e.g. "x402-exact"
  network: string; // e.g. "base"
  asset: string; // e.g. "USDC"
  amount: string; // string to avoid float issues
  payTo: string; // recipient address
  tx_hash: string; // on-chain settlement hash — independently verifiable
}

/** The signed core. Contains NO id, signatures, or witness (avoids circularity). */
export interface Claim {
  version: 1;
  issued_at: string; // ISO 8601, agent's claimed time
  agent: Agent;
  action: Action;
  payload_digest: string | null; // base64url sha256 of salient content, or null
  anchor: Anchor | null; // agent's external-effect reference (null = none)
  prev: string[]; // ids of predecessor receipts forming an evidence chain ([] = none)
}

export interface Witness {
  witnessed_at: string; // ISO 8601, authoritative time
  witness_key_id: string;
  witness_sig: string; // base64url
  anchor_check: AnchorCheck | null; // witness's independent anchor verification (null = none)
  payment: PaymentSettlement | null; // proof the receipt was paid for (null = free/unpriced)
}

export interface Receipt extends Claim {
  id: string; // base64url sha256 of canonical(Claim)
  agent_sig: string; // base64url, over canonical(Claim)
  witness: Witness;
}

export interface VerifyResult {
  valid: boolean;
  claim?: Claim;
  anchor_check?: AnchorCheck | null; // surfaced on success so consumers can require effect-proof
  payment?: PaymentSettlement | null; // surfaced on success so consumers can see service payment
  reason?: string; // populated when valid === false
}
