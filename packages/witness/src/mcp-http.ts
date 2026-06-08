import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { Context } from "hono";
import { verifyReceipt } from "@witnessed/verifier";
import type { Jwk, Receipt } from "@witnessed/core";
import type { ReceiptStore } from "./store";

export interface HostedMcpDeps {
  store: ReceiptStore;
  trustedWitnessKeys: Record<string, Jwk>;
  /** Returns the service manifest for the `service_info` tool. */
  info: () => unknown;
}

/**
 * The hosted MCP server. Exposes only keyless, remote-safe operations: verify a receipt, fetch
 * one by id, and describe the service. Issuance is intentionally NOT here — it requires
 * client-side signing with the agent's own key (do that with the SDK locally).
 */
export function buildHostedMcpServer(deps: HostedMcpDeps): McpServer {
  const server = new McpServer({ name: "receipts-witness", version: "0" });

  server.tool("verify_receipt", { receipt: z.any() }, async (args) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(verifyReceipt(args.receipt as Receipt, deps.trustedWitnessKeys)),
      },
    ],
  }));

  server.tool("get_receipt", { id: z.string() }, async (args) => {
    const r = await deps.store.get(args.id);
    return {
      content: [{ type: "text", text: JSON.stringify(r ?? { error: "not found", id: args.id }) }],
    };
  });

  server.tool("service_info", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(deps.info()) }],
  }));

  return server;
}

/**
 * Hono handler serving MCP over Streamable HTTP (stateless). Requires the Node server runtime
 * (`@hono/node-server`), which provides the raw req/res the transport writes to.
 */
export function mcpHandler(deps: HostedMcpDeps) {
  return async (c: Context) => {
    const env = (c.env ?? {}) as { incoming?: unknown; outgoing?: unknown };
    if (!env.incoming || !env.outgoing) {
      return c.json({ error: "MCP endpoint requires the Node server runtime" }, 500);
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildHostedMcpServer(deps);
    // Clean up per-request (stateless) when the response closes.
    const outgoing = env.outgoing as { on(ev: string, cb: () => void): void };
    outgoing.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    const body = c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await transport.handleRequest(env.incoming as any, env.outgoing as any, body);
    return RESPONSE_ALREADY_SENT as unknown as Response;
  };
}
