import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Language, UserRole, UserView } from '@hyperlocal/core';

const KEY = 'hl.session.v1';

interface Persisted {
  accessToken: string;
  refreshToken: string;
  activeRole: UserRole | null;
}

interface SessionState {
  hydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  user: UserView | null;
  activeRole: UserRole | null;
  language: Language;
  hydrate(): Promise<void>;
  setTokens(t: { accessToken: string; refreshToken: string }): Promise<void>;
  setUser(u: UserView | null): void;
  setActiveRole(r: UserRole | null): Promise<void>;
  setLanguage(l: Language): void;
  signOut(): Promise<void>;
}

// SecureStore is unavailable on web; fall back to localStorage for the web preview only.
const storage = {
  async get(): Promise<Persisted | null> {
    try {
      const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
      return raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      return null;
    }
  },
  async set(p: Persisted | null) {
    try {
      if (Platform.OS === 'web') {
        if (p) globalThis.localStorage?.setItem(KEY, JSON.stringify(p));
        else globalThis.localStorage?.removeItem(KEY);
        return;
      }
      if (p) await SecureStore.setItemAsync(KEY, JSON.stringify(p));
      else await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* storage failure must never crash the app */
    }
  },
};

export const useSession = create<SessionState>((set, get) => ({
  hydrated: false,
  accessToken: null,
  refreshToken: null,
  user: null,
  activeRole: null,
  language: 'en',
  async hydrate() {
    const p = await storage.get();
    set({ hydrated: true, accessToken: p?.accessToken ?? null, refreshToken: p?.refreshToken ?? null, activeRole: p?.activeRole ?? null });
  },
  async setTokens(t) {
    set({ accessToken: t.accessToken, refreshToken: t.refreshToken });
    await storage.set({ accessToken: t.accessToken, refreshToken: t.refreshToken, activeRole: get().activeRole });
  },
  setUser(user) {
    const roles = user?.roles.filter((r) => r.status === 'ACTIVE').map((r) => r.role) ?? [];
    const current = get().activeRole;
    const activeRole = current && roles.includes(current) ? current : (roles[0] ?? null);
    set({ user, activeRole, language: user?.preferredLanguage ?? get().language });
  },
  async setActiveRole(activeRole) {
    set({ activeRole });
    const { accessToken, refreshToken } = get();
    if (accessToken && refreshToken) await storage.set({ accessToken, refreshToken, activeRole });
  },
  setLanguage(language) {
    set({ language });
  },
  async signOut() {
    set({ accessToken: null, refreshToken: null, user: null, activeRole: null });
    await storage.set(null);
  },
}));
