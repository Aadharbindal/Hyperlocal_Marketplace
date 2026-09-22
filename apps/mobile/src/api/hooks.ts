import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CategoryView, GrantRoleBody, MeResponse, RequestOtpResponse, VerifyOtpResponse } from '@hyperlocal/core';
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
  return useMutation({
    mutationFn: (body: { displayName?: string; preferredLanguage?: 'en' | 'hi' }) => api<{ user: MeResponse['user'] }>('/me', { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
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
