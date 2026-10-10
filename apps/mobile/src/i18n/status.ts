import type { DisputeCategory, DisputeStatus, KycDocumentType, VerificationStatus } from '@hyperlocal/core';

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

/**
 * What each identity document is called.
 *
 * The provider's profile had four of these written by hand and the admin's verification queue had
 * none, so a reviewer deciding somebody's livelihood read "SHOP_LICENCE". Keyed by the enum, so
 * the seventh document we accept has to be named before it compiles.
 */
export const KYC_DOCUMENT: Record<KycDocumentType, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  DRIVING_LICENCE: 'Driving licence',
  VOTER_ID: 'Voter ID',
  SHOP_LICENCE: 'Shop licence',
  GST: 'GST certificate',
};

/**
 * What each kind of problem is called, and which ones somebody can report themselves.
 *
 * The customer's picker was a hand-written list of six of the ten categories, and the four it
 * left out were not decorative:
 *
 * - **`NO_SHOW` has a 12-hour SLA.** With no option for it, somebody whose professional never
 *   arrived had to file "They were very late" (24h) or "It was left unfinished" (48h), so the
 *   platform answered them in two to four times the time its own policy promises.
 * - **`ABUSIVE_BEHAVIOUR` has a 12-hour SLA and is in `HUMAN_ONLY_CATEGORIES`** - never decided
 *   by an automated rule. Without it, that report arrived as "The work is not right": a 72-hour
 *   queue, and eligible to be closed by a rule. That is the one that actually mattered.
 * - `MATERIAL_MISMATCH` existed for the whole materials flow and could not be chosen.
 *
 * Keyed by the enum with an explicit `customer` flag, so an eleventh category cannot be added
 * without somebody deciding whether a customer may pick it. `SUSPECTED_FRAUD` is false: it is a
 * classification support applies, not something anybody self-selects accurately, and offering it
 * invites it to be used as a threat.
 */
export const DISPUTE_CATEGORY: Record<DisputeCategory, { label: string; customer: boolean }> = {
  POOR_WORKMANSHIP: { label: 'The work is not right', customer: true },
  INCOMPLETE_WORK: { label: 'It was left unfinished', customer: true },
  NO_SHOW: { label: 'They never turned up', customer: true },
  LATE_ARRIVAL: { label: 'They were very late', customer: true },
  PROPERTY_DAMAGE: { label: 'Something was damaged', customer: true },
  INCORRECT_PRICING: { label: 'The price is wrong', customer: true },
  PAYMENT_ISSUE: { label: 'Something about the payment', customer: true },
  MATERIAL_MISMATCH: { label: 'The wrong materials arrived', customer: true },
  ABUSIVE_BEHAVIOUR: { label: 'I was treated badly', customer: true },
  SUSPECTED_FRAUD: { label: 'Suspected fraud', customer: false },
};

/** The ones somebody can raise themselves, in the order they are offered. */
export const CUSTOMER_DISPUTE_CATEGORIES = (Object.keys(DISPUTE_CATEGORY) as DisputeCategory[]).filter(
  (c) => DISPUTE_CATEGORY[c].customer,
);
