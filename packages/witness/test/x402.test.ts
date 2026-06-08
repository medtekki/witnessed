import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  signClaim,
  computeId,
} from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";
import { createApp } from "../src/http";
import type { PaymentFacilitator } from "../src/x402";

function fakeFacilitator(opts: { settle: boolean; txHash?: string }) {
  const seen: { nonce?: string; header?: string } = {};
  const facilitator: PaymentFacilitator = {
    requirements(resource, nonce) {
      seen.nonce = nonce;
      return {
        scheme: "x402-exact",
        network: "base",
        asset: "USDC",
        amount: "10000",
        payTo: "0xWitnessTreasury",
        resource,
        nonce,
        description: "Witness one receipt",
      };
    },
    async settle(header) {
      seen.header = header;
      return opts.settle
        ? { settled: true, txHash: opts.txHash ?? "0xtxabc123", detail: "settled" }
        : { settled: false, detail: "insufficient payment" };
    },
  };
  return { facilitator, seen };
}

function witnessKeys() {
  const wkp = generateKeyPair();
  return {
    privateJwk: wkp.privateJwk,
    keyId: thumbprint(wkp.publicJwk),
    trusted: { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) },
  };
}

function body() {
  const kp = generateKeyPair();
  const agent = { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) };
  const claim = buildClaim({
    issued_at: "2026-06-04T10:00:00Z",
    agent,
    action: { type: "data.fetch", description: "Fetched a dataset" },
    payload_digest: null,
  });
  return { claim, agent_sig: signClaim(claim, kp.privateJwk) };
}

describe("x402 billing gate", () => {
  it("returns 402 with payment requirements bound to the claim id when unpaid", async () => {
    const wk = witnessKeys();
    const { facilitator, seen } = fakeFacilitator({ settle: true });
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-04T10:00:01Z",
      x402: { facilitator },
    });

    const b = body();
    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    });

    expect(res.status).toBe(402);
    const payload = await res.json();
    expect(payload.x402Version).toBe(1);
    expect(payload.accepts[0]).toMatchObject({ network: "base", asset: "USDC", payTo: "0xWitnessTreasury" });
    // The payment is bound to this exact receipt via the claim's content hash.
    expect(seen.nonce).toBe(computeId(b.claim));
  });

  it("issues the receipt when paid, recording the settlement as witness.payment", async () => {
    const wk = witnessKeys();
    const { facilitator } = fakeFacilitator({ settle: true, txHash: "0xdeadbeef" });
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-04T10:00:01Z",
      x402: { facilitator },
    });

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json", "X-PAYMENT": "proof-of-usdc-transfer" },
      body: JSON.stringify(body()),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("x-payment-response")).toContain("0xdeadbeef");

    const receipt = await res.json();
    expect(receipt.witness.payment).toMatchObject({
      scheme: "x402-exact",
      network: "base",
      asset: "USDC",
      payTo: "0xWitnessTreasury",
      tx_hash: "0xdeadbeef",
    });

    const v = verifyReceipt(receipt, wk.trusted);
    expect(v.valid).toBe(true);
    expect(v.payment?.tx_hash).toBe("0xdeadbeef");
  });

  it("returns 402 with the facilitator's reason when settlement fails", async () => {
    const wk = witnessKeys();
    const { facilitator } = fakeFacilitator({ settle: false });
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-04T10:00:01Z",
      x402: { facilitator },
    });

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json", "X-PAYMENT": "bad-proof" },
      body: JSON.stringify(body()),
    });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/insufficient/);
  });

  it("binds the settlement: tampering with witness.payment breaks the witness signature", async () => {
    const wk = witnessKeys();
    const { facilitator } = fakeFacilitator({ settle: true, txHash: "0xreal" });
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-04T10:00:01Z",
      x402: { facilitator },
    });
    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json", "X-PAYMENT": "proof" },
      body: JSON.stringify(body()),
    });
    const receipt = await res.json();

    const forged = {
      ...receipt,
      witness: { ...receipt.witness, payment: { ...receipt.witness.payment, tx_hash: "0xFAKE" } },
    };
    const v = verifyReceipt(forged, wk.trusted);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/witness signature/i);
  });

  it("stays free (payment null, no 402) when x402 is not configured", async () => {
    const wk = witnessKeys();
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-04T10:00:01Z",
    });
    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).witness.payment).toBeNull();
  });
});
