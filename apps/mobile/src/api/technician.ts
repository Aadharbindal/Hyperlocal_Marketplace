import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { FALLBACK_POLL_MS } from './polling';

export const technicianKeys = {
  profile: ['technician', 'profile'] as const,
  jobs: ['technician', 'jobs'] as const,
};

export interface TechnicianProfile {
  fullName: string | null;
  verificationStatus: string;
  active: boolean;
  /** Who is answerable for them - which is what the customer is really being told. */
  teamName: string | null;
}

export function useTechnicianProfile() {
  return useQuery({
    queryKey: technicianKeys.profile,
    queryFn: () => api<TechnicianProfile>('/technician/profile'),
    staleTime: 60_000,
    retry: false,
  });
}

export interface TechnicianJob {
  jobId: string;
  status: string;
  categoryName: string;
  description: string | null;
  preferredStart: string | null;
  customerName: string;
  /** The full address: somebody who has been assigned has to be able to arrive. */
  address: string | null;
  lat: number | null;
  lng: number | null;
}

/** Where they are going next. Live work first, which is the question this screen answers. */
export function useTechnicianJobs() {
  return useQuery({
    queryKey: technicianKeys.jobs,
    queryFn: async () => (await api<{ items: TechnicianJob[] }>('/technician/jobs')).items,
    refetchInterval: FALLBACK_POLL_MS,
  });
}
