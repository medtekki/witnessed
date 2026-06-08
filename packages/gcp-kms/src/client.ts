import { KeyManagementServiceClient } from "@google-cloud/kms";
import type { KmsClient } from "./kms";

/**
 * Construct a real Cloud KMS client (authenticated via Application Default Credentials).
 * The returned client structurally satisfies {@link KmsClient} for the `asymmetricSign` and
 * `getPublicKey` calls the adapter makes.
 *
 * This is the only module that imports `@google-cloud/kms`, so unit tests (which inject a
 * fake KmsClient) never load the SDK. NOTE: real signing requires GCP credentials and an
 * Ed25519 (EC_SIGN_ED25519) key version; that path is exercised against live GCP, not in CI.
 */
export function createGcpKmsClient(
  options?: ConstructorParameters<typeof KeyManagementServiceClient>[0],
): KmsClient {
  return new KeyManagementServiceClient(options) as unknown as KmsClient;
}
