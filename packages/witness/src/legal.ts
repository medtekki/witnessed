/**
 * Terms of Service + Privacy Notice for the witness, served as markdown and linked from the
 * manifest / llms.txt / OpenAPI. These are v0 DRAFTS for a free beta — not legal advice. The
 * documents are code-embedded (single source of truth), matching the llms.txt pattern.
 */

export const LEGAL_VERSION = "v0";
export const LEGAL_LAST_UPDATED = "2026-06-09";

export interface LegalParams {
  /** Absolute base URL of the service, e.g. https://witness.medtekki.no */
  base: string;
  /** Legal entity operating the service, e.g. "MEDTEK KI AS". */
  operator: string;
  /** Operator's place of business, e.g. "Sandnes, Norway". */
  location: string;
  /** Contact address for legal / privacy / deletion requests. */
  contact: string;
}

/** Terms of Service (v0 draft). */
export function termsOfService({ base, operator, location, contact }: LegalParams): string {
  return `# Witnessed — Terms of Service (${LEGAL_VERSION}, beta)

_Last updated: ${LEGAL_LAST_UPDATED}. This is a ${LEGAL_VERSION} draft for a free beta. It is
not legal advice — verify with counsel before relying on it._

Witnessed is operated by ${operator} (${location}). By using the service at ${base} you agree
to these terms.

## The service
Witnessed independently timestamps and countersigns receipts of AI agent actions. Agents sign
claims locally with their own key; the witness records and countersigns them.

## Beta status
Witnessed is a free beta, provided **as is** and **as available**. It may change, be
interrupted, or be discontinued at any time without notice. There is no service-level or
uptime guarantee.

## Acceptable use
- Do not abuse, overload, or attempt to disrupt the service. Per-IP and global rate limits
  apply; exceeding them returns HTTP 429.
- Do not submit unlawful content, or content you have no right to submit.
- You are responsible for what you submit. Signing is client-side: you control your keys.

## No warranty
To the maximum extent permitted by law, the service is provided without warranties of any
kind, express or implied, including fitness for a particular purpose and non-infringement.

## Not a compliance guarantee
Receipts and any Article-12 / Annex-IV / FRIA-style exports are \`format ${LEGAL_VERSION}\`.
They are not legal or regulatory advice and do not constitute a compliance certification or
audit. Nothing produced by the service should be relied upon for regulatory purposes without
independent legal review.

## Limitation of liability
To the extent permitted by Norwegian law, ${operator} is not liable for any indirect,
incidental, or consequential damages, or any loss arising from use of this free beta.

## Your data
See the Privacy Notice at ${base}/privacy for what the service stores and how.

## Changes
These terms may change. Continued use after a change constitutes acceptance.

## Governing law
These terms are governed by the laws of Norway, with venue in the Norwegian courts
(${location}).

## Contact
${contact}
`;
}

/** Privacy Notice (v0 draft). */
export function privacyNotice({ base, operator, location, contact }: LegalParams): string {
  return `# Witnessed — Privacy Notice (${LEGAL_VERSION}, beta)

_Last updated: ${LEGAL_LAST_UPDATED}. This is a ${LEGAL_VERSION} draft for a free beta. It is
not legal advice — verify with counsel before relying on it._

## Controller
${operator}, ${location}. Contact: ${contact}.

## What the service stores
When you create a receipt, the witness stores the **receipt**: the signed claim and its
witness signature. A claim contains:
- the agent's public key and key id;
- the action type and a free-text description **you provide**;
- a **content digest (a hash) — not the underlying content**;
- timestamps;
- optional anchor identifiers (e.g. an email Message-ID, a payment transaction id, or a
  health-record id);
and, if payment is enabled, a settlement reference (transaction hash).

**The witness never receives your private key** — signing happens on your side.

## Your responsibility
The free-text \`action.description\` and any anchor identifiers are stored as you provide
them. **Do not put secrets, personal data, or PHI in these plaintext fields** — hash or digest
sensitive content instead. The service is designed around digests, not raw content.

## Logs and IP addresses
Per-IP rate-limit counters are held **in memory only** — they are not persisted and reset when
the service restarts. Standard web/proxy access logs may transiently record IP addresses for
security and operations. The service uses **no cookies, no tracking pixels, and no third-party
analytics** — it is a machine API.

## Retention
Receipts are retained according to the configured retention policy (a minimum window may apply
for regulated logs). Legal holds may preserve specific records. Expired records that are not
held are purged.

## Where data is hosted
On EU infrastructure (Germany). (The operator, ${operator}, is established in ${location}.)

## Your rights
Subject to applicable law (including the GDPR), you may request access, rectification, or
erasure of personal data, among other rights — contact ${contact}. Note that
**erasure may be constrained**: receipts are tamper-evident by design, and legal-hold or
retention obligations may require records to be preserved.

## Changes
This notice may change; the latest version is always at ${base}/privacy.

## Contact
${contact}
`;
}
