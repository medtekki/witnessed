import type { PaymentFacilitator, PaymentRequirements, SettlementResult } from "./x402";

/**
 * A real x402 facilitator client. A facilitator is a hosted service (e.g. Coinbase's or
 * Cloudflare's) that exposes `POST /verify` and `POST /settle`; the witness calls it to
 * verify an agent's `X-PAYMENT` payload off-chain and then settle the stablecoin transfer
 * on-chain, returning a transaction hash.
 *
 * The HTTP transport is injected (`fetchImpl`) so tests simulate a facilitator. NOT exercised
 * here: live chain settlement, real facilitator auth, and the agent-side EIP-3009
 * `transferWithAuthorization` payload construction (the agent wallet's job).
 */
export interface HttpFacilitatorConfig {
  facilitatorUrl: string; // e.g. "https://x402.org/facilitator"
  network: string; // e.g. "base" | "base-sepolia"
  asset: string; // token CONTRACT address (e.g. USDC on the network)
  payTo: string; // recipient address
  maxAmountRequired: string; // price in atomic units (USDC has 6 decimals: "10000" = $0.01)
  scheme?: string; // default "exact"
  description?: string;
  maxTimeoutSeconds?: number; // default 60
  extra?: Record<string, unknown>; // e.g. EIP-712 domain { name, version } for the "exact" scheme
  x402Version?: number; // default 1
  headers?: Record<string, string>; // optional facilitator auth (e.g. CDP API key)
  fetchImpl?: typeof fetch;
}

/** The x402-spec PaymentRequirements sent to the facilitator (richer than our 402-body view). */
interface SpecPaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: Record<string, unknown>;
}

export class HttpFacilitator implements PaymentFacilitator {
  private readonly fetchImpl: typeof fetch;
  private readonly scheme: string;
  private readonly x402Version: number;

  constructor(private readonly config: HttpFacilitatorConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.scheme = config.scheme ?? "exact";
    this.x402Version = config.x402Version ?? 1;
  }

  requirements(resource: string, nonce: string): PaymentRequirements {
    return {
      scheme: this.scheme,
      network: this.config.network,
      asset: this.config.asset,
      amount: this.config.maxAmountRequired,
      payTo: this.config.payTo,
      resource,
      nonce,
      description: this.config.description ?? "Witness one receipt",
    };
  }

  private spec(req: PaymentRequirements): SpecPaymentRequirements {
    return {
      scheme: req.scheme,
      network: req.network,
      maxAmountRequired: req.amount,
      resource: req.resource,
      description: req.description ?? "",
      mimeType: "application/json",
      payTo: req.payTo,
      maxTimeoutSeconds: this.config.maxTimeoutSeconds ?? 60,
      asset: req.asset,
      ...(this.config.extra ? { extra: this.config.extra } : {}),
    };
  }

  private headers(): Record<string, string> {
    return { "content-type": "application/json", ...(this.config.headers ?? {}) };
  }

  async settle(xPaymentHeader: string, requirements: PaymentRequirements): Promise<SettlementResult> {
    let paymentPayload: unknown;
    try {
      paymentPayload = JSON.parse(Buffer.from(xPaymentHeader, "base64").toString("utf8"));
    } catch {
      return { settled: false, detail: "invalid X-PAYMENT header (not base64-encoded JSON)" };
    }

    const body = JSON.stringify({
      x402Version: this.x402Version,
      paymentPayload,
      paymentRequirements: this.spec(requirements),
    });

    try {
      // 1) Verify off-chain first — cheap, and avoids attempting settlement on bad payments.
      const verifyRes = await this.fetchImpl(`${this.config.facilitatorUrl}/verify`, {
        method: "POST",
        headers: this.headers(),
        body,
      });
      if (!verifyRes.ok) {
        return { settled: false, detail: `facilitator /verify returned HTTP ${verifyRes.status}` };
      }
      const verify = (await verifyRes.json()) as { isValid?: boolean; invalidReason?: string };
      if (!verify.isValid) {
        return { settled: false, detail: verify.invalidReason ?? "payment failed verification" };
      }

      // 2) Settle on-chain.
      const settleRes = await this.fetchImpl(`${this.config.facilitatorUrl}/settle`, {
        method: "POST",
        headers: this.headers(),
        body,
      });
      if (!settleRes.ok) {
        return { settled: false, detail: `facilitator /settle returned HTTP ${settleRes.status}` };
      }
      const settle = (await settleRes.json()) as {
        success?: boolean;
        transaction?: string;
        errorReason?: string;
      };
      if (!settle.success || !settle.transaction) {
        return { settled: false, detail: settle.errorReason ?? "settlement failed" };
      }
      return { settled: true, txHash: settle.transaction, detail: "settled on-chain" };
    } catch (err) {
      return { settled: false, detail: `facilitator request error: ${(err as Error).message}` };
    }
  }
}
