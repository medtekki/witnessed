# @witnessed/verifier

Offline verifier for [Receipts](https://witness.medtekki.no) action receipts. No network or trust
in the issuer required — verify signatures and the witness countersignature against a known witness
public key.

```bash
npm i @witnessed/verifier
```

```ts
import { verifyReceipt, verifyChain } from "@witnessed/verifier";

// trustedWitnessKeys: { [key_id]: publicJwk } — fetch from GET <witness>/public-key
const result = verifyReceipt(receipt, trustedWitnessKeys);
if (result.valid) {
  console.log(result.claim.action, result.anchor_check, result.payment);
}

// Verify an evidence chain (a receipt's `prev` links, e.g. a human-approval over an action):
const chain = verifyChain([actionReceipt, approvalReceipt], trustedWitnessKeys);
console.log(chain.valid, chain.issues);
```

MIT licensed.
