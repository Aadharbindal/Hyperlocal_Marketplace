/**
 * Idempotency keys.
 *
 * In its own file because both the HTTP client and the offline outbox need it, and having them
 * import from each other is the kind of cycle that works until the day the module order changes.
 */
export function newIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
