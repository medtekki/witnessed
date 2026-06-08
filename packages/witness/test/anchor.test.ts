import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  signClaim,
} from "@witnessed/core";
import type { Anchor } from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";
import { createApp } from "../src/http";
import { EmailMessageIdValidator } from "../src/anchor";
import { ReceiptsClient } from "@witnessed/sdk";

function witnessKeys() {
  const wkp = generateKeyPair();
  return {
    privateJwk: wkp.privateJwk,
    keyId: thumbprint(wkp.publicJwk),
    trusted: { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) },
  };
}

/** A signed claim carrying an anchor, posted as the witness HTTP body. */
function bodyWithAnchor(anchor: Anchor) {
  const kp = generateKeyPair();
  const agent = { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) };
  const claim = buildClaim({
    issued_at: "2026-06-03T14:03:00Z",
    agent,
    action: { type: "email.send", description: "Sent confirmation" },
    payload_digest: null,
    anchor,
  });
  return { claim, agent_sig: signClaim(claim, kp.privateJwk) };
}

const emailAnchor: Anchor = { type: "email.message_id", value: "<abc123@mail.example.com>" };

describe("anchor validation (email.message_id)", () => {
  it("marks the anchor verified when the provider confirms the message, and the receipt verifies", async () => {
    const wk = witnessKeys();
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-03T14:03:01Z",
      validators: {
        "email.message_id": new EmailMessageIdValidator(async () => ({ found: true })),
      },
    });

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyWithAnchor(emailAnchor)),
    });
    const receipt = await res.json();

    expect(receipt.anchor).toEqual(emailAnchor);
    expect(receipt.witness.anchor_check.verified).toBe(true);
    expect(receipt.witness.anchor_check.validator).toBe("email.message_id");

    const v = verifyReceipt(receipt, wk.trusted);
    expect(v.valid).toBe(true);
    expect(v.anchor_check?.verified).toBe(true);
  });

  it("records verified:false (does NOT reject) when the provider cannot find the message", async () => {
    const wk = witnessKeys();
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-03T14:03:01Z",
      validators: {
        "email.message_id": new EmailMessageIdValidator(async () => ({ found: false })),
      },
    });

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyWithAnchor(emailAnchor)),
    });
    expect(res.status).toBe(201); // recorded, not gated
    const receipt = await res.json();
    expect(receipt.witness.anchor_check.verified).toBe(false);

    // Still a structurally valid, witness-signed receipt — just not effect-proven.
    expect(verifyReceipt(receipt, wk.trusted).valid).toBe(true);
  });

  it("records validator 'none' when no validator is registered for the anchor type", async () => {
    const wk = witnessKeys();
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-03T14:03:01Z",
      // no validators registered
    });

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyWithAnchor(emailAnchor)),
    });
    const receipt = await res.json();
    expect(receipt.witness.anchor_check.verified).toBe(false);
    expect(receipt.witness.anchor_check.validator).toBe("none");
    expect(verifyReceipt(receipt, wk.trusted).valid).toBe(true);
  });

  it("tampering with anchor_check breaks the witness signature", async () => {
    const wk = witnessKeys();
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-03T14:03:01Z",
      validators: {
        "email.message_id": new EmailMessageIdValidator(async () => ({ found: false })),
      },
    });

    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyWithAnchor(emailAnchor)),
    });
    const receipt = await res.json();

    // Forge a "verified" anchor_check the witness never signed.
    const forged = {
      ...receipt,
      witness: { ...receipt.witness, anchor_check: { ...receipt.witness.anchor_check, verified: true } },
    };
    const v = verifyReceipt(forged, wk.trusted);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/witness signature/i);
  });

  it("flows through the SDK: issueReceipt with an anchor returns a verified effect", async () => {
    const wk = witnessKeys();
    const app = createApp({
      witnessPrivateJwk: wk.privateJwk,
      witnessKeyId: wk.keyId,
      now: () => "2026-06-03T14:03:01Z",
      validators: {
        "email.message_id": new EmailMessageIdValidator(async () => ({ found: true })),
      },
    });
    const fetchImpl = ((url: string, init?: RequestInit) =>
      app.request(url.replace("http://witness", ""), init as any)) as unknown as typeof fetch;

    const client = new ReceiptsClient({
      baseUrl: "http://witness",
      privateJwk: generateKeyPair().privateJwk,
      fetchImpl,
    });

    const receipt = await client.issueReceipt({
      action: { type: "email.send", description: "Sent confirmation" },
      anchor: emailAnchor,
    });
    expect(receipt.witness.anchor_check?.verified).toBe(true);
    expect(client.verify(receipt, wk.trusted).anchor_check?.verified).toBe(true);
  });
});
