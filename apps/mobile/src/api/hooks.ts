import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AvatarUploadResponse,
  CategoryView,
  CreateServicePlanBody,
  ServicePlanView,
  ServicePlansResponse,
  UpdateServicePlanBody,
  CompleteProfileBody,
  EmergencyContactView,
  EmergencyContactsResponse,
  GrantRoleBody,
  MeResponse,
  RequestOtpResponse,
  VerifyOtpResponse,
} from '@hyperlocal/core';
import { useSession } from '@/store/session';
import { api, newIdempotencyKey } from './client';

export const keys = {
  me: ['me'] as const,
  categories: (lang: string) => ['categories', lang] as const,
};

export function useMe(enabled = true) {
  const setUser = useSession((s) => s.setUser);
  const token = useSession((s) => s.accessToken);
  return useQuery({
    queryKey: keys.me,
    enabled: enabled && !!token,
    queryFn: async () => {
      const me = await api<MeResponse>('/me');
      setUser(me.user);
      return me;
    },
    staleTime: 30_000,
  });
}

export function useCategories() {
  const lang = useSession((s) => s.language);
  return useQuery({
    queryKey: keys.categories(lang),
    queryFn: () => api<{ items: CategoryView[] }>('/categories', { auth: false }),
    staleTime: 5 * 60_000,
  });
}

export function useRequestOtp() {
  return useMutation({
    mutationFn: (phone: string) => api<RequestOtpResponse>('/auth/request-otp', { method: 'POST', body: { phone }, auth: false }),
  });
}

export function useVerifyOtp() {
  const setTokens = useSession((s) => s.setTokens);
  const setUser = useSession((s) => s.setUser);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { challengeId: string; code: string }) =>
      api<VerifyOtpResponse>('/auth/verify-otp', { method: 'POST', body: input, auth: false }),
    onSuccess: async (res) => {
      await setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      setUser(res.user);
      await qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useGrantRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: GrantRoleBody['role']) =>
      api<{ role: string; status: string }>('/me/roles', { method: 'POST', body: { role }, idempotencyKey: newIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  const setUser = useSession((s) => s.setUser);
  return useMutation({
    mutationFn: (body: { displayName?: string; preferredLanguage?: 'en' | 'hi'; email?: string | null; avatarKey?: string | null }) =>
      api<{ user: MeResponse['user'] }>('/me', { method: 'PATCH', body }),
    // The session copy is updated from the response, not left for the refetch. Without this the
    // header still says the old name for as long as the /me query takes to come back, which on a
    // patchy connection is long enough to look like the save did not work.
    onSuccess: async (res) => {
      setUser(res.user);
      await qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

/** The one-time screen after the OTP: a name, optionally an email, and the terms. */
export function useCompleteProfile() {
  const qc = useQueryClient();
  const setUser = useSession((s) => s.setUser);
  return useMutation({
    mutationFn: (body: CompleteProfileBody) => api<{ user: MeResponse['user'] }>('/me/complete-profile', { method: 'POST', body }),
    onSuccess: async (res) => {
      setUser(res.user);
      await qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

/**
 * Uploads a profile photo and commits it to the account.
 *
 * Three steps behind one call, because the caller has no business knowing about signed URLs: ask
 * for a target, PUT the bytes straight at storage, then tell the API the key is good. The commit
 * is last on purpose - an upload that dies half way leaves the previous photo in place instead of
 * a blank circle.
 */
export function useUploadAvatar() {
  const update = useUpdateMe();
  return useMutation({
    mutationFn: async (file: { uri: string; mime: 'image/jpeg' | 'image/png' | 'image/webp' }) => {
      const blob = await (await fetch(file.uri)).blob();
      const target = await api<AvatarUploadResponse>('/me/avatar', { method: 'POST', body: { mime: file.mime, bytes: blob.size } });
      const put = await fetch(target.url, { method: target.method, headers: { 'content-type': file.mime }, body: blob });
      if (!put.ok) throw new Error(`upload failed (${put.status})`);
      return update.mutateAsync({ avatarKey: target.key });
    },
  });
}

export function useRemoveAvatar() {
  const update = useUpdateMe();
  return useMutation({ mutationFn: () => update.mutateAsync({ avatarKey: null }) });
}

export const emergencyKeys = { contacts: ['emergency-contacts'] as const };

export function useEmergencyContacts() {
  const token = useSession((s) => s.accessToken);
  return useQuery({
    queryKey: emergencyKeys.contacts,
    enabled: !!token,
    queryFn: () => api<EmergencyContactsResponse>('/me/emergency-contacts'),
    staleTime: 60_000,
  });
}

export function useAddEmergencyContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; phone: string; relationship?: string }) =>
      api<{ contact: EmergencyContactView }>('/me/emergency-contacts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.contacts }),
  });
}

export function useRemoveEmergencyContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/me/emergency-contacts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.contacts }),
  });
}

/**
 * Closes the account.
 *
 * Both app stores require this to be reachable from inside the app, and it is the one destructive
 * thing here that cannot be undone from the phone - so the screen that calls it does the
 * confirming, and this hook signs out immediately afterwards because the API has already revoked
 * every session and the tokens in memory are now dead.
 */
export function useDeleteAccount() {
  const signOut = useSession((s) => s.signOut);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean; scheduledFor: string; retained: string }>('/me', { method: 'DELETE' }),
    onSuccess: async () => {
      await signOut();
      qc.clear();
    },
  });
}

export function useLogout() {
  const signOut = useSession((s) => s.signOut);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { refreshToken } = useSession.getState();
      try {
        await api('/auth/logout', { method: 'POST', body: { refreshToken } });
      } catch {
        /* local sign-out proceeds even if the network call fails */
      }
    },
    onSettled: async () => {
      await signOut();
      qc.clear();
    },
  });
}

export const planKeys = { list: ['service-plans'] as const };

/**
 * Standing arrangements - the AC every three months, the clean every month.
 *
 * Nothing here touches money. A plan opens an ordinary booking when it falls due, and that
 * booking is quoted and paid for like any other; there is no saved card and no automatic charge,
 * which is a deliberate refusal rather than a missing feature (see 0020).
 */
export function useServicePlans() {
  const token = useSession((s) => s.accessToken);
  return useQuery({
    queryKey: planKeys.list,
    enabled: !!token,
    queryFn: () => api<ServicePlansResponse>('/me/service-plans'),
    staleTime: 60_000,
  });
}

export function useCreateServicePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateServicePlanBody) => api<ServicePlanView>('/me/service-plans', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: planKeys.list }),
  });
}

export function useUpdateServicePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateServicePlanBody & { id: string }) =>
      api<ServicePlanView>(`/me/service-plans/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: planKeys.list }),
  });
}

export function useSkipNextVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api<ServicePlanView>(`/me/service-plans/${id}/skip-next`, { method: 'POST', body: { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: planKeys.list }),
  });
}
