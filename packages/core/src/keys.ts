import { generateKeyPairSync, createHash } from "node:crypto";
import type { Jwk } from "./types";

export function generateKeyPair(): { publicJwk: Jwk; privateJwk: Jwk } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" }) as unknown as Jwk;
  const privateJwk = privateKey.export({ format: "jwk" }) as unknown as Jwk;
  return { publicJwk, privateJwk };
}

/** Returns the public half only (strips `d`). */
export function toPublicJwk(jwk: Jwk): Jwk {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
}

/** RFC 7638-style thumbprint over the public members, base64url. */
export function thumbprint(jwk: Jwk): string {
  const canonicalMembers = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return createHash("sha256").update(canonicalMembers, "utf8").digest("base64url");
}
