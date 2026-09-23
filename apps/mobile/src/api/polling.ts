/**
 * Polling intervals, now that the live stream carries the updates.
 *
 * The stream is the fast path; these are the safety net for a dropped connection or a runtime
 * without `EventSource`. They are deliberately slow: often enough that a stuck screen fixes
 * itself within a minute, rare enough that a phone on mobile data is not paying for it.
 */
export const FALLBACK_POLL_MS = 60_000;
export const FALLBACK_POLL_SLOW_MS = 120_000;
