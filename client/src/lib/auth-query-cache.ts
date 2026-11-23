import type { QueryClient } from "@tanstack/react-query";

/** Cancel prior-account requests before removing their cached responses. */
export async function clearAuthenticatedQueryCache(client: QueryClient) {
  await client.cancelQueries();
  client.clear();
}