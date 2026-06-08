import {
  sign as nodeSign,
  verify as nodeVerify,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import type { JsonWebKey as CryptoJsonWebKey } from "node:crypto";
import type { Jwk } from "./types";

export function sign(message: string, privateJwk: Jwk): string {
  const key = createPrivateKey({ key: privateJwk as unknown as CryptoJsonWebKey, format: "jwk" });
  const sig = nodeSign(null, Buffer.from(message, "utf8"), key);
  return sig.toString("base64url");
}

export function verifySig(message: string, signatureB64u: string, publicJwk: Jwk): boolean {
  try {
    const key = createPublicKey({ key: publicJwk as unknown as CryptoJsonWebKey, format: "jwk" });
    return nodeVerify(
      null,
      Buffer.from(message, "utf8"),
      key,
      Buffer.from(signatureB64u, "base64url"),
    );
  } catch {
    return false;
  }
}
