import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DataExportView,
  PublicProviderView,
  SearchResultsView,
  WarrantyClaimView,
  WarrantyStatusView,
} from '@hyperlocal/core';
import { api } from './client';
import { growthKeys } from './growth';

export const warrantyKeys = {
  status: (jobId: string) => ['job', jobId, 'warranty'] as const,
  claims: () => ['me', 'warranty-claims'] as const,
  provider: (id: string) => ['provider', 'public', id] as const,
  search: (q: string) => ['search', q] as const,
};

// ---------------------------------------------------------------------------
// Warranty
// ---------------------------------------------------------------------------

/** What a finished job says about its own cover. The app never works this out itself. */
export function useWarrantyStatus(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: warrantyKeys.status(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: () => api<WarrantyStatusView>(`/jobs/${jobId}/warranty`),
    staleTime: 60_000,
  });
}

export function useWarrantyClaims() {
  return useQuery({
    queryKey: warrantyKeys.claims(),
    queryFn: async () => (await api<{ items: WarrantyClaimView[] }>('/me/warranty-claims')).items,
    staleTime: 30_000,
  });
}

export function useRaiseWarrantyClaim(jobId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { description: string; mediaIds?: string[] }) =>
      api<{ claim: WarrantyClaimView }>(`/jobs/${jobId}/warranty-claim`, { method: 'POST', body }),
    onSuccess: () => {
      if (jobId) void qc.invalidateQueries({ queryKey: warrantyKeys.status(jobId) });
      void qc.invalidateQueries({ queryKey: warrantyKeys.claims() });
    },
  });
}

/** The professional's answer. Declining needs a reason; the server insists, and so does the UI. */
export function useRespondToClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, ...body }: { claimId: string; response: 'ACCEPT' | 'DECLINE'; reason?: string }) =>
      api<{ claim: WarrantyClaimView }>(`/warranty-claims/${claimId}/respond`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: warrantyKeys.claims() }),
  });
}

export function useBookRevisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, preferredStart }: { claimId: string; preferredStart?: string }) =>
      api<{ claim: WarrantyClaimView }>(`/warranty-claims/${claimId}/revisit`, { method: 'POST', body: { preferredStart } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: warrantyKeys.claims() });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useResolveClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, note }: { claimId: string; note: string }) =>
      api<{ claim: WarrantyClaimView }>(`/warranty-claims/${claimId}/resolve`, { method: 'POST', body: { note } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: warrantyKeys.claims() }),
  });
}

// ---------------------------------------------------------------------------
// The professional a customer is choosing between
// ---------------------------------------------------------------------------

export function usePublicProvider(providerId: string | undefined) {
  return useQuery({
    queryKey: warrantyKeys.provider(providerId ?? ''),
    enabled: !!providerId,
    queryFn: async () => (await api<{ provider: PublicProviderView }>(`/providers/${providerId}`)).provider,
    staleTime: 5 * 60_000,
  });
}

/** Saving somebody from their profile, which is where a customer decides they want them again. */
export function useFavouriteFromProfile(providerId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saved: boolean) =>
      api(`/providers/${providerId}/favourite`, { method: saved ? 'DELETE' : 'POST', body: saved ? undefined : {} }),
    onSuccess: () => {
      if (providerId) void qc.invalidateQueries({ queryKey: warrantyKeys.provider(providerId) });
      void qc.invalidateQueries({ queryKey: growthKeys.favourites() });
    },
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Searches as somebody types. Kept short and cached per query, because the point of this box is
 * that it answers before the word is finished.
 */
export function useSearch(query: string) {
  return useQuery({
    queryKey: warrantyKeys.search(query),
    queryFn: () => api<SearchResultsView>(`/search${query ? `?q=${encodeURIComponent(query)}` : ''}`),
    // The catalog does not move; re-asking for the same word is waste.
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}

// ---------------------------------------------------------------------------
// What we hold about you
// ---------------------------------------------------------------------------

export function useDataExport() {
  return useMutation({
    mutationFn: () => api<DataExportView>('/me/export'),
  });
}
