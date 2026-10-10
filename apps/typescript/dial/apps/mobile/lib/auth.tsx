import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { SessionUser } from '@dial/schemas';
import { api, setToken, getToken } from './api';
import { registerPush, unregisterPush } from './push';

interface AuthValue {
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on launch, so the app opens where the user left it.
  useEffect(() => {
    void (async () => {
      const token = await getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        setUser(me.user);
        // Signed in again: keep this device's push registration current.
        void registerPush();
      } catch {
        await setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      signIn: async (email, password) => {
        const result = await api.signIn({ email, password });
        if (result.token) await setToken(result.token);
        setUser(result.user);
        void registerPush();
      },
      signUp: async (email, password, name) => {
        const result = await api.signUp({ email, password, name });
        if (result.token) await setToken(result.token);
        setUser(result.user);
        void registerPush();
      },
      signOut: async () => {
        try {
          await api.signOut();
        } finally {
          // The device stops receiving this account's pushes even if the
          // server call above failed.
          await unregisterPush();
          await setToken(null);
          setUser(null);
        }
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
