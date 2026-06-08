import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  buildClaim,
  signClaim,
  HUMAN_APPROVAL,
  HUMAN_REJECTION,
} from "@witnessed/core";
import type { Action, Anchor, Jwk, Receipt, VerifyResult } from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";

export interface ClientConfig {
  baseUrl: string;
  privateJwk: Jwk;
  fetchImpl?: typeof fetch;
}

export class ReceiptsClient {
  private readonly publicJwk: Jwk;
  private readonly keyId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ClientConfig) {
    this.publicJwk = toPublicJwk(config.privateJwk);
    this.keyId = thumbprint(this.publicJwk);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  static generateKey() {
    return generateKeyPair();
  }

  async issueReceipt(input: {
    action: Action;
    issued_at?: string;
    payload_digest?: string | null;
    anchor?: Anchor | null;
    prev?: string[];
  }): Promise<Receipt> {
    const claim = buildClaim({
      issued_at: input.issued_at ?? new Date().toISOString(),
      agent: { key_id: this.keyId, public_key: this.publicJwk },
      action: input.action,
      payload_digest: input.payload_digest ?? null,
      anchor: input.anchor ?? null,
      prev: input.prev ?? [],
    });
    const agent_sig = signClaim(claim, this.config.privateJwk);

    const res = await this.fetchImpl(`${this.config.baseUrl}/receipts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim, agent_sig }),
    });
    if (res.status !== 201) {
      throw new Error(`witness rejected receipt: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as Receipt;
  }

  /**
   * Record a human-oversight decision on a prior action receipt. The decision is itself a
   * receipt — signed by this client's (the reviewer's) key and linked via `prev` to the
   * receipt under review — so it joins the same evidence chain.
   */
  async approve(prevReceiptId: string, reason: string): Promise<Receipt> {
    return this.issueReceipt({
      action: { type: HUMAN_APPROVAL, description: reason },
      prev: [prevReceiptId],
    });
  }

  async reject(prevReceiptId: string, reason: string): Promise<Receipt> {
    return this.issueReceipt({
      action: { type: HUMAN_REJECTION, description: reason },
      prev: [prevReceiptId],
    });
  }

  verify(receipt: Receipt, trustedWitnessKeys: Record<string, Jwk>): VerifyResult {
    return verifyReceipt(receipt, trustedWitnessKeys);
  }
}
