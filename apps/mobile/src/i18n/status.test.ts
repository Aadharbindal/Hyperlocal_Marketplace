import { DISPUTE_STATUSES, VERIFICATION_STATUSES } from '@hyperlocal/core';
import { DISPUTE_STATUS, VERIFICATION } from './status';

/**
 * That every status has words, and that none of them are the database's.
 *
 * These maps exist because four screens were each reading the same enums and inventing their own
 * fallback - and the two that had no map at all printed the column value: a shopkeeper read
 * "Verification is under_review", a customer who had reported a problem read "awaiting party".
 *
 * The type already makes a missing key a compile error. What it cannot catch is somebody adding
 * `SOMETHING_NEW: { label: 'something_new' }` to satisfy it, which is the same bug wearing the
 * type's clothes - so the enum shape itself is what is asserted here.
 */

const RAW = /^[A-Z][A-Z_]*$|_/;

describe('status labels', () => {
  it('names every verification status', () => {
    for (const s of VERIFICATION_STATUSES) {
      expect(VERIFICATION[s].label).toBeTruthy();
      expect(VERIFICATION[s].body).toBeTruthy();
    }
  });

  it('names every dispute status', () => {
    for (const s of DISPUTE_STATUSES) {
      expect(DISPUTE_STATUS[s].label).toBeTruthy();
    }
  });

  it('never shows the enum itself', () => {
    // An underscore or a SHOUTING word in a label means somebody reached for the key again.
    for (const s of VERIFICATION_STATUSES) {
      expect(VERIFICATION[s].label).not.toMatch(RAW);
    }
    for (const s of DISPUTE_STATUSES) {
      expect(DISPUTE_STATUS[s].label).not.toMatch(RAW);
    }
  });

  it('ends every verification body as a sentence', () => {
    // These are concatenated with another sentence on the vendor's shop card. One of them missing
    // its full stop is how two sentences become one run-on.
    for (const s of VERIFICATION_STATUSES) {
      expect(VERIFICATION[s].body).toMatch(/[.!?]$/);
    }
  });
});
