import { describe, expect, it } from 'vitest';
import { ACTIONS, HIGH_RISK_ACTIONS, PERMISSION_MATRIX, can } from './permissions';

describe('permissions', () => {
  it('every action has at least one role', () => {
    for (const a of ACTIONS) expect(PERMISSION_MATRIX[a].length).toBeGreaterThan(0);
  });
  it('customers cannot bid, providers cannot approve completion', () => {
    expect(can(['CUSTOMER'], 'bid.create')).toBe(false);
    expect(can(['PROVIDER'], 'job.approve_completion')).toBe(false);
    expect(can(['CUSTOMER'], 'job.approve_completion')).toBe(true);
  });
  it('support cannot suspend or refund; admin can', () => {
    expect(can(['SUPPORT'], 'admin.user.suspend')).toBe(false);
    expect(can(['SUPPORT'], 'admin.refund.issue')).toBe(false);
    expect(can(['ADMIN'], 'admin.user.suspend')).toBe(true);
  });
  it('multi-role users get the union', () => {
    expect(can(['CUSTOMER', 'PROVIDER'], 'bid.create')).toBe(true);
    expect(can(['CUSTOMER', 'PROVIDER'], 'job.create')).toBe(true);
  });
  it('technicians cannot bid or manage other technicians', () => {
    expect(can(['TECHNICIAN'], 'bid.create')).toBe(false);
    expect(can(['TECHNICIAN'], 'technician.manage')).toBe(false);
    expect(can(['TECHNICIAN'], 'job.start_with_otp')).toBe(true);
  });
  it('high-risk actions are admin-only', () => {
    for (const a of HIGH_RISK_ACTIONS) expect(PERMISSION_MATRIX[a]).toEqual(['ADMIN']);
  });
});
