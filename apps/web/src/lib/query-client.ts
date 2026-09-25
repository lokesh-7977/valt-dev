import { isServer, QueryClient } from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false },
      // AI calls are billed and slow — never retry a mutation automatically.
      mutations: { retry: false },
    },
  });
}

let browserClient: QueryClient | undefined;

/** One client per request on the server (no cross-user leaks), one for the whole browser session. */
export function getQueryClient() {
  if (isServer) return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
