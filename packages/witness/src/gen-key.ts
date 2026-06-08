import { generateKeyPair, toPublicJwk, thumbprint } from "@witnessed/core";

/**
 * Generate a witness Ed25519 keypair for a beta deployment. Prints:
 *  - WITNESS_PRIVATE_JWK : set this as a SECRET on your host (never commit it)
 *  - the public key + key id : publish these so verifiers can trust your receipts
 *
 * Run: `tsx packages/witness/src/gen-key.ts`
 */
export function generateWitnessKey() {
  const { publicJwk, privateJwk } = generateKeyPair();
  const pub = toPublicJwk(publicJwk);
  return { keyId: thumbprint(pub), publicJwk: pub, privateJwk };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { keyId, publicJwk, privateJwk } = generateWitnessKey();
  // eslint-disable-next-line no-console
  console.log(
    [
      "# Witness key generated. Keep the private JWK SECRET (host secret store / env).",
      "",
      `WITNESS_PRIVATE_JWK=${JSON.stringify(privateJwk)}`,
      "",
      "# Publish these so others can verify your receipts:",
      `key_id:     ${keyId}`,
      `public_key: ${JSON.stringify(publicJwk)}`,
    ].join("\n"),
  );
}
