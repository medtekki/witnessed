import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint } from "@witnessed/core";
import { createApp } from "@witnessed/witness/src/http";
import { ReceiptsClient } from "../src/client";

function appFetch() {
  const wkp = generateKeyPair();
  const app = createApp({
    witnessPrivateJwk: wkp.privateJwk,
    witnessKeyId: thumbprint(wkp.publicJwk),
    now: () => "2026-06-03T14:03:01Z",
  });
  const fetchImpl = (url: string, init?: RequestInit) =>
    app.request(url.replace("http://witness", ""), init as any);
  const trusted = { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) };
  return { fetchImpl, trusted };
}

describe("ReceiptsClient", () => {
  it("issues a receipt the SDK can then verify", async () => {
    const { fetchImpl, trusted } = appFetch();
    const kp = generateKeyPair();
    const client = new ReceiptsClient({
      baseUrl: "http://witness",
      privateJwk: kp.privateJwk,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const receipt = await client.issueReceipt({
      action: { type: "email.send", description: "Sent confirmation" },
      issued_at: "2026-06-03T14:03:00Z",
    });

    expect(receipt.action.type).toBe("email.send");
    expect(receipt.agent.key_id).toBe(thumbprint(kp.publicJwk));
    expect(client.verify(receipt, trusted).valid).toBe(true);
  });

  it("generateKey returns a usable keypair", () => {
    const { publicJwk, privateJwk } = ReceiptsClient.generateKey();
    expect(publicJwk.crv).toBe("Ed25519");
    expect(privateJwk.d).toBeTruthy();
  });
});
