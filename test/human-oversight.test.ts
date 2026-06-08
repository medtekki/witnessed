import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  toPublicJwk,
  thumbprint,
  HUMAN_APPROVAL,
  HUMAN_REJECTION,
  isHumanDecision,
} from "@witnessed/core";
import { createApp } from "@witnessed/witness/src/http";
import { ReceiptsClient } from "@witnessed/sdk";
import { verifyChain } from "@witnessed/verifier";

function setup() {
  const wkp = generateKeyPair();
  const app = createApp({
    witnessPrivateJwk: wkp.privateJwk,
    witnessKeyId: thumbprint(wkp.publicJwk),
    now: () => "2026-06-04T10:00:01Z",
  });
  const fetchImpl = ((url: string, init?: RequestInit) =>
    app.request(url.replace("http://witness", ""), init as any)) as unknown as typeof fetch;

  const agent = new ReceiptsClient({
    baseUrl: "http://witness",
    privateJwk: generateKeyPair().privateJwk,
    fetchImpl,
  });
  const reviewer = new ReceiptsClient({
    baseUrl: "http://witness",
    privateJwk: generateKeyPair().privateJwk,
    fetchImpl,
  });
  const trusted = { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) };
  return { agent, reviewer, trusted };
}

describe("human oversight chain", () => {
  it("links a human approval to the agent's action in one verifiable chain", async () => {
    const { agent, reviewer, trusted } = setup();

    const action = await agent.issueReceipt({
      action: { type: "ehr.write", description: "Wrote progress note" },
    });
    const approval = await reviewer.approve(action.id, "Reviewed — clinically correct");

    // Shape of the oversight receipt
    expect(approval.action.type).toBe(HUMAN_APPROVAL);
    expect(isHumanDecision(approval.action.type)).toBe(true);
    expect(approval.prev).toEqual([action.id]);
    // Signed by the reviewer's key, NOT the agent's — independent oversight.
    expect(approval.agent.key_id).not.toBe(action.agent.key_id);

    const chain = verifyChain([action, approval], trusted);
    expect(chain.valid).toBe(true);
  });

  it("supports a rejection decision", async () => {
    const { agent, reviewer, trusted } = setup();
    const action = await agent.issueReceipt({
      action: { type: "payment.send", description: "Pay invoice #42" },
    });
    const rejection = await reviewer.reject(action.id, "Amount exceeds policy");

    expect(rejection.action.type).toBe(HUMAN_REJECTION);
    expect(rejection.prev).toEqual([action.id]);
    expect(verifyChain([action, rejection], trusted).valid).toBe(true);
  });

  it("breaks the chain if the reviewed action is tampered after approval", async () => {
    const { agent, reviewer, trusted } = setup();
    const action = await agent.issueReceipt({
      action: { type: "ehr.write", description: "Wrote progress note" },
    });
    const approval = await reviewer.approve(action.id, "Looks correct");

    const tamperedAction = { ...action, action: { ...action.action, description: "Wrote DIFFERENT note" } };
    const chain = verifyChain([tamperedAction, approval], trusted);
    expect(chain.valid).toBe(false);
    expect(chain.results[action.id].valid).toBe(false);
  });

  it("fails verification if the approval is presented without the action it references", async () => {
    const { agent, reviewer, trusted } = setup();
    const action = await agent.issueReceipt({
      action: { type: "ehr.write", description: "Wrote progress note" },
    });
    const approval = await reviewer.approve(action.id, "Looks correct");

    const chain = verifyChain([approval], trusted); // missing the action receipt
    expect(chain.valid).toBe(false);
    expect(chain.issues.join(" ")).toMatch(/missing predecessor/);
  });
});
