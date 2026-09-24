import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FavouriteProviderView,
  FeedFilters,
  InvoiceView,
  JobView,
  PromoPreview,
  ReferralView,
} from '@hyperlocal/core';
import { api } from './client';

export const growthKeys = {
  invoice: (jobId: string) => ['job', jobId, 'invoice'] as const,
  invoices: () => ['me', 'invoices'] as const,
  favourites: () => ['me', 'favourites'] as const,
  referrals: () => ['me', 'referrals'] as const,
};

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export function useInvoice(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: growthKeys.invoice(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: async () => (await api<{ invoice: InvoiceView }>(`/jobs/${jobId}/invoice`)).invoice,
    // A receipt does not change once issued, so there is nothing to refetch for.
    staleTime: Infinity,
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: growthKeys.invoices(),
    queryFn: async () => (await api<{ items: InvoiceView[] }>('/me/invoices')).items,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Favourites and rebooking
// ---------------------------------------------------------------------------

export function useFavourites() {
  return useQuery({
    queryKey: growthKeys.favourites(),
    queryFn: async () => (await api<{ items: FavouriteProviderView[] }>('/me/favourites')).items,
    staleTime: 60_000,
  });
}

export function useToggleFavourite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, saved, note }: { providerId: string; saved: boolean; note?: string }) =>
      api<{ items: FavouriteProviderView[] }>(`/providers/${providerId}/favourite`, {
        method: saved ? 'DELETE' : 'POST',
        body: saved ? undefined : { note },
      }),
    onSuccess: (r) => qc.setQueryData(growthKeys.favourites(), r.items),
  });
}

/** Booking the same work again. Everything already known is carried over from the earlier job. */
export function useRebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string; preferProviderId?: string; description?: string; preferredStart?: string }) =>
      api<{ job: JobView }>(`/jobs/${jobId}/rebook`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

/**
 * What a code would take off, checked before the customer commits to it. The server checks
 * again at acceptance, because the answer can change between looking and booking.
 */
export function usePromoPreview() {
  return useMutation({
    mutationFn: ({ code, orderPaise }: { code: string; orderPaise: number }) =>
      api<{ promo: PromoPreview }>(`/promo/preview?code=${encodeURIComponent(code)}&orderPaise=${orderPaise}`),
  });
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export function useReferrals() {
  return useQuery({
    queryKey: growthKeys.referrals(),
    queryFn: () => api<ReferralView>('/me/referrals'),
    staleTime: 60_000,
  });
}

export function useClaimReferral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<{ ok: boolean; referrerName: string }>('/me/referrals/claim', { method: 'POST', body: { code } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: growthKeys.referrals() }),
  });
}

// ---------------------------------------------------------------------------
// Feed filters
// ---------------------------------------------------------------------------

/** Turns the filter object into the comma-separated query the API expects. */
export function feedQueryFrom(filters: FeedFilters, limit = 20): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (filters.categoryIds?.length) params.set('categoryIds', filters.categoryIds.join(','));
  if (filters.maxDistanceKm !== undefined) params.set('maxDistanceKm', String(filters.maxDistanceKm));
  if (filters.priorities?.length) params.set('priorities', filters.priorities.join(','));
  if (filters.requestTypes?.length) params.set('requestTypes', filters.requestTypes.join(','));
  if (filters.maxBids !== undefined) params.set('maxBids', String(filters.maxBids));
  if (filters.hideMyBids) params.set('hideMyBids', 'true');
  if (filters.withMediaOnly) params.set('withMediaOnly', 'true');
  if (filters.sort) params.set('sort', filters.sort);
  return params.toString();
}

/** How many filters are on, for the little number on the filter button. */
export function activeFilterCount(filters: FeedFilters): number {
  let n = 0;
  if (filters.categoryIds?.length) n++;
  if (filters.maxDistanceKm !== undefined) n++;
  if (filters.priorities?.length) n++;
  if (filters.requestTypes?.length) n++;
  if (filters.maxBids !== undefined) n++;
  if (filters.hideMyBids) n++;
  if (filters.withMediaOnly) n++;
  return n;
}
