import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BidView, NearbyJobItem, OfferView, ProviderProfileView } from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';

export const providerKeys = {
  profile: ['provider', 'profile'] as const,
  feed: ['provider', 'feed'] as const,
  bids: ['provider', 'bids'] as const,
  offers: (jobId: string) => ['job', jobId, 'offers'] as const,
};

export interface BidTerms {
  labourPaise: number;
  visitFeePaise: number;
  etaMinutes: number;
  warrantyDays: number;
  materialResponsibility?: 'PROVIDER' | 'CUSTOMER' | 'VENDOR';
  notes?: string;
}

export interface ProviderBidItem extends BidView {
  job: {
    id: string;
    status: string;
    categoryName: string;
    categoryIconKey: string;
    description: string | null;
    areaLabel: string;
    priority: 'NORMAL' | 'URGENT';
  };
}

export function useProviderProfile() {
  return useQuery({
    queryKey: providerKeys.profile,
    queryFn: () => api<ProviderProfileView>('/provider/profile'),
    staleTime: 30_000,
  });
}

export function useUpdateProviderProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { businessName?: string; bio?: string; experienceYears?: number; serviceRadiusKm?: number; baseAddressId?: string; skillIds?: string[] }) =>
      api<ProviderProfileView>('/provider/profile', { method: 'PUT', body }),
    onSuccess: (p) => {
      qc.setQueryData(providerKeys.profile, p);
      void qc.invalidateQueries({ queryKey: providerKeys.feed });
    },
  });
}

export function useSetAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isAvailable: boolean) => api<{ isAvailable: boolean }>('/provider/availability', { method: 'POST', body: { isAvailable } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.profile });
      void qc.invalidateQueries({ queryKey: providerKeys.feed });
    },
  });
}

export function useSubmitKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { documentType: string; documentNumber: string; mime: string; sizeBytes: number }) =>
      api<{ kyc: { id: string; status: string; last4: string | null } }>('/provider/kyc', { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: providerKeys.profile }),
  });
}

export function useNearbyJobs() {
  return useQuery({
    queryKey: providerKeys.feed,
    queryFn: () => api<{ items: NearbyJobItem[]; blockers: string[] }>('/provider/jobs/nearby'),
    // New work arrives on the server, so keep the feed fresh while it is open.
    refetchInterval: 20_000,
  });
}

export function useMyBids() {
  return useQuery({
    queryKey: providerKeys.bids,
    queryFn: () => api<{ items: ProviderBidItem[] }>('/provider/bids'),
    staleTime: 15_000,
  });
}

export function usePlaceBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...terms }: BidTerms & { jobId: string }) =>
      api<BidView>(`/jobs/${jobId}/bids`, { method: 'POST', body: terms, idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.feed });
      void qc.invalidateQueries({ queryKey: providerKeys.bids });
    },
  });
}

export function useReviseBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bidId, ...terms }: BidTerms & { bidId: string }) => api<BidView>(`/bids/${bidId}/revise`, { method: 'POST', body: terms }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.feed });
      void qc.invalidateQueries({ queryKey: providerKeys.bids });
    },
  });
}

export function useWithdrawBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bidId, reason }: { bidId: string; reason: string }) =>
      api<BidView>(`/bids/${bidId}/withdraw`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: providerKeys.feed });
      void qc.invalidateQueries({ queryKey: providerKeys.bids });
    },
  });
}

/** Customer-side: the ranked offers on one of my jobs. */
export function useOffers(jobId: string | undefined, poll = true) {
  return useQuery({
    queryKey: providerKeys.offers(jobId ?? ''),
    enabled: !!jobId,
    queryFn: () => api<{ items: OfferView[] }>(`/jobs/${jobId}/offers`),
    refetchInterval: poll ? 15_000 : false,
  });
}
