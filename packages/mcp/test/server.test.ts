import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint } from "@witnessed/core";
import { createApp } from "@witnessed/witness/src/http";
import { ReceiptsClient } from "@witnessed/sdk";
import { makeHandlers } from "../src/server";

function handlers() {
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
  const trusted = { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) };
  return makeHandlers({ client, trustedWitnessKeys: trusted });
}

describe("mcp handlers", () => {
  it("issue_receipt then verify_receipt round-trips", async () => {
    const h = handlers();
    const issued = await h.issue_receipt({
      action_type: "email.send",
      description: "Sent confirmation",
    });
    expect(issued.receipt.action.type).toBe("email.send");

    const verified = await h.verify_receipt({ receipt: issued.receipt });
    expect(verified.valid).toBe(true);
  });
});
