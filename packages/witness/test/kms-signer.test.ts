import { describe, it, expect } from "vitest";
import { sign as nodeSign, createPrivateKey } from "node:crypto";
import type { JsonWebKey as CryptoJsonWebKey } from "node:crypto";
import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  signClaim,
} from "@witnessed/core";
import type { Jwk } from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";
import { KmsSigner } from "../src/signer";
import { makeWitness } from "../src/witness";
import { InMemoryStore } from "../src/store";
import { createApp } from "../src/http";
import { ReceiptsClient } from "@witnessed/sdk";

/** Simulate a KMS/HSM holding an Ed25519 key: signs raw bytes, counts invocations. */
function fakeKms(privateJwk: Jwk) {
  const key = createPrivateKey({ key: privateJwk as unknown as CryptoJsonWebKey, format: "jwk" });
  let calls = 0;
  const signFn = async (message: Uint8Array): Promise<Uint8Array> => {
    calls += 1;
    return new Uint8Array(nodeSign(null, Buffer.from(message), key));
  };
  return { signFn, calls: () => calls };
}

function agentClaim() {
  const kp = generateKeyPair();
  const claim = buildClaim({
    issued_at: "2026-06-04T10:00:00Z",
    agent: { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) },
    action: { type: "email.send", description: "x" },
    payload_digest: null,
  });
  return { claim, agent_sig: signClaim(claim, kp.privateJwk) };
}

describe("KmsSigner", () => {
  it("delegates to the KMS and produces a witness signature that verifies", async () => {
    const wkp = generateKeyPair();
    const keyId = thumbprint(wkp.publicJwk);
    const kms = fakeKms(wkp.privateJwk);
    const signer = new KmsSigner(keyId, kms.signFn);
    const witness = makeWitness({
      signer,
      store: new InMemoryStore(),
      now: () => "2026-06-04T10:00:01Z",
    });

    const { claim, agent_sig } = agentClaim();
    const receipt = await witness({ claim, agent_sig });

    expect(kms.calls()).toBe(1); // the KMS actually signed
    expect(receipt.witness.witness_key_id).toBe(keyId);
    expect(verifyReceipt(receipt, { [keyId]: toPublicJwk(wkp.publicJwk) }).valid).toBe(true);
  });

  it("fails verification if the KMS signs with a key other than the registered public key", async () => {
    const registered = generateKeyPair();
    const actuallyUsed = generateKeyPair(); // KMS holds a different key than advertised
    const keyId = thumbprint(registered.publicJwk);
    const signer = new KmsSigner(keyId, fakeKms(actuallyUsed.privateJwk).signFn);
    const witness = makeWitness({
      signer,
      store: new InMemoryStore(),
      now: () => "2026-06-04T10:00:01Z",
    });

    const { claim, agent_sig } = agentClaim();
    const receipt = await witness({ claim, agent_sig });
    expect(verifyReceipt(receipt, { [keyId]: toPublicJwk(registered.publicJwk) }).valid).toBe(false);
  });

  it("works end-to-end via createApp in KMS mode, with no private key in the config", async () => {
    const wkp = generateKeyPair();
    const keyId = thumbprint(wkp.publicJwk);
    // Only the Signer (which holds a sign function, not key material) and the PUBLIC jwk.
    const app = createApp({
      signer: new KmsSigner(keyId, fakeKms(wkp.privateJwk).signFn),
      witnessPublicJwk: toPublicJwk(wkp.publicJwk),
      now: () => "2026-06-04T10:00:01Z",
    });
    const fetchImpl = ((url: string, init?: RequestInit) =>
      app.request(url.replace("http://witness", ""), init as any)) as unknown as typeof fetch;

    const client = new ReceiptsClient({
      baseUrl: "http://witness",
      privateJwk: generateKeyPair().privateJwk,
      fetchImpl,
    });
    const receipt = await client.issueReceipt({
      action: { type: "payment.send", description: "Paid invoice #42" },
    });

    expect(receipt.witness.witness_key_id).toBe(keyId);
    expect(client.verify(receipt, { [keyId]: toPublicJwk(wkp.publicJwk) }).valid).toBe(true);

    const verifyRes = await app.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt),
    });
    expect((await verifyRes.json()).valid).toBe(true);
  });

  it("requires the witness public JWK when a signer is injected", () => {
    const signer = new KmsSigner("k", async () => new Uint8Array());
    expect(() => createApp({ signer })).toThrow(/witnessPublicJwk/);
  });
});
