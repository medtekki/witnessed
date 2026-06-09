import { describe, it, expect } from "vitest";
import { RateLimiter, classify, clientKey } from "../src/rate-limit";

describe("RateLimiter", () => {
  it("allows up to the limit, then blocks", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(60_000, () => now);
    expect(rl.check("k", 2).allowed).toBe(true); // 1st
    expect(rl.check("k", 2).allowed).toBe(true); // 2nd
    expect(rl.check("k", 2).allowed).toBe(false); // 3rd — over
  });

  it("resets the count after the window elapses", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(60_000, () => now);
    expect(rl.check("k", 1).allowed).toBe(true);
    expect(rl.check("k", 1).allowed).toBe(false);
    now += 60_000;
    expect(rl.check("k", 1).allowed).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(60_000, () => now);
    expect(rl.check("a", 1).allowed).toBe(true);
    expect(rl.check("b", 1).allowed).toBe(true);
    expect(rl.check("a", 1).allowed).toBe(false);
  });

  it("reports retryAfterSec as the time left in the window when blocked", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(60_000, () => now);
    rl.check("k", 1); // opens the window at now
    now += 10_000; // 10s into the 60s window
    const r = rl.check("k", 1); // blocked
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBe(50);
  });

  it("reports remaining as the allowance left in the window, clamped at 0", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(60_000, () => now);
    expect(rl.check("k", 3).remaining).toBe(2); // 1 used
    expect(rl.check("k", 3).remaining).toBe(1); // 2 used
    expect(rl.check("k", 3).remaining).toBe(0); // 3 used
    expect(rl.check("k", 3).remaining).toBe(0); // over-limit — clamped, never negative
  });

  it("sweeps expired buckets so memory does not grow unbounded", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(60_000, () => now);
    for (let i = 0; i < 100; i++) rl.check("ip" + i, 5);
    expect(rl.size()).toBe(100);
    now += 60_001; // every existing bucket is now expired
    rl.check("fresh", 5); // triggers the sweep, then adds one fresh bucket
    expect(rl.size()).toBe(1);
  });
});

describe("classify", () => {
  it("exempts /healthz regardless of method (path check precedes method check)", () => {
    expect(classify("GET", "/healthz")).toBe("exempt");
    expect(classify("POST", "/healthz")).toBe("exempt");
  });

  it("treats signing, verify and mcp as write", () => {
    expect(classify("POST", "/receipts")).toBe("write");
    expect(classify("POST", "/verify")).toBe("write");
    expect(classify("POST", "/mcp")).toBe("write");
    expect(classify("GET", "/mcp")).toBe("write");
    expect(classify("POST", "/mcp/messages")).toBe("write");
  });

  it("treats reads (including GET /receipts/:id) as read", () => {
    expect(classify("GET", "/")).toBe("read");
    expect(classify("GET", "/public-key")).toBe("read");
    expect(classify("GET", "/receipts/abc")).toBe("read");
    expect(classify("GET", "/llms.txt")).toBe("read");
  });
});

describe("clientKey", () => {
  it("takes the leftmost X-Forwarded-For entry", () => {
    expect(clientKey("1.1.1.1, 10.0.0.1")).toBe("1.1.1.1");
    expect(clientKey("  2.2.2.2  ")).toBe("2.2.2.2");
  });

  it("falls back to 'unknown' when the header is missing, empty, or whitespace", () => {
    expect(clientKey(undefined)).toBe("unknown");
    expect(clientKey("")).toBe("unknown");
    expect(clientKey("   ")).toBe("unknown");
  });
});
