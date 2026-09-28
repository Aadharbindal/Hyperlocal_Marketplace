import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserView, DisputeView, KycReviewItem, MfaSetupView, MfaStatusView, OpsReportView } from '@hyperlocal/core';
import { api } from './client';
import { FALLBACK_POLL_MS, FALLBACK_POLL_SLOW_MS } from './polling';

export const adminKeys = {
  mfa: () => ['admin', 'mfa'] as const,
  kyc: () => ['admin', 'kyc'] as const,
  disputes: () => ['admin', 'disputes'] as const,
  settlements: (status: string) => ['admin', 'settlements', status] as const,
  report: () => ['admin', 'report'] as const,
  user: (id: string) => ['admin', 'user', id] as const,
};

export interface AdminSettlement {
  id: string;
  jobId: string;
  payeeId: string;
  payeeRole: string;
  amountPaise: number;
  status: string;
  attempts: number;
  failureReason: string | null;
  createdAt: string;
}

// --------------------------------------------------------------------------- MFA

export function useMfaStatus() {
  return useQuery({ queryKey: adminKeys.mfa(), queryFn: () => api<MfaStatusView>('/admin/mfa') });
}

export function useStartMfa() {
  return useMutation({ mutationFn: () => api<MfaSetupView>('/admin/mfa/setup', { method: 'POST' }) });
}

export function useEnableMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<{ enabled: boolean }>('/admin/mfa/enable', { method: 'POST', body: { code } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.mfa() }),
  });
}

export function useVerifyMfa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<{ verified: boolean }>('/admin/mfa/verify', { method: 'POST', body: { code } }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

/**
 * Getting back in with a recovery code, when the authenticator is gone.
 *
 * The phone with the authenticator on it gets lost, stolen and factory-reset like any other, and
 * without this the only way back into an admin account is somebody with database access - which
 * is both slow and a far worse thing to have a habit of. The codes were shown once at setup and
 * are stored hashed; using one burns it.
 */
export function useUseRecoveryCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<{ ok: boolean; remaining: number }>('/admin/mfa/recover', { method: 'POST', body: { code } }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

// --------------------------------------------------------------------------- one job's money

export interface LedgerEntry {
  id: string;
  jobId: string;
  entryType: string;
  accountUserId: string | null;
  amountPaise: number;
  batchId: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * Every ledger line for one booking, and what they net to.
 *
 * The question this answers is the one support is actually asked - "where did my money go?" -
 * and until now answering it meant running SQL against production. The ledger is append-only and
 * double-entry, so the net is the whole point: if it does not match what the platform still
 * holds for that job, something is wrong and this is where it shows.
 */
export function useJobLedger(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-ledger', jobId],
    enabled: enabled && !!jobId,
    queryFn: () => api<{ items: LedgerEntry[]; netPaise: number }>(`/admin/jobs/${jobId}/ledger`),
  });
}

/**
 * A refund somebody decided on, rather than one a rule produced.
 *
 * Deliberately not a button next to the ledger lines: it takes an amount and a reason of real
 * length, because this moves money back on a human judgement and the reason is what somebody
 * reads a year later when asked to justify it.
 */
export function useAdminRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, amountPaise, reason }: { jobId: string; amountPaise: number; reason: string }) =>
      api<{ id: string; amountPaise: number }>(`/admin/jobs/${jobId}/refund`, { method: 'POST', body: { amountPaise, reason } }),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin-ledger', vars.jobId] });
      void qc.invalidateQueries({ queryKey: adminKeys.settlements('PENDING') });
    },
  });
}

// --------------------------------------------------------------------------- queues

export function useKycQueue(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.kyc(),
    enabled,
    queryFn: () => api<{ items: KycReviewItem[] }>('/admin/kyc'),
    refetchInterval: enabled ? FALLBACK_POLL_MS : false,
  });
}

/** Opening a document is a separate, logged act - never part of loading the queue. */
export function useOpenKycDocument() {
  return useMutation({ mutationFn: (id: string) => api<KycReviewItem>(`/admin/kyc/${id}/open`, { method: 'POST' }) });
}

export function useReviewKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; decision: 'APPROVE' | 'REJECT' | 'NEEDS_MORE'; reason?: string }) =>
      api<{ id: string; status: string }>(`/admin/kyc/${id}/review`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.kyc() });
      void qc.invalidateQueries({ queryKey: adminKeys.report() });
    },
  });
}

export function useDisputeQueue(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.disputes(),
    enabled,
    queryFn: () => api<{ items: DisputeView[] }>('/admin/disputes'),
    refetchInterval: enabled ? FALLBACK_POLL_MS : false,
  });
}

export function useResolveDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      resolution: string;
      reason: string;
      refundPaise?: number;
      secondApproverId?: string;
    }) => api<DisputeView>(`/admin/disputes/${id}/resolve`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.disputes() });
      void qc.invalidateQueries({ queryKey: adminKeys.report() });
    },
  });
}

export function useMoveDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to, note }: { id: string; to: 'UNDER_REVIEW' | 'AWAITING_PARTY' | 'ESCALATED'; note?: string }) =>
      api<DisputeView>(`/admin/disputes/${id}/move`, { method: 'POST', body: { to, note } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.disputes() }),
  });
}

// --------------------------------------------------------------------------- money

export function useAdminSettlements(status: string, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.settlements(status),
    enabled,
    queryFn: () => api<{ items: AdminSettlement[] }>(`/admin/settlements?status=${status}`),
  });
}

export function useRunSettlements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ results: Array<{ id: string; status: string; reason?: string }> }>('/admin/settlements/run', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export function useRetrySettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string; status: string }>(`/admin/settlements/${id}/retry`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export function useOpsReport(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.report(),
    enabled,
    queryFn: () => api<OpsReportView>('/admin/reports/overview'),
    refetchInterval: enabled ? FALLBACK_POLL_SLOW_MS : false,
  });
}

export function useAdminUser(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.user(id ?? ''),
    enabled: !!id,
    queryFn: () => api<AdminUserView>(`/admin/users/${id}`),
  });
}
