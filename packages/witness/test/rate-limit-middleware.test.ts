import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint, buildClaim, signClaim } from "@witnessed/core";
import { createApp } from "../src/http";
import type { RateLimitConfig } from "../src/rate-limit";

function freshBody() {
  const kp = generateKeyPair();
  const agent = { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) };
  const claim = buildClaim({
    issued_at: "2026-06-09T00:00:00Z",
    agent,
    action: { type: "email.send", description: "x" },
    payload_digest: null,
  });
  return JSON.stringify({ claim, agent_sig: signClaim(claim, kp.privateJwk) });
}

function setup(rateLimit?: Partial<RateLimitConfig> & { now: () => number }) {
  const wkp = generateKeyPair();
  const app = createApp({
    witnessPrivateJwk: wkp.privateJwk,
    witnessKeyId: thumbprint(wkp.publicJwk),
    now: () => "2026-06-09T00:00:00Z",
    rateLimit: rateLimit
      ? {
          enabled: true,
          writePerMin: 1000,
          readPerMin: 1000,
          globalWritePerMin: 1000,
          ...rateLimit,
        }
      : undefined,
  });
  return app;
}

function postReceipt(app: ReturnType<typeof setup>, ip = "1.1.1.1") {
  return app.request("/receipts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: freshBody(),
  });
}

describe("rateLimit middleware", () => {
  it("does not limit when no rateLimit config is supplied", async () => {
    const app = setup();
    for (let i = 0; i < 5; i++) expect((await postReceipt(app)).status).toBe(201);
  });

  it("does not limit when rateLimit is disabled", async () => {
    let now = 1_000_000;
    const app = setup({ enabled: false, writePerMin: 1, now: () => now });
    expect((await postReceipt(app)).status).toBe(201);
    expect((await postReceipt(app)).status).toBe(201);
  });

  it("sets RateLimit-Limit and RateLimit-Remaining headers on allowed responses", async () => {
    let now = 1_000_000;
    const app = setup({ writePerMin: 2, globalWritePerMin: 1000, now: () => now });
    const first = await postReceipt(app);
    expect(first.status).toBe(201);
    expect(first.headers.get("ratelimit-limit")).toBe("2");
    expect(first.headers.get("ratelimit-remaining")).toBe("1");
    const second = await postReceipt(app);
    expect(second.headers.get("ratelimit-remaining")).toBe("0");
  });

  it("429s a write past the per-IP write limit, with Retry-After + body shape", async () => {
    let now = 1_000_000;
    const app = setup({ writePerMin: 2, now: () => now });
    expect((await postReceipt(app)).status).toBe(201);
    expect((await postReceipt(app)).status).toBe(201);
    const blocked = await postReceipt(app);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(await blocked.json()).toEqual({ error: "rate_limited", retry_after_seconds: 60 });
  });

  it("never limits /healthz even past the write limit", async () => {
    let now = 1_000_000;
    const app = setup({ writePerMin: 1, now: () => now });
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/healthz", { headers: { "x-forwarded-for": "9.9.9.9" } })).status).toBe(200);
    }
  });

  it("limits reads on a separate bucket from writes", async () => {
    let now = 1_000_000;
    const app = setup({ readPerMin: 3, writePerMin: 1, now: () => now });
    const get = () => app.request("/", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
  });

  it("keys per-IP: a different X-Forwarded-For gets its own bucket", async () => {
    let now = 1_000_000;
    const app = setup({ writePerMin: 1, now: () => now });
    expect((await postReceipt(app, "1.1.1.1")).status).toBe(201);
    expect((await postReceipt(app, "1.1.1.1")).status).toBe(429);
    expect((await postReceipt(app, "2.2.2.2")).status).toBe(201);
  });

  it("the global write backstop trips across different IPs under their per-IP limit", async () => {
    let now = 1_000_000;
    const app = setup({ writePerMin: 100, globalWritePerMin: 2, now: () => now });
    expect((await postReceipt(app, "1.1.1.1")).status).toBe(201);
    expect((await postReceipt(app, "2.2.2.2")).status).toBe(201);
    expect((await postReceipt(app, "3.3.3.3")).status).toBe(429);
  });

  it("resets the per-IP window after 60s", async () => {
    let now = 1_000_000;
    const app = setup({ writePerMin: 1, globalWritePerMin: 1000, now: () => now });
    expect((await postReceipt(app)).status).toBe(201);
    expect((await postReceipt(app)).status).toBe(429);
    now += 60_000;
    expect((await postReceipt(app)).status).toBe(201);
  });
});
