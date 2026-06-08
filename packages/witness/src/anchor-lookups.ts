import { canonical, sha256b64u } from "@witnessed/core";
import type { EmailLookup, PaymentLookup, EhrLookup } from "./anchor";

/**
 * Real lookups for the anchor validators. Each is an HTTP client for a concrete provider,
 * behind the validator's injected lookup type, with `fetch` injectable for tests. Live
 * network/auth is not exercised in CI.
 */

// ---------------------------------------------------------------------------
// Email — Mailgun Events API (looks up by RFC 5322 Message-ID).
// ---------------------------------------------------------------------------
export interface MailgunConfig {
  domain: string;
  apiKey: string;
  baseUrl?: string; // default "https://api.mailgun.net/v3"
  /** Event types that count as a real send. Default: accepted, delivered. */
  deliveredEvents?: string[];
  fetchImpl?: typeof fetch;
}

export function mailgunEmailLookup(config: MailgunConfig): EmailLookup {
  const base = config.baseUrl ?? "https://api.mailgun.net/v3";
  const positive = config.deliveredEvents ?? ["accepted", "delivered"];
  const fetchImpl = config.fetchImpl ?? fetch;
  const auth = `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}`;

  return async (messageId: string) => {
    const id = messageId.replace(/^<|>$/g, ""); // strip RFC angle brackets
    const qs = new URLSearchParams({ "message-id": id }).toString();
    const res = await fetchImpl(`${base}/${config.domain}/events?${qs}`, {
      headers: { authorization: auth },
    });
    if (!res.ok) return { found: false, detail: `Mailgun events HTTP ${res.status}` };
    const data = (await res.json()) as { items?: { event?: string }[] };
    const events = (data.items ?? []).map((i) => i.event).filter((e): e is string => !!e);
    if (events.length === 0) return { found: false, detail: "no events for message-id" };
    return { found: events.some((e) => positive.includes(e)), detail: `events: ${events.join(", ")}` };
  };
}

// ---------------------------------------------------------------------------
// Payment — Stripe (PaymentIntents / Charges).
// ---------------------------------------------------------------------------
export interface StripeConfig {
  apiKey: string;
  baseUrl?: string; // default "https://api.stripe.com"
  fetchImpl?: typeof fetch;
}

export function stripePaymentLookup(config: StripeConfig): PaymentLookup {
  const base = config.baseUrl ?? "https://api.stripe.com";
  const fetchImpl = config.fetchImpl ?? fetch;

  return async (txnId: string) => {
    const path = txnId.startsWith("ch_") ? `/v1/charges/${txnId}` : `/v1/payment_intents/${txnId}`;
    const res = await fetchImpl(`${base}${path}`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
    });
    if (res.status === 404) return { found: false, detail: "transaction not found at Stripe" };
    if (!res.ok) return { found: false, detail: `Stripe HTTP ${res.status}` };
    const obj = (await res.json()) as { status?: string };
    return { found: true, status: obj.status, detail: `Stripe ${txnId} status=${obj.status ?? "unknown"}` };
  };
}

// ---------------------------------------------------------------------------
// EHR — FHIR REST (resource status + provenance content hash).
// ---------------------------------------------------------------------------
export interface FhirConfig {
  baseUrl: string;
  headers?: Record<string, string>; // e.g. { authorization: "Bearer <SMART token>" }
  /** Top-level fields excluded from the content hash (volatile/derived). Default: meta, text. */
  stripFields?: string[];
  fetchImpl?: typeof fetch;
}

/** The provenance hash a FHIR record reduces to — agents must hash the same way when writing. */
export function fhirContentHash(resource: Record<string, unknown>, stripFields: string[]): string {
  const stripped: Record<string, unknown> = { ...resource };
  for (const f of stripFields) delete stripped[f];
  return sha256b64u(canonical(stripped));
}

export function fhirEhrLookup(config: FhirConfig): EhrLookup {
  const fetchImpl = config.fetchImpl ?? fetch;
  const strip = config.stripFields ?? ["meta", "text"];

  return async (recordId: string) => {
    if (!/^[A-Za-z]+\/[^/]+$/.test(recordId)) {
      return { found: false, detail: `invalid FHIR reference "${recordId}"` };
    }
    const res = await fetchImpl(`${config.baseUrl}/${recordId}`, {
      headers: { accept: "application/fhir+json", ...(config.headers ?? {}) },
    });
    if (res.status === 404) return { found: false, detail: "resource not found in EHR" };
    if (!res.ok) return { found: false, detail: `FHIR HTTP ${res.status}` };
    const resource = (await res.json()) as Record<string, unknown>;
    const status = typeof resource.status === "string" ? resource.status : undefined;
    return {
      found: true,
      status,
      contentHash: fhirContentHash(resource, strip),
      detail: `FHIR ${recordId} status=${status ?? "unknown"}`,
    };
  };
}
