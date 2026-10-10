import {
  DISPUTE_CATEGORIES,
  DISPUTE_SLA_HOURS,
  DISPUTE_STATUSES,
  HUMAN_ONLY_CATEGORIES,
  KYC_DOCUMENT_TYPES,
  VERIFICATION_STATUSES,
} from '@hyperlocal/core';
import { CUSTOMER_DISPUTE_CATEGORIES, DISPUTE_CATEGORY, DISPUTE_STATUS, KYC_DOCUMENT, VERIFICATION } from './status';

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

  it('names every document the server will accept', () => {
    // The provider's picker was hand-written from this list and had four of the six, so somebody
    // holding a voter ID or a GST certificate had nothing to choose.
    //
    // `RAW` is the wrong rule here: "PAN" is what the document is called, not a leaked column
    // value, and so is the GST in "GST certificate". The underscore is what gives the key away.
    for (const d of KYC_DOCUMENT_TYPES) {
      expect(KYC_DOCUMENT[d]).toBeTruthy();
      expect(KYC_DOCUMENT[d]).not.toContain('_');
      if (d.includes('_')) expect(KYC_DOCUMENT[d]).not.toBe(d);
    }
  });

  it('names every dispute category and says who may pick it', () => {
    for (const c of DISPUTE_CATEGORIES) {
      expect(DISPUTE_CATEGORY[c].label).toBeTruthy();
      expect(DISPUTE_CATEGORY[c].label).not.toMatch(RAW);
    }
  });

  it('offers every category whose SLA or routing a customer would lose by not having it', () => {
    /*
     * The reason this map exists. The old hand-written picker had six of ten, and the omissions
     * had consequences rather than being cosmetic:
     *
     *   NO_SHOW is 12 hours, so somebody whose professional never arrived was filing a 24- or
     *   48-hour category instead; ABUSIVE_BEHAVIOUR is 12 hours *and* human-only, so that report
     *   was arriving as a 72-hour one a rule could close.
     *
     * Anything that fast, or that we have promised a person will look at, has to be reachable by
     * the person it happened to.
     */
    const urgent = DISPUTE_CATEGORIES.filter((c) => DISPUTE_SLA_HOURS[c] <= 24);
    for (const c of urgent) {
      if (c === 'SUSPECTED_FRAUD') continue; // support's classification, not a self-selection
      expect(CUSTOMER_DISPUTE_CATEGORIES).toContain(c);
    }
    for (const c of HUMAN_ONLY_CATEGORIES) {
      if (c === 'SUSPECTED_FRAUD') continue;
      expect(CUSTOMER_DISPUTE_CATEGORIES).toContain(c);
    }
  });

  it('keeps the fraud classification out of a customer\'s hands', () => {
    // Offering "I suspect fraud" invites it to be used as a threat, and nobody self-selects it
    // accurately. Support applies it.
    expect(CUSTOMER_DISPUTE_CATEGORIES).not.toContain('SUSPECTED_FRAUD');
  });

  it('ends every verification body as a sentence', () => {
    // These are concatenated with another sentence on the vendor's shop card. One of them missing
    // its full stop is how two sentences become one run-on.
    for (const s of VERIFICATION_STATUSES) {
      expect(VERIFICATION[s].body).toMatch(/[.!?]$/);
    }
  });
});
