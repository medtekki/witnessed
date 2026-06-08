import canonicalizeFn from "canonicalize";
import { createHash } from "node:crypto";

export function canonical(value: unknown): string {
  const out = canonicalizeFn(value as object);
  if (out === undefined) throw new Error("value is not canonicalizable");
  return out;
}

export const b64u = {
  encode(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64url");
  },
  decode(s: string): Uint8Array {
    return new Uint8Array(Buffer.from(s, "base64url"));
  },
};

export function sha256b64u(data: string | Uint8Array): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return createHash("sha256").update(buf).digest("base64url");
}
