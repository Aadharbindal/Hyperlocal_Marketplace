import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatThreadView, CompletionView, ExecutionView, PriceRevisionView } from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';
import { bookingKeys } from './negotiation';
import { jobKeys, type LocalMedia } from './jobs';
import { FALLBACK_POLL_MS } from './polling';

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
    // the live stream carries updates; this is the fallback when it is not connected
    refetchInterval: enabled ? FALLBACK_POLL_MS : false,
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

/**
 * Attaches progress, revision or completion evidence; the server picks the phase from the job's
 * status, so the client never has to guess which one it is in.
 *
 * The bytes are transferred when the storage adapter asks for them. In mock mode the API marks
 * the row uploaded and says the transfer is not required, so the same code path works both ways
 * without the app pretending a file exists that does not.
 */
export function useAddEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, file }: { jobId: string; file: LocalMedia }) => {
      const res = await api<{ media: { id: string; url: string }; upload: { url: string; method: 'PUT' | 'POST'; required: boolean } }>(
        `/jobs/${jobId}/evidence`,
        {
          method: 'POST',
          body: {
            kind: file.kind,
            mime: file.mime,
            sizeBytes: file.sizeBytes,
            ...(file.durationSeconds ? { durationSeconds: Math.round(file.durationSeconds) } : {}),
          },
        },
      );
      if (res.upload.required) {
        const blob = await (await fetch(file.uri)).blob();
        await fetch(res.upload.url, { method: res.upload.method, body: blob, headers: { 'content-type': file.mime } });
      }
      return res;
    },
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
    refetchInterval: enabled ? FALLBACK_POLL_MS : false,
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
