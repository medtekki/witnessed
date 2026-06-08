import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk, thumbprint } from "@witnessed/core";
import type { Anchor } from "@witnessed/core";
import { createApp } from "../src/http";
import { EmailMessageIdValidator } from "../src/anchor";
import { SqliteStore } from "../src/sqlite-store";
import { buildArticle12Export } from "../src/export";
import { ReceiptsClient } from "@witnessed/sdk";

const emailAnchor: Anchor = { type: "email.message_id", value: "<abc@mail.example.com>" };

async function scenario() {
  const wkp = generateKeyPair();
  const trusted = { [thumbprint(wkp.publicJwk)]: toPublicJwk(wkp.publicJwk) };
  const store = new SqliteStore(":memory:", { minimumDays: 180 });
  const app = createApp({
    witnessPrivateJwk: wkp.privateJwk,
    witnessKeyId: thumbprint(wkp.publicJwk),
    now: () => "2026-06-04T10:00:01.000Z",
    store,
    validators: { "email.message_id": new EmailMessageIdValidator(async () => ({ found: true })) },
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

  const action = await agent.issueReceipt({
    action: { type: "email.send", description: "Sent appointment confirmation" },
    anchor: emailAnchor,
  });
  await reviewer.approve(action.id, "Reviewed — appropriate");

  return { trusted, store, actionId: action.id };
}

const opts = {
  system: { name: "Triage Assistant", provider: "Acme Health", version: "1.0.0" },
  generated_at: "2026-06-04T12:00:00.000Z",
  scope: "all receipts",
  retention: { minimum_days: 180 },
};

describe("Article 12 export", () => {
  it("produces a verified, ordered event log with an explicit disclaimer", async () => {
    const { trusted, store, actionId } = await scenario();
    const exp = buildArticle12Export(await store.list(), trusted, opts);

    expect(exp.format).toBe("receipts.article12.v0");
    expect(exp.disclaimer).toMatch(/counsel/i);
    expect(exp.disclaimer).toMatch(/Article 12/);
    expect(exp.system.provider).toBe("Acme Health");
    expect(exp.retention).toEqual({ minimum_days: 180 });

    expect(exp.integrity_summary).toMatchObject({
      total: 2,
      all_valid: true,
      invalid_ids: [],
      chain_complete: true,
      chain_issues: [],
    });
    expect(exp.events.map((e) => e.sequence)).toEqual([1, 2]);

    const action = exp.events.find((e) => e.event_type === "email.send")!;
    expect(action.effect.anchor).toEqual(emailAnchor);
    expect(action.effect.verified).toBe(true);
    expect(action.human_oversight).toBe(false);
    expect(action.integrity.signature_valid).toBe(true);

    const approval = exp.events.find((e) => e.event_type === "human.approval")!;
    expect(approval.human_oversight).toBe(true);
    expect(approval.chain.prev).toEqual([actionId]);
    expect(approval.integrity.signature_valid).toBe(true);
  });

  it("flags tampering in the integrity summary", async () => {
    const { trusted, store } = await scenario();
    const receipts = await store.list();
    const tampered = receipts.map((r) =>
      r.action.type === "email.send"
        ? { ...r, action: { ...r.action, description: "Sent something ELSE" } }
        : r,
    );

    const exp = buildArticle12Export(tampered, trusted, opts);
    expect(exp.integrity_summary.all_valid).toBe(false);
    expect(exp.integrity_summary.invalid_ids.length).toBe(1);

    const bad = exp.events.find((e) => e.event_type === "email.send")!;
    expect(bad.integrity.signature_valid).toBe(false);
    expect(bad.integrity.reason).toMatch(/id|signature/i);
  });
});
