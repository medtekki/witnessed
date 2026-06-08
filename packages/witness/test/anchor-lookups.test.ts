import { describe, it, expect } from "vitest";
import {
  canonical,
  sha256b64u,
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  signClaim,
} from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";
import { createApp } from "../src/http";
import { EhrRecordIdValidator } from "../src/anchor";
import {
  mailgunEmailLookup,
  stripePaymentLookup,
  fhirEhrLookup,
  fhirContentHash,
} from "../src/anchor-lookups";

function jsonFetch(handler: (url: string) => { status?: number; body?: unknown }) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    const { status = 200, body } = handler(String(url));
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("mailgunEmailLookup", () => {
  it("reports found when a positive delivery event exists, stripping angle brackets", async () => {
    const { fetchImpl, calls } = jsonFetch(() => ({ body: { items: [{ event: "delivered" }] } }));
    const lookup = mailgunEmailLookup({ domain: "mail.example.com", apiKey: "key", fetchImpl });
    const r = await lookup("<abc@mail.example.com>");
    expect(r.found).toBe(true);
    expect(calls[0]).toContain("message-id=abc%40mail.example.com");
    expect(calls[0]).not.toContain("%3C"); // no encoded "<"
  });

  it("reports not-found when only negative events exist, or none", async () => {
    const failed = mailgunEmailLookup({
      domain: "d",
      apiKey: "k",
      fetchImpl: jsonFetch(() => ({ body: { items: [{ event: "failed" }] } })).fetchImpl,
    });
    expect((await failed("<x@y>")).found).toBe(false);

    const empty = mailgunEmailLookup({
      domain: "d",
      apiKey: "k",
      fetchImpl: jsonFetch(() => ({ body: { items: [] } })).fetchImpl,
    });
    expect((await empty("<x@y>")).found).toBe(false);
  });

  it("reports not-found on an HTTP error", async () => {
    const lookup = mailgunEmailLookup({
      domain: "d",
      apiKey: "k",
      fetchImpl: jsonFetch(() => ({ status: 401 })).fetchImpl,
    });
    const r = await lookup("<x@y>");
    expect(r.found).toBe(false);
    expect(r.detail).toMatch(/HTTP 401/);
  });
});

describe("stripePaymentLookup", () => {
  it("returns the PaymentIntent status", async () => {
    const { fetchImpl, calls } = jsonFetch(() => ({ body: { id: "pi_1", status: "succeeded" } }));
    const lookup = stripePaymentLookup({ apiKey: "sk", fetchImpl });
    const r = await lookup("pi_1");
    expect(r).toMatchObject({ found: true, status: "succeeded" });
    expect(calls[0]).toContain("/v1/payment_intents/pi_1");
  });

  it("routes ch_ ids to the charges endpoint", async () => {
    const { fetchImpl, calls } = jsonFetch(() => ({ body: { status: "succeeded" } }));
    await stripePaymentLookup({ apiKey: "sk", fetchImpl })("ch_9");
    expect(calls[0]).toContain("/v1/charges/ch_9");
  });

  it("treats 404 as not found", async () => {
    const lookup = stripePaymentLookup({ apiKey: "sk", fetchImpl: jsonFetch(() => ({ status: 404 })).fetchImpl });
    const r = await lookup("pi_missing");
    expect(r.found).toBe(false);
    expect(r.detail).toMatch(/not found/i);
  });
});

describe("fhirEhrLookup", () => {
  const resource = {
    resourceType: "Observation",
    id: "1234",
    status: "final",
    meta: { versionId: "3", lastUpdated: "2026-06-04T00:00:00Z" },
    text: { div: "<div>rendered</div>" },
    valueString: "BP 120/80",
  };

  it("fhirContentHash strips volatile fields before hashing", () => {
    const expected = sha256b64u(
      canonical({ resourceType: "Observation", id: "1234", status: "final", valueString: "BP 120/80" }),
    );
    expect(fhirContentHash(resource, ["meta", "text"])).toBe(expected);
  });

  it("returns status and a provenance content hash for an existing resource", async () => {
    const { fetchImpl, calls } = jsonFetch(() => ({ body: resource }));
    const r = await fhirEhrLookup({ baseUrl: "https://fhir.example.com", fetchImpl })("Observation/1234");
    expect(r).toMatchObject({ found: true, status: "final" });
    expect(r.contentHash).toBe(fhirContentHash(resource, ["meta", "text"]));
    expect(calls[0]).toBe("https://fhir.example.com/Observation/1234");
  });

  it("rejects a malformed reference and treats 404 as not found", async () => {
    const ok = fhirEhrLookup({ baseUrl: "https://f", fetchImpl: jsonFetch(() => ({ status: 404 })).fetchImpl });
    expect((await ok("notareference")).found).toBe(false); // never fetched
    expect((await ok("Observation/missing")).found).toBe(false); // 404
  });
});

describe("real FHIR lookup wired into the validator via createApp", () => {
  it("verifies provenance: matching payload_digest -> anchor_check verified", async () => {
    const resource = {
      resourceType: "Observation",
      id: "1234",
      status: "final",
      meta: { versionId: "1" },
      valueString: "BP 120/80",
    };
    const digest = fhirContentHash(resource, ["meta", "text"]);

    const wkp = generateKeyPair();
    const trusted = { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) };
    const app = createApp({
      witnessPrivateJwk: wkp.privateJwk,
      witnessKeyId: thumbprint(wkp.publicJwk),
      now: () => "2026-06-04T10:00:01Z",
      validators: {
        "ehr.record_id": new EhrRecordIdValidator(
          fhirEhrLookup({ baseUrl: "https://fhir.example.com", fetchImpl: jsonFetch(() => ({ body: resource })).fetchImpl }),
        ),
      },
    });

    const kp = generateKeyPair();
    const claim = buildClaim({
      issued_at: "2026-06-04T10:00:00Z",
      agent: { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) },
      action: { type: "ehr.write", description: "Wrote observation" },
      payload_digest: digest,
      anchor: { type: "ehr.record_id", value: "Observation/1234" },
    });
    const res = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim, agent_sig: signClaim(claim, kp.privateJwk) }),
    });
    const receipt = await res.json();

    expect(receipt.witness.anchor_check.verified).toBe(true);
    expect(receipt.witness.anchor_check.detail).toMatch(/matching provenance/);
    expect(verifyReceipt(receipt, trusted).valid).toBe(true);
  });
});
