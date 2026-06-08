import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { ReceiptsClient } from "@witnessed/sdk";
import { thumbprint, toPublicJwk } from "@witnessed/core";
import type { Jwk } from "@witnessed/core";

/**
 * Resolve the agent's signing key for the CLI: from $WITNESS_AGENT_JWK, else a key file
 * ($WITNESS_AGENT_KEY_FILE or ~/.witnessed/agent.jwk), auto-generated + persisted on first run
 * so the agent keeps a stable identity across runs.
 */
export function loadAgentKey(env: NodeJS.ProcessEnv = process.env): {
  privateJwk: Jwk;
  keyId: string;
  source: string;
} {
  if (env.WITNESS_AGENT_JWK) {
    const privateJwk = JSON.parse(env.WITNESS_AGENT_JWK) as Jwk;
    return { privateJwk, keyId: thumbprint(toPublicJwk(privateJwk)), source: "env" };
  }
  const keyFile = env.WITNESS_AGENT_KEY_FILE ?? join(homedir(), ".witnessed", "agent.jwk");
  if (existsSync(keyFile)) {
    const privateJwk = JSON.parse(readFileSync(keyFile, "utf8")) as Jwk;
    return { privateJwk, keyId: thumbprint(toPublicJwk(privateJwk)), source: keyFile };
  }
  const { privateJwk } = ReceiptsClient.generateKey();
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, JSON.stringify(privateJwk), { mode: 0o600 });
  try {
    chmodSync(keyFile, 0o600);
  } catch {
    /* best effort */
  }
  return { privateJwk, keyId: thumbprint(toPublicJwk(privateJwk)), source: `${keyFile} (new)` };
}
