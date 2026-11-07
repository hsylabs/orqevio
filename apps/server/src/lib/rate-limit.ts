/**
 * Small fixed-window limiter kept in memory. It protects a single instance;
 * deployments with several replicas should also rate-limit at the proxy.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns the seconds to wait when the key is over the limit, otherwise 0. */
  hit(key: string, now = Date.now()): number {
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      this.sweep(now)
      return 0
    }
    entry.count++
    return entry.count > this.limit ? Math.ceil((entry.resetAt - now) / 1000) : 0
  }

  reset(key: string) {
    this.hits.delete(key)
  }

  private sweep(now: number) {
    if (this.hits.size < 10_000) return
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key)
  }
}
