import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint } from "../src/keys";
import { buildClaim, computeId, signClaim } from "../src/claim";
import { canonical } from "../src/canonical";
import { verifySig } from "../src/crypto";

describe("claim", () => {
  const kp = generateKeyPair();
  const agent = {
    key_id: thumbprint(kp.publicJwk),
    public_key: toPublicJwk(kp.publicJwk),
  };

  it("buildClaim defaults anchor to null, prev to [], and sets version 1", () => {
    const claim = buildClaim({
      issued_at: "2026-06-03T14:03:00Z",
      agent,
      action: { type: "email.send", description: "Sent confirmation" },
      payload_digest: null,
    });
    expect(claim.version).toBe(1);
    expect(claim.anchor).toBeNull();
    expect(claim.prev).toEqual([]);
  });

  it("computeId is the sha256-base64url of the canonical claim", () => {
    const claim = buildClaim({
      issued_at: "2026-06-03T14:03:00Z",
      agent,
      action: { type: "email.send", description: "x" },
      payload_digest: null,
    });
    // id must NOT depend on object key insertion order
    const reordered = { ...claim, action: { description: "x", type: "email.send" } };
    expect(computeId(claim)).toBe(computeId(reordered));
  });

  it("signClaim produces an agent_sig verifiable over canonical(claim)", () => {
    const claim = buildClaim({
      issued_at: "2026-06-03T14:03:00Z",
      agent,
      action: { type: "email.send", description: "x" },
      payload_digest: null,
    });
    const sig = signClaim(claim, kp.privateJwk);
    expect(verifySig(canonical(claim), sig, agent.public_key)).toBe(true);
  });
});
