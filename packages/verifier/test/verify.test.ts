import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  computeId,
  signClaim,
  canonical,
  sign,
} from "@witnessed/core";
import type { Receipt } from "@witnessed/core";
import { verifyReceipt } from "../src/verify";

// Build a fully-witnessed receipt the same way the witness service will.
function makeReceipt() {
  const agentKp = generateKeyPair();
  const witnessKp = generateKeyPair();
  const witnessKeyId = thumbprint(witnessKp.publicJwk);

  const claim = buildClaim({
    issued_at: "2026-06-03T14:03:00Z",
    agent: { key_id: thumbprint(agentKp.publicJwk), public_key: toPublicJwk(agentKp.publicJwk) },
    action: { type: "email.send", description: "Sent confirmation" },
    payload_digest: null,
  });
  const id = computeId(claim);
  const agent_sig = signClaim(claim, agentKp.privateJwk);
  const witnessed_at = "2026-06-03T14:03:01Z";
  const anchor_check = null;
  const payment = null;
  const witness_sig = sign(
    canonical({ id, agent_sig, witnessed_at, anchor_check, payment }),
    witnessKp.privateJwk,
  );

  const receipt: Receipt = {
    ...claim,
    id,
    agent_sig,
    witness: { witnessed_at, witness_key_id: witnessKeyId, witness_sig, anchor_check, payment },
  };
  const trusted = { [witnessKeyId]: toPublicJwk(witnessKp.publicJwk) };
  return { receipt, trusted };
}

describe("verifyReceipt", () => {
  it("accepts a well-formed receipt", () => {
    const { receipt, trusted } = makeReceipt();
    const r = verifyReceipt(receipt, trusted);
    expect(r.valid).toBe(true);
    expect(r.claim?.action.type).toBe("email.send");
  });

  it("rejects a tampered action (id mismatch)", () => {
    const { receipt, trusted } = makeReceipt();
    const bad = { ...receipt, action: { ...receipt.action, description: "HACKED" } };
    const r = verifyReceipt(bad, trusted);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/id/i);
  });

  it("rejects a bad agent signature", () => {
    const { receipt, trusted } = makeReceipt();
    // Deterministically alter the signature: flipping the first char always changes byte 0.
    const sig = receipt.agent_sig;
    const bad = { ...receipt, agent_sig: (sig[0] === "A" ? "B" : "A") + sig.slice(1) };
    expect(verifyReceipt(bad, trusted).valid).toBe(false);
  });

  it("rejects an unknown witness key", () => {
    const { receipt } = makeReceipt();
    const r = verifyReceipt(receipt, {});
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/witness/i);
  });
});
