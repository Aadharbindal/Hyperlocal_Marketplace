import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatThreadView, CompletionView, ExecutionView, PriceRevisionView } from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';
import { bookingKeys } from './negotiation';
import { jobKeys } from './jobs';

export const executionKeys = {
  panel: (jobId: string) => ['job', jobId, 'execution'] as const,
  chat: (jobId: string) => ['job', jobId, 'chat'] as const,
};

function invalidate(qc: ReturnType<typeof useQueryClient>, jobId: string) {
  void qc.invalidateQueries({ queryKey: executionKeys.panel(jobId) });
  void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
  void qc.invalidateQueries({ queryKey: bookingKeys.booking(jobId) });
  void qc.invalidateQueries({ queryKey: ['jobs'] });
}

/** The live panel both sides watch while a job is running. */
export function useExecution(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: executionKeys.panel(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: () => api<ExecutionView>(`/jobs/${jobId}/execution`),
    // there is no realtime channel yet, so the panel polls while the job is live
    refetchInterval: enabled ? 15_000 : false,
  });
}

export function useProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, to, etaMinutes }: { jobId: string; to: 'EN_ROUTE' | 'ARRIVED'; etaMinutes?: number }) =>
      api<{ id: string; status: string }>(`/jobs/${jobId}/progress`, { method: 'POST', body: { to, etaMinutes } }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useStartJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, code }: { jobId: string; code: string }) =>
      api<{ id: string; status: string }>(`/jobs/${jobId}/start`, { method: 'POST', body: { code } }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

/** Attaches progress, revision or completion evidence; the server picks the phase. */
export function useAddEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, mime, sizeBytes }: { jobId: string; mime: string; sizeBytes: number }) =>
      api<{ media: { id: string; url: string } }>(`/jobs/${jobId}/evidence`, {
        method: 'POST',
        body: { kind: 'PHOTO', mime, sizeBytes },
      }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useRequestRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      ...body
    }: {
      jobId: string;
      reason: string;
      extraLabourPaise: number;
      extraMaterialPaise?: number;
      extraTimeMinutes?: number;
      explanation: string;
      mediaIds: string[];
    }) => api<PriceRevisionView>(`/jobs/${jobId}/price-revision`, { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useRespondToRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ revisionId, ...body }: { jobId: string; revisionId: string; action: 'APPROVE' | 'REJECT' | 'CLARIFY'; message?: string }) =>
      api<{ revision: PriceRevisionView; payment: { id: string; amountPaise: number } | null }>(
        `/price-revisions/${revisionId}/respond`,
        { method: 'POST', body },
      ),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useCompleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string; summary: string; mediaIds: string[]; warrantyNote?: string }) =>
      api<{ status: string; completion: CompletionView }>(`/jobs/${jobId}/complete`, { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useApproveCompletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: { jobId: string; approved: boolean; reason?: string; rating?: number }) =>
      api<{ status: string; completion: CompletionView }>(`/jobs/${jobId}/approve`, { method: 'POST', body }),
    onSuccess: (_r, v) => invalidate(qc, v.jobId),
  });
}

export function useChat(jobId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: executionKeys.chat(jobId ?? ''),
    enabled: !!jobId && enabled,
    queryFn: () => api<ChatThreadView>(`/jobs/${jobId}/chat`),
    refetchInterval: enabled ? 8_000 : false,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: string }) =>
      api<{ id: string; flagged: boolean }>(`/jobs/${jobId}/chat`, { method: 'POST', body: { body } }),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: executionKeys.chat(v.jobId) });
      void qc.invalidateQueries({ queryKey: executionKeys.panel(v.jobId) });
    },
  });
}
