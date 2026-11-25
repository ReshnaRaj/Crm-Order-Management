import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { authApi } from '@/api/auth.api';
import { onUnauthorized } from '@/lib/api-client';
import { authStorage } from '@/lib/auth-storage';
import type { AuthResponse, User } from '@/types/auth';
import { AuthContext, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setLoading] = useState(() => authStorage.getToken() !== null);

  // Restore session on load
  useEffect(() => {
    if (!authStorage.getToken()) return;
    authApi
      .me()
      .then(setUser)
      .catch(() => authStorage.clear())
      .finally(() => setLoading(false));
  }, []);

  // Expired / revoked session anywhere in the app -> back to login.
  // Side effects stay out of state updaters (StrictMode runs updaters twice), and the toast
  // has a fixed id so several concurrent 401 responses show a single message.
  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  useEffect(
    () =>
      onUnauthorized(() => {
        if (userRef.current) {
          toast.error('Your session has ended. Please sign in again.', { id: 'session-ended' });
        }
        userRef.current = null;
        setUser(null);
        queryClient.clear();
      }),
    [queryClient],
  );

  const accept = useCallback((res: AuthResponse) => {
    authStorage.set(res.accessToken, res.expiresAt);
    setUser(res.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      setUser,
      login: async (email, password) => accept(await authApi.login({ email, password })),
      register: async (name, email, password) =>
        accept(await authApi.register({ name, email, password })),
      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          /* token may already be invalid – clear locally regardless */
        }
        authStorage.clear();
        setUser(null);
        queryClient.clear();
      },
    }),
    [user, isLoading, accept, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
