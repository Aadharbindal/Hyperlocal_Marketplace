import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddressView, JobListItem, JobMediaUploadTarget, JobView } from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';
import { FALLBACK_POLL_MS } from './polling';

export const jobKeys = {
  list: (scope: string) => ['jobs', scope] as const,
  detail: (id: string) => ['job', id] as const,
  addresses: ['addresses'] as const,
};

export interface JobDraftInput {
  categoryId: string;
  description?: string;
  priority?: 'NORMAL' | 'URGENT';
  requestType?: 'LABOUR_ONLY' | 'LABOUR_AND_MATERIAL';
  addressId?: string;
  preferredStart?: string;
  bookedForName?: string;
  bookedForPhone?: string;
}

export function useAddresses() {
  return useQuery({
    queryKey: jobKeys.addresses,
    queryFn: () => api<{ items: AddressView[] }>('/me/addresses'),
    staleTime: 60_000,
  });
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { line1: string; city: string; pincode: string; label?: string; landmark?: string }) =>
      api<AddressView>('/me/addresses', { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.addresses }),
  });
}

export function useJobs(scope: 'active' | 'past' | 'all' = 'all') {
  return useQuery({
    queryKey: jobKeys.list(scope),
    queryFn: () => api<{ items: JobListItem[] }>(`/me/jobs?scope=${scope}`),
    staleTime: 15_000,
  });
}

export function useJob(id: string | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: jobKeys.detail(id ?? ''),
    enabled: !!id,
    queryFn: () => api<JobView>(`/jobs/${id}`),
    // A live booking changes on the server (offers arriving), so poll while it is open.
    refetchInterval: opts.poll ? FALLBACK_POLL_MS : false,
  });
}

export function useCreateDraft() {
  return useMutation({
    mutationFn: (body: JobDraftInput) => api<JobView>('/jobs', { method: 'POST', body, idempotencyKey: newIdempotencyKey() }),
  });
}

export function useUpdateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: JobDraftInput & { id: string }) => api<JobView>(`/jobs/${id}`, { method: 'PATCH', body }),
    onSuccess: (job) => qc.setQueryData(jobKeys.detail(job.id), job),
  });
}

export interface LocalMedia {
  uri: string;
  kind: 'PHOTO' | 'VOICE_NOTE';
  mime: string;
  sizeBytes: number;
  durationSeconds?: number;
}

/**
 * Registers the file with the API and, when the storage adapter is live, transfers the bytes.
 * In mock mode the API marks the row uploaded and tells us to skip the transfer.
 */
export function useAttachMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId, file }: { jobId: string; file: LocalMedia }) => {
      const res = await api<JobMediaUploadTarget>(`/jobs/${jobId}/media`, {
        method: 'POST',
        body: {
          kind: file.kind,
          mime: file.mime,
          sizeBytes: file.sizeBytes,
          ...(file.durationSeconds ? { durationSeconds: Math.round(file.durationSeconds) } : {}),
        },
      });
      if (res.upload.required) {
        const blob = await (await fetch(file.uri)).blob();
        await fetch(res.upload.url, { method: res.upload.method, body: blob, headers: { 'content-type': file.mime } });
      }
      return res;
    },
    onSuccess: (_r, vars) => qc.invalidateQueries({ queryKey: jobKeys.detail(vars.jobId) }),
  });
}

export function useRemoveMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, mediaId }: { jobId: string; mediaId: string }) =>
      api<{ ok: true }>(`/jobs/${jobId}/media/${mediaId}`, { method: 'DELETE' }),
    onSuccess: (_r, vars) => qc.invalidateQueries({ queryKey: jobKeys.detail(vars.jobId) }),
  });
}

export function useSubmitJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      api<{ job: JobView; duplicateOf: string | null }>(`/jobs/${jobId}/submit`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: (res) => {
      qc.setQueryData(jobKeys.detail(res.job.id), res.job);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, reason }: { jobId: string; reason: string }) =>
      api<JobView>(`/jobs/${jobId}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: (job) => {
      qc.setQueryData(jobKeys.detail(job.id), job);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
