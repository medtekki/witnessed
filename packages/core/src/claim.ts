import type { Agent, Action, Anchor, Claim, Jwk } from "./types";
import { canonical, sha256b64u } from "./canonical";
import { sign } from "./crypto";

export function buildClaim(input: {
  issued_at: string;
  agent: Agent;
  action: Action;
  payload_digest: string | null;
  anchor?: Anchor | null;
  prev?: string[];
}): Claim {
  return {
    version: 1,
    issued_at: input.issued_at,
    agent: input.agent,
    action: input.action,
    payload_digest: input.payload_digest,
    anchor: input.anchor ?? null,
    prev: input.prev ?? [],
  };
}

export function computeId(claim: Claim): string {
  return sha256b64u(canonical(claim));
}

export function signClaim(claim: Claim, privateJwk: Jwk): string {
  return sign(canonical(claim), privateJwk);
}
