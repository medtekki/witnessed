# Receipts — Verifiable Action Receipts for AI Agents

- **Date:** 2026-06-03
- **Status:** Approved design (pre-implementation)
- **Working name:** Receipts (service) / action receipt (core unit)

## Summary

A drop-in service and MCP tool that lets any AI agent emit a **signed, independently
witnessed, tamper-evident record** of a consequential action — and lets anyone verify it
later, even offline.

This is the **agent-native wedge**: a one-call trust upgrade that makes an agent's work
provable to its principal, adopted and recommended agent-to-agent. The same primitive
expands into a **regulated-domain flight recorder** (healthcare first) by adding external
effect-binding, human-oversight checkpoints, and long-term retention — all additive on
fields reserved in v1. The wedge supplies viral distribution and credibility; the
expansion supplies margin and a regulatory moat.

## Goals

- Make it trivial (under 5 minutes, ~3 lines) for an agent to emit a verifiable receipt
  for a consequential action.
- Produce receipts that are **offline-verifiable** using public keys, with no dependency
  on the issuing service at verification time.
- Keep the private key on the client; the service never sees it.
- Reserve schema space so effect-binding (anchors) and multi-agent chaining are additive,
  not a rewrite.
- Establish a usage-based business with a near-zero-marginal-cost free tier feeding a
  high-ACV compliance tier.

## Non-goals

- **Not** an identity/credentialing product. The key registry is a thin resolution layer,
  not the product. We do not compete in the crowded "Know Your Agent" / scoped-token space.
- **Not** an observability/debugging tool. Receipts are legal-grade evidence records, not
  performance traces.
- v1 does **not** prove an action's real-world effect (see Trust Model). It proves a
  tamper-evident, independently timestamped *assertion*. Effect-binding is the paid upgrade.
- Receipts do **not** gate or block the agent's underlying action.

## Strategy: wedge → expansion

The same data primitive — a tamper-evident record of "an agent did X" — ships in two
packagings:

- **Wedge (agent-native, viral, free/cheap):** plain witnessed action receipts. Spreads
  agent-to-agent because emitting receipts makes an agent more trustworthy to its principal
  and is a one-call adoption. This is the distribution engine a compliance product can
  never have.
- **Expansion (human-bought, high-value, defensible):** the same receipts shaped to
  regulatory semantics (healthcare/MDR), with human-oversight checkpoints and 6-month+
  retention = the regulated flight recorder. Sold to operators, not agents.

The defensible part is **binding receipts to verifiable external anchors** (message-IDs,
transaction-IDs, EHR record-IDs, device identity). Knowing which anchors matter in
healthcare/MDR is the domain moat a generic infrastructure company cannot replicate
credibly.

## The action receipt (core unit)

A canonical, content-addressed JSON object. Canonicalization is deterministic (e.g. JCS /
sorted-key JSON) so the same logical claim always produces the same digest and signature,
regardless of key order or whitespace.

| Field | Status | Description |
|---|---|---|
| `version` | v1 | Schema version, for forward compatibility. |
| `id` | v1 | Content hash of the canonicalized claim; the value the agent signs. |
| `issued_at` | v1 | The agent's claimed time of the action. |
| `agent` | v1 | `{key_id, public_key, label?, on_behalf_of?}` — issuer identity and optional principal. |
| `action` | v1 | `{type, description}`, e.g. `email.send` / "Sent appointment confirmation". |
| `payload_digest` | v1 | Hash of the salient content — **not** the content itself (privacy by default; PHI never forced in). |
| `anchor` | reserved | `{type, value, verified}` for external effect-proof. Present but inert in v1; validated per-vertical later. |
| `prev` | reserved | Reference(s) to predecessor receipts for multi-agent chains. |
| `agent_sig` | v1 | Agent's signature over the digest. Signed locally; the service never sees the private key. |
| `witness` | v1 | `{witnessed_at, witness_key_id, witness_sig}` — independent trusted timestamp + tamper-evidence. |

### What v1 proves

> *Agent K asserted action A over content-digest D at time T, independently witnessed at
> time T′, and the record is unaltered since.*

Verifiable offline with the public keys. It does **not** prove the action's real-world
effect — that requires effect-binding via the `anchor` field, delivered in the expansion.

## Architecture and components

Each component is an independently testable unit with one clear purpose.

### 1. Client surface
Two front doors over the same signing logic:
- **MCP server** with tools `issue_receipt`, `verify_receipt`, `get_receipt` — the
  agent-native, machine-to-machine surface.
- **Thin SDK + REST API** (`POST /receipts`, `GET /receipts/{id}`, `POST /verify`) for
  non-MCP agents and backends.

Responsibilities: generate/hold the agent keypair locally, canonicalize the claim, sign the
digest locally, and send **only** the digest + signature + claim metadata to the witness.

### 2. Witness service
Receives the canonical digest + agent signature, verifies the agent signature, adds a
trusted timestamp, countersigns with the service key, persists, and returns the complete
receipt. The witness private key lives in a KMS/HSM — it is the crown jewel.

### 3. Receipt store
Append-only, content-addressed, retention-aware storage (where 6-month+ compliance
retention plugs in later). Roadmap trust upgrade: a transparency-log / Merkle-checkpoint
layer so the witness itself cannot backdate or alter records, with periodically published
checkpoints.

### 4. Verifier
A pure function shipped as **both** an open-source library and a hosted endpoint: given a
receipt + known public keys, validate signatures, timestamp sanity, and (later) chain +
anchor. Open-sourcing the verifier is required — a proof system is only trusted if its
checker can be inspected.

### 5. Key registry
A deliberately thin resolution layer mapping `key_id` → public key + rotation/revocation
validity windows, so verifiers can resolve keys. Identity is a means here, not the product.

## Data flows

**Issue:** agent (SDK) canonicalizes claim → signs digest locally → sends
`{digest, agent_sig, agent_pubkey, claim metadata}` to witness → witness verifies the
signature, timestamps, countersigns, persists → returns the full receipt → agent
stores/shares it.

**Verify:** holder sends a receipt to the verify endpoint, or runs the library offline →
checks `agent_sig` over the digest, `witness_sig` over the witnessed digest, timestamp
sanity, chain links (when present), and anchor status (when present) → returns a verdict +
the parsed claim.

## Key design stances

- **Receipts never gate the real action.** If the witness is unavailable, the SDK emits a
  *provisional* agent-signed receipt and witnesses it asynchronously. We record actions; we
  never block them.
- **Witness time is authoritative** for verification; the agent's claimed `issued_at` is
  also retained, so clock skew is visible, not fatal.
- **Privacy by default.** Receipts carry content *digests*, not content. The agent chooses
  what, if anything, to include. PHI must never be forced into a receipt — critical for the
  healthcare expansion.

## Error handling and edge cases

- **Witness unavailable** → provisional agent-signed receipt, async witnessing later.
- **Clock skew** → both agent and witness times recorded; verifier trusts witness time.
- **Key compromise/rotation** → registry supports rotation + revocation; receipts pin the
  `key_id` and its validity window.
- **Tampering/forgery** → content-addressed `id` + agent and witness signatures make any
  alteration detectable; the witness countersignature prevents backdating.
- **Replay** → content-addressed `id` plus timestamps make duplicate/replayed receipts
  identifiable.

## Distribution

1. **One-call adoption.** "Add three lines; your agent's actions are now provable." Publish
   the MCP server to public MCP registries; ship the SDK to npm/PyPI. Time-to-first-receipt
   under 5 minutes is a hard requirement.
2. **Open the schema + verifier, host the witness.** The receipt spec and verification
   library are open source and free (open-core); the hosted witness, storage, retention,
   and anchor validation are the paid product.
3. **Public verify page.** Paste any receipt → green/red verdict + parsed claim. The viral,
   branded surface receipts land on when shared — like a tracking number.
4. **Recommendation loop.** Emitting receipts makes an agent more trustworthy to its
   principal, giving agents a selfish reason to adopt *and* to recommend it to peer agents
   they delegate to. This is the M2M flywheel.

## Pricing

Usage-based, metered on three axes — **receipts witnessed**, **retention duration**, and
**anchor validations** — because those are the real cost and value drivers.

- **Free** — N witnessed receipts/month, 30-day retention, public verify, open verifier.
  Near-zero marginal cost; drives virality.
- **Developer (paid, usage-based)** — higher volume, longer retention, org/key management,
  webhooks, SLA. Self-serve agent-dev tier.
- **Compliance / Enterprise (expansion)** — anchor validation for specific healthcare
  systems, guaranteed 6-month+ WORM retention with legal hold, human-oversight checkpoint
  workflows, and regulation-shaped exports. Where the ACV and margin concentrate.

The free/dev tiers are a distribution engine; the business is not bet on them converting.
They manufacture the trust and footprint that make the enterprise sale credible.

## Expansion path to the flight recorder

The flight recorder is the same primitive with three additive layers, all landing on
already-reserved fields:

- **Effect-binding** → fill the `anchor` slot with healthcare semantics (EHR record IDs,
  device identity, MDR data provenance) and validate them. The domain moat.
- **Human oversight** → a `human.approval` receipt that `prev`-references the agent's
  action receipt, capturing the reviewer's decision in the same evidence chain.
- **Record-keeping** → retention + legal hold + regulation-mapped exports.

Together: logging + human-oversight + record-keeping — the trifecta regulated-domain
obligations demand, for agentic, multi-step, tool-calling systems.

## Regulatory context (to be verified with counsel)

The expansion is motivated by emerging EU AI Act high-risk obligations: automatic
event-logging across the system lifecycle, multi-month retention of automated logs, and
human-oversight mechanisms, with significant turnover-based fines and extraterritorial
reach. The regulation is reportedly precise on objectives but thin on operational detail
(what events, what format, who owns storage and integrity) — that ambiguity is the product
wedge, and a binding enforcement deadline (cited as 2026-08-02 for core high-risk provider
and deployer requirements) forces the market into existence.

**These specifics — article numbers, dates, retention periods, and penalty figures — must
be verified with qualified legal counsel before they drive any product commitment or
external claim.** They are recorded here as the strategic rationale, not as established
legal fact.

## Risks

- **Receipt ≠ reality until anchored.** Witnessed-only proves *assertion*, not *effect*. Be
  upfront that v1 is a tamper-evident claim; do not oversell it.
- **Cold-start trust.** A notary nobody knows is worth little. The open verifier and
  transparency-log roadmap are the answer; lean on them early.
- **Compliance is a slow, trust-heavy sale.** Precisely why the agent-native free tier
  exists: it builds footprint and credibility while the enterprise pipeline matures.

## Testing strategy

- **Canonicalization** — property tests: the same logical claim produces the same digest
  regardless of key order/whitespace.
- **Signatures** — round-trip verification; flipping any byte must fail verification.
- **Witness** — countersignature validity and timestamp monotonicity.
- **Chain** — broken or forged `prev` links are detected (when chaining lands).
- **Parity** — the offline library and the hosted verifier return identical verdicts.
- **Load** — witness throughput under concurrency.

## Open questions / future work

- Signature scheme and key format (e.g. Ed25519 + JWK/DID-style key IDs) — to settle in the
  implementation plan.
- Transparency-log design and checkpoint publication cadence.
- First healthcare anchor integrations and their MDR semantics.
- Whether provisional (un-witnessed) receipts are exposed in v1 or held internal.
