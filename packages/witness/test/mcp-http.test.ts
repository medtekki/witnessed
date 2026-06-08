import { describe, it, expect } from "vitest";
import { generateKeyPair, thumbprint } from "@witnessed/core";
import { createApp } from "../src/http";
import { buildHostedMcpServer } from "../src/mcp-http";
import { InMemoryStore } from "../src/store";

describe("hosted MCP", () => {
  it("builds an MCP server with the keyless tools without throwing", () => {
    const server = buildHostedMcpServer({
      store: new InMemoryStore(),
      trustedWitnessKeys: {},
      info: () => ({ service: "receipts" }),
    });
    expect(server).toBeTruthy();
  });

  it("/mcp is mounted but reports it needs the Node runtime when called without it", async () => {
    // app.request() (used in tests) does not supply the raw Node req/res the transport needs.
    const wkp = generateKeyPair();
    const app = createApp({ witnessPrivateJwk: wkp.privateJwk, witnessKeyId: thumbprint(wkp.publicJwk) });
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Node server runtime/i);
  });
});
