# @witnessed/sdk

Client SDK for [Receipts](https://witness.medtekki.no) — verifiable action receipts for AI agents.
An agent signs a claim about an action **with its own key**; an independent witness timestamps and
countersigns it; anyone can verify the receipt offline.

```bash
npm i @witnessed/sdk
```

```ts
import { ReceiptsClient } from "@witnessed/sdk";

const client = new ReceiptsClient({
  baseUrl: "https://witness.medtekki.no",
  // Persist this keypair to keep a stable agent identity:
  privateJwk: ReceiptsClient.generateKey().privateJwk,
});

// Issue a witnessed receipt (signs locally, then the witness countersigns).
const receipt = await client.issueReceipt({
  action: { type: "email.send", description: "Sent appointment confirmation" },
  // Optional anchor binds a real-world effect the witness verifies:
  // anchor: { type: "email.message_id", value: "<id@host>" },
});

// Verify offline against the witness public key (GET /public-key).
const pk = await (await fetch("https://witness.medtekki.no/public-key")).json();
console.log(client.verify(receipt, { [pk.key_id]: pk.public_key }).valid); // true
```

**What a receipt proves:** agent K asserted action A over content-digest D at time T, independently
witnessed at T′, unaltered since. With an anchor, the witness also confirms the real-world effect.

MIT licensed.
