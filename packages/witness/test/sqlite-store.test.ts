import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { generateKeyPair, toPublicJwk, thumbprint, buildClaim, signClaim } from "@witnessed/core";
import type { Receipt } from "@witnessed/core";
import { SqliteStore } from "../src/sqlite-store";
import { createApp } from "../src/http";

const fake = (id: string) => ({ id, witness: { witnessed_at: "2026-06-03T00:00:00Z" } }) as Receipt;

const tempFiles: string[] = [];
function tempDbPath() {
  const p = join(tmpdir(), `receipts-test-${process.pid}-${tempFiles.length}-${Date.now()}.db`);
  tempFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tempFiles.splice(0)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        rmSync(p + suffix);
      } catch {
        /* ignore */
      }
    }
  }
});

describe("SqliteStore", () => {
  it("stores and retrieves by id", async () => {
    const store = new SqliteStore(":memory:");
    await store.put(fake("abc"));
    expect((await store.get("abc"))?.id).toBe("abc");
    store.close();
  });

  it("returns null for a missing id", async () => {
    const store = new SqliteStore(":memory:");
    expect(await store.get("nope")).toBeNull();
    store.close();
  });

  it("is append-only: rejects overwriting an existing id", async () => {
    const store = new SqliteStore(":memory:");
    await store.put(fake("dup"));
    await expect(store.put(fake("dup"))).rejects.toThrow(/append-only|exists/i);
    store.close();
  });

  it("is durable: data survives a fresh store instance on the same file", async () => {
    const path = tempDbPath();
    const first = new SqliteStore(path);
    await first.put(fake("persisted"));
    first.close();

    const second = new SqliteStore(path);
    expect((await second.get("persisted"))?.id).toBe("persisted");
    second.close();
  });

  it("works as the injected store for the HTTP app, and the receipt persists", async () => {
    const path = tempDbPath();
    const wkp = generateKeyPair();
    const store = new SqliteStore(path);
    const app = createApp({
      witnessPrivateJwk: wkp.privateJwk,
      witnessKeyId: thumbprint(wkp.publicJwk),
      now: () => "2026-06-03T14:03:01Z",
      store,
    });

    const kp = generateKeyPair();
    const agent = { key_id: thumbprint(kp.publicJwk), public_key: toPublicJwk(kp.publicJwk) };
    const claim = buildClaim({
      issued_at: "2026-06-03T14:03:00Z",
      agent,
      action: { type: "email.send", description: "x" },
      payload_digest: null,
    });
    const post = await app.request("/receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim, agent_sig: signClaim(claim, kp.privateJwk) }),
    });
    expect(post.status).toBe(201);
    const id = (await post.json()).id;
    store.close();

    // Re-open the DB independently — the witnessed receipt is still there.
    const reopened = new SqliteStore(path);
    expect((await reopened.get(id))?.id).toBe(id);
    reopened.close();
  });
});
