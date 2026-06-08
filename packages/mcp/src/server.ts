import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ReceiptsClient } from "@witnessed/sdk";
import type { Jwk, Receipt } from "@witnessed/core";

export interface HandlerDeps {
  client: ReceiptsClient;
  trustedWitnessKeys: Record<string, Jwk>;
}

/** Pure, directly-testable tool handlers. */
export function makeHandlers(deps: HandlerDeps) {
  return {
    async issue_receipt(args: {
      action_type: string;
      description: string;
      payload_digest?: string | null;
    }) {
      const receipt = await deps.client.issueReceipt({
        action: { type: args.action_type, description: args.description },
        payload_digest: args.payload_digest ?? null,
      });
      return { receipt };
    },
    async verify_receipt(args: { receipt: Receipt }) {
      return deps.client.verify(args.receipt, deps.trustedWitnessKeys);
    },
  };
}

/** Wires the handlers into an MCP server over stdio. */
export function createMcpServer(deps: HandlerDeps): McpServer {
  const handlers = makeHandlers(deps);
  const server = new McpServer({ name: "receipts", version: "0.0.0" });

  server.tool(
    "issue_receipt",
    {
      action_type: z.string(),
      description: z.string(),
      payload_digest: z.string().nullable().optional(),
    },
    async (args) => ({
      content: [{ type: "text", text: JSON.stringify(await handlers.issue_receipt(args)) }],
    }),
  );

  server.tool("verify_receipt", { receipt: z.any() }, async (args) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(await handlers.verify_receipt(args as { receipt: Receipt })),
      },
    ],
  }));

  return server;
}

export async function start(deps: HandlerDeps): Promise<void> {
  const server = createMcpServer(deps);
  await server.connect(new StdioServerTransport());
}
