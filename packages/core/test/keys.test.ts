import { describe, it, expect } from "vitest";
import { generateKeyPair, thumbprint } from "../src/keys";

describe("keys", () => {
  it("generates an Ed25519 keypair as JWKs", () => {
    const { publicJwk, privateJwk } = generateKeyPair();
    expect(publicJwk.kty).toBe("OKP");
    expect(publicJwk.crv).toBe("Ed25519");
    expect(typeof publicJwk.x).toBe("string");
    expect(publicJwk.d).toBeUndefined(); // public must not leak `d`
    expect(typeof privateJwk.d).toBe("string"); // private holds `d`
  });

  it("thumbprint is stable and ignores `d`", () => {
    const { publicJwk, privateJwk } = generateKeyPair();
    expect(thumbprint(publicJwk)).toBe(thumbprint(privateJwk));
  });

  it("different keys have different thumbprints", () => {
    expect(thumbprint(generateKeyPair().publicJwk)).not.toBe(
      thumbprint(generateKeyPair().publicJwk),
    );
  });
});
