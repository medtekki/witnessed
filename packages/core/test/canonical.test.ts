import { describe, it, expect } from "vitest";
import { canonical, sha256b64u, b64u } from "../src/canonical";

describe("canonical", () => {
  it("produces identical strings regardless of key order", () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  });

  it("sha256b64u is deterministic and base64url (no +/= chars)", () => {
    const h = sha256b64u("hello");
    expect(h).toBe(sha256b64u("hello"));
    expect(h).not.toMatch(/[+/=]/);
  });

  it("b64u round-trips bytes", () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect(b64u.decode(b64u.encode(bytes))).toEqual(bytes);
  });
});
