import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint, buildClaim, signClaim } from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";
import { createApp } from "../src/http";
import { HttpFacilitator } from "../src/x402-facilitator";

/** A simulated x402 facilitator over fetch: routes /verify and /settle, logs calls. */
function facilitatorFetch(opts: {
  verifyValid?: boolean;
  invalidReason?: string;
  settleSuccess?: boolean;
  txHash?: string;
  errorReason?: string;
  verifyStatus?: number;
}) {
  const calls: { url: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url: u, body });
    if (u.endsWith("/verify")) {
      if (opts.verifyStatus && opts.verifyStatus >= 400) {
        return new Response("error", { status: opts.verifyStatus });
      }
      return new Response(
        JSON.stringify({ isValid: opts.verifyValid ?? true, invalidReason: opts.invalidReason }),
        { status: 200 },
      );
    }
    if (u.endsWith("/settle")) {
      return new Response(
        JSON.stringify({
          success: opts.settleSuccess ?? true,
          transaction: opts.txHash ?? "0xabc",
          errorReason: opts.errorReason,
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function makeFacilitator(fetchImpl: typeof fetch) {
  return new HttpFacilitator({
    facilitatorUrl: "https://facilitator.test",
    network: "base",
    asset: "0xUSDCContractAddress",
    payTo: "0xWitnessTreasury",
    maxAmountRequired: "10000",
    fetchImpl,
  });
}

/** A plausible base64-encoded X-PAYMENT payload (content is opaque to the facilitator). */
const X_PAYMENT = Buffer.from(
  JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: { signature: "0xsig", authorization: { from: "0xAgent", to: "0xWitnessTreasury", value: "10000" } },
  }),
).toString("base64");

describe("HttpFacilitator", () => {
  it("verifies then settles, returning the on-chain tx hash", async () => {
    const { fetchImpl, calls } = facilitatorFetch({ txHash: "0xdeadbeef" });
    const f = makeFacilitator(fetchImpl);
    const result = await f.settle(X_PAYMENT, f.requirements("/receipts", "nonce-1"));

    expect(result.settled).toBe(true);
    expect(result.txHash).toBe("0xdeadbeef");
    // Called /verify before /settle, with spec-shaped requirements + decoded payload.
    expect(calls.map((c) => c.url)).toEqual([
      "https://facilitator.test/verify",
      "https://facilitator.test/settle",
    ]);
    expect(calls[1].body.paymentRequirements).toMatchObject({
      maxAmountRequired: "10000",
      payTo: "0xWitnessTreasury",
      asset: "0xUSDCContractAddress",
      network: "base",
      mimeType: "application/json",
    });
    expect(calls[1].body.paymentPayload.payload.authorization.from).toBe("0xAgent");
  });

  it("does not settle when verification fails", async () => {
    const { fetchImpl, calls } = facilitatorFetch({ verifyValid: false, invalidReason: "insufficient_funds" });
    const f = makeFacilitator(fetchImpl);
    const result = await f.settle(X_PAYMENT, f.requirements("/receipts", "n"));

    expect(result.settled).toBe(false);
    expect(result.detail).toMatch(/insufficient_funds/);
    expect(calls.some((c) => c.url.endsWith("/settle"))).toBe(false);
  });

  it("reports settlement failure from the facilitator", async () => {
    const { fetchImpl } = facilitatorFetch({ settleSuccess: false, errorReason: "settle_reverted" });
    const f = makeFacilitator(fetchImpl);
    const result = await f.settle(X_PAYMENT, f.requirements("/receipts", "n"));
    expect(result.settled).toBe(false);
    expect(result.detail).toMatch(/settle_reverted/);
  });

  it("rejects a malformed X-PAYMENT header without calling the facilitator", async () => {
    const { fetchImpl, calls } = facilitatorFetch({});
    const f = makeFacilitator(fetchImpl);
    const result = await f.settle("@@@ not base64 json @@@", f.requirements("/receipts", "n"));
    expect(result.settled).toBe(false);
    expect(result.detail).toMatch(/invalid X-PAYMENT/i);
    expect(calls.length).toBe(0);
  });

  it("surfaces facilitator HTTP errors", async () => {
    const { fetchImpl } = facilitatorFetch({ verifyStatus: 502 });
    const f = makeFacilitator(fetchImpl);
    const result = await f.settle(X_PAYMENT, f.requirements("/receipts", "n"));
    expect(result.settled).toBe(false);
    expect(result.detail).toMatch(/HTTP 502/);
  });
});

describe("HttpFacilitator wired into the billing gate", () => {
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

  it("issues a receipt whose witness.payment carries the real settlement tx hash", async () => {
    const wk = witnessKeys();
    const { fetchImpl } = facilitatorFetch({ txHash: "0xsettled99" });
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-04T10:00:01Z",
      x402: { facilitator: makeFacilitator(fetchImpl) },
    });

    // Unpaid -> 402
    const unpaid = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect(unpaid.status).toBe(402);

    // Paid -> 201 with settlement recorded
    const paid = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json", "X-PAYMENT": X_PAYMENT },
      body: JSON.stringify(body()),
    });
    expect(paid.status).toBe(201);
    const receipt = await paid.json();
    expect(receipt.witness.payment).toMatchObject({
      network: "base",
      payTo: "0xWitnessTreasury",
      tx_hash: "0xsettled99",
    });
    expect(verifyReceipt(receipt, wk.trusted).valid).toBe(true);
  });
});
