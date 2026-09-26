import { z } from 'zod';
import { NOTIFICATION_CATEGORIES, SCHEDULE_PROPOSAL_STATUSES } from '../ops/reach';

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * A device registering itself so notifications have somewhere to go. Sent on every launch, not
 * only the first: a push token is rotated by the operating system, and a stale one is a person
 * who silently stops hearing from us.
 */
export const RegisterDeviceBody = z
  .object({
    token: z.string().trim().min(10).max(400),
    platform: z.enum(['IOS', 'ANDROID', 'WEB']),
    deviceLabel: z.string().trim().max(60).optional(),
    appVersion: z.string().trim().max(20).optional(),
  })
  .strict();
export type RegisterDeviceBody = z.infer<typeof RegisterDeviceBody>;

export const DeviceView = z.object({
  id: z.string().uuid(),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  deviceLabel: z.string().nullable(),
  /** So a person can tell which row is the phone in their hand. */
  isThisDevice: z.boolean(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
});
export type DeviceView = z.infer<typeof DeviceView>;

// ---------------------------------------------------------------------------
// Notification settings and the list itself
// ---------------------------------------------------------------------------

/**
 * Only the switches that exist. Money and account alerts are deliberately absent: there is no
 * setting to turn off being told that a payout failed.
 */
export const NotificationSettingsBody = z
  .object({
    jobUpdates: z.boolean().optional(),
    offers: z.boolean().optional(),
    marketing: z.boolean().optional(),
  })
  .strict();
export type NotificationSettingsBody = z.infer<typeof NotificationSettingsBody>;

export const NotificationSettingsView = z.object({
  jobUpdates: z.boolean(),
  offers: z.boolean(),
  marketing: z.boolean(),
  /** Stated rather than implied, so the settings screen can say why there is no switch. */
  alwaysOn: z.array(z.enum(NOTIFICATION_CATEGORIES)),
});
export type NotificationSettingsView = z.infer<typeof NotificationSettingsView>;

export const NotificationView = z.object({
  id: z.string().uuid(),
  type: z.string(),
  category: z.enum(NOTIFICATION_CATEGORIES),
  title: z.string(),
  body: z.string(),
  data: z.record(z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationView = z.infer<typeof NotificationView>;

export const NotificationListView = z.object({
  items: z.array(NotificationView),
  /** What the badge shows. */
  unread: z.number().int(),
});
export type NotificationListView = z.infer<typeof NotificationListView>;

export const MarkReadBody = z
  .object({
    /** Leave out to mark everything read - which is what the "clear all" affordance does. */
    ids: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict();
export type MarkReadBody = z.infer<typeof MarkReadBody>;

// ---------------------------------------------------------------------------
// Masked calling
// ---------------------------------------------------------------------------

export const StartCallBody = z
  .object({
    /** Set when something is going wrong right now; it lifts the calling-hours limit. */
    urgent: z.boolean().optional(),
  })
  .strict();
export type StartCallBody = z.infer<typeof StartCallBody>;

/**
 * What a caller gets back. The other person's real number is not in here and never will be:
 * the whole point of the feature is that neither side learns it.
 */
export const CallView = z.object({
  id: z.string().uuid(),
  /** Dial this. It reaches the other person through the telephony provider. */
  virtualNumber: z.string(),
  status: z.enum(['REQUESTED', 'CONNECTED', 'FAILED', 'ENDED']),
  /** Who is being reached, by the name the caller is allowed to see. */
  calleeName: z.string(),
  callsLeftToday: z.number().int(),
  createdAt: z.string(),
});
export type CallView = z.infer<typeof CallView>;

// ---------------------------------------------------------------------------
// Rescheduling
// ---------------------------------------------------------------------------

export const RescheduleBody = z
  .object({
    newStart: z.string().datetime(),
    newEnd: z.string().datetime().optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .strict();
export type RescheduleBody = z.infer<typeof RescheduleBody>;

// ---------------------------------------------------------------------------
// A professional proposing a new time
// ---------------------------------------------------------------------------

export const ProposeTimeBody = z
  .object({
    newStart: z.string().datetime(),
    newEnd: z.string().datetime().optional(),
    /** Required: a customer rearranging their day deserves to know why it moved. */
    reason: z.string().trim().min(10).max(300),
  })
  .strict();
export type ProposeTimeBody = z.infer<typeof ProposeTimeBody>;

export const RespondToProposalBody = z
  .object({ accept: z.boolean(), reason: z.string().trim().max(300).optional() })
  .strict();
export type RespondToProposalBody = z.infer<typeof RespondToProposalBody>;

export const ScheduleProposalView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  previousStart: z.string().nullable(),
  newStart: z.string(),
  newEnd: z.string().nullable(),
  reason: z.string(),
  status: z.enum(SCHEDULE_PROPOSAL_STATUSES),
  /** Set for the person who has to answer, so the app can say how long they have. */
  expiresAt: z.string(),
  mine: z.boolean(),
  createdAt: z.string(),
});
export type ScheduleProposalView = z.infer<typeof ScheduleProposalView>;

export const RescheduleView = z.object({
  jobId: z.string().uuid(),
  preferredStart: z.string().nullable(),
  preferredEnd: z.string().nullable(),
  /** How many moves are left before the booking has to be cancelled and made again. */
  movesLeft: z.number().int(),
  /** Whether the provider had to be told, so the app can say "we have let them know". */
  providerNotified: z.boolean(),
});
export type RescheduleView = z.infer<typeof RescheduleView>;
