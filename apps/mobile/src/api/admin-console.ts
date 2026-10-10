import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OpsReportView, RoleStatus, UserRole, UserStatus } from '@hyperlocal/core';
import { api } from './client';

export const consoleKeys = {
  overview: ['admin', 'overview'] as const,
  users: (q: string) => ['admin', 'users', q] as const,
  audit: (filter: string) => ['admin', 'audit', filter] as const,
  scheduler: ['admin', 'scheduler'] as const,
  settlements: (status: string) => ['admin', 'settlements', status] as const,
};

/**
 * The overview, as the contract defines it.
 *
 * This was a hand-written copy that had drifted: it declared eleven of the report's fourteen
 * fields, so `providersVerified`, `providersSuspended` and `jobsByStatus` had been computed by
 * both data stores and sent on every request since the report was written, and were invisible to
 * the one screen that reads it. Nobody had to delete them - they just never existed in the type,
 * so nothing could show them and nothing complained.
 */
export type OpsOverview = OpsReportView;


/** The numbers somebody on call wants first: what is live, what is stuck, what is owed. */
export function useOpsOverview() {
  return useQuery({
    queryKey: consoleKeys.overview,
    queryFn: () => api<OpsOverview>('/admin/reports/overview'),
    staleTime: 60_000,
  });
}

export interface AdminUser {
  id: string;
  displayName: string | null;
  phone: string;
  status: UserStatus;
  /*
   * `{ role, status }`, not a list of names. It was typed as `string[]` here, and the console
   * joined it - so the row under every person's phone number read "[object object]". Somebody
   * deciding whether to suspend an account could not see what that account *is*.
   *
   * The per-role status matters as much as the name: a REVOKED provider role and an active one
   * are very different accounts to be looking at.
   */
  roles: Array<{ role: UserRole; status: RoleStatus }>;
  suspendedReason: string | null;
}

/** Only runs on a real query: an empty search would walk every user for nothing. */
export function useUserSearch(q: string) {
  return useQuery({
    queryKey: consoleKeys.users(q),
    enabled: q.trim().length >= 2,
    queryFn: async () => (await api<{ items: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q.trim())}`)).items,
    staleTime: 30_000,
  });
}

/** Suspension is a two-person action; this is the approved route, not the retired M1 one. */
export function useSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string; reason: string; secondApproverId: string }) =>
      api<{ ok: boolean }>(`/admin/users/${userId}/suspend-approved`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      api<{ ok: boolean }>(`/admin/users/${userId}/reactivate`, { method: 'POST', body: { reason } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export function useAuditLog(entityType?: string, entityId?: string) {
  const query = new URLSearchParams();
  if (entityType) query.set('entityType', entityType);
  if (entityId) query.set('entityId', entityId);
  const key = query.toString();
  return useQuery({
    queryKey: consoleKeys.audit(key),
    queryFn: async () => (await api<{ items: AuditEntry[] }>(`/admin/audit-logs?${key}`)).items,
    staleTime: 30_000,
  });
}

export interface SchedulerTask {
  task: string;
  description: string;
  runs: number;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export function useScheduler() {
  return useQuery({
    queryKey: consoleKeys.scheduler,
    /*
     * `streams` is `{ streams, users }` - open event streams, and how many distinct people they
     * belong to. It was typed here as `{ connections }`, a field the server has never sent, so
     * the console rendered " live connections" with nothing in front of it. A hand-written type
     * for a response nobody checks it against will say whatever it was first guessed to say.
     */
    queryFn: () => api<{ tasks: SchedulerTask[]; streams: { streams: number; users: number } }>('/admin/scheduler'),
    refetchInterval: 30_000,
  });
}

export function useRunTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (task: string) => api<{ result: unknown }>('/admin/scheduler/run', { method: 'POST', body: { task } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: consoleKeys.scheduler }),
  });
}

export interface AdminSettlement {
  id: string;
  jobId: string;
  amountPaise: number;
  status: string;
  payeeRole: string;
  attempts: number;
  failureReason: string | null;
}

export function useSettlements(status: string) {
  return useQuery({
    queryKey: consoleKeys.settlements(status),
    queryFn: async () => (await api<{ items: AdminSettlement[] }>(`/admin/settlements?status=${status}`)).items,
    staleTime: 30_000,
  });
}

export function useRetrySettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/admin/settlements/${id}/retry`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'settlements'] }),
  });
}
