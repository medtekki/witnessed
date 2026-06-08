import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  computeId,
  signClaim,
} from "@witnessed/core";
import { LocalSigner } from "../src/signer";
import { InMemoryStore } from "../src/store";
import { makeWitness } from "../src/witness";
import { verifyReceipt } from "@witnessed/verifier";

function agentClaim() {
  const kp = generateKeyPair();
  const agent = { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) };
  const claim = buildClaim({
    issued_at: "2026-06-03T14:03:00Z",
    agent,
    action: { type: "email.send", description: "x" },
    payload_digest: null,
  });
  return { claim, id: computeId(claim), agent_sig: signClaim(claim, kp.privateJwk) };
}

describe("makeWitness", () => {
  it("countersigns a valid claim and the result verifies", async () => {
    const wkp = generateKeyPair();
    const signer = new LocalSigner(wkp.privateJwk, thumbprint(wkp.publicJwk));
    const store = new InMemoryStore();
    const witness = makeWitness({ signer, store, now: () => "2026-06-03T14:03:01Z" });

    const { claim, id, agent_sig } = agentClaim();
    const receipt = await witness({ claim, agent_sig });

    expect(receipt.id).toBe(id);
    const trusted = { [signer.keyId]: toPublicJwk(wkp.publicJwk) };
    expect(verifyReceipt(receipt, trusted).valid).toBe(true);
    expect((await store.get(id))?.id).toBe(id);
  });

  it("rejects a claim whose agent_sig is invalid", async () => {
    const wkp = generateKeyPair();
    const witness = makeWitness({
      signer: new LocalSigner(wkp.privateJwk, thumbprint(wkp.publicJwk)),
      store: new InMemoryStore(),
      now: () => "2026-06-03T14:03:01Z",
    });
    const { claim } = agentClaim();
    await expect(witness({ claim, agent_sig: "AAAA" })).rejects.toThrow(/agent signature/i);
  });
});
