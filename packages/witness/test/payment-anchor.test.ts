import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint, buildClaim, signClaim } from "@witnessed/core";
import type { Anchor } from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";
import { createApp } from "../src/http";
import { PaymentTxnIdValidator } from "../src/anchor";
import type { PaymentLookup } from "../src/anchor";
import { ReceiptsClient } from "@witnessed/sdk";

function witnessKeys() {
  const wkp = generateKeyPair();
  return {
    privateJwk: wkp.privateJwk,
    keyId: thumbprint(wkp.publicJwk),
    trusted: { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) },
  };
}

/** A signed `payment.send` claim carrying a payment.txn_id anchor. */
function paymentBody(anchor: Anchor) {
  const kp = generateKeyPair();
  const agent = { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) };
  const claim = buildClaim({
    issued_at: "2026-06-04T10:00:00Z",
    agent,
    action: { type: "payment.send", description: "Paid invoice #42" },
    payload_digest: null,
    anchor,
  });
  return { claim, agent_sig: signClaim(claim, kp.privateJwk) };
}

const txnAnchor: Anchor = { type: "payment.txn_id", value: "txn_3PabcXYZ" };

function appWith(lookup: PaymentLookup, now = () => "2026-06-04T10:00:01Z") {
  const wk = witnessKeys();
  const app = createApp({
    witnessPrivateJwk: wk.privateJwk,
    witnessKeyId: wk.keyId,
    now,
    validators: { "payment.txn_id": new PaymentTxnIdValidator(lookup) },
  });
  return { app, wk };
}

describe("anchor validation (payment.txn_id)", () => {
  it("marks verified when the transaction exists and is settled", async () => {
    const { app, wk } = appWith(async () => ({ found: true, status: "succeeded" }));

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(paymentBody(txnAnchor)),
    });
    const receipt = await res.json();

    expect(receipt.anchor).toEqual(txnAnchor);
    expect(receipt.witness.anchor_check.verified).toBe(true);
    expect(receipt.witness.anchor_check.validator).toBe("payment.txn_id");

    const v = verifyReceipt(receipt, wk.trusted);
    expect(v.valid).toBe(true);
    expect(v.anchor_check?.verified).toBe(true);
  });

  it("records verified:false (not rejected) when the transaction exists but failed", async () => {
    const { app, wk } = appWith(async () => ({ found: true, status: "failed" }));

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(paymentBody(txnAnchor)),
    });
    expect(res.status).toBe(201); // recorded, not gated
    const receipt = await res.json();
    expect(receipt.witness.anchor_check.verified).toBe(false);
    expect(receipt.witness.anchor_check.detail).toMatch(/failed/);
    expect(verifyReceipt(receipt, wk.trusted).valid).toBe(true);
  });

  it("records verified:false when the transaction is not found", async () => {
    const { app, wk } = appWith(async () => ({ found: false }));

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(paymentBody(txnAnchor)),
    });
    const receipt = await res.json();
    expect(receipt.witness.anchor_check.verified).toBe(false);
    expect(receipt.witness.anchor_check.detail).toMatch(/not found/);
    expect(verifyReceipt(receipt, wk.trusted).valid).toBe(true);
  });

  it("flows through the SDK: issueReceipt with a settled txn anchor returns a verified effect", async () => {
    const { app, wk } = appWith(async () => ({ found: true, status: "captured" }));
    const fetchImpl = ((url: string, init?: RequestInit) =>
      app.request(url.replace("http://witness", ""), init as any)) as unknown as typeof fetch;

    const client = new ReceiptsClient({
      baseUrl: "http://witness",
      privateJwk: generateKeyPair().privateJwk,
      fetchImpl,
    });

    const receipt = await client.issueReceipt({
      action: { type: "payment.send", description: "Paid invoice #42" },
      anchor: txnAnchor,
    });
    expect(receipt.witness.anchor_check?.verified).toBe(true);
    expect(client.verify(receipt, wk.trusted).anchor_check?.verified).toBe(true);
  });
});
