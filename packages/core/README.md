# @witnessed/core

Core primitives for [Receipts](https://witness.medtekki.no) — verifiable action receipts for AI
agents. Shared types and the cryptographic building blocks used by the SDK and verifier:

- Ed25519 keypairs as JWKs (`generateKeyPair`, `toPublicJwk`, `thumbprint`)
- JCS (RFC 8785) canonicalization + SHA-256 (`canonical`, `sha256b64u`)
- Sign/verify (`sign`, `verifySig`) and claim construction (`buildClaim`, `computeId`, `signClaim`)
- The `Receipt`, `Claim`, `Anchor`, `Witness`, `PaymentSettlement` types

Most consumers use [`@witnessed/sdk`](https://www.npmjs.com/package/@witnessed/sdk) or
[`@witnessed/verifier`](https://www.npmjs.com/package/@witnessed/verifier) rather than this directly.

```bash
npm i @witnessed/core
```

MIT licensed.
