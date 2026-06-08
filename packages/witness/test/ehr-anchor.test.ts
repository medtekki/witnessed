import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  signClaim,
  sha256b64u,
} from "@witnessed/core";
import type { Anchor } from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";
import { createApp } from "../src/http";
import { EhrRecordIdValidator } from "../src/anchor";
import type { EhrLookup } from "../src/anchor";
import { ReceiptsClient } from "@witnessed/sdk";

function witnessKeys() {
  const wkp = generateKeyPair();
  return {
    privateJwk: wkp.privateJwk,
    keyId: thumbprint(wkp.publicJwk),
    trusted: { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) },
  };
}

/** A signed `ehr.write` claim carrying an ehr.record_id anchor and an optional payload_digest. */
function ehrBody(anchor: Anchor, payload_digest: string | null) {
  const kp = generateKeyPair();
  const agent = { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) };
  const claim = buildClaim({
    issued_at: "2026-06-04T10:00:00Z",
    agent,
    action: { type: "ehr.write", description: "Wrote progress note" },
    payload_digest,
    anchor,
  });
  return { claim, agent_sig: signClaim(claim, kp.privateJwk) };
}

const recordAnchor: Anchor = { type: "ehr.record_id", value: "Observation/1234" };
const noteDigest = sha256b64u("progress note: patient stable, continue current plan");

function appWith(lookup: EhrLookup) {
  const wk = witnessKeys();
  const app = createApp({
    witnessPrivateJwk: wk.privateJwk,
    witnessKeyId: wk.keyId,
    now: () => "2026-06-04T10:00:01Z",
    validators: { "ehr.record_id": new EhrRecordIdValidator(lookup) },
  });
  return { app, wk };
}

async function issue(app: ReturnType<typeof appWith>["app"], body: object) {
  const res = await app.request("/receipts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, receipt: await res.json() };
}

describe("anchor validation (ehr.record_id)", () => {
  it("verifies when the record exists, is final, and its content hash matches payload_digest", async () => {
    const { app, wk } = appWith(async () => ({
      found: true,
      status: "final",
      contentHash: noteDigest,
    }));

    const { receipt } = await issue(app, ehrBody(recordAnchor, noteDigest));

    expect(receipt.anchor).toEqual(recordAnchor);
    expect(receipt.witness.anchor_check.verified).toBe(true);
    expect(receipt.witness.anchor_check.validator).toBe("ehr.record_id");
    expect(receipt.witness.anchor_check.detail).toMatch(/matching provenance/);

    const v = verifyReceipt(receipt, wk.trusted);
    expect(v.valid).toBe(true);
    expect(v.anchor_check?.verified).toBe(true);
  });

  it("records verified:false on provenance mismatch (record exists but content hash differs)", async () => {
    const { app, wk } = appWith(async () => ({
      found: true,
      status: "final",
      contentHash: sha256b64u("a DIFFERENT note that the agent did not write"),
    }));

    const { status, receipt } = await issue(app, ehrBody(recordAnchor, noteDigest));
    expect(status).toBe(201); // recorded, not gated
    expect(receipt.witness.anchor_check.verified).toBe(false);
    expect(receipt.witness.anchor_check.detail).toMatch(/provenance mismatch/);
    expect(verifyReceipt(receipt, wk.trusted).valid).toBe(true);
  });

  it("records verified:false when the record is in a non-accepted status", async () => {
    const { app, wk } = appWith(async () => ({
      found: true,
      status: "entered-in-error",
      contentHash: noteDigest,
    }));

    const { receipt } = await issue(app, ehrBody(recordAnchor, noteDigest));
    expect(receipt.witness.anchor_check.verified).toBe(false);
    expect(receipt.witness.anchor_check.detail).toMatch(/entered-in-error/);
    expect(verifyReceipt(receipt, wk.trusted).valid).toBe(true);
  });

  it("records verified:false when the record is not found", async () => {
    const { app } = appWith(async () => ({ found: false }));
    const { receipt } = await issue(app, ehrBody(recordAnchor, noteDigest));
    expect(receipt.witness.anchor_check.verified).toBe(false);
    expect(receipt.witness.anchor_check.detail).toMatch(/not found/);
  });

  it("verifies on existence+status alone when the claim carries no payload_digest", async () => {
    const { app, wk } = appWith(async () => ({ found: true, status: "active" }));
    const { receipt } = await issue(app, ehrBody(recordAnchor, null));
    expect(receipt.witness.anchor_check.verified).toBe(true);
    expect(receipt.witness.anchor_check.detail).toMatch(/no payload_digest/);
    expect(verifyReceipt(receipt, wk.trusted).valid).toBe(true);
  });

  it("flows through the SDK with matching provenance", async () => {
    const { app, wk } = appWith(async () => ({
      found: true,
      status: "final",
      contentHash: noteDigest,
    }));
    const fetchImpl = ((url: string, init?: RequestInit) =>
      app.request(url.replace("http://witness", ""), init as any)) as unknown as typeof fetch;

    const client = new ReceiptsClient({
      baseUrl: "http://witness",
      privateJwk: generateKeyPair().privateJwk,
      fetchImpl,
    });

    const receipt = await client.issueReceipt({
      action: { type: "ehr.write", description: "Wrote progress note" },
      payload_digest: noteDigest,
      anchor: recordAnchor,
    });
    expect(receipt.witness.anchor_check?.verified).toBe(true);
    expect(client.verify(receipt, wk.trusted).anchor_check?.verified).toBe(true);
  });
});
