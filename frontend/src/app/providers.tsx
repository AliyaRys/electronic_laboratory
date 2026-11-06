/**
 * Global providers: TanStack Query owns server state (ADR-008). Mutations
 * never retry automatically; staleTime is zero because the backend sends
 * no-store for working data.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { SESSION_EXPIRED_EVENT } from "../shared/api/client";
import { LOGOUT_EVENT, clearQueryCache } from "../features/context/SwitchContext";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }): React.ReactElement {
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    // 401 and logout both leave the working context: closed data is dropped.
    const clear = (): void => {
      clearQueryCache(queryClient);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, clear);
    window.addEventListener(LOGOUT_EVENT, clear);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, clear);
      window.removeEventListener(LOGOUT_EVENT, clear);
    };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
