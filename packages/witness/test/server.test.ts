import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint } from "@witnessed/core";
import { createApp } from "../src/http";
import { buildConfigFromEnv } from "../src/server";
import { generateWitnessKey } from "../src/gen-key";

describe("witness endpoints for deployment", () => {
  function app() {
    const wkp = generateKeyPair();
    return {
      app: createApp({ witnessPrivateJwk: wkp.privateJwk, witnessKeyId: thumbprint(wkp.publicJwk) }),
      keyId: thumbprint(wkp.publicJwk),
      publicJwk: toPublicJwk(wkp.publicJwk),
    };
  }

  it("GET /healthz returns ok", async () => {
    const res = await app().app.request("/healthz");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("GET /public-key returns the witness key id and public JWK", async () => {
    const { app: a, keyId, publicJwk } = app();
    const res = await a.request("/public-key");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key_id).toBe(keyId);
    expect(body.public_key).toEqual(publicJwk);
  });
});

describe("generateWitnessKey", () => {
  it("produces an Ed25519 keypair with a matching thumbprint key id", () => {
    const { keyId, publicJwk, privateJwk } = generateWitnessKey();
    expect(publicJwk.crv).toBe("Ed25519");
    expect(publicJwk.d).toBeUndefined();
    expect(privateJwk.d).toBeTruthy();
    expect(keyId).toBe(thumbprint(publicJwk));
  });
});

describe("buildConfigFromEnv", () => {
  const key = generateWitnessKey();
  const base = { WITNESS_PRIVATE_JWK: JSON.stringify(key.privateJwk) };

  it("throws when the witness key is missing", () => {
    expect(() => buildConfigFromEnv({})).toThrow(/WITNESS_PRIVATE_JWK/);
  });

  it("derives the key id from the private key and serves it via /public-key", async () => {
    const config = buildConfigFromEnv({ ...base });
    expect(config.witnessKeyId).toBe(key.keyId);
    const res = await createApp(config).request("/public-key");
    expect((await res.json()).key_id).toBe(key.keyId);
  });

  it("enables the durable store when RECEIPTS_DB is set", () => {
    expect(buildConfigFromEnv({ ...base }).store).toBeUndefined();
    expect(buildConfigFromEnv({ ...base, RECEIPTS_DB: ":memory:" }).store).toBeDefined();
  });

  it("enables x402 billing only when all five x402 vars are present", () => {
    expect(buildConfigFromEnv({ ...base, X402_FACILITATOR_URL: "https://f" }).x402).toBeUndefined();
    const full = buildConfigFromEnv({
      ...base,
      X402_FACILITATOR_URL: "https://f",
      X402_NETWORK: "base",
      X402_ASSET: "0xUSDC",
      X402_PAY_TO: "0xTreasury",
      X402_AMOUNT: "10000",
    });
    expect(full.x402).toBeDefined();
  });

  it("enables rate limiting by default with the documented limits", () => {
    const rl = buildConfigFromEnv({ ...base }).rateLimit;
    expect(rl).toEqual({
      enabled: true,
      writePerMin: 30,
      readPerMin: 120,
      globalWritePerMin: 300,
    });
  });

  it("disables rate limiting when RL_ENABLED=false", () => {
    expect(buildConfigFromEnv({ ...base, RL_ENABLED: "false" }).rateLimit?.enabled).toBe(false);
  });

  it("only the exact string 'false' disables — other values stay enabled (safe default)", () => {
    expect(buildConfigFromEnv({ ...base, RL_ENABLED: "0" }).rateLimit?.enabled).toBe(true);
    expect(buildConfigFromEnv({ ...base, RL_ENABLED: "" }).rateLimit?.enabled).toBe(true);
  });

  it("reads custom rate-limit numbers from env", () => {
    const rl = buildConfigFromEnv({
      ...base,
      RL_WRITE_PER_MIN: "60",
      RL_READ_PER_MIN: "240",
      RL_GLOBAL_WRITE_PER_MIN: "0",
    }).rateLimit;
    expect(rl).toMatchObject({ writePerMin: 60, readPerMin: 240, globalWritePerMin: 0 });
  });

  it("falls back to defaults for malformed or negative limit env vars (fail-safe, not fail-closed)", () => {
    const rl = buildConfigFromEnv({
      ...base,
      RL_WRITE_PER_MIN: "on", // typo → NaN must not brick the tier
      RL_READ_PER_MIN: "-5", // negative is nonsensical
    }).rateLimit;
    expect(rl).toMatchObject({ writePerMin: 30, readPerMin: 120, globalWritePerMin: 300 });
  });
});
