import { describe, it, expect } from "vitest";
import { generateKeyPair, toPublicJwk } from "../src/keys";
import { sign, verifySig } from "../src/crypto";

describe("crypto", () => {
  it("verifies a signature it produced", () => {
    const { publicJwk, privateJwk } = generateKeyPair();
    const sig = sign("the message", privateJwk);
    expect(verifySig("the message", sig, toPublicJwk(publicJwk))).toBe(true);
  });

  it("rejects a tampered message", () => {
    const { publicJwk, privateJwk } = generateKeyPair();
    const sig = sign("the message", privateJwk);
    expect(verifySig("the messagE", sig, toPublicJwk(publicJwk))).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const sig = sign("m", a.privateJwk);
    expect(verifySig("m", sig, toPublicJwk(b.publicJwk))).toBe(false);
  });
});
