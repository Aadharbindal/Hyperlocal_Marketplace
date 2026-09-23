/**
 * The oldest app build the API will still talk to. An app that is too old gets a clear "please
 * update" rather than a puzzling validation error from a contract it no longer matches
 * (SECURITY_CHECKLIST: API min-version gate).
 */

/** Compares dotted versions without pulling in semver. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * True when this build is too old to be trusted with the current contracts. A request with no
 * version header is let through: browsers and curl have no app version, and the gate exists to
 * help real users update, not to block tooling.
 */
export function isUnsupportedVersion(appVersion: string | undefined, minimum: string): boolean {
  if (!appVersion) return false;
  return compareVersions(appVersion, minimum) < 0;
}
