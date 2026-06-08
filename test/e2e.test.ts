import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint, computeId } from "@witnessed/core";
import type { Claim } from "@witnessed/core";
import { createApp } from "@witnessed/witness/src/http";
import { ReceiptsClient } from "@witnessed/sdk";
import { verifyReceipt } from "@witnessed/verifier";

describe("end-to-end", () => {
  it("issue -> witness -> store/get -> offline verify, with tamper detection", async () => {
    // Witness service
    const wkp = generateKeyPair();
    const witnessKeyId = thumbprint(wkp.publicJwk);
    const app = createApp({
      witnessPrivateJwk: wkp.privateJwk,
      witnessKeyId,
      now: () => "2026-06-03T14:03:01Z",
    });
    const fetchImpl = ((url: string, init?: RequestInit) =>
      app.request(url.replace("http://witness", ""), init as any)) as unknown as typeof fetch;

    // Agent + client
    const agentKey = generateKeyPair();
    const client = new ReceiptsClient({
      baseUrl: "http://witness",
      privateJwk: agentKey.privateJwk,
      fetchImpl,
    });

    // Issue
    const receipt = await client.issueReceipt({
      action: { type: "payment.send", description: "Paid invoice #42" },
      issued_at: "2026-06-03T14:03:00Z",
    });

    // Retrieve from the store via HTTP
    const got = await app.request(`/receipts/${encodeURIComponent(receipt.id)}`);
    expect((await got.json()).id).toBe(receipt.id);

    // Offline verification by a third party holding only the trusted witness key
    const trusted = { [witnessKeyId]: toPublicJwk(wkp.publicJwk) };
    expect(verifyReceipt(receipt, trusted).valid).toBe(true);

    // Tamper: changing the action invalidates the receipt
    const tampered = {
      ...receipt,
      action: { type: "payment.send", description: "Paid invoice #9999" },
    };
    const r = verifyReceipt(tampered, trusted);
    expect(r.valid).toBe(false);

    // Sanity: id derives only from the claim, independent of insertion order
    const claim: Claim = {
      version: receipt.version,
      issued_at: receipt.issued_at,
      agent: receipt.agent,
      action: receipt.action,
      payload_digest: receipt.payload_digest,
      anchor: receipt.anchor,
      prev: receipt.prev,
    };
    expect(computeId(claim)).toBe(receipt.id);
  });
});
