import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync } from "node:fs";
import { ReceiptsClient } from "@witnessed/sdk";
import { loadAgentKey } from "../src/agent-key";

const tempFiles: string[] = [];
afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    try {
      rmSync(f);
    } catch {
      /* ignore */
    }
  }
});
function tmpKey() {
  const p = join(tmpdir(), `witnessed-agent-${process.pid}-${tempFiles.length}.jwk`);
  tempFiles.push(p);
  return p;
}

describe("loadAgentKey", () => {
  it("uses WITNESS_AGENT_JWK when provided", () => {
    const { privateJwk } = ReceiptsClient.generateKey();
    const r = loadAgentKey({ WITNESS_AGENT_JWK: JSON.stringify(privateJwk) } as NodeJS.ProcessEnv);
    expect(r.source).toBe("env");
    expect(r.privateJwk.d).toBe(privateJwk.d);
  });

  it("generates + persists a key file once, then reloads the same identity", () => {
    const keyFile = tmpKey();
    const first = loadAgentKey({ WITNESS_AGENT_KEY_FILE: keyFile } as NodeJS.ProcessEnv);
    expect(existsSync(keyFile)).toBe(true);
    expect(first.source).toMatch(/new/);

    const second = loadAgentKey({ WITNESS_AGENT_KEY_FILE: keyFile } as NodeJS.ProcessEnv);
    expect(second.keyId).toBe(first.keyId); // stable agent identity across runs
    expect(second.source).toBe(keyFile);
  });
});
