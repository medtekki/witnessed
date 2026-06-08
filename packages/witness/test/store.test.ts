import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../src/store";
import type { Receipt } from "@witnessed/core";

const fake = (id: string) => ({ id }) as Receipt;

describe("InMemoryStore", () => {
  it("stores and retrieves by id", async () => {
    const store = new InMemoryStore();
    await store.put(fake("abc"));
    expect((await store.get("abc"))?.id).toBe("abc");
  });

  it("returns null for a missing id", async () => {
    expect(await new InMemoryStore().get("nope")).toBeNull();
  });

  it("is append-only: rejects overwriting an existing id", async () => {
    const store = new InMemoryStore();
    await store.put(fake("dup"));
    await expect(store.put(fake("dup"))).rejects.toThrow(/append-only|exists/i);
  });
});
