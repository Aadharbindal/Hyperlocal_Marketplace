import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddressView,
  JobListItem,
  JobMediaUploadTarget,
  JobView,
  ProposeTimeBody,
  RescheduleBody,
  RescheduleView,
  RespondToProposalBody,
  ScheduleProposalView,
} from '@hyperlocal/core';
import { api, newIdempotencyKey } from './client';
import { FALLBACK_POLL_MS } from './polling';

export const jobKeys = {
  list: (scope: string) => ['jobs', scope] as const,
  detail: (id: string) => ['job', id] as const,
  addresses: ['addresses'] as const,
  rebook: ['rebook'] as const,
};

export interface RebookItem {
  jobId: string;
  categoryId: string;
  categoryName: string;
  iconKey: string;
  description: string | null;
  addressId: string | null;
  lastAt: string;
  providerName: string | null;
  providerId: string | null;
}

/**
 * Work this person has had done before.
 *
 * A returning customer used to start from the same blank grid as a stranger - the app
 * remembered nothing about somebody having already trusted it with their home. In this business
 * the second booking is the business; the first is the expensive one to win.
 */
export function useRebookable() {
  return useQuery({
    queryKey: jobKeys.rebook,
    queryFn: () => api<{ items: RebookItem[] }>('/me/rebook'),
    // Nobody's history changes while they are looking at the home screen.
    staleTime: 5 * 60_000,
  });
}

/** Starts a fresh draft from a finished job: same work, same place, quoted again from scratch. */
export function useRebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api<JobView>(`/jobs/from/${jobId}`, { method: 'POST', idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.list('active') }),
  });
}

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

/** The fields the address form can change. Matches AddressUpdate on the server. */
export interface AddressEdit {
  label?: string | null;
  line1?: string;
  line2?: string | null;
  landmark?: string | null;
  societyName?: string | null;
  gateInstructions?: string | null;
  city?: string;
  pincode?: string;
}

export function useUpdateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AddressEdit & { id: string }) =>
      api<AddressView>(`/me/addresses/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.addresses }),
  });
}

/**
 * Removing an address.
 *
 * Not only a convenience: somebody who has moved house cannot otherwise get their old home
 * address out of this system at all, which makes it a privacy problem as much as a usability
 * one. The server soft-deletes, so bookings that already happened keep the address they were
 * carried out at.
 */
export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/me/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.addresses }),
  });
}

// ---------------------------------------------------------------- moving a booking
/**
 * Suggesting another time instead of cancelling.
 *
 * A customer who cannot be home on Tuesday used to have to cancel and start over - which costs
 * them the price they agreed and costs the provider the job. Either side may suggest; nothing
 * moves until the other answers.
 */
export function useTimeProposal(jobId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['time-proposal', jobId],
    enabled,
    queryFn: () => api<{ proposal: ScheduleProposalView | null }>(`/jobs/${jobId}/time-proposal`),
    staleTime: 15_000,
  });
}

/**
 * The customer moving their own booking.
 *
 * Deliberately different from the provider's path below, and the asymmetry is the point: the
 * customer's time is theirs to arrange, so this moves the booking outright and tells the
 * professional, who blocked a slot for it. A provider wanting a different time has to *ask*.
 * The server caps the number of moves and refuses once somebody may already be travelling.
 */
export function useRescheduleBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: RescheduleBody & { jobId: string }) =>
      api<RescheduleView>(`/jobs/${jobId}/reschedule`, { method: 'POST', body }),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: jobKeys.detail(vars.jobId) });
      void qc.invalidateQueries({ queryKey: ['time-proposal', vars.jobId] });
    },
  });
}

export function useProposeTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, ...body }: ProposeTimeBody & { jobId: string }) =>
      api<{ proposal: ScheduleProposalView }>(`/jobs/${jobId}/propose-time`, { method: 'POST', body }),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['time-proposal', vars.jobId] });
      void qc.invalidateQueries({ queryKey: jobKeys.detail(vars.jobId) });
    },
  });
}

export function useRespondToProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, ...body }: RespondToProposalBody & { proposalId: string; jobId: string }) =>
      api<{ proposal: ScheduleProposalView }>(`/time-proposals/${proposalId}/respond`, { method: 'POST', body }),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['time-proposal', vars.jobId] });
      void qc.invalidateQueries({ queryKey: jobKeys.detail(vars.jobId) });
    },
  });
}

export function useWithdrawProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId }: { proposalId: string; jobId: string }) =>
      api<{ proposal: ScheduleProposalView }>(`/time-proposals/${proposalId}/withdraw`, { method: 'POST' }),
    onSuccess: (_r, vars) => {
      void qc.invalidateQueries({ queryKey: ['time-proposal', vars.jobId] });
    },
  });
}

/**
 * The provider backing out of a confirmed booking.
 *
 * Free for the customer, always a strike for the provider, and - before anybody has arrived - it
 * re-opens the booking to the professionals whose offers lost rather than ending it. The screen
 * that calls this says so, because a provider who thinks they are cancelling on somebody is far
 * more likely to simply not turn up instead.
 */
export function useCancelAsProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, reason }: { jobId: string; reason: string }) =>
      api<{ id: string; status: string; redispatch: { invited: number; expiresAt: string } | null }>(
        `/jobs/${jobId}/cancel-as-provider`,
        { method: 'POST', body: { reason } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['provider'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
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
        // Tell the server the bytes landed. With a remote provider the transfer never touches
        // our API, so without this the row claims a file it cannot prove - and a completion
        // photo that does not exist is discovered during a dispute, which is the worst moment.
        await api(`/jobs/${jobId}/media/${res.media.id}/uploaded`, { method: 'POST' });
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
