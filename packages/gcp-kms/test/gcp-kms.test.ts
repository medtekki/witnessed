import { describe, it, expect } from "vitest";
import { sign as nodeSign, generateKeyPairSync } from "node:crypto";
import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  signClaim,
  verifySig,
} from "@witnessed/core";
import { KmsSigner } from "@witnessed/witness/src/signer";
import { makeWitness } from "@witnessed/witness/src/witness";
import { InMemoryStore } from "@witnessed/witness/src/store";
import { verifyReceipt } from "@witnessed/verifier";
import { gcpKmsSignFn, gcpKmsPublicJwk } from "../src/kms";
import type { KmsClient } from "../src/kms";
import { crc32c } from "../src/crc32c";

const KEY = "projects/p/locations/global/keyRings/r/cryptoKeys/witness/cryptoKeyVersions/1";

/** A fake Cloud KMS client backed by a local Ed25519 key, mimicking the real API contract. */
function fakeKms(opts?: {
  corruptSignatureCrc?: boolean;
  verifiedDataCrc32c?: boolean;
  respName?: string;
}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const client: KmsClient = {
    async asymmetricSign({ name, data }) {
      const sig = new Uint8Array(nodeSign(null, Buffer.from(data), privateKey));
      const sigCrc = opts?.corruptSignatureCrc ? (crc32c(sig) ^ 0x1) >>> 0 : crc32c(sig);
      return [
        {
          signature: sig,
          signatureCrc32c: { value: sigCrc },
          verifiedDataCrc32c: opts?.verifiedDataCrc32c ?? true,
          name: opts?.respName ?? name,
        },
      ];
    },
    async getPublicKey() {
      return [{ pem: publicKey.export({ type: "spki", format: "pem" }) as string, algorithm: "EC_SIGN_ED25519" }];
    },
  };
  return { client };
}

function agentClaim() {
  const kp = generateKeyPair();
  const claim = buildClaim({
    issued_at: "2026-06-04T10:00:00Z",
    agent: { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) },
    action: { type: "ehr.write", description: "Wrote progress note" },
    payload_digest: null,
  });
  return { claim, agent_sig: signClaim(claim, kp.privateJwk) };
}

describe("gcpKmsPublicJwk", () => {
  it("derives an Ed25519 JWK + thumbprint key id from the KMS public key", async () => {
    const { client } = fakeKms();
    const { publicJwk, keyId } = await gcpKmsPublicJwk(KEY, client);
    expect(publicJwk.crv).toBe("Ed25519");
    expect(publicJwk.d).toBeUndefined();
    expect(keyId).toBe(thumbprint(publicJwk));
  });
});

describe("gcpKmsSignFn", () => {
  it("signs message bytes such that the matching public key verifies", async () => {
    const { client } = fakeKms();
    const { publicJwk } = await gcpKmsPublicJwk(KEY, client);
    const signFn = gcpKmsSignFn(KEY, client);

    const sig = await signFn(Buffer.from("hello kms"));
    expect(sig.length).toBe(64); // raw Ed25519 signature
    expect(verifySig("hello kms", Buffer.from(sig).toString("base64url"), publicJwk)).toBe(true);
  });

  it("works end-to-end as a KmsSigner: witnessed receipt verifies", async () => {
    const { client } = fakeKms();
    const { publicJwk, keyId } = await gcpKmsPublicJwk(KEY, client);
    const witness = makeWitness({
      signer: new KmsSigner(keyId, gcpKmsSignFn(KEY, client)),
      store: new InMemoryStore(),
      now: () => "2026-06-04T10:00:01Z",
    });

    const { claim, agent_sig } = agentClaim();
    const receipt = await witness({ claim, agent_sig });

    expect(receipt.witness.witness_key_id).toBe(keyId);
    expect(verifyReceipt(receipt, { [keyId]: publicJwk }).valid).toBe(true);
  });

  it("throws when the signature integrity check (signatureCrc32c) fails", async () => {
    const signFn = gcpKmsSignFn(KEY, fakeKms({ corruptSignatureCrc: true }).client);
    await expect(signFn(Buffer.from("x"))).rejects.toThrow(/signatureCrc32c|integrity/i);
  });

  it("throws when KMS reports it could not verify request data integrity", async () => {
    const signFn = gcpKmsSignFn(KEY, fakeKms({ verifiedDataCrc32c: false }).client);
    await expect(signFn(Buffer.from("x"))).rejects.toThrow(/request data integrity/i);
  });

  it("throws when the response key version name does not match the request", async () => {
    const signFn = gcpKmsSignFn(KEY, fakeKms({ respName: KEY + "9" }).client);
    await expect(signFn(Buffer.from("x"))).rejects.toThrow(/key mismatch/i);
  });
});
