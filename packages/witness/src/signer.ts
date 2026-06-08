import { sign } from "@witnessed/core";
import type { Jwk } from "@witnessed/core";

export interface Signer {
  readonly keyId: string;
  /** Sign a UTF-8 message, returning a base64url signature. Async to allow KMS/HSM backends. */
  sign(message: string): Promise<string>;
}

/** v1 signer backed by a local Ed25519 key. Convenient for dev/tests; not for production. */
export class LocalSigner implements Signer {
  constructor(
    private readonly privateJwk: Jwk,
    public readonly keyId: string,
  ) {}

  async sign(message: string): Promise<string> {
    return sign(message, this.privateJwk);
  }
}

/**
 * The signing primitive a KMS/HSM exposes: sign raw message bytes with the managed key and
 * return the signature bytes. The private key never leaves the KMS. In production this wraps a
 * provider SDK call (e.g. GCP Cloud KMS `asymmetricSign` with EC_SIGN_ED25519, or an HSM).
 *
 * Note: the signature MUST be Ed25519 over the given bytes, because the verifier checks
 * Ed25519. Providers without Ed25519 support (e.g. AWS KMS managed keys) are not compatible
 * without also changing the verifier's algorithm.
 */
export interface KmsSignFn {
  (message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Production signer that delegates signing to a KMS/HSM via an injected {@link KmsSignFn}.
 * `keyId` must be the thumbprint of the witness public key registered with verifiers, so
 * `witness_key_id` resolves to the right public key.
 */
export class KmsSigner implements Signer {
  constructor(
    public readonly keyId: string,
    private readonly signFn: KmsSignFn,
  ) {}

  async sign(message: string): Promise<string> {
    const signature = await this.signFn(Buffer.from(message, "utf8"));
    return Buffer.from(signature).toString("base64url");
  }
}
