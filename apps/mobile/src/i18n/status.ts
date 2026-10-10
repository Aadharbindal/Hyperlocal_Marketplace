import type { DisputeStatus, VerificationStatus } from '@hyperlocal/core';

/**
 * What a verification status is called, once, for every role.
 *
 * There were three of these and one screen with none. A provider read "In review", a contractor
 * reading the same status about a technician read "in review", a profile screen had the colour but
 * no words at all - and the vendor's shop screen, which had no map, printed the database enum:
 * **"Verification is under_review. You can quote once it is approved."** A shopkeeper waiting to be
 * allowed to quote was shown a column value with an underscore in it.
 *
 * Typed `Record<VerificationStatus, ...>` rather than `Record<string, ...>`, which is the part that
 * stops this coming back: two of the three old maps were keyed by `string`, so a seventh status
 * added to the enum would have compiled everywhere and fallen through to `undefined` on screen.
 *
 * `body` is written from the subject's own point of view - the person whose documents these are.
 * Where a screen is showing somebody *else's* status, a contractor looking at their technician,
 * only `label` and `tone` apply; the body would be addressing the wrong person.
 */
export const VERIFICATION: Record<
  VerificationStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; body: string }
> = {
  UNVERIFIED: {
    label: 'Not started',
    tone: 'neutral',
    body: 'Submit one ID document to get started.',
  },
  // Two statuses, one situation as far as the person waiting is concerned: the documents are in and
  // nothing is required of them. Distinguishing "received" from "being looked at" would be asking
  // them to care about our queue.
  SUBMITTED: {
    label: 'In review',
    tone: 'warning',
    body: 'We are checking your documents. This usually takes a day.',
  },
  UNDER_REVIEW: {
    label: 'In review',
    tone: 'warning',
    body: 'We are checking your documents. This usually takes a day.',
  },
  VERIFIED: {
    label: 'Verified',
    tone: 'success',
    body: 'Customers can see your verified badge.',
  },
  REJECTED: {
    label: 'Not accepted',
    tone: 'danger',
    body: 'Your documents were not accepted. Please submit them again.',
  },
  SUSPENDED: {
    label: 'Suspended',
    tone: 'danger',
    body: 'Contact support to restore your account.',
  },
};

/**
 * What a dispute's status is called, to the person who raised it.
 *
 * The customer's after-job card was rendering the enum lowercased, so somebody who had reported a
 * problem with their boiler read **"awaiting party"** - a phrase from our admin queue describing a
 * move a staff member made. `AWAITING_PARTY` does not record *which* party was asked, so the label
 * does not claim it is them; if we had asked them, they would have a notification saying so.
 *
 * Admin reads the same words. Triage needs OPEN apart from UNDER_REVIEW and it has that; what it
 * does not need is a second vocabulary for the same six rows.
 */
export const DISPUTE_STATUS: Record<DisputeStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  OPEN: { label: 'Reported', tone: 'warning' },
  UNDER_REVIEW: { label: 'Being looked at', tone: 'warning' },
  AWAITING_PARTY: { label: 'Waiting for a reply', tone: 'warning' },
  ESCALATED: { label: 'Escalated', tone: 'danger' },
  REOPENED: { label: 'Reopened', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  REJECTED: { label: 'Not upheld', tone: 'neutral' },
};
