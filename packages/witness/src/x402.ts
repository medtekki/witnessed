/**
 * x402 ("HTTP 402 Payment Required") billing for the witness API. An unpaid request gets a
 * 402 with payment requirements; the agent pays (stablecoin, e.g. USDC on Base) and retries
 * with an `X-PAYMENT` header; the witness settles it via a facilitator and records the
 * settlement on the receipt (witness.payment), so getting paid and proving it are one artifact.
 *
 * The facilitator is injected (same DI pattern as KMS/anchor lookups): in production it wraps
 * a real x402 facilitator (Coinbase / Cloudflare) or a chain RPC; in tests it is stubbed.
 */

/** What the agent must pay, returned in the 402 body. A simplified x402 PaymentRequirements. */
export interface PaymentRequirements {
  scheme: string; // e.g. "x402-exact"
  network: string; // e.g. "base"
  asset: string; // e.g. "USDC"
  amount: string; // amount owed (string to avoid float issues)
  payTo: string; // recipient address
  resource: string; // the resource being paid for, e.g. "/receipts"
  nonce: string; // binds payment to one specific request (we use the claim id)
  description?: string;
}

export interface SettlementResult {
  settled: boolean;
  txHash?: string; // present iff settled
  detail: string;
}

export interface PaymentFacilitator {
  /** Build the payment requirements for a resource + per-request nonce. */
  requirements(resource: string, nonce: string): PaymentRequirements;
  /** Verify and settle the X-PAYMENT header against the requirements. */
  settle(xPaymentHeader: string, requirements: PaymentRequirements): Promise<SettlementResult>;
}

/** The 402 response body shape (x402 v1-style). */
export function paymentRequiredBody(requirements: PaymentRequirements, error = "payment required") {
  return { x402Version: 1, error, accepts: [requirements] };
}
