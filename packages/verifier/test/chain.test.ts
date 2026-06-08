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
import type { Action, Receipt } from "@witnessed/core";
import { verifyChain } from "../src/verify";

const agentKp = generateKeyPair();
const witnessKp = generateKeyPair();
const witnessKeyId = thumbprint(witnessKp.publicJwk);
const trusted = { [witnessKeyId]: toPublicJwk(witnessKp.publicJwk) };

/** Mint a fully-witnessed receipt the same way the witness service does. */
function mint(action: Action, prev: string[] = []): Receipt {
  const claim = buildClaim({
    issued_at: "2026-06-04T10:00:00Z",
    agent: { key_id: thumbprint(agentKp.publicJwk), public_key: toPublicJwk(agentKp.publicJwk) },
    action,
    payload_digest: null,
    prev,
  });
  const id = computeId(claim);
  const agent_sig = signClaim(claim, agentKp.privateJwk);
  const witnessed_at = "2026-06-04T10:00:01Z";
  const anchor_check = null;
  const payment = null;
  const witness_sig = sign(
    canonical({ id, agent_sig, witnessed_at, anchor_check, payment }),
    witnessKp.privateJwk,
  );
  return {
    ...claim,
    id,
    agent_sig,
    witness: { witnessed_at, witness_key_id: witnessKeyId, witness_sig, anchor_check, payment },
  };
}

describe("verifyChain", () => {
  it("accepts a chain whose prev links all resolve and verify", () => {
    const r1 = mint({ type: "ehr.write", description: "Wrote note" });
    const r2 = mint({ type: "ehr.amend", description: "Amended note" }, [r1.id]);
    const result = verifyChain([r1, r2], trusted);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.results[r1.id].valid).toBe(true);
    expect(result.results[r2.id].valid).toBe(true);
  });

  it("accepts a single receipt with no predecessors", () => {
    const r1 = mint({ type: "email.send", description: "x" });
    expect(verifyChain([r1], trusted).valid).toBe(true);
  });

  it("fails when a prev reference is missing from the set", () => {
    const r1 = mint({ type: "ehr.write", description: "Wrote note" });
    const r2 = mint({ type: "ehr.amend", description: "Amended note" }, [r1.id]);
    const result = verifyChain([r2], trusted); // r1 omitted
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/missing predecessor/);
  });

  it("fails when a member receipt is tampered, even if links resolve", () => {
    const r1 = mint({ type: "ehr.write", description: "Wrote note" });
    const r2 = mint({ type: "ehr.amend", description: "Amended note" }, [r1.id]);
    const tampered = { ...r1, action: { ...r1.action, description: "TAMPERED" } };
    const result = verifyChain([tampered, r2], trusted);
    expect(result.valid).toBe(false);
    expect(result.results[r1.id].valid).toBe(false); // r1.id field unchanged; content no longer matches
  });
});
