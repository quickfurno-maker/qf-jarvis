export interface ReplayGuard {
  claim(requestId: string, nowMs: number): boolean;
}

export class BoundedReplayCache implements ReplayGuard {
  readonly #entries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  claim(requestId: string, nowMs: number): boolean {
    for (const [id, expiresAt] of this.#entries) {
      if (expiresAt <= nowMs) this.#entries.delete(id);
    }
    const existing = this.#entries.get(requestId);
    if (existing !== undefined && existing > nowMs) return false;
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(requestId, nowMs + this.ttlMs);
    return true;
  }
}
