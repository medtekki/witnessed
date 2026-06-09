import { describe, it, expect } from "vitest";
import { termsOfService, privacyNotice, LEGAL_VERSION } from "../src/legal";

const params = {
  base: "https://example.test",
  operator: "MEDTEK KI AS",
  location: "Sandnes, Norway",
  contact: "support@medtekki.no",
};

describe("termsOfService", () => {
  const tos = termsOfService(params);
  it("names the operator, contact, and Norwegian governing law", () => {
    expect(tos).toContain("MEDTEK KI AS");
    expect(tos).toContain("support@medtekki.no");
    expect(tos).toContain("Norway");
  });
  it("carries the v0/beta + verify-with-counsel disclaimer", () => {
    expect(tos.toLowerCase()).toContain("not legal advice");
    expect(tos).toContain(LEGAL_VERSION);
    expect(tos.toLowerCase()).toContain("beta");
  });
  it("states no-warranty and not-a-compliance-guarantee", () => {
    expect(tos.toLowerCase()).toContain("as is");
    expect(tos.toLowerCase()).toContain("without warranties");
    expect(tos.toLowerCase()).toContain("not a compliance guarantee");
  });
  it("interpolates the base URL", () => {
    expect(tos).toContain("https://example.test");
  });
});

describe("privacyNotice", () => {
  const pn = privacyNotice(params);
  it("names the controller, location, and contact", () => {
    expect(pn).toContain("MEDTEK KI AS");
    expect(pn).toContain("Sandnes, Norway");
    expect(pn).toContain("support@medtekki.no");
  });
  it("states digests-not-content and client-side signing", () => {
    expect(pn.toLowerCase()).toContain("not the underlying content");
    expect(pn.toLowerCase()).toContain("never receives your private key");
  });
  it("warns against submitting secrets/PII/PHI in plaintext", () => {
    expect(pn).toContain("Do not put secrets, personal data, or PHI");
  });
  it("discloses in-memory-only rate-limit IPs and the erasure caveat", () => {
    expect(pn.toLowerCase()).toContain("in memory only");
    expect(pn.toLowerCase()).toContain("erasure may be constrained");
  });
  it("is parameterized (not hardcoded)", () => {
    const other = privacyNotice({ ...params, operator: "ACME LLC" });
    expect(other).toContain("ACME LLC");
    expect(other).not.toContain("MEDTEK KI AS");
  });
});
