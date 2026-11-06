/**
 * Global providers: TanStack Query owns server state (ADR-008). Mutations
 * never retry automatically; staleTime is zero because the backend sends
 * no-store for working data.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { SESSION_EXPIRED_EVENT } from "../shared/api/client";
import { clearQueryCache } from "../entities/session/context";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({
  children,
  queryClient: provided,
}: {
  children: ReactNode;
  /** Test seam: inject a client to observe cache-clearing behaviour. */
  queryClient?: QueryClient;
}): React.ReactElement {
  const [queryClient] = useState(() => provided ?? createQueryClient());

  useEffect(() => {
    // A 401 leaves the working context: closed data is dropped exactly once.
    // Logout clears via performLogout, which never re-dispatches into this
    // handler — clearQueryCache does not emit events (regression F01-r1).
    const clear = (): void => {
      clearQueryCache(queryClient);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, clear);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, clear);
    };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
