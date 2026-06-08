# Witnessed — verifiable action receipts for AI agents

[![CI](https://github.com/medtekki/witnessed/actions/workflows/ci.yml/badge.svg)](https://github.com/medtekki/witnessed/actions/workflows/ci.yml)
[![npm @witnessed/sdk](https://img.shields.io/npm/v/@witnessed/sdk?label=%40witnessed%2Fsdk)](https://www.npmjs.com/package/@witnessed/sdk)
[![license](https://img.shields.io/npm/l/@witnessed/sdk)](./LICENSE)

An agent signs a claim about a consequential action **with its own key**; a **witness** service
independently timestamps and countersigns it; the receipt is stored and retrievable; and **anyone
can verify it offline** with the witness's public key.

```bash
npm i @witnessed/sdk        # build it into your agent
npx @witnessed/mcp          # or run a local MCP server for any agent host
```

Live at **https://witness.medtekki.no**. Design and plan in `docs/superpowers/`.

## Live beta

- **Endpoint:** `https://witness.medtekki.no` (`/healthz`, `/public-key`, `POST /receipts`,
  `GET /receipts/:id`, `POST /verify`)
- **Agent discovery:** the service describes itself for agents at `GET /` and
  `/.well-known/receipts.json` (JSON manifest), `/llms.txt`, and `/openapi.json`.
- **Hosted MCP:** `https://witness.medtekki.no/mcp` (Streamable HTTP) exposes `verify_receipt`,
  `get_receipt`, `service_info`. Issuance is **not** hosted (it needs client-side signing) — issue
  with the SDK or the local MCP CLI.
- **Local MCP CLI:** `npx @witnessed/mcp` runs a stdio MCP server that issues receipts signed with
  the agent's own key (tools `issue_receipt`, `verify_receipt`). Point any MCP host at it.
- **Published packages:** `@witnessed/sdk`, `@witnessed/verifier`, `@witnessed/core`,
  `@witnessed/mcp` on npm.
- **Witness public key** (build your trusted-key set from this to verify receipts offline):
  - `key_id`: `zNo0zXMkkRwNUbNqtHj6diky8Nd9SvMZ8i7m6F99oFE`
  - `public_key`: `{"kty":"OKP","crv":"Ed25519","x":"oKDkj9ODRDR8ASpYs8pKALb0AnwS6u1j7WyivK9UpM4"}`

Beta caveats: receipts are free/unbilled; the signing key is host-held (not yet KMS); treat as
a labelled beta, not a compliance guarantee.

## Packages

| Package | Responsibility |
|---|---|
| `@witnessed/core` | Types, JCS canonicalization, Ed25519 keys/crypto, claim building & signing |
| `@witnessed/verifier` | Pure, offline receipt verification (reused client- and server-side) |
| `@witnessed/witness` | In-memory + durable SQLite stores, signer, anchor validators, witness logic, Hono HTTP service |
| `@witnessed/sdk` | `ReceiptsClient` — local signing, issue via witness, offline verify |
| `@witnessed/mcp` | MCP server exposing `issue_receipt` / `verify_receipt` tools |
| `@witnessed/gcp-kms` | Production adapter: a `KmsSignFn` backed by Google Cloud KMS (Ed25519) |

## What a receipt proves

Baseline (no anchor):

> Agent K asserted action A over content-digest D at time T, independently witnessed at
> time T′, and the record is unaltered since.

With an **anchor** (effect-binding), the agent attaches an external reference such as an
email `Message-ID`, and the witness independently validates it, adding a signed
`anchor_check`:

> ...and the witness confirmed, at time T′, that the claimed external effect (Message-ID X)
> actually exists at the provider.

A failed or unvalidated anchor is **recorded** as `verified: false`, never rejected —
receipts never gate the underlying action. Verifiers surface `anchor_check` so a consumer
can choose to trust only effect-proven receipts.

## Develop

Requires Node 22+ and npm (npm workspaces).

```bash
npm install
npm run typecheck   # tsc --noEmit across all packages + tests
npm test            # full Vitest suite
npm run check       # typecheck + test (the CI gate; see .github/workflows/ci.yml)
```

## Deploy (beta)

The witness is a standard HTTP service (`/healthz`, `/public-key`, `POST /receipts`,
`GET /receipts/:id`, `POST /verify`).

```bash
npm run gen:witness-key          # prints WITNESS_PRIVATE_JWK (keep secret) + the public key
cp .env.example .env             # set WITNESS_PRIVATE_JWK (and optional store / x402 vars)
npm run start:witness            # listens on :8787
```

Container / Fly.io (a `Dockerfile` and `fly.toml` are included):

```bash
fly launch --no-deploy
fly secrets set WITNESS_PRIVATE_JWK='...'   # value from gen:witness-key
fly volumes create receipts_data --size 1
fly deploy
```

Publish `GET /public-key` so verifiers can build their trusted-key set and check receipts
offline. **Beta note:** an env-held private key is acceptable for a labelled beta; move signing
to a KMS/HSM (`@witnessed/gcp-kms` + `KmsSigner`) before charging money or handling regulated data.

## Trust model

- The agent's **private key never leaves the client**; only the canonical digest and the
  agent signature go to the witness.
- The **witness signing key** is pluggable via the `Signer` interface (async). `LocalSigner`
  holds a local key (dev only); `KmsSigner` delegates to a KMS/HSM via an injected
  `KmsSignFn` so the witness key never enters the process. Wire it with
  `createApp({ signer, witnessPublicJwk, ... })`. (Ed25519 signing required — works with GCP
  Cloud KMS / HSMs that support Ed25519; AWS KMS managed keys do not.)

  Production wiring with `@witnessed/gcp-kms` (the only module touching the GCP SDK is
  `createGcpKmsClient`; the adapter logic is injected-client + CRC32C-verified):

  ```ts
  import { createGcpKmsClient, gcpKmsSignFn, gcpKmsPublicJwk } from "@witnessed/gcp-kms";
  import { KmsSigner } from "@witnessed/witness/src/signer";

  const client = createGcpKmsClient();
  const keyVersion = "projects/P/locations/L/keyRings/R/cryptoKeys/witness/cryptoKeyVersions/1";
  const { publicJwk, keyId } = await gcpKmsPublicJwk(keyVersion, client);
  const app = createApp({
    signer: new KmsSigner(keyId, gcpKmsSignFn(keyVersion, client)),
    witnessPublicJwk: publicJwk,
  });
  ```
- The **witness time is authoritative**; the agent's claimed time is also retained.
- Receipts carry content **digests, not content** — privacy by default.
- **Durable storage**: `SqliteStore` persists receipts append-only (PRIMARY KEY on `id`);
  inject it via `createApp({ ..., store })`. Postgres can implement the same `ReceiptStore`.
- **Record-keeping** (`RetentionStore`): a `RetentionPolicy { minimumDays }` (EU AI Act
  ≈ 180 days) sets each record's `retain_until`; `purgeExpired(now)` deletes only records past
  their window and not under hold, returning both what it purged and what a **legal hold**
  kept (`placeLegalHold`/`releaseLegalHold`) — no silent deletion. Records with no policy are
  kept indefinitely.
- **Article-12 export**: `buildArticle12Export(receipts, keys, opts)` produces an ordered,
  integrity-verified event log (each receipt re-verified, chain resolved) with effect/anchor,
  actor, timestamps, and human-oversight flags. It is `format: "...v0"` and carries an explicit
  disclaimer that the field mapping is **not** legally validated — verify with counsel.
- **x402 billing** (optional): `createApp({ x402: { facilitator } })` makes the witness
  charge per receipt. An unpaid `POST /receipts` returns HTTP `402` with payment requirements
  (USDC, bound to the claim id so a payment can't be replayed); a paid request settles via the
  injected `PaymentFacilitator` and the settlement (`tx_hash`) is recorded as witness-signed
  `witness.payment` — so getting paid and proving it are one on-chain-verifiable artifact.
  The facilitator is provider-agnostic; `HttpFacilitator` (`@witnessed/witness/src/x402-facilitator`)
  is a real client for a hosted x402 facilitator — it decodes the `X-PAYMENT` payload, calls
  `POST /verify` then `POST /settle`, and maps the returned `transaction` to the receipt's
  `tx_hash` (transport injected for tests; live chain settlement runs against a real facilitator).
- **Effect-binding**: agents attach an `anchor` `{ type, value }`; the witness runs a
  pluggable `AnchorValidator` (given the anchor value + the claim's `payload_digest`) and
  signs the result. Built in:
  - `EmailMessageIdValidator` (`email.message_id`) — verified when the message is found.
  - `PaymentTxnIdValidator` (`payment.txn_id`) — verified when the transaction is found
    *and* settled.
  - `EhrRecordIdValidator` (`ehr.record_id`) — MDR-style provenance: verified when the
    record exists, is in an accepted status, *and* its content hash matches the receipt's
    `payload_digest` (proving the agent wrote exactly the data it claimed).

  Real provider lookups live in `@witnessed/witness/src/anchor-lookups`: `mailgunEmailLookup`
  (Mailgun Events API, by RFC Message-ID), `stripePaymentLookup` (Stripe PaymentIntents/Charges),
  and `fhirEhrLookup` (FHIR REST + a `fhirContentHash` provenance reducer). Each takes an
  injected `fetch` for tests; live network/auth runs against the real provider.
- **Evidence chains**: a receipt's `prev` lists predecessor receipt ids. Because `id` is a
  content hash, a `prev` link pins the exact predecessor and is covered by the signatures, so
  tampering with any link breaks the chain. `verifyChain()` verifies every receipt and
  resolves every link.
- **Human oversight**: a reviewer's decision is an ordinary receipt with
  `action.type` = `human.approval` / `human.rejection`, signed by the reviewer's own key and
  `prev`-linked to the action under review — so oversight lands in the same evidence chain.
  Use `client.approve(id, reason)` / `client.reject(id, reason)`. (Binding a reviewer key to a
  real licensed human is a separate identity layer, intentionally out of scope.)
