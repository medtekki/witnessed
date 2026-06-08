import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint } from "@witnessed/core";
import { createApp } from "../src/http";

function app() {
  const wkp = generateKeyPair();
  return {
    app: createApp({ witnessPrivateJwk: wkp.privateJwk, witnessKeyId: thumbprint(wkp.publicJwk) }),
    keyId: thumbprint(wkp.publicJwk),
    publicJwk: toPublicJwk(wkp.publicJwk),
  };
}

describe("agent-facing manifests", () => {
  it("GET / returns a self-describing JSON manifest with the witness key and endpoints", async () => {
    const { app: a, keyId, publicJwk } = app();
    const res = await a.request("/", { headers: { host: "witness.medtekki.no", "x-forwarded-proto": "https" } });
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m.service).toBe("receipts");
    expect(m.witness_key.key_id).toBe(keyId);
    expect(m.witness_key.public_key).toEqual(publicJwk);
    expect(m.endpoints.verify.path).toBe("/verify");
    expect(m.mcp.url).toBe("https://witness.medtekki.no/mcp");
    expect(m.links.openapi).toBe("https://witness.medtekki.no/openapi.json");
  });

  it("serves the same manifest at /.well-known/receipts.json", async () => {
    const { app: a, keyId } = app();
    const res = await a.request("/.well-known/receipts.json");
    expect((await res.json()).witness_key.key_id).toBe(keyId);
  });

  it("GET /llms.txt is markdown that references the endpoints and key", async () => {
    const { app: a, keyId } = app();
    const res = await a.request("/llms.txt", { headers: { host: "witness.medtekki.no", "x-forwarded-proto": "https" } });
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toContain("https://witness.medtekki.no/receipts");
    expect(txt).toContain(keyId);
  });

  it("GET /openapi.json is a valid-shaped OpenAPI 3.1 doc covering the endpoints", async () => {
    const { app: a } = app();
    const spec = await (await a.request("/openapi.json")).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/receipts", "/receipts/{id}", "/verify", "/public-key", "/healthz"]),
    );
  });
});
