import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlaggedMessageView, ModerationOutcome } from '@hyperlocal/core';
import { api } from './client';

export const adminTrustKeys = {
  flagged: ['admin', 'flagged-messages'] as const,
  promos: ['admin', 'promos'] as const,
  recoveryCodes: ['admin', 'recovery-codes'] as const,
};

/** Messages the contact filter caught, oldest first, with an overdue count for the header. */
export function useFlaggedMessages() {
  return useQuery({
    queryKey: adminTrustKeys.flagged,
    queryFn: () => api<{ items: FlaggedMessageView[]; overdue: number }>('/admin/flagged-messages'),
    staleTime: 30_000,
  });
}

export function useReviewMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; outcome: ModerationOutcome; reason?: string }) =>
      api<{ ok: boolean }>(`/admin/flagged-messages/${id}/review`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminTrustKeys.flagged }),
  });
}

export interface AdminPromo {
  id: string;
  code: string;
  kind: 'FLAT' | 'PERCENT';
  value: number;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  redemptionCount: number;
  maxRedemptions: number | null;
  firstJobOnly: boolean;
  active: boolean;
  endsAt: string | null;
}

export function usePromos() {
  return useQuery({
    queryKey: adminTrustKeys.promos,
    queryFn: async () => (await api<{ items: AdminPromo[] }>('/admin/promos')).items,
    staleTime: 60_000,
  });
}

export function useCreatePromo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      code: string;
      kind: 'FLAT' | 'PERCENT';
      value: number;
      maxDiscountPaise?: number;
      minOrderPaise: number;
      maxPerCustomer: number;
      firstJobOnly: boolean;
    }) => api<{ promo: { id: string; code: string } }>('/admin/promos', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminTrustKeys.promos }),
  });
}

export function useDeactivatePromo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/admin/promos/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminTrustKeys.promos }),
  });
}

/** How many recovery codes are left. Never the codes themselves. */
export function useRecoveryCodeCount() {
  return useQuery({
    queryKey: adminTrustKeys.recoveryCodes,
    queryFn: () => api<{ remaining: number; generatedAt: string | null }>('/admin/mfa/recovery-codes'),
    staleTime: 60_000,
  });
}

export function useGenerateRecoveryCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ codes: string[]; warning: string }>('/admin/mfa/recovery-codes', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminTrustKeys.recoveryCodes }),
  });
}
