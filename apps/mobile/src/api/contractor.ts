import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContractorJobItem, TechnicianView } from '@hyperlocal/core';
import { api } from './client';
import { FALLBACK_POLL_MS } from './polling';

export const contractorKeys = {
  profile: ['contractor', 'profile'] as const,
  team: ['contractor', 'team'] as const,
  jobs: ['contractor', 'jobs'] as const,
};

export interface ContractorProfile {
  businessName: string | null;
  verificationStatus: string;
  serviceRadiusKm: number;
  teamSize: number;
  verifiedTeamSize: number;
}

export function useContractorProfile() {
  return useQuery({
    queryKey: contractorKeys.profile,
    queryFn: () => api<ContractorProfile>('/contractor/profile'),
    staleTime: 60_000,
    retry: false,
  });
}

export function useSaveContractorProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { businessName: string; baseAddressId?: string; serviceRadiusKm?: number }) =>
      api<{ businessName: string }>('/contractor/profile', { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: contractorKeys.profile }),
  });
}

export function useTeam() {
  return useQuery({
    queryKey: contractorKeys.team,
    queryFn: async () => (await api<{ items: TechnicianView[] }>('/contractor/technicians')).items,
    staleTime: 30_000,
  });
}

/**
 * Adding somebody to the crew. They must already have an account on that number - a contractor
 * cannot conjure one - and adding them is what grants the technician role.
 */
export function useAddTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone: string; fullName: string; skills?: string[] }) =>
      api<{ technician: TechnicianView }>('/contractor/technicians', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractorKeys.team });
      void qc.invalidateQueries({ queryKey: contractorKeys.profile });
    },
  });
}

export function useRemoveTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<{ ok: true }>(`/contractor/technicians/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractorKeys.team });
      void qc.invalidateQueries({ queryKey: contractorKeys.profile });
    },
  });
}

/** Submitting a crew member's documents. Staff decide the outcome; the contractor never does. */
export function useSubmitTechnicianKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string; documentType: string; documentNumber: string; mime: string; sizeBytes: number }) =>
      api<{ kyc: { id: string; status: string } }>(`/contractor/technicians/${userId}/kyc`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: contractorKeys.team }),
  });
}

/** Every live job this crew holds, and who is on each one. */
export function useContractorJobs() {
  return useQuery({
    queryKey: contractorKeys.jobs,
    queryFn: async () => (await api<{ items: ContractorJobItem[] }>('/contractor/jobs')).items,
    refetchInterval: FALLBACK_POLL_MS,
  });
}

/** Putting somebody from the crew on a job. */
export function useAssignTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, technicianId }: { jobId: string; technicianId: string }) =>
      api<{ assignmentId: string }>(`/jobs/${jobId}/technician`, { method: 'POST', body: { technicianId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractorKeys.jobs });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
