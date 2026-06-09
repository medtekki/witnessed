import { serve } from "@hono/node-server";
import { thumbprint, toPublicJwk } from "@witnessed/core";
import type { Jwk } from "@witnessed/core";
import { createApp } from "./http";
import { SqliteStore } from "./sqlite-store";
import { HttpFacilitator } from "./x402-facilitator";

/**
 * Production-ish entrypoint for the witness service. Configured entirely from environment
 * variables so it deploys to any container host. Run with: `tsx packages/witness/src/server.ts`.
 *
 * Required:
 *   WITNESS_PRIVATE_JWK  Ed25519 private key as a JWK JSON string (generate with gen-key.ts).
 * Optional:
 *   PORT                 default 8787
 *   RECEIPTS_DB          SQLite path for durable storage (omit -> in-memory, non-durable)
 *   RETENTION_DAYS       enable retention with this minimum window (e.g. 180)
 *   X402_FACILITATOR_URL + X402_NETWORK + X402_ASSET + X402_PAY_TO + X402_AMOUNT
 *                        enable x402 billing (all five required together)
 *   RL_ENABLED           rate limiting on/off (default "true"; set "false" to disable)
 *   RL_WRITE_PER_MIN     per-IP writes/min: POST /receipts, /verify, /mcp (default 30)
 *   RL_READ_PER_MIN      per-IP reads/min (default 120)
 *   RL_GLOBAL_WRITE_PER_MIN  process-wide writes/min across all IPs (default 300; 0 = off)
 *
 * BETA NOTE: holding the private key in an env var (your host's secret store) is acceptable for
 * a labelled beta. Before charging real money / handling regulated data, move signing to a
 * KMS/HSM via `@witnessed/gcp-kms` + `KmsSigner` (the Signer is already pluggable).
 */
export interface ServerOptions {
  env?: NodeJS.ProcessEnv;
}

export function buildConfigFromEnv(env: NodeJS.ProcessEnv) {
  const raw = env.WITNESS_PRIVATE_JWK;
  if (!raw) {
    throw new Error(
      "WITNESS_PRIVATE_JWK is required. Generate one with `tsx packages/witness/src/gen-key.ts`.",
    );
  }
  const witnessPrivateJwk = JSON.parse(raw) as Jwk;

  // key_id is the public-key thumbprint (override with WITNESS_KEY_ID only to pin a value).
  const config: Parameters<typeof createApp>[0] = {
    witnessPrivateJwk,
    witnessKeyId: env.WITNESS_KEY_ID ?? thumbprint(toPublicJwk(witnessPrivateJwk)),
    publicBaseUrl: env.WITNESS_PUBLIC_URL,
  };

  if (env.RECEIPTS_DB) {
    config.store = new SqliteStore(
      env.RECEIPTS_DB,
      env.RETENTION_DAYS ? { minimumDays: Number(env.RETENTION_DAYS) } : undefined,
    );
  }

  const { X402_FACILITATOR_URL, X402_NETWORK, X402_ASSET, X402_PAY_TO, X402_AMOUNT } = env;
  if (X402_FACILITATOR_URL && X402_NETWORK && X402_ASSET && X402_PAY_TO && X402_AMOUNT) {
    config.x402 = {
      facilitator: new HttpFacilitator({
        facilitatorUrl: X402_FACILITATOR_URL,
        network: X402_NETWORK,
        asset: X402_ASSET,
        payTo: X402_PAY_TO,
        maxAmountRequired: X402_AMOUNT,
      }),
    };
  }

  // Parse a non-negative integer limit, falling back to the default if unset or malformed
  // (a typo like RL_WRITE_PER_MIN=on must not silently brick a tier by making every request 429).
  const limit = (raw: string | undefined, dflt: number): number => {
    const n = Number(raw);
    return raw !== undefined && Number.isFinite(n) && n >= 0 ? n : dflt;
  };
  config.rateLimit = {
    enabled: (env.RL_ENABLED ?? "true") !== "false",
    writePerMin: limit(env.RL_WRITE_PER_MIN, 30),
    readPerMin: limit(env.RL_READ_PER_MIN, 120),
    globalWritePerMin: limit(env.RL_GLOBAL_WRITE_PER_MIN, 300),
  };

  return config;
}

export function startServer(options: ServerOptions = {}) {
  const env = options.env ?? process.env;
  const app = createApp(buildConfigFromEnv(env));
  const port = Number(env.PORT ?? 8787);
  serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`witness listening on :${port}`);
  return app;
}

// Run when invoked directly (tsx/node), not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
