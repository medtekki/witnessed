import { canonical, verifySig, computeId } from "@witnessed/core";
import type { Receipt, Claim, Jwk, VerifyResult } from "@witnessed/core";

/** trustedWitnessKeys maps witness_key_id -> public JWK the verifier trusts. */
export function verifyReceipt(
  receipt: Receipt,
  trustedWitnessKeys: Record<string, Jwk>,
): VerifyResult {
  // Reconstruct the signed claim (strip id, agent_sig, witness).
  const claim: Claim = {
    version: receipt.version,
    issued_at: receipt.issued_at,
    agent: receipt.agent,
    action: receipt.action,
    payload_digest: receipt.payload_digest,
    anchor: receipt.anchor,
    prev: receipt.prev,
  };

  if (computeId(claim) !== receipt.id) {
    return { valid: false, reason: "id does not match claim contents" };
  }
  if (!verifySig(canonical(claim), receipt.agent_sig, receipt.agent.public_key)) {
    return { valid: false, reason: "agent signature is invalid" };
  }

  const witnessKey = trustedWitnessKeys[receipt.witness.witness_key_id];
  if (!witnessKey) {
    return { valid: false, reason: "unknown or untrusted witness key" };
  }
  const anchor_check = receipt.witness.anchor_check ?? null;
  const payment = receipt.witness.payment ?? null;
  const witnessMessage = canonical({
    id: receipt.id,
    agent_sig: receipt.agent_sig,
    witnessed_at: receipt.witness.witnessed_at,
    anchor_check,
    payment,
  });
  if (!verifySig(witnessMessage, receipt.witness.witness_sig, witnessKey)) {
    return { valid: false, reason: "witness signature is invalid" };
  }

  return { valid: true, claim, anchor_check, payment };
}

export interface ChainResult {
  valid: boolean;
  results: Record<string, VerifyResult>; // id -> individual verification result
  issues: string[]; // broken links or invalid members, human-readable
}

/**
 * Verify an evidence chain: every receipt must verify individually AND every `prev` link
 * must resolve to a receipt present in the set. Because `id` is a content hash, a `prev`
 * reference pins the exact predecessor — tampering with a predecessor changes its id and
 * orphans the link. (Cycles are impossible: a receipt's id is unknown until it is created,
 * so it cannot be referenced by an ancestor.)
 */
export function verifyChain(
  receipts: Receipt[],
  trustedWitnessKeys: Record<string, Jwk>,
): ChainResult {
  const byId = new Map<string, Receipt>();
  for (const r of receipts) byId.set(r.id, r);

  const results: Record<string, VerifyResult> = {};
  const issues: string[] = [];

  for (const r of receipts) {
    const res = verifyReceipt(r, trustedWitnessKeys);
    results[r.id] = res;
    if (!res.valid) issues.push(`receipt ${r.id} is invalid: ${res.reason}`);
    for (const p of r.prev) {
      if (!byId.has(p)) {
        issues.push(`receipt ${r.id} references missing predecessor ${p}`);
      }
    }
  }

  return { valid: issues.length === 0, results, issues };
}
