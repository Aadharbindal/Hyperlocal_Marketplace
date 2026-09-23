import type { UserRole } from '../contracts/enums';

/**
 * Action catalogue. Route handlers call `can(roles, action)` for the coarse role check and then
 * `ownsResource` style checks in the module for the fine-grained check.
 */
export const ACTIONS = [
  // self
  'me.read',
  'me.update',
  'me.delete',
  'me.role.grant_self',
  'me.consent.write',
  'address.manage',
  // jobs
  'job.create',
  'job.read_own',
  'job.submit',
  'job.reschedule',
  'job.cancel_as_customer',
  'job.approve_completion',
  'job.raise_dispute',
  // provider
  'provider.profile.manage',
  'provider.kyc.submit',
  'job.feed.read',
  'bid.create',
  'bid.revise',
  'bid.withdraw',
  'job.status.update_as_provider',
  'job.start_with_otp',
  'job.price_revision.request',
  'job.complete',
  'material.request',
  // contractor
  'technician.manage',
  'assignment.assign_technician',
  // vendor
  'vendor.profile.manage',
  'material.quote',
  'material.deliver',
  // admin / support
  'admin.user.search',
  'admin.user.suspend',
  'admin.user.reactivate',
  'admin.kyc.review',
  'admin.dispute.manage',
  'admin.refund.issue',
  'admin.override.otp',
  'admin.audit.read',
  'admin.maintenance.toggle',
  'support.ticket.manage',
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL_HUMAN: readonly UserRole[] = ['CUSTOMER', 'PROVIDER', 'CONTRACTOR', 'TECHNICIAN', 'VENDOR', 'ADMIN', 'SUPPORT'];
const PROVIDER_SIDE: readonly UserRole[] = ['PROVIDER', 'CONTRACTOR', 'TECHNICIAN'];

export const PERMISSION_MATRIX: Readonly<Record<Action, readonly UserRole[]>> = {
  'me.read': ALL_HUMAN,
  'me.update': ALL_HUMAN,
  'me.delete': ALL_HUMAN,
  'me.role.grant_self': ALL_HUMAN,
  'me.consent.write': ALL_HUMAN,
  'address.manage': ['CUSTOMER', 'PROVIDER', 'CONTRACTOR', 'VENDOR'],

  'job.create': ['CUSTOMER', 'SUPPORT', 'ADMIN'],
  'job.read_own': ALL_HUMAN,
  'job.submit': ['CUSTOMER', 'SUPPORT', 'ADMIN'],
  // Support can move a booking on a customer's behalf, over the phone. A provider cannot: the
  // time belongs to the person whose home it is.
  'job.reschedule': ['CUSTOMER', 'SUPPORT', 'ADMIN'],
  'job.cancel_as_customer': ['CUSTOMER', 'SUPPORT', 'ADMIN'],
  'job.approve_completion': ['CUSTOMER'],
  'job.raise_dispute': ['CUSTOMER', 'PROVIDER', 'CONTRACTOR', 'VENDOR'],

  'provider.profile.manage': ['PROVIDER', 'CONTRACTOR'],
  'provider.kyc.submit': ['PROVIDER', 'CONTRACTOR', 'TECHNICIAN', 'VENDOR'],
  'job.feed.read': ['PROVIDER', 'CONTRACTOR'],
  'bid.create': ['PROVIDER', 'CONTRACTOR'],
  'bid.revise': ['PROVIDER', 'CONTRACTOR'],
  'bid.withdraw': ['PROVIDER', 'CONTRACTOR'],
  'job.status.update_as_provider': PROVIDER_SIDE,
  'job.start_with_otp': PROVIDER_SIDE,
  'job.price_revision.request': PROVIDER_SIDE,
  'job.complete': PROVIDER_SIDE,
  'material.request': PROVIDER_SIDE,

  'technician.manage': ['CONTRACTOR'],
  'assignment.assign_technician': ['CONTRACTOR'],

  'vendor.profile.manage': ['VENDOR'],
  'material.quote': ['VENDOR'],
  'material.deliver': ['VENDOR'],

  'admin.user.search': ['ADMIN', 'SUPPORT'],
  'admin.user.suspend': ['ADMIN'],
  'admin.user.reactivate': ['ADMIN'],
  'admin.kyc.review': ['ADMIN'],
  'admin.dispute.manage': ['ADMIN', 'SUPPORT'],
  'admin.refund.issue': ['ADMIN'],
  'admin.override.otp': ['ADMIN'],
  'admin.audit.read': ['ADMIN'],
  'admin.maintenance.toggle': ['ADMIN'],
  'support.ticket.manage': ['ADMIN', 'SUPPORT'],
};

/** Actions that must carry a `reason` and produce an audit log entry. */
export const HIGH_RISK_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'admin.user.suspend',
  'admin.user.reactivate',
  'admin.kyc.review',
  'admin.refund.issue',
  'admin.override.otp',
  'admin.maintenance.toggle',
]);

/** Actions that require two-person approval above configured thresholds (M8). */
export const TWO_PERSON_ACTIONS: ReadonlySet<Action> = new Set<Action>(['admin.refund.issue', 'admin.user.suspend']);

export function can(roles: readonly UserRole[], action: Action): boolean {
  const allowed = PERMISSION_MATRIX[action];
  return roles.some((r) => allowed.includes(r));
}

export function rolesFor(action: Action): readonly UserRole[] {
  return PERMISSION_MATRIX[action];
}
