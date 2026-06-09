import { Hono } from "hono";
import type { Context } from "hono";
import { toPublicJwk, computeId } from "@witnessed/core";
import type { Jwk, PaymentSettlement } from "@witnessed/core";
import { verifyReceipt } from "@witnessed/verifier";
import { LocalSigner } from "./signer";
import type { Signer } from "./signer";
import { InMemoryStore } from "./store";
import type { ReceiptStore } from "./store";
import type { ValidatorRegistry } from "./anchor";
import { makeWitness } from "./witness";
import { paymentRequiredBody } from "./x402";
import type { PaymentFacilitator } from "./x402";
import { serviceManifest, llmsTxt, openApiSpec } from "./manifest";
import { mcpHandler } from "./mcp-http";
import { rateLimit } from "./rate-limit";
import type { RateLimitConfig } from "./rate-limit";

export interface AppConfig {
  /** Local-key mode: provide the witness private JWK and its key id. */
  witnessPrivateJwk?: Jwk;
  witnessKeyId?: string;
  /** KMS/HSM mode: inject a Signer plus the witness PUBLIC JWK (for the /verify trusted set). */
  signer?: Signer;
  witnessPublicJwk?: Jwk;
  now?: () => string;
  /** Inject a durable store (e.g. SqliteStore); defaults to an in-memory store. */
  store?: ReceiptStore;
  /** Anchor validators keyed by anchor type; absent types record verified:false. */
  validators?: ValidatorRegistry;
  /** Enable x402 billing: an unpaid POST /receipts gets a 402; paid requests are recorded. */
  x402?: { facilitator: PaymentFacilitator };
  /** Absolute base URL (e.g. https://witness.medtekki.no) for links in the MCP service_info tool. */
  publicBaseUrl?: string;
  /** Optional per-IP rate limiting (safety ceiling). Absent → no limiting. */
  rateLimit?: RateLimitConfig;
}

function resolveWitness(config: AppConfig): { signer: Signer; keyId: string; publicJwk: Jwk } {
  if (config.signer) {
    if (!config.witnessPublicJwk) {
      throw new Error("witnessPublicJwk is required when injecting a signer");
    }
    return { signer: config.signer, keyId: config.signer.keyId, publicJwk: config.witnessPublicJwk };
  }
  if (!config.witnessPrivateJwk || !config.witnessKeyId) {
    throw new Error("provide either a signer (+witnessPublicJwk) or witnessPrivateJwk+witnessKeyId");
  }
  return {
    signer: new LocalSigner(config.witnessPrivateJwk, config.witnessKeyId),
    keyId: config.witnessKeyId,
    publicJwk: toPublicJwk(config.witnessPrivateJwk),
  };
}

export function createApp(config: AppConfig) {
  const { signer, keyId, publicJwk } = resolveWitness(config);
  const store = config.store ?? new InMemoryStore();
  const now = config.now ?? (() => new Date().toISOString());
  const witness = makeWitness({ signer, store, now, validators: config.validators });
  const trusted: Record<string, Jwk> = { [keyId]: publicJwk };

  const app = new Hono();

  // Per-IP safety ceiling (absent config → no limiting). Registered before all routes.
  if (config.rateLimit) {
    app.use("*", rateLimit(config.rateLimit));
  }

  // Liveness probe for the deployment platform.
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  // The witness public key, so anyone can build a trusted-key set and verify receipts offline.
  app.get("/public-key", (c) => c.json({ key_id: keyId, public_key: publicJwk }));

  // Machine-readable self-description so an agent pointed at the domain can self-onboard.
  const publicBase = (c: Context) =>
    `${c.req.header("x-forwarded-proto") ?? "https"}://${c.req.header("host") ?? "witness.medtekki.no"}`;
  app.get("/", (c) => c.json(serviceManifest({ base: publicBase(c), keyId, publicJwk })));
  app.get("/.well-known/receipts.json", (c) =>
    c.json(serviceManifest({ base: publicBase(c), keyId, publicJwk })),
  );
  app.get("/llms.txt", (c) => c.text(llmsTxt({ base: publicBase(c), keyId })));
  app.get("/openapi.json", (c) => c.json(openApiSpec({ base: publicBase(c) })));

  // Hosted MCP (verify/get/info) over Streamable HTTP. Issuance stays client-side (signing).
  app.all(
    "/mcp",
    mcpHandler({
      store,
      trustedWitnessKeys: trusted,
      info: () =>
        serviceManifest({ base: config.publicBaseUrl ?? "", keyId, publicJwk }),
    }),
  );

  const x402 = config.x402;

  app.post("/receipts", async (c) => {
    const { claim, agent_sig } = await c.req.json();

    let payment: PaymentSettlement | null = null;
    if (x402) {
      // Bind the payment to this exact receipt via the claim's content hash.
      const nonce = computeId(claim);
      const requirements = x402.facilitator.requirements("/receipts", nonce);
      const header = c.req.header("X-PAYMENT");
      if (!header) {
        return c.json(paymentRequiredBody(requirements), 402);
      }
      const settlement = await x402.facilitator.settle(header, requirements);
      if (!settlement.settled || !settlement.txHash) {
        return c.json(paymentRequiredBody(requirements, settlement.detail), 402);
      }
      payment = {
        scheme: requirements.scheme,
        network: requirements.network,
        asset: requirements.asset,
        amount: requirements.amount,
        payTo: requirements.payTo,
        tx_hash: settlement.txHash,
      };
      c.header("X-PAYMENT-RESPONSE", JSON.stringify({ txHash: settlement.txHash }));
    }

    try {
      const receipt = await witness({ claim, agent_sig, payment });
      return c.json(receipt, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/receipts/:id", async (c) => {
    const receipt = await store.get(c.req.param("id"));
    return receipt ? c.json(receipt) : c.json({ error: "not found" }, 404);
  });

  app.post("/verify", async (c) => {
    const receipt = await c.req.json();
    return c.json(verifyReceipt(receipt, trusted));
  });

  return app;
}
