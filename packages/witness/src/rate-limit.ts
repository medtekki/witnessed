/**
 * Zero-dependency, in-memory rate limiting for the witness service.
 *
 * The witness runs as a single process behind MedScan's Caddy (the sole ingress), so
 * per-process in-memory counters are sufficient and the client IP arrives via
 * X-Forwarded-For. This is a SAFETY CEILING (stop one client from monopolizing signing /
 * exhausting the box), not a fair-use quota or billing mechanism.
 */
import type { Context, MiddlewareHandler } from "hono";

/** Fixed-window per-key counter. Pure; the clock is injected for deterministic tests. */
export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();
  private lastSweepAt: number;

  /** @param windowMs window length in ms (default 60000). @param now clock in ms (default Date.now). */
  constructor(
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.lastSweepAt = this.now();
  }

  /** Record one hit against `key` (allowance `limit`) and report whether it is allowed. */
  check(key: string, limit: number): { allowed: boolean; remaining: number; retryAfterSec: number } {
    const t = this.now();
    this.maybeSweep(t);
    let b = this.buckets.get(key);
    if (!b || t - b.windowStart >= this.windowMs) {
      b = { count: 0, windowStart: t };
      this.buckets.set(key, b);
    }
    // A blocked request still counts toward the window — a sustained flood keeps registering pressure.
    b.count += 1;
    const allowed = b.count <= limit;
    const remaining = Math.max(0, limit - b.count);
    const retryAfterSec = allowed ? 0 : Math.ceil((b.windowStart + this.windowMs - t) / 1000);
    return { allowed, remaining, retryAfterSec };
  }

  /** Number of tracked buckets (test/introspection helper). */
  size(): number {
    return this.buckets.size;
  }

  /** Drop expired buckets at most once per window so the map cannot grow unbounded. */
  private maybeSweep(t: number): void {
    if (t - this.lastSweepAt < this.windowMs) return;
    for (const [key, b] of this.buckets) {
      if (t - b.windowStart >= this.windowMs) this.buckets.delete(key);
    }
    this.lastSweepAt = t;
  }
}

export type Tier = "exempt" | "write" | "read";

/**
 * Map a request to a cost tier. Unknown shapes fall through to the (loose) read tier.
 * Path matching is exact/prefix and case-sensitive — consistent with Hono's own
 * case-sensitive routing, so a mismatched-case path also fails to match a real handler
 * (404, cheap) rather than reaching the signing path under a looser tier.
 */
export function classify(method: string, path: string): Tier {
  if (path === "/healthz") return "exempt";
  if (path === "/mcp" || path.startsWith("/mcp/")) return "write";
  const m = method.toUpperCase();
  if (m === "POST" && (path === "/receipts" || path === "/verify")) return "write";
  return "read";
}

/**
 * Derive the rate-limit key from X-Forwarded-For. Safe ONLY because Caddy is the sole
 * ingress and overwrites this header; if the witness were exposed directly, the header
 * would be client-spoofable. Falls back to "unknown" for direct/local calls.
 */
export function clientKey(xff: string | undefined): string {
  if (!xff) return "unknown";
  const first = xff.split(",")[0]?.trim();
  return first || "unknown";
}

export interface RateLimitConfig {
  /** When false the middleware is a pure passthrough. */
  enabled: boolean;
  /** Per-IP allowance for the write tier (POST /receipts, POST /verify, /mcp) per window. */
  writePerMin: number;
  /** Per-IP allowance for the read tier per window. */
  readPerMin: number;
  /** Process-wide write ceiling across ALL IPs per window; 0 disables the backstop. */
  globalWritePerMin: number;
  /** Window length in ms (default 60_000) — code-level knob, not exposed via env. */
  windowMs?: number;
  /** Clock in ms (default Date.now) — code-level knob for tests, not exposed via env. */
  now?: () => number;
}

function tooMany(c: Context, retryAfterSec: number) {
  c.header("Retry-After", String(retryAfterSec));
  return c.json({ error: "rate_limited", retry_after_seconds: retryAfterSec }, 429);
}

/**
 * Hono middleware enforcing the per-IP safety ceiling. Construct once per app so the global
 * write counter is genuinely process-wide. Register with `app.use("*", rateLimit(cfg))`
 * BEFORE the routes.
 *
 * Allowed requests carry RateLimit-Limit/RateLimit-Remaining headers; these are merged via
 * the Hono context, so they only reach responses built through context helpers (c.json/c.text).
 * A route returning a raw `new Response(...)` would bypass them — all current routes use helpers.
 */
export function rateLimit(config: RateLimitConfig): MiddlewareHandler {
  const limiter = new RateLimiter(config.windowMs ?? 60_000, config.now);
  return async (c, next) => {
    if (!config.enabled) return next();

    const tier = classify(c.req.method, c.req.path);
    if (tier === "exempt") return next();

    const key = clientKey(c.req.header("x-forwarded-for"));

    if (tier === "write") {
      if (config.globalWritePerMin > 0) {
        const g = limiter.check("global:write", config.globalWritePerMin);
        if (!g.allowed) return tooMany(c, g.retryAfterSec);
      }
      const r = limiter.check("w:" + key, config.writePerMin);
      if (!r.allowed) return tooMany(c, r.retryAfterSec);
      c.header("RateLimit-Limit", String(config.writePerMin));
      c.header("RateLimit-Remaining", String(r.remaining));
      return next();
    }

    const r = limiter.check("r:" + key, config.readPerMin);
    if (!r.allowed) return tooMany(c, r.retryAfterSec);
    c.header("RateLimit-Limit", String(config.readPerMin));
    c.header("RateLimit-Remaining", String(r.remaining));
    return next();
  };
}
