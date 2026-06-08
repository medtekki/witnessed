import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint, buildClaim, signClaim } from "@witnessed/core";
import { createApp } from "../src/http";

function setup() {
  const wkp = generateKeyPair();
  const app = createApp({
    witnessPrivateJwk: wkp.privateJwk,
    witnessKeyId: thumbprint(wkp.publicJwk),
    now: () => "2026-06-03T14:03:01Z",
  });
  return {
    app,
    witnessPublicJwk: toPublicJwk(wkp.publicJwk),
    witnessKeyId: thumbprint(wkp.publicJwk),
  };
}

function body() {
  const kp = generateKeyPair();
  const agent = { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) };
  const claim = buildClaim({
    issued_at: "2026-06-03T14:03:00Z",
    agent,
    action: { type: "email.send", description: "x" },
    payload_digest: null,
  });
  return { claim, agent_sig: signClaim(claim, kp.privateJwk) };
}

describe("witness HTTP", () => {
  it("POST /receipts returns a witnessed receipt, then GET /receipts/:id retrieves it", async () => {
    const { app } = setup();
    const post = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect(post.status).toBe(201);
    const receipt = await post.json();
    expect(receipt.witness.witnessed_at).toBe("2026-06-03T14:03:01Z");

    const get = await app.request(`/receipts/${encodeURIComponent(receipt.id)}`);
    expect(get.status).toBe(200);
    expect((await get.json()).id).toBe(receipt.id);
  });

  it("GET /receipts/:id returns 404 for unknown id", async () => {
    const { app } = setup();
    expect((await app.request("/receipts/missing")).status).toBe(404);
  });

  it("POST /verify validates a receipt against the service's own witness key", async () => {
    const { app } = setup();
    const post = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    const receipt = await post.json();
    const verify = await app.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt),
    });
    expect(verify.status).toBe(200);
    expect((await verify.json()).valid).toBe(true);
  });

  it("POST /receipts returns 400 when agent_sig is invalid", async () => {
    const { app } = setup();
    const b = body();
    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...b, agent_sig: "AAAA" }),
    });
    expect(res.status).toBe(400);
  });
});
