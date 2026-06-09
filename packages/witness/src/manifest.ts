import type { Jwk } from "@witnessed/core";

export interface ManifestParams {
  base: string;
  keyId: string;
  publicJwk: Jwk;
}

/** Machine-readable self-description served at `/` and `/.well-known/receipts.json`. */
export function serviceManifest({ base, keyId, publicJwk }: ManifestParams) {
  return {
    service: "receipts",
    description:
      "Verifiable action receipts for AI agents. An agent signs a claim about an action with " +
      "its own key; an independent witness timestamps and countersigns it; anyone can verify " +
      "the receipt offline using the witness public key.",
    format: "receipts.v0",
    status: "beta",
    pricing: "free",
    proves:
      "Agent K asserted action A over content-digest D at time T, independently witnessed at " +
      "T', and unaltered since. With an anchor, the witness also confirms the real-world effect " +
      "(email Message-ID, payment txn, or EHR record).",
    witness_key: { key_id: keyId, public_key: publicJwk, alg: "Ed25519" },
    endpoints: {
      issue_receipt: {
        method: "POST",
        path: "/receipts",
        body: { claim: "Claim", agent_sig: "base64url Ed25519 over the JCS-canonical claim" },
        returns: "Receipt (201)",
        note: "Sign the claim locally with your own key, then POST. Your private key never leaves you.",
      },
      get_receipt: { method: "GET", path: "/receipts/{id}", returns: "Receipt" },
      verify: { method: "POST", path: "/verify", body: "Receipt", returns: "VerifyResult" },
      public_key: { method: "GET", path: "/public-key" },
      health: { method: "GET", path: "/healthz" },
    },
    mcp: {
      url: `${base}/mcp`,
      transport: "streamable-http",
      tools: ["verify_receipt", "get_receipt", "service_info"],
      note: "Issuance requires client-side signing, so it is NOT exposed over the hosted MCP — issue with the Receipts SDK locally. The hosted MCP offers verify/get.",
    },
    verify_offline:
      "Recompute the JCS-canonical claim, check id == base64url(sha256(claim)), verify agent_sig " +
      "with receipt.agent.public_key, and verify witness.witness_sig with this witness_key. The " +
      "reference verifier is open source.",
    links: {
      openapi: `${base}/openapi.json`,
      llms_txt: `${base}/llms.txt`,
      manifest: `${base}/.well-known/receipts.json`,
      terms: `${base}/terms`,
      privacy: `${base}/privacy`,
    },
  };
}

/** llms.txt — concise markdown an LLM agent can read to self-onboard. */
export function llmsTxt({ base, keyId }: { base: string; keyId: string }): string {
  return `# Receipts — verifiable action receipts for AI agents

> An agent signs a claim about an action with its own key; an independent witness timestamps and
> countersigns it; anyone verifies the receipt offline with the witness public key. Free beta.

## Use it
- Issue (sign locally, then POST): \`POST ${base}/receipts\` with JSON {claim, agent_sig}.
  Signing happens on your side with the Receipts SDK — your private key never leaves you.
- Retrieve: \`GET ${base}/receipts/{id}\`
- Verify: \`POST ${base}/verify\` with a Receipt -> {valid, ...}
- Witness public key: \`GET ${base}/public-key\` (key_id ${keyId})
- Manifests: \`GET ${base}/.well-known/receipts.json\`, \`GET ${base}/openapi.json\`
- MCP (verify/get/info, streamable-http): \`${base}/mcp\`

## What a receipt proves
Agent K asserted action A over content-digest D at time T, independently witnessed at T',
unaltered since. With an anchor, the witness also confirms the real-world effect.

## Legal
Terms: ${base}/terms · Privacy: ${base}/privacy

## Notes
Beta, free, signing key host-held (not yet KMS). Not a compliance guarantee.
`;
}

/** Minimal OpenAPI 3.1 description of the REST surface. */
export function openApiSpec({ base }: { base: string }) {
  const Receipt = { type: "object", description: "A signed, witnessed action receipt." };
  return {
    openapi: "3.1.0",
    info: { title: "Receipts witness", version: "0", description: "Verifiable action receipts for AI agents. Free beta." },
    servers: [{ url: base }],
    paths: {
      "/receipts": {
        post: {
          summary: "Witness a locally-signed claim and return a receipt",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["claim", "agent_sig"],
                  properties: { claim: { type: "object" }, agent_sig: { type: "string" } },
                },
              },
            },
          },
          responses: { "201": { description: "Receipt", content: { "application/json": { schema: Receipt } } }, "400": { description: "Invalid signature" }, "402": { description: "Payment required (if billing enabled)" } },
        },
      },
      "/receipts/{id}": {
        get: {
          summary: "Retrieve a receipt by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Receipt", content: { "application/json": { schema: Receipt } } }, "404": { description: "Not found" } },
        },
      },
      "/verify": {
        post: {
          summary: "Verify a receipt against the witness key",
          requestBody: { required: true, content: { "application/json": { schema: Receipt } } },
          responses: { "200": { description: "VerifyResult", content: { "application/json": { schema: { type: "object", properties: { valid: { type: "boolean" } } } } } } },
        },
      },
      "/public-key": { get: { summary: "Witness public key", responses: { "200": { description: "key_id + public JWK" } } } },
      "/healthz": { get: { summary: "Liveness", responses: { "200": { description: "ok" } } } },
      "/terms": { get: { summary: "Terms of Service (markdown, v0 draft)", responses: { "200": { description: "Terms of Service", content: { "text/markdown": {} } } } } },
      "/privacy": { get: { summary: "Privacy Notice (markdown, v0 draft)", responses: { "200": { description: "Privacy Notice", content: { "text/markdown": {} } } } } },
    },
  };
}
