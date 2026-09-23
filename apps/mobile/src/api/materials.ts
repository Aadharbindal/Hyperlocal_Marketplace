import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MaterialOrderView, MaterialPanelView, MaterialQuoteView, MaterialRequestView, VendorRequestView } from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';
import { executionKeys } from './execution';
import { jobKeys } from './jobs';
import { FALLBACK_POLL_MS, FALLBACK_POLL_SLOW_MS } from './polling';

export const materialKeys = {
  panel: (jobId: string) => ['job', jobId, 'materials'] as const,
  vendorFeed: () => ['vendor', 'material-requests'] as const,
  vendorOrders: () => ['vendor', 'material-orders'] as const,
};

function invalidate(qc: ReturnType<typeof useQueryClient>, jobId?: string) {
  if (jobId) {
    void qc.invalidateQueries({ queryKey: materialKeys.panel(jobId) });
    void qc.invalidateQueries({ queryKey: executionKeys.panel(jobId) });
    void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  }
  void qc.invalidateQueries({ queryKey: materialKeys.vendorFeed() });
  void qc.invalidateQueries({ queryKey: materialKeys.vendorOrders() });
}

/** The material leg of one job, as the asking side sees it. */
export function useMaterials(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: materialKeys.panel(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: () => api<MaterialPanelView>(`/jobs/${jobId}/materials`),
    refetchInterval: enabled ? FALLBACK_POLL_MS : false,
  });
}

export function useRequestMaterials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string; items: Array<{ name: string; quantity: number; unit: string }>; note?: string; neededByMinutes?: number }) =>
      api<MaterialRequestView>(`/jobs/${jobId}/material-request`, { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useSelectMaterialQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId }: { jobId: string; quoteId: string }) =>
      api<{ order: MaterialOrderView; payment: { id: string; amountPaise: number; status: string } }>(
        `/material-quotes/${quoteId}/select`,
        { method: 'POST', idempotencyKey: newIdempotencyKey() },
      ),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useConfirmDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, ...body }: { jobId: string; orderId: string; ok: boolean; issue?: string; note?: string }) =>
      api<MaterialOrderView>(`/material-orders/${orderId}/confirm`, { method: 'POST', body }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

// --------------------------------------------------------------------------- vendor

export function useVendorRequests() {
  return useQuery({
    queryKey: materialKeys.vendorFeed(),
    queryFn: () => api<{ items: VendorRequestView[]; blockers: string[] }>('/vendor/material-requests'),
    refetchInterval: FALLBACK_POLL_SLOW_MS,
  });
}

export function useVendorOrders() {
  return useQuery({
    queryKey: materialKeys.vendorOrders(),
    queryFn: () => api<{ items: MaterialOrderView[] }>('/vendor/material-orders'),
    refetchInterval: FALLBACK_POLL_SLOW_MS,
  });
}

export function useSendMaterialQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      ...body
    }: {
      requestId: string;
      items: Array<{ name: string; quantity: number; unit: string; unitPricePaise: number; inStock: boolean; brand?: string }>;
      deliveryPaise: number;
      etaMinutes: number;
      note?: string;
    }) => api<MaterialQuoteView>(`/material-requests/${requestId}/quote`, { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => invalidate(qc),
  });
}

export function useMoveMaterialOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, to, reason }: { orderId: string; to: 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED'; reason?: string }) =>
      api<MaterialOrderView>(`/material-orders/${orderId}/status`, { method: 'POST', body: { to, reason } }),
    onSuccess: () => invalidate(qc),
  });
}
