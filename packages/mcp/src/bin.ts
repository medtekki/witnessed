import { ReceiptsClient } from "@witnessed/sdk";
import type { Jwk } from "@witnessed/core";
import { start } from "./server";
import { loadAgentKey } from "./agent-key";

/**
 * `npx @witnessed/mcp` — a local MCP server (stdio) for an agent. Unlike the hosted /mcp, this runs
 * on the agent's machine, so it CAN issue: it signs the claim with the agent's OWN key, then
 * witnesses it at the configured witness. Config via env: WITNESS_URL (default
 * https://witness.medtekki.no), WITNESS_AGENT_JWK / WITNESS_AGENT_KEY_FILE. All diagnostics go to
 * stderr — stdout is the MCP JSON-RPC channel.
 *
 * This file is the executable entry: it always runs `main()`. The importable helper lives in
 * `./agent-key` so nothing imports this module (which would start a server).
 */
async function main(): Promise<void> {
  const baseUrl = process.env.WITNESS_URL ?? "https://witness.medtekki.no";
  const { privateJwk, keyId, source } = loadAgentKey();
  console.error(`[witnessed-mcp] witness=${baseUrl} agent_key_id=${keyId} key=${source}`);

  let trustedWitnessKeys: Record<string, Jwk> = {};
  try {
    const pk = (await (await fetch(`${baseUrl}/public-key`)).json()) as {
      key_id: string;
      public_key: Jwk;
    };
    trustedWitnessKeys = { [pk.key_id]: pk.public_key };
  } catch (err) {
    console.error(
      `[witnessed-mcp] warning: could not fetch witness key from ${baseUrl}: ${(err as Error).message}`,
    );
  }

  await start({ client: new ReceiptsClient({ baseUrl, privateJwk }), trustedWitnessKeys });
  console.error("[witnessed-mcp] ready on stdio (tools: issue_receipt, verify_receipt)");
}

main().catch((err) => {
  console.error("[witnessed-mcp] fatal:", err);
  process.exit(1);
});
