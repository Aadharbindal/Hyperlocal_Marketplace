import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancellationQuoteView,
  DisputeView,
  EarningsView,
  JobMoneyView,
  PayoutAccountBody,
  PayoutAccountView,
  ReviewView,
  SupportTicketBody,
  SupportTicketCreated,
  SupportTicketsResponse,
} from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';
import { executionKeys } from './execution';
import { jobKeys } from './jobs';

export const financeKeys = {
  money: (jobId: string) => ['job', jobId, 'money'] as const,
  disputes: (jobId: string) => ['job', jobId, 'disputes'] as const,
  cancellation: (jobId: string) => ['job', jobId, 'cancellation-quote'] as const,
  earnings: () => ['me', 'earnings'] as const,
  payoutAccount: () => ['me', 'payout-account'] as const,
  supportTickets: () => ['me', 'support-tickets'] as const,
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

/**
 * Appealing a decision.
 *
 * One per dispute, within a week, reviewed by somebody who did not decide it the first time - all
 * enforced on the server. The view's `canAppeal` is what decides whether this is offered at all,
 * so the button and the rule cannot disagree.
 */
export function useAppealDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, reason }: { jobId: string; disputeId: string; reason: string }) =>
      api<{ ok: true }>(`/disputes/${disputeId}/appeal`, { method: 'POST', body: { reason } }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

/**
 * Adding something to a dispute that is still open.
 *
 * The endpoint has existed since the finance work with nothing calling it, which meant a customer
 * who found the receipt an hour after reporting the problem had no way to hand it over - and
 * support decided on what was in the first message.
 */
export function useAddDisputeEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, mediaIds, note }: { jobId: string; disputeId: string; mediaIds: string[]; note?: string }) =>
      api<DisputeView>(`/disputes/${disputeId}/evidence`, { method: 'POST', body: { mediaIds, ...(note ? { note } : {}) } }),
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

/**
 * Where this payee's money goes. Only ever the masked view comes back - the details are sent
 * once, to the server, and are never held on the device.
 */
export function usePayoutAccount() {
  return useQuery({
    queryKey: financeKeys.payoutAccount(),
    queryFn: async () => (await api<{ payoutAccount: PayoutAccountView | null }>('/me/payout-account')).payoutAccount,
    staleTime: 60_000,
  });
}

export function useSetPayoutAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PayoutAccountBody) =>
      api<{ payoutAccount: PayoutAccountView }>('/me/payout-account', { method: 'POST', body }),
    onSuccess: (r) => {
      qc.setQueryData(financeKeys.payoutAccount(), r.payoutAccount);
      // Anything that was waiting on this is released server-side, so the earnings view is stale.
      void qc.invalidateQueries({ queryKey: financeKeys.earnings() });
    },
  });
}

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

/**
 * The tickets this person has opened.
 *
 * Staff get everybody's from the same endpoint; that branch is the console's, not this app's, and
 * the server decides which it is from the active role rather than from anything sent here.
 */
export function useSupportTickets() {
  return useQuery({
    queryKey: financeKeys.supportTickets(),
    queryFn: () => api<SupportTicketsResponse>('/support/tickets'),
  });
}

export function useRaiseSupportTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SupportTicketBody) =>
      api<SupportTicketCreated>('/support/tickets', { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    // So the list the person is sent back to already has it in, rather than appearing a poll later
    // and leaving them wondering whether it sent.
    onSuccess: () => void qc.invalidateQueries({ queryKey: financeKeys.supportTickets() }),
  });
}
