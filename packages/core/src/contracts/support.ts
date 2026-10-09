import { z } from 'zod';
import { checkMeaningfulText, refineWith } from '../validation/validation';

/**
 * Asking a person for help.
 *
 * The endpoints behind this have existed, tested, since the finance work, and nothing in the app
 * called them: "Talk to support" opened a `mailto:` to `support@hyperlocal.example` - a reserved
 * TLD that cannot receive mail, on a phone that may well have no mail client configured. So the
 * one route out of a problem went nowhere, silently, for everybody.
 *
 * The contract lives here rather than inline in the route because the app needs the same category
 * list and the same minimum lengths. A support form that accepts "asdasd" wastes a round trip for
 * the person and a queue slot for whoever reads it.
 */

/**
 * What the ticket is about, as the person would say it.
 *
 * Deliberately short and deliberately not a taxonomy: somebody with a problem should not have to
 * work out which of eleven departments owns it. "Something else" is first-class rather than a
 * grudging last resort, because the most urgent tickets are usually the ones that fit nothing.
 */
export const SUPPORT_CATEGORIES = [
  { value: 'BOOKING', label: 'A booking' },
  { value: 'PAYMENT', label: 'Money' },
  { value: 'PROFESSIONAL', label: 'The professional' },
  { value: 'ACCOUNT', label: 'My account' },
  { value: 'OTHER', label: 'Something else' },
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]['value'];

export const SUPPORT_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const SupportTicketBody = z
  .object({
    category: z.enum(SUPPORT_CATEGORIES.map((c) => c.value) as [SupportCategory, ...SupportCategory[]]),
    /** One line, so a queue of these can be read without opening each one. */
    subject: z.string().trim().min(3).max(120).superRefine(refineWith((v) => checkMeaningfulText(v, 3, 'A subject'))),
    body: z.string().trim().min(10).max(2000).superRefine(refineWith((v) => checkMeaningfulText(v, 10, 'Your message'))),
    /** Attaches the ticket to a booking, so support does not have to ask which one. */
    jobId: z.string().uuid().optional(),
  })
  .strict();
export type SupportTicketBody = z.infer<typeof SupportTicketBody>;

export const SupportTicketView = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  category: z.string(),
  status: z.enum(SUPPORT_TICKET_STATUSES),
  jobId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type SupportTicketView = z.infer<typeof SupportTicketView>;

export const SupportTicketsResponse = z.object({ items: z.array(SupportTicketView) });
export type SupportTicketsResponse = z.infer<typeof SupportTicketsResponse>;

export const SupportTicketCreated = z.object({
  id: z.string().uuid(),
  status: z.enum(SUPPORT_TICKET_STATUSES),
  createdAt: z.string(),
});
export type SupportTicketCreated = z.infer<typeof SupportTicketCreated>;

/**
 * What the person is told their ticket is doing.
 *
 * `WAITING` is the one worth wording carefully: internally it means the queue is waiting on *them*,
 * and "Waiting" alone reads as "we are waiting, sit tight" - the opposite. It says so.
 */
export const SUPPORT_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  OPEN: 'Waiting for us',
  IN_PROGRESS: 'Being looked at',
  WAITING: 'Waiting for your reply',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
