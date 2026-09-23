import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcceptOfferResponse, AssignmentView, BookingQuoteView, OfferChainItem, PaymentView } from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';
import { jobKeys } from './jobs';
import { providerKeys } from './provider';
import { FALLBACK_POLL_MS } from './polling';

export const bookingKeys = {
  chain: (jobId: string) => ['job', jobId, 'offer-chain'] as const,
  booking: (jobId: string) => ['job', jobId, 'booking'] as const,
};

export interface BookingView {
  quote: BookingQuoteView | null;
  assignment: AssignmentView | null;
  payments: PaymentView[];
}

export function useOfferChain(jobId: string | undefined, poll = false) {
  return useQuery({
    queryKey: bookingKeys.chain(jobId ?? ''),
    enabled: !!jobId,
    queryFn: () => api<{ items: OfferChainItem[] }>(`/jobs/${jobId}/offer-chain`),
    refetchInterval: poll ? FALLBACK_POLL_MS : false,
  });
}

export function useBooking(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: bookingKeys.booking(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: () => api<BookingView>(`/jobs/${jobId}/booking`),
    staleTime: 10_000,
  });
}

/** Everything a booking touches: the job, its offers, the chain and the booking itself. */
function invalidateBooking(qc: ReturnType<typeof useQueryClient>, jobId: string) {
  void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  void qc.invalidateQueries({ queryKey: providerKeys.offers(jobId) });
  void qc.invalidateQueries({ queryKey: bookingKeys.chain(jobId) });
  void qc.invalidateQueries({ queryKey: bookingKeys.booking(jobId) });
  void qc.invalidateQueries({ queryKey: ['jobs'] });
}

export function useCounterOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string; bidId: string; labourPaise: number; visitFeePaise?: number; scopeNotes?: string }) =>
      api<OfferChainItem>(`/jobs/${jobId}/counter-offer`, { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: (_r, v) => invalidateBooking(qc, v.jobId),
  });
}

export function useRespondToOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ offerId, ...body }: { jobId: string; offerId: string; action: 'ACCEPT' | 'REJECT' | 'COUNTER'; labourPaise?: number; scopeNotes?: string }) =>
      api<OfferChainItem>(`/offers/${offerId}/respond`, { method: 'POST', body }),
    onSuccess: (_r, v) => invalidateBooking(qc, v.jobId),
  });
}

export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bidId }: { jobId: string; bidId: string }) =>
      api<AcceptOfferResponse>(`/bids/${bidId}/accept`, { method: 'POST', idempotencyKey: newIdempotencyKey() }),
    onSuccess: (_r, v) => invalidateBooking(qc, v.jobId),
  });
}

/**
 * Completes the mock gateway checkout. A live gateway replaces this with its own SDK sheet;
 * the server then hears about the result through the signed webhook instead.
 */
export function useCompleteMockPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, outcome }: { jobId: string; paymentId: string; outcome: 'authorized' | 'failed' }) =>
      api<{ ok: boolean; payment: PaymentView | null }>(`/payments/${paymentId}/mock-complete`, { method: 'POST', body: { outcome } }),
    onSuccess: (_r, v) => invalidateBooking(qc, v.jobId),
  });
}
