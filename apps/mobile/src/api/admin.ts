import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserView, DisputeView, KycReviewItem, MfaSetupView, MfaStatusView, OpsReportView } from '@hyperlocal/core';
import { api } from './client';

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

// --------------------------------------------------------------------------- queues

export function useKycQueue(enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.kyc(),
    enabled,
    queryFn: () => api<{ items: KycReviewItem[] }>('/admin/kyc'),
    refetchInterval: enabled ? 30_000 : false,
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
    refetchInterval: enabled ? 30_000 : false,
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
    refetchInterval: enabled ? 60_000 : false,
  });
}

export function useAdminUser(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.user(id ?? ''),
    enabled: !!id,
    queryFn: () => api<AdminUserView>(`/admin/users/${id}`),
  });
}
