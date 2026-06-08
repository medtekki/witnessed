import { canonical, verifySig, computeId } from "@witnessed/core";
import type { AnchorCheck, Claim, PaymentSettlement, Receipt } from "@witnessed/core";
import type { Signer } from "./signer";
import type { ReceiptStore } from "./store";
import type { ValidatorRegistry } from "./anchor";

export interface WitnessDeps {
  signer: Signer;
  store: ReceiptStore;
  now: () => string; // injected clock for testability; returns ISO 8601
  validators?: ValidatorRegistry; // anchor validators keyed by anchor type
}

export interface WitnessRequest {
  claim: Claim;
  agent_sig: string;
  /** Settled service payment (e.g. from an x402 gate); null/omitted when free or unpriced. */
  payment?: PaymentSettlement | null;
}

/** Run the registered validator for the claim's anchor, if any. Records, never rejects. */
async function checkAnchor(
  claim: Claim,
  checked_at: string,
  validators: ValidatorRegistry | undefined,
): Promise<AnchorCheck | null> {
  if (!claim.anchor) return null;
  const validator = validators?.[claim.anchor.type];
  if (!validator) {
    return {
      verified: false,
      checked_at,
      validator: "none",
      detail: `no validator registered for anchor type "${claim.anchor.type}"`,
    };
  }
  const result = await validator.validate({
    value: claim.anchor.value,
    payload_digest: claim.payload_digest,
  });
  return { verified: result.verified, checked_at, validator: validator.type, detail: result.detail };
}

/** Returns an async witness function bound to its dependencies. */
export function makeWitness(deps: WitnessDeps) {
  return async function witness(req: WitnessRequest): Promise<Receipt> {
    const { claim, agent_sig } = req;
    const payment = req.payment ?? null;

    if (!verifySig(canonical(claim), agent_sig, claim.agent.public_key)) {
      throw new Error("agent signature is invalid");
    }

    const id = computeId(claim);
    const witnessed_at = deps.now();
    const anchor_check = await checkAnchor(claim, witnessed_at, deps.validators);
    const witness_sig = await deps.signer.sign(
      canonical({ id, agent_sig, witnessed_at, anchor_check, payment }),
    );

    const receipt: Receipt = {
      ...claim,
      id,
      agent_sig,
      witness: {
        witnessed_at,
        witness_key_id: deps.signer.keyId,
        witness_sig,
        anchor_check,
        payment,
      },
    };

    await deps.store.put(receipt);
    return receipt;
  };
}
