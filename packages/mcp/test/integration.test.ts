import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generateKeyPair, toPublicJwk, thumbprint } from "@witnessed/core";
import { createApp } from "@witnessed/witness/src/http";
import { ReceiptsClient } from "@witnessed/sdk";
import { createMcpServer } from "../src/server";

/** Stand up a witness app, an SDK client wired to it, and the MCP server deps. */
function deps() {
  const wkp = generateKeyPair();
  const app = createApp({
    witnessPrivateJwk: wkp.privateJwk,
    witnessKeyId: thumbprint(wkp.publicJwk),
    now: () => "2026-06-03T14:03:01Z",
  });
  const fetchImpl = ((url: string, init?: RequestInit) =>
    app.request(url.replace("http://witness", ""), init as any)) as unknown as typeof fetch;
  const client = new ReceiptsClient({
    baseUrl: "http://witness",
    privateJwk: generateKeyPair().privateJwk,
    fetchImpl,
  });
  return { client, trustedWitnessKeys: { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) } };
}

/** Connect a real MCP Client to our server over a linked in-memory transport pair. */
async function connectClient() {
  const server = createMcpServer(deps());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: any) {
  return JSON.parse(result.content[0].text);
}

describe("MCP live protocol", () => {
  it("advertises both tools over tools/list", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["issue_receipt", "verify_receipt"]);
    await client.close();
  });

  it("issue_receipt then verify_receipt round-trips over the wire", async () => {
    const client = await connectClient();

    const issued = textOf(
      await client.callTool({
        name: "issue_receipt",
        arguments: { action_type: "email.send", description: "Sent confirmation" },
      }),
    );
    expect(issued.receipt.action.type).toBe("email.send");
    expect(issued.receipt.witness.witnessed_at).toBe("2026-06-03T14:03:01Z");

    const verified = textOf(
      await client.callTool({
        name: "verify_receipt",
        arguments: { receipt: issued.receipt },
      }),
    );
    expect(verified.valid).toBe(true);

    await client.close();
  });
});
