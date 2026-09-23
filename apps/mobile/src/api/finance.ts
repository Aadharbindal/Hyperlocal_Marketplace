import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CancellationQuoteView, DisputeView, EarningsView, JobMoneyView, ReviewView } from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';
import { executionKeys } from './execution';
import { jobKeys } from './jobs';

export const financeKeys = {
  money: (jobId: string) => ['job', jobId, 'money'] as const,
  disputes: (jobId: string) => ['job', jobId, 'disputes'] as const,
  cancellation: (jobId: string) => ['job', jobId, 'cancellation-quote'] as const,
  earnings: () => ['me', 'earnings'] as const,
  reviews: (providerId: string) => ['provider', providerId, 'reviews'] as const,
};

function invalidate(qc: ReturnType<typeof useQueryClient>, jobId: string) {
  void qc.invalidateQueries({ queryKey: financeKeys.money(jobId) });
  void qc.invalidateQueries({ queryKey: financeKeys.disputes(jobId) });
  void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  void qc.invalidateQueries({ queryKey: executionKeys.panel(jobId) });
  void qc.invalidateQueries({ queryKey: financeKeys.earnings() });
  void qc.invalidateQueries({ queryKey: ['jobs'] });
}

/** What has been held, taken or given back on one job. */
export function useJobMoney(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: financeKeys.money(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: () => api<JobMoneyView>(`/jobs/${jobId}/money`),
    staleTime: 15_000,
  });
}

/** What cancelling right now would cost, fetched before the customer commits to it. */
export function useCancellationQuote(jobId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: financeKeys.cancellation(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: () => api<CancellationQuoteView>(`/jobs/${jobId}/cancellation-quote`),
  });
}

export function useDisputes(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: financeKeys.disputes(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: () => api<{ items: DisputeView[] }>(`/jobs/${jobId}/disputes`),
  });
}

export function useRaiseDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string; category: string; description: string; mediaIds?: string[] }) =>
      api<DisputeView>(`/jobs/${jobId}/dispute`, { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useLeaveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string; rating: number; comment?: string }) =>
      api<ReviewView>(`/jobs/${jobId}/review`, { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useEarnings() {
  return useQuery({
    queryKey: financeKeys.earnings(),
    queryFn: () => api<EarningsView>('/me/earnings'),
    staleTime: 30_000,
  });
}

export function useProviderReviews(providerId: string | undefined) {
  return useQuery({
    queryKey: financeKeys.reviews(providerId ?? ''),
    enabled: !!providerId,
    queryFn: () => api<{ items: ReviewView[] }>(`/providers/${providerId}/reviews`),
  });
}
