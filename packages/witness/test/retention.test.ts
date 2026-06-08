import { describe, it, expect } from "vitest";
import type { Receipt } from "@witnessed/core";
import { SqliteStore } from "../src/sqlite-store";

/** A structurally-complete receipt (signatures irrelevant to retention metadata). */
function rec(id: string, witnessed_at: string, agentKeyId = "agentX"): Receipt {
  return {
    version: 1,
    issued_at: witnessed_at,
    agent: { key_id: agentKeyId, public_key: { kty: "OKP", crv: "Ed25519", x: "x" } },
    action: { type: "email.send", description: "x" },
    payload_digest: null,
    anchor: null,
    prev: [],
    id,
    agent_sig: "sig",
    witness: { witnessed_at, witness_key_id: "w", witness_sig: "s", anchor_check: null, payment: null },
  };
}

describe("retention", () => {
  it("computes retain_until = witnessed_at + minimumDays", async () => {
    const store = new SqliteStore(":memory:", { minimumDays: 180 });
    await store.put(rec("a", "2026-01-01T00:00:00.000Z"));
    const meta = await store.getMeta("a");
    expect(meta?.retain_until).toBe("2026-06-30T00:00:00.000Z"); // +180 days
    store.close();
  });

  it("keeps records indefinitely (retain_until null) when no policy is set", async () => {
    const store = new SqliteStore(":memory:");
    await store.put(rec("a", "2020-01-01T00:00:00.000Z"));
    expect((await store.getMeta("a"))?.retain_until).toBeNull();
    const result = await store.purgeExpired("2099-01-01T00:00:00.000Z");
    expect(result.purged).toEqual([]);
    expect(await store.get("a")).not.toBeNull();
    store.close();
  });

  it("does not purge before retain_until, purges after", async () => {
    const store = new SqliteStore(":memory:", { minimumDays: 180 });
    await store.put(rec("a", "2026-01-01T00:00:00.000Z")); // retain_until 2026-06-30

    const early = await store.purgeExpired("2026-03-01T00:00:00.000Z");
    expect(early.purged).toEqual([]);
    expect(await store.get("a")).not.toBeNull();

    const late = await store.purgeExpired("2026-12-01T00:00:00.000Z");
    expect(late.purged).toEqual(["a"]);
    expect(await store.get("a")).toBeNull();
    store.close();
  });
});

describe("legal hold", () => {
  it("exempts held records from purge and reports them, until released", async () => {
    const store = new SqliteStore(":memory:", { minimumDays: 180 });
    await store.put(rec("held", "2026-01-01T00:00:00.000Z"));

    expect(await store.placeLegalHold("held", "litigation matter #7")).toBe(true);
    expect((await store.getMeta("held"))?.legal_hold).toBe(true);
    expect((await store.getMeta("held"))?.legal_hold_reason).toBe("litigation matter #7");

    const result = await store.purgeExpired("2026-12-01T00:00:00.000Z");
    expect(result.purged).toEqual([]);
    expect(result.retainedUnderHold).toEqual(["held"]);
    expect(await store.get("held")).not.toBeNull(); // survived despite being past retain_until

    expect(await store.releaseLegalHold("held")).toBe(true);
    const after = await store.purgeExpired("2026-12-01T00:00:00.000Z");
    expect(after.purged).toEqual(["held"]);
    store.close();
  });

  it("placeLegalHold returns false for an unknown id", async () => {
    const store = new SqliteStore(":memory:", { minimumDays: 180 });
    expect(await store.placeLegalHold("nope", "x")).toBe(false);
    store.close();
  });
});

describe("list filters", () => {
  it("filters by time range and agent, ordered by witnessed_at", async () => {
    const store = new SqliteStore(":memory:");
    await store.put(rec("c", "2026-03-01T00:00:00.000Z", "agentA"));
    await store.put(rec("a", "2026-01-01T00:00:00.000Z", "agentA"));
    await store.put(rec("b", "2026-02-01T00:00:00.000Z", "agentB"));

    const all = await store.list();
    expect(all.map((r) => r.id)).toEqual(["a", "b", "c"]); // sorted by witnessed_at

    const ranged = await store.list({
      from: "2026-01-15T00:00:00.000Z",
      to: "2026-02-15T00:00:00.000Z",
    });
    expect(ranged.map((r) => r.id)).toEqual(["b"]);

    const byAgent = await store.list({ agentKeyId: "agentA" });
    expect(byAgent.map((r) => r.id)).toEqual(["a", "c"]);
    store.close();
  });
});
