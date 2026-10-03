import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { clearSession, getRole, getToken, getUsername, saveSession, type Role } from './api';

const AuthCtx = createContext<{
  role: Role | null;
  username: string | null;
  login: (token: string, role: Role, username: string) => void;
  logout: () => void;
}>({ role: null, username: null, login: () => undefined, logout: () => undefined });

export function useAuth() {
  return useContext(AuthCtx);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(() => ({
    role: getToken() ? getRole() : null,
    username: getUsername(),
  }));

  return (
    <AuthCtx.Provider
      value={{
        role: session.role,
        username: session.username,
        login: (token, role, username) => {
          saveSession(token, role, username);
          setSession({ role, username });
        },
        logout: () => {
          clearSession();
          setSession({ role: null, username: null });
        },
      }}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AuthCtx.Provider>
  );
}
