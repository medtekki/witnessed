import { createPublicKey } from "node:crypto";
import { toPublicJwk, thumbprint } from "@witnessed/core";
import type { Jwk } from "@witnessed/core";
import { crc32c } from "./crc32c";

/**
 * Minimal structural view of the Cloud KMS client — only the two calls we make. The real
 * `@google-cloud/kms` `KeyManagementServiceClient` satisfies this (see `client.ts`); tests
 * inject a fake. `name` is a crypto key VERSION resource:
 * `projects/P/locations/L/keyRings/R/cryptoKeys/K/cryptoKeyVersions/V`.
 */
export interface KmsClient {
  asymmetricSign(request: {
    name: string;
    data: Uint8Array;
    dataCrc32c?: { value: number };
  }): Promise<
    [
      {
        signature?: Uint8Array | string | null;
        signatureCrc32c?: { value?: unknown } | null;
        verifiedDataCrc32c?: boolean | null;
        name?: string | null;
      },
      ...unknown[],
    ]
  >;
  getPublicKey(request: {
    name: string;
  }): Promise<[{ pem?: string | null; algorithm?: string | null }, ...unknown[]]>;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof (v as { toString?: unknown }).toString === "function") {
    return Number((v as { toString(): string }).toString());
  }
  return Number(v);
}

/**
 * Build a KmsSignFn that signs with a Cloud KMS Ed25519 key (EC_SIGN_ED25519).
 *
 * Ed25519 is EdDSA, which hashes the message internally, so KMS is given the raw `data`
 * (NOT a pre-hashed digest). Request and response are integrity-checked with CRC32C, and
 * the returned key version `name` is confirmed, per Cloud KMS guidance.
 */
export function gcpKmsSignFn(
  keyVersionName: string,
  client: KmsClient,
): (message: Uint8Array) => Promise<Uint8Array> {
  return async (message: Uint8Array): Promise<Uint8Array> => {
    const [resp] = await client.asymmetricSign({
      name: keyVersionName,
      data: message,
      dataCrc32c: { value: crc32c(message) },
    });

    if (resp.name && resp.name !== keyVersionName) {
      throw new Error(`KMS response key mismatch: requested ${keyVersionName}, got ${resp.name}`);
    }
    if (resp.verifiedDataCrc32c === false) {
      throw new Error("KMS could not verify request data integrity (dataCrc32c mismatch)");
    }
    if (resp.signature == null) {
      throw new Error("KMS returned no signature");
    }

    const signature =
      typeof resp.signature === "string"
        ? new Uint8Array(Buffer.from(resp.signature, "base64"))
        : new Uint8Array(resp.signature);

    if (resp.signatureCrc32c?.value != null) {
      const expected = toNumber(resp.signatureCrc32c.value);
      if (crc32c(signature) !== expected) {
        throw new Error("KMS signature integrity check failed (signatureCrc32c mismatch)");
      }
    }

    return signature;
  };
}

/**
 * Fetch the Ed25519 public key for a KMS key version and return it as a JWK plus the
 * thumbprint to use as the witness key id. The operator registers `publicJwk` with verifiers
 * and constructs the signer with `keyId`.
 */
export async function gcpKmsPublicJwk(
  keyVersionName: string,
  client: KmsClient,
): Promise<{ publicJwk: Jwk; keyId: string }> {
  const [resp] = await client.getPublicKey({ name: keyVersionName });
  if (!resp.pem) throw new Error("KMS returned no public key PEM");
  const jwk = createPublicKey({ key: resp.pem, format: "pem" }).export({
    format: "jwk",
  }) as unknown as Jwk;
  const publicJwk = toPublicJwk(jwk);
  if (publicJwk.crv !== "Ed25519") {
    throw new Error(`expected an Ed25519 key, got crv=${publicJwk.crv}`);
  }
  return { publicJwk, keyId: thumbprint(publicJwk) };
}
